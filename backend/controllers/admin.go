package controllers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"bakeflow/configs"
	"bakeflow/models"

	"github.com/gorilla/mux"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

type facebookProfile struct {
	Name    string `json:"name"`
	Picture struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	} `json:"picture"`
}

type facebookErrorResponse struct {
	Error struct {
		Message      string `json:"message"`
		Type         string `json:"type"`
		Code         int    `json:"code"`
		ErrorSubcode int    `json:"error_subcode"`
	} `json:"error"`
}

func extractFacebookError(err error) facebookErrorResponse {
	if err == nil {
		return facebookErrorResponse{}
	}
	raw := err.Error()
	idx := strings.Index(raw, "{")
	if idx == -1 {
		return facebookErrorResponse{}
	}
	var parsed facebookErrorResponse
	if json.Unmarshal([]byte(raw[idx:]), &parsed) != nil {
		return facebookErrorResponse{}
	}
	return parsed
}

func isOutsideMessagingWindow(err error) bool {
	if err == nil {
		return false
	}
	raw := err.Error()
	if strings.Contains(raw, "outside of allowed window") || strings.Contains(raw, "2018278") {
		return true
	}
	parsed := extractFacebookError(err)
	return parsed.Error.ErrorSubcode == 2018278
}

func isProfileLookupSkippable(err error) bool {
	if err == nil {
		return false
	}
	raw := err.Error()
	if strings.Contains(raw, "Unsupported get request") || strings.Contains(raw, "error_subcode\":33") || strings.Contains(raw, "Object with ID") {
		return true
	}
	parsed := extractFacebookError(err)
	return parsed.Error.Code == 100 && parsed.Error.ErrorSubcode == 33
}

func fetchFacebookProfile(client *http.Client, senderID string) (string, string, error) {
	pageAccessToken := os.Getenv("PAGE_ACCESS_TOKEN")
	if pageAccessToken == "" {
		return "", "", fmt.Errorf("PAGE_ACCESS_TOKEN not set")
	}

	profileURL := url.URL{
		Scheme: "https",
		Host:   "graph.facebook.com",
		Path:   fmt.Sprintf("/v18.0/%s", url.PathEscape(senderID)),
	}
	query := profileURL.Query()
	query.Set("fields", "name,picture.type(large)")
	query.Set("access_token", pageAccessToken)
	profileURL.RawQuery = query.Encode()

	resp, err := client.Get(profileURL.String())
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("facebook profile lookup failed: %s", string(body))
	}

	var profile facebookProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return "", "", err
	}

	return strings.TrimSpace(profile.Name), strings.TrimSpace(profile.Picture.Data.URL), nil
}

type adminTokenPayload struct {
	AdminID int   `json:"admin_id"`
	Exp     int64 `json:"exp"`
	Iat     int64 `json:"iat"`
}

func getAdminTokenSecret() []byte {
	secret := strings.TrimSpace(os.Getenv("ADMIN_TOKEN_SECRET"))
	if secret == "" {
		return nil
	}
	return []byte(secret)
}

func getAdminTokenTTL() time.Duration {
	ttl := 24 * time.Hour
	if s := strings.TrimSpace(os.Getenv("ADMIN_TOKEN_TTL_HOURS")); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			if n > 0 && n <= 720 {
				ttl = time.Duration(n) * time.Hour
			}
		}
	}
	return ttl
}

func generateAdminToken(adminID int, ttl time.Duration) (string, error) {
	secret := getAdminTokenSecret()
	if len(secret) == 0 {
		return "", errors.New("ADMIN_TOKEN_SECRET is not set")
	}
	if adminID <= 0 {
		return "", errors.New("invalid admin id")
	}
	if ttl <= 0 {
		ttl = getAdminTokenTTL()
	}

	now := time.Now().Unix()
	payload := adminTokenPayload{AdminID: adminID, Iat: now, Exp: now + int64(ttl.Seconds())}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(payloadB64))
	sig := mac.Sum(nil)
	sigB64 := base64.RawURLEncoding.EncodeToString(sig)
	return payloadB64 + "." + sigB64, nil
}

func verifyAdminToken(token string) (int, error) {
	secret := getAdminTokenSecret()
	if len(secret) == 0 {
		return 0, errors.New("ADMIN_TOKEN_SECRET is not set")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return 0, errors.New("invalid token format")
	}
	payloadB64 := parts[0]
	sigB64 := parts[1]

	payloadJSON, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return 0, errors.New("invalid payload encoding")
	}
	providedSig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return 0, errors.New("invalid signature encoding")
	}

	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(payloadB64))
	expectedSig := mac.Sum(nil)
	if !hmac.Equal(providedSig, expectedSig) {
		return 0, errors.New("invalid token signature")
	}

	var payload adminTokenPayload
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return 0, errors.New("invalid payload")
	}
	if payload.AdminID <= 0 {
		return 0, errors.New("missing admin id")
	}
	if payload.Exp <= 0 {
		return 0, errors.New("missing exp")
	}
	if time.Now().Unix() > payload.Exp {
		return 0, errors.New("token expired")
	}

	return payload.AdminID, nil
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := strings.TrimSpace(r.Header.Get("Authorization"))
		if auth == "" {
			http.Error(w, "missing authorization", http.StatusUnauthorized)
			return
		}
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) != 2 || strings.ToLower(strings.TrimSpace(parts[0])) != "bearer" {
			http.Error(w, "invalid authorization header", http.StatusUnauthorized)
			return
		}
		adminID, err := verifyAdminToken(strings.TrimSpace(parts[1]))
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), adminIDContextKey, adminID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func AdminLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request"})
		return
	}

	identifier := strings.TrimSpace(req.Identifier)
	password := req.Password
	if identifier == "" || strings.TrimSpace(password) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing credentials"})
		return
	}

	if configs.DB == nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not configured"})
		return
	}

	var admin struct {
		ID           int
		Username     string
		Email        string
		PasswordHash string
		RoleID       int
	}
	err := configs.DB.QueryRow(
		`SELECT id, username, email, password_hash, role_id FROM admins WHERE username = $1 OR email = $1`,
		identifier,
	).Scan(&admin.ID, &admin.Username, &admin.Email, &admin.PasswordHash, &admin.RoleID)
	if err != nil {
		if err == sql.ErrNoRows {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid credentials"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to authenticate"})
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(password)) != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid credentials"})
		return
	}

	tok, err := generateAdminToken(admin.ID, getAdminTokenTTL())
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "token not configured"})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   tok,
		"admin": map[string]interface{}{
			"id":       admin.ID,
			"username": admin.Username,
			"email":    admin.Email,
			"role_id":  admin.RoleID,
		},
	})
}

func AdminMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	adminID := getAdminIDFromContext(r)
	if !adminID.Valid {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "unauthorized"})
		return
	}
	if configs.DB == nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not configured"})
		return
	}

	var out struct {
		ID       int    `json:"id"`
		Username string `json:"username"`
		Email    string `json:"email"`
		RoleID   int    `json:"role_id"`
	}
	err := configs.DB.QueryRow(
		`SELECT id, username, email, role_id FROM admins WHERE id = $1`,
		adminID.Int64,
	).Scan(&out.ID, &out.Username, &out.Email, &out.RoleID)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "unauthorized"})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"admin":   out,
	})
}

func AdminBootstrap(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	bootstrapSecret := strings.TrimSpace(os.Getenv("ADMIN_BOOTSTRAP_SECRET"))
	if bootstrapSecret == "" {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "not found"})
		return
	}
	if strings.TrimSpace(r.Header.Get("X-Admin-Bootstrap-Secret")) != bootstrapSecret {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "forbidden"})
		return
	}
	if configs.DB == nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "database not configured"})
		return
	}

	var existing int
	if err := configs.DB.QueryRow(`SELECT COUNT(*) FROM admins`).Scan(&existing); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to check admins"})
		return
	}
	if existing > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "admin already exists"})
		return
	}

	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request"})
		return
	}

	username := strings.TrimSpace(req.Username)
	email := strings.TrimSpace(req.Email)
	password := req.Password
	if username == "" || email == "" || strings.TrimSpace(password) == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "missing fields"})
		return
	}

	roleID := 1
	_ = configs.DB.QueryRow(`SELECT id FROM admin_roles WHERE name = 'owner'`).Scan(&roleID)

	hashBytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to set password"})
		return
	}

	var adminID int
	err = configs.DB.QueryRow(
		`INSERT INTO admins (username, email, password_hash, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
		username,
		email,
		string(hashBytes),
		roleID,
	).Scan(&adminID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "failed to create admin"})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"admin_id": adminID,
	})
}

// AdminGetOrders returns all orders for admin dashboard
func AdminGetOrders(w http.ResponseWriter, r *http.Request) {
	// Set JSON header before any response
	w.Header().Set("Content-Type", "application/json")

	log.Printf("[Admin] Fetching all orders from database...")

	statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("order_status")))
	var orders []models.Order
	var err error
	if statusFilter != "" {
		orders, err = models.GetOrdersByStatus(statusFilter)
	} else {
		orders, err = models.GetAllOrders()
	}
	if err != nil {
		log.Printf("[Admin] Error fetching orders: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "Error fetching orders",
			"details": err.Error(),
			"orders":  []interface{}{},
			"total":   0,
		})
		return
	}

	log.Printf("[Admin] Found %d orders", len(orders))

	if len(orders) > 0 {
		ids := make([]int, 0, len(orders))
		for _, order := range orders {
			ids = append(ids, order.ID)
		}
		lastItemMap, err := models.GetOrderLastItemTimes(ids)
		if err == nil {
			for i := range orders {
				if ts, ok := lastItemMap[orders[i].ID]; ok {
					t := ts
					orders[i].LastItemAt = &t
				}
			}
		}
	}

	enableStr := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_FB_PROFILE")))
	includeParam := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("include_fb_profile")))
	allowProfiles := enableStr == "1" || enableStr == "true"
	enableProfiles := allowProfiles || includeParam == "1" || includeParam == "true"

	isLikelyPSID := func(s string) bool {
		if len(s) < 8 {
			return false
		}
		for _, ch := range s {
			if ch < '0' || ch > '9' {
				return false
			}
		}
		return true
	}

	if enableProfiles {
		profileCache := make(map[string]string)
		client := &http.Client{Timeout: 3 * time.Second}
		failCount := 0
		maxLookups := 25
		loggedProfileError := false

		for i := range orders {
			senderID := strings.TrimSpace(orders[i].SenderID)
			if senderID == "" || !isLikelyPSID(senderID) {
				continue
			}
			if cached, ok := profileCache[senderID]; ok {
				orders[i].FBName = cached
				continue
			}
			if failCount >= 5 || len(profileCache) >= maxLookups {
				continue
			}
			fbName, fbAvatar, err := fetchFacebookProfile(client, senderID)
			if err != nil {
				profileCache[senderID] = ""
				if isProfileLookupSkippable(err) {
					continue
				}
				failCount++
				if !loggedProfileError {
					log.Printf("[Admin] Facebook profile lookup failed for sender %s: %v", senderID, err)
					loggedProfileError = true
				}
				if strings.Contains(err.Error(), "PAGE_ACCESS_TOKEN not set") || strings.Contains(strings.ToLower(err.Error()), "permission") || strings.Contains(err.Error(), "OAuthException") {
					failCount = 5
				}
				continue
			}
			profileCache[senderID] = fbName
			orders[i].FBName = fbName
			orders[i].FBAvatar = fbAvatar
		}
	}

	paymentMap := make(map[int]map[string]string)
	if len(orders) > 0 {
		ids := make([]int, 0, len(orders))
		for _, order := range orders {
			ids = append(ids, order.ID)
		}
		rows, err := configs.DB.Query(`
			SELECT DISTINCT ON (order_id) order_id, COALESCE(method, '') as method, COALESCE(status, '') as status
			FROM payments
			WHERE order_id = ANY($1)
			ORDER BY order_id, created_at DESC
		`, pq.Array(ids))
		if err == nil {
			for rows.Next() {
				var orderID int
				var method, status string
				if scanErr := rows.Scan(&orderID, &method, &status); scanErr == nil {
					paymentMap[orderID] = map[string]string{
						"method": strings.ToLower(strings.TrimSpace(method)),
						"status": strings.ToLower(strings.TrimSpace(status)),
					}
				}
			}
			rows.Close()
		}
	}

	extractPhone := func(value string) string {
		raw := strings.TrimSpace(value)
		if raw == "" {
			return ""
		}
		start := strings.LastIndex(raw, "(")
		end := strings.LastIndex(raw, ")")
		if start >= 0 && end > start {
			phone := strings.TrimSpace(raw[start+1 : end])
			if phone != "" {
				return phone
			}
		}
		return ""
	}

	phoneBySender := make(map[string]string)
	for _, order := range orders {
		senderID := strings.TrimSpace(order.SenderID)
		if senderID == "" {
			continue
		}
		if _, ok := phoneBySender[senderID]; ok {
			continue
		}
		phones, err := models.GetCustomerPhones(senderID)
		if err == nil && len(phones) > 0 {
			phoneBySender[senderID] = phones[0]
		} else {
			phoneBySender[senderID] = ""
		}
	}

	type adminOrder struct {
		models.Order
		PaymentStatus string `json:"payment_status"`
		PaymentMethod string `json:"payment_method"`
		CustomerPhone string `json:"customer_phone"`
	}
	responseOrders := make([]adminOrder, 0, len(orders))
	for _, order := range orders {
		method := "cash"
		status := "none"
		if meta, ok := paymentMap[order.ID]; ok {
			if meta["status"] != "" {
				status = meta["status"]
			}
			if meta["method"] != "" {
				method = "scan"
			}
		}
		phone := ""
		if senderID := strings.TrimSpace(order.SenderID); senderID != "" {
			phone = strings.TrimSpace(phoneBySender[senderID])
		}
		if phone == "" {
			phone = extractPhone(order.CustomerName)
		}
		responseOrders = append(responseOrders, adminOrder{
			Order:         order,
			PaymentStatus: status,
			PaymentMethod: method,
			CustomerPhone: phone,
		})
	}

	// Return orders as JSON
	response := map[string]interface{}{
		"orders": responseOrders,
		"total":  len(responseOrders),
	}

	json.NewEncoder(w).Encode(response)
}

func AdminBlockMessengerUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PSID   string   `json:"psid"`
		Phones []string `json:"phones"`
		Reason string   `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	psid := strings.TrimSpace(req.PSID)
	if psid == "" {
		http.Error(w, "Missing Messenger user ID", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		http.Error(w, "Missing block reason", http.StatusBadRequest)
		return
	}

	phones := []string{}
	seen := map[string]struct{}{}
	for _, phone := range req.Phones {
		if normalized, ok := NormalizeMyanmarPhoneE164(phone); ok {
			if _, exists := seen[normalized]; !exists {
				seen[normalized] = struct{}{}
				phones = append(phones, normalized)
			}
		}
	}

	linkedPhones, err := models.GetCustomerPhones(psid)
	if err == nil {
		for _, phone := range linkedPhones {
			if normalized, ok := NormalizeMyanmarPhoneE164(phone); ok {
				if _, exists := seen[normalized]; !exists {
					seen[normalized] = struct{}{}
					phones = append(phones, normalized)
				}
			}
		}
	}

	if err := models.BlockCustomerIdentity(psid, phones, req.Reason); err != nil {
		log.Printf("[Admin] Failed to block Messenger user %s: %v", psid, err)
		http.Error(w, "Failed to block Messenger user", http.StatusInternalServerError)
		return
	}

	adminID := getAdminIDFromContext(r)
	_ = models.LogAdminAction(psid, "block_customer", req.Reason, map[string]interface{}{
		"phones": phones,
	}, adminID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"blocked_psid":   psid,
		"blocked_phones": phones,
		"blocked_at":     time.Now().UTC(),
	})
}

func AdminUnblockMessengerUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PSID   string `json:"psid"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	psid := strings.TrimSpace(req.PSID)
	if psid == "" {
		http.Error(w, "Missing Messenger user ID", http.StatusBadRequest)
		return
	}

	phones, err := models.UnblockCustomerIdentity(psid)
	if err != nil {
		log.Printf("[Admin] Failed to unblock Messenger user %s: %v", psid, err)
		http.Error(w, "Failed to unblock Messenger user", http.StatusInternalServerError)
		return
	}

	adminID := getAdminIDFromContext(r)
	_ = models.LogAdminAction(psid, "unblock_customer", req.Reason, map[string]interface{}{
		"phones": phones,
	}, adminID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":          true,
		"unblocked_psid":   psid,
		"unblocked_phones": phones,
	})
}

func AdminGetCustomerStatus(w http.ResponseWriter, r *http.Request) {
	psid := strings.TrimSpace(r.URL.Query().Get("psid"))
	if psid == "" {
		http.Error(w, "Missing Messenger user ID", http.StatusBadRequest)
		return
	}

	blocked, blockReason, blockedAt, err := models.GetBlockedIdentityDetails("psid", psid)
	if err != nil {
		http.Error(w, "Failed to load block status", http.StatusInternalServerError)
		return
	}

	verification, err := models.GetCustomerVerification(psid)
	if err != nil {
		http.Error(w, "Failed to load verification status", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"psid":                 psid,
		"blocked":              blocked,
		"blocked_reason":       blockReason,
		"blocked_at":           blockedAt,
		"verified":             verification.Verified,
		"verification_method":  verification.VerificationMethod,
		"verified_at":          verification.VerifiedAt,
		"verified_by_admin_id": verification.VerifiedByAdminID,
		"pending_verification": verification.PendingVerification,
		"pending_requested_at": verification.PendingRequestedAt,
	})
}

func AdminSetCustomerVerification(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req struct {
		PSID     string `json:"psid"`
		Verified bool   `json:"verified"`
		Method   string `json:"method"`
		Reason   string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	psid := strings.TrimSpace(req.PSID)
	if psid == "" {
		http.Error(w, "Missing Messenger user ID", http.StatusBadRequest)
		return
	}

	method := strings.TrimSpace(req.Method)
	if req.Verified && method == "" {
		method = "admin_manual"
	}

	adminID := getAdminIDFromContext(r)
	if err := models.SetCustomerVerification(psid, req.Verified, method, adminID); err != nil {
		http.Error(w, "Failed to update verification", http.StatusInternalServerError)
		return
	}

	action := "unverify_customer"
	if req.Verified {
		action = "verify_customer_admin"
	}
	_ = models.LogAdminAction(psid, action, req.Reason, map[string]interface{}{
		"method": method,
	}, adminID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"psid":     psid,
		"verified": req.Verified,
		"method":   method,
	})
}

func AdminRequestMessengerVerification(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	var req struct {
		PSID   string `json:"psid"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	psid := strings.TrimSpace(req.PSID)
	if psid == "" {
		http.Error(w, "Missing Messenger user ID", http.StatusBadRequest)
		return
	}

	adminID := getAdminIDFromContext(r)
	if err := models.UpsertMessengerVerificationRequest(psid, adminID); err != nil {
		http.Error(w, "Failed to queue verification request", http.StatusInternalServerError)
		return
	}

	quickReplies := []QuickReply{
		{ContentType: "text", Title: "✅ Confirm", Payload: "VERIFY_CUSTOMER_CONFIRM"},
	}
	message := "Hi! This is BakeFlow. Please tap Confirm or reply CONFIRM to verify this Messenger account so we can keep your orders smooth."
	if err := SendQuickReplies(psid, message, quickReplies); err != nil {
		if isOutsideMessagingWindow(err) {
			log.Printf("[Admin] Messenger verification message not sent (outside window) for %s", psid)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":      true,
				"psid":         psid,
				"message_sent": false,
				"error":        "outside_window",
			})
			return
		}
		http.Error(w, "Failed to send verification message", http.StatusInternalServerError)
		return
	}

	_ = models.LogAdminAction(psid, "verify_customer_messenger_request", req.Reason, map[string]interface{}{
		"channel": "messenger",
	}, adminID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"psid":         psid,
		"message_sent": true,
	})
}

// AdminUpdateOrderStatus updates the status of an order
func AdminUpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Get order ID from URL using gorilla/mux
	vars := mux.Vars(r)
	orderIDStr := vars["id"]
	orderID, err := strconv.Atoi(orderIDStr)
	if err != nil {
		http.Error(w, "Invalid order ID", http.StatusBadRequest)
		return
	}

	// Parse request body
	var requestBody struct {
		Status string `json:"status"`
	}

	if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	requestBody.Status = strings.ToLower(strings.TrimSpace(requestBody.Status))

	// Validate status
	validStatuses := map[string]bool{
		"scheduled": true,
		"pending":   true,
		"confirmed": true, // Added confirmed
		"preparing": true,
		"ready":     true,
		"delivered": true,
		"cancelled": true,
	}

	if !validStatuses[requestBody.Status] {
		http.Error(w, "Invalid status", http.StatusBadRequest)
		return
	}

	// Load existing order to check current status & sender
	currentOrder, err := models.GetOrderByID(orderID)
	currentStatus := strings.ToLower(strings.TrimSpace(currentOrder.Status))
	if err != nil {
		log.Printf("[Admin] Failed to load order #%d before update: %v", orderID, err)
		http.Error(w, "Order not found", http.StatusNotFound)
		return
	}

	// Validate allowed status transition (no skipping)
	allowedNext := map[string]string{
		"scheduled": "preparing",
		"pending":   "preparing",
		"confirmed": "preparing", // Verified payment -> preparing
		"preparing": "ready",
		"ready":     "delivered",
		"delivered": "",
	}
	if next, ok := allowedNext[currentStatus]; !ok {
		http.Error(w, "Invalid current status", http.StatusBadRequest)
		return
	} else {
		if next == "" {
			// Already delivered; cannot advance further
			resp := map[string]interface{}{"success": true, "duplicate": true, "order_id": orderID, "status": currentStatus, "message": "Order already delivered"}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		if requestBody.Status != next {
			http.Error(w, fmt.Sprintf("Invalid transition: %s -> %s", currentStatus, requestBody.Status), http.StatusBadRequest)
			return
		}
	}

	if currentStatus == requestBody.Status {
		// Duplicate / idempotent update; respond quickly
		resp := map[string]interface{}{
			"success":   true,
			"duplicate": true,
			"order_id":  orderID,
			"status":    currentStatus,
			"message":   "Status unchanged",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// Perform DB update (prevent duplicate race by using current different status)
	err = models.UpdateOrderStatus(orderID, requestBody.Status)
	if err != nil {
		log.Printf("[Admin] Error updating order status: %v", err)
		http.Error(w, "Error updating order status", http.StatusInternalServerError)
		return
	}
	log.Printf("[Admin] Order #%d status updated to: %s", orderID, requestBody.Status)

	// Respond immediately before potentially slow external notification
	resp := map[string]interface{}{
		"success":                 true,
		"order_id":                orderID,
		"new_status":              requestBody.Status,
		"message":                 "Order status updated",
		"notification_dispatched": currentOrder.SenderID != "", // whether we'll attempt notification
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)

	// Async notification (non-blocking) - Professional Grab/Foodpanda style
	if currentOrder.SenderID != "" {
		go func(order *models.Order, status string) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Notify] Panic recovered for order #%d: %v", order.ID, r)
				}
			}()

			// Get product image from first item (if available and valid https URL)
			productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
			if len(order.Items) > 0 && order.Items[0].ImageURL != "" {
				imgURL := order.Items[0].ImageURL
				if strings.HasPrefix(imgURL, "https://") {
					if u, err := url.Parse(imgURL); err == nil && u.Host != "" {
						productImage = imgURL
					}
				}
			}

			// Professional status messages (Grab/Foodpanda style)
			var title, subtitle string
			var buttons []Button

			switch status {
			case "preparing":
				title = "Your order is being prepared"
				subtitle = fmt.Sprintf("Order #BF-%d\n\nWe're working on it now.\nYou'll be notified when it's ready.", order.ID)
				buttons = []Button{{Type: "postback", Title: "Need Help?", Payload: "CONTACT_SUPPORT"}}

			case "ready":
				title = "Your order is ready"
				pickupMsg := "Please pick up at our store."
				if order.DeliveryType == "delivery" {
					pickupMsg = "Your order is on its way."
				}
				subtitle = fmt.Sprintf("Order #BF-%d\n\n%s", order.ID, pickupMsg)
				buttons = []Button{{Type: "postback", Title: "Need Help?", Payload: "CONTACT_SUPPORT"}}

			case "delivered":
				title = "Order complete"
				subtitle = fmt.Sprintf("Order #BF-%d\n\nThank you for your order.\nWe hope you enjoy it!", order.ID)

				// Generate rating webview URL with signed token
				ratingToken, _ := GenerateWebviewToken(order.SenderID, 24*7*time.Hour) // 7 days to rate
				baseURL := resolveFrontendBaseURL()

				var ratingURL string
				if baseURL != "" {
					if u, err := url.Parse(baseURL); err == nil && u.Scheme != "" && u.Host != "" {
						ratingURL = fmt.Sprintf("%s/rate-order.html?order_id=%d&user_id=%s", baseURL, order.ID, url.QueryEscape(order.SenderID))
						if ratingToken != "" {
							ratingURL = fmt.Sprintf("%s&t=%s", ratingURL, ratingToken)
						}
					} else {
						log.Printf("[Notify] Invalid WEBVIEW_BASE_URL='%s'; using postback rating", baseURL)
					}
				}

				// Build buttons: use webview if available, otherwise postback
				if ratingURL != "" {
					buttons = []Button{
						{Type: "web_url", Title: "⭐ Rate Order", URL: ratingURL, WebviewHeightRatio: "tall", MessengerExtensions: true},
						{Type: "postback", Title: "Order Again", Payload: "ORDER_NOW"},
					}
				} else {
					// Fallback to postback-based rating (works without webview)
					buttons = []Button{
						{Type: "postback", Title: "⭐ Rate Order", Payload: fmt.Sprintf("RATE_ORDER_%d", order.ID)},
						{Type: "postback", Title: "Order Again", Payload: "ORDER_NOW"},
					}
				}

			default:
				log.Printf("[Notify] Status '%s' not configured for order #%d", status, order.ID)
				return
			}

			// Use Messenger tag for post-purchase updates outside 24h window
			constTag := "POST_PURCHASE_UPDATE"
			err := SendOrderCardWithTag(order.SenderID, order.ID, title, subtitle, productImage, buttons, constTag)
			if err != nil {
				log.Printf("[Notify] Card failed for order #%d: %v", order.ID, err)
				// Fallback: for delivered, prompt rating with quick replies
				if status == "delivered" {
					_ = SendMessageWithTag(order.SenderID, fmt.Sprintf("✅ Order #BF-%d complete!\n\nThank you for your order. We hope you enjoy it! 🍰", order.ID), constTag)
					// Send rating prompt with quick replies
					askForRating(order.SenderID, order.ID)
				} else {
					// Other statuses: plain text fallback
					fallbackMessages := map[string]string{
						"preparing": "👨‍🍳 Your order #BF-%d is being prepared.",
						"ready":     "🔔 Your order #BF-%d is ready for pickup/delivery!",
					}
					if msg, ok := fallbackMessages[status]; ok {
						_ = SendMessageWithTag(order.SenderID, fmt.Sprintf(msg, order.ID), constTag)
					}
				}
			} else {
				log.Printf("[Notify] Status notification sent for order #%d (%s)", order.ID, status)
			}
			time.Sleep(10 * time.Millisecond)
		}(currentOrder, requestBody.Status)
	} else {
		log.Printf("[Admin] No SenderID for order #%d; skipping notification", orderID)
	}
}

// AdminCancelOrder cancels an order and notifies the customer via Messenger
func AdminCancelOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Get order ID from URL
	vars := mux.Vars(r)
	orderIDStr := vars["id"]
	orderID, err := strconv.Atoi(orderIDStr)
	if err != nil {
		http.Error(w, "Invalid order ID", http.StatusBadRequest)
		return
	}

	// Parse request body for optional cancellation reason
	var requestBody struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&requestBody)

	// Load existing order
	currentOrder, err := models.GetOrderByID(orderID)
	if err != nil {
		log.Printf("[Admin] Failed to load order #%d: %v", orderID, err)
		http.Error(w, "Order not found", http.StatusNotFound)
		return
	}

	// Check if order can be cancelled (not already delivered or cancelled)
	currentStatus := strings.ToLower(strings.TrimSpace(currentOrder.Status))
	if currentStatus == "delivered" {
		http.Error(w, "Cannot cancel delivered order", http.StatusBadRequest)
		return
	}
	if currentStatus == "cancelled" {
		// Already cancelled
		resp := map[string]interface{}{
			"success":  true,
			"order_id": orderID,
			"message":  "Order already cancelled",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// Update order status to cancelled
	err = models.UpdateOrderStatus(orderID, "cancelled")
	if err != nil {
		log.Printf("[Admin] Error cancelling order: %v", err)
		http.Error(w, "Error cancelling order", http.StatusInternalServerError)
		return
	}
	log.Printf("[Admin] Order #%d cancelled", orderID)

	// PRODUCTION-GRADE: Restore stock for cancelled order
	// Only restore if order wasn't already delivered
	restoredItems := []map[string]interface{}{}
	log.Printf("🔍 [Admin] Checking stock restoration - Status: %s, Items count: %d", currentStatus, len(currentOrder.Items))

	if currentStatus != "delivered" {
		for i, item := range currentOrder.Items {
			log.Printf("🔍 [Admin] Processing item %d: %s (qty: %d)", i+1, item.Product, item.Quantity)

			// Try to find product ID from the item
			var productID int
			var stockBefore, stockAfter int

			err := configs.DB.QueryRow(
				"SELECT id, stock FROM products WHERE name = $1 AND deleted_at IS NULL LIMIT 1",
				item.Product,
			).Scan(&productID, &stockBefore)

			if err == nil && productID > 0 {
				log.Printf("🔍 [Admin] Found product: ID=%d, Current stock=%d", productID, stockBefore)

				err = models.RestoreStock(productID, item.Quantity, orderID, "Order cancelled by admin")
				if err != nil {
					log.Printf("❌ [Admin] Failed to restore stock for %s: %v", item.Product, err)
				} else {
					// Get stock after restoration
					configs.DB.QueryRow(
						"SELECT stock FROM products WHERE id = $1",
						productID,
					).Scan(&stockAfter)

					log.Printf("✅ [Admin] Stock restored: %s (ID:%d) %d → %d (+%d)",
						item.Product, productID, stockBefore, stockAfter, item.Quantity)

					restoredItems = append(restoredItems, map[string]interface{}{
						"product_id":   productID,
						"product_name": item.Product,
						"quantity":     item.Quantity,
						"stock_before": stockBefore,
						"stock_after":  stockAfter,
					})
				}
			} else {
				log.Printf("⚠️ [Admin] Product not found for restoration: '%s' (err: %v)", item.Product, err)
			}
		}
	} else {
		log.Printf("⚠️ [Admin] Not restoring stock - order already delivered")
	}

	// Respond immediately
	resp := map[string]interface{}{
		"success":                 true,
		"order_id":                orderID,
		"message":                 "Order cancelled",
		"stock_restored":          currentStatus != "delivered",
		"restored_items":          restoredItems,
		"notification_dispatched": currentOrder.SenderID != "",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)

	// Send notification to customer via Messenger (async) - Professional style
	if currentOrder.SenderID != "" {
		go func(order *models.Order, reason string) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Notify] Panic in cancel notification for order #%d: %v", order.ID, r)
				}
			}()

			// Get product image from first item (if available and valid https URL)
			productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
			if len(order.Items) > 0 && order.Items[0].ImageURL != "" {
				imgURL := order.Items[0].ImageURL
				if strings.HasPrefix(imgURL, "https://") {
					if u, err := url.Parse(imgURL); err == nil && u.Host != "" {
						productImage = imgURL
					}
				}
			}

			title := "Order cancelled"
			subtitle := fmt.Sprintf("Order #BF-%d\nWe hope to serve you again soon.", order.ID)
			if reason != "" {
				subtitle = fmt.Sprintf("Order #BF-%d\nReason: %s\nWe hope to serve you again soon.", order.ID, reason)
			}

			err := SendOrderCard(order.SenderID, order.ID, title, subtitle, productImage, nil)
			if err != nil {
				log.Printf("[Notify] Card failed for order #%d: %v", order.ID, err)
				fallbackMsg := fmt.Sprintf("Your order #BF-%d has been cancelled. We apologize for the inconvenience.", order.ID)
				if reason != "" {
					fallbackMsg = fmt.Sprintf("Your order #BF-%d has been cancelled.\n\nReason: %s\n\nWe apologize for the inconvenience.", order.ID, reason)
				}
				SendMessage(order.SenderID, fallbackMsg)
			} else {
				log.Printf("[Notify] Cancellation notification sent for order #%d", order.ID)
			}
		}(currentOrder, requestBody.Reason)
	} else {
		log.Printf("[Admin] No SenderID for order #%d; skipping cancellation notification", orderID)
	}
}
