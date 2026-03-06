package controllers

import (
	"bakeflow/configs"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	cloudinary "github.com/cloudinary/cloudinary-go/v2"
	"github.com/cloudinary/cloudinary-go/v2/api/uploader"
	"github.com/gorilla/mux"
)

// ─── Preorder Session Types ─────────────────────────────────

type PreorderSessionItem struct {
	ProductID int     `json:"product_id"`
	Name      string  `json:"name"`
	Qty       int     `json:"qty"`
	Price     float64 `json:"price"`
	Note      string  `json:"note"`
	ImageURL  string  `json:"image_url"`
}

type CreatePreorderSessionRequest struct {
	UserID        string                `json:"user_id"`
	Items         []PreorderSessionItem `json:"items"`
	CustomerName  string                `json:"customer_name"`
	CustomerPhone string                `json:"customer_phone"`
	DeliveryType  string                `json:"delivery_type"`
	Address       string                `json:"address"`
	Notes         string                `json:"notes"`
	ScheduleDate  string                `json:"schedule_date"`
	ScheduleTime  string                `json:"schedule_time"`
	TotalAmount   float64               `json:"total_amount"`
}

// ─── Expire Old Sessions ────────────────────────────────────

func expireOldPreorderSessions() {
	result, err := configs.DB.Exec(`
		UPDATE preorder_sessions
		SET payment_status = 'expired', updated_at = NOW()
		WHERE payment_status IN ('awaiting_payment', 'proof_uploaded')
		  AND expires_at < NOW()
	`)
	if err != nil {
		log.Printf("⚠️ Failed to expire old preorder sessions: %v", err)
	} else if n, _ := result.RowsAffected(); n > 0 {
		log.Printf("🕐 Expired %d preorder session(s)", n)
	}
}

// ─── Active Custom Order Guard ──────────────────────────────

func hasActiveCustomOrder(userID string) (bool, int) {
	var orderID int
	err := configs.DB.QueryRow(`
		SELECT id FROM orders
		WHERE sender_id = $1
		  AND COALESCE(order_type, '') = 'custom'
		  AND status IN ('scheduled', 'pending', 'preparing')
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&orderID)
	if err != nil {
		return false, 0
	}
	return true, orderID
}

// hasActivePendingSession checks if user has an unexpired session still awaiting payment or verification
func hasActivePendingSession(userID string) (bool, int) {
	var sessionID int
	err := configs.DB.QueryRow(`
		SELECT id FROM preorder_sessions
		WHERE user_id = $1
		  AND payment_status IN ('awaiting_payment', 'proof_uploaded')
		  AND expires_at > NOW()
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&sessionID)
	if err != nil {
		return false, 0
	}
	return true, sessionID
}

// ─── Create Session ─────────────────────────────────────────

func CreatePreorderSession(w http.ResponseWriter, r *http.Request) {
	var req CreatePreorderSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Auth
	tok := strings.TrimSpace(r.URL.Query().Get("t"))
	psid := ""
	if tok != "" {
		if verified, errTok := VerifyWebviewToken(tok); errTok == nil {
			psid = verified
		}
	}
	if psid == "" {
		if isValidMessengerRecipientID(req.UserID) {
			psid = req.UserID
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	userID := psid

	if len(req.Items) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "empty_cart", "message": "No items in order"})
		return
	}

	// Expire old sessions first
	expireOldPreorderSessions()

	// Guard: active custom order already exists
	if hasActive, existingOrderID := hasActiveCustomOrder(userID); hasActive {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  false,
			"error":    "active_custom_order",
			"message":  "You already have an active custom cake order.",
			"order_id": existingOrderID,
		})
		return
	}

	// Guard: pending session still active
	if hasPending, existingSessionID := hasActivePendingSession(userID); hasPending {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    false,
			"error":      "pending_session",
			"message":    "You already have a pending payment session. Complete or wait for it to expire.",
			"session_id": existingSessionID,
		})
		return
	}

	// Normalize phone
	if req.CustomerPhone != "" {
		if normalized, ok := NormalizeMyanmarPhoneE164(req.CustomerPhone); ok {
			req.CustomerPhone = normalized
		}
	}

	// Serialize items to JSON
	itemsJSON, err := json.Marshal(req.Items)
	if err != nil {
		http.Error(w, "failed to encode items", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().Add(30 * time.Minute)

	var sessionID int
	err = configs.DB.QueryRow(`
		INSERT INTO preorder_sessions
			(user_id, items, customer_name, customer_phone, delivery_type, address, notes, schedule_date, schedule_time, total_amount, payment_status, expires_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'awaiting_payment', $11, NOW(), NOW())
		RETURNING id
	`, userID, itemsJSON, req.CustomerName, req.CustomerPhone, req.DeliveryType, req.Address, req.Notes, req.ScheduleDate, req.ScheduleTime, req.TotalAmount, expiresAt).Scan(&sessionID)
	if err != nil {
		log.Printf("❌ Failed to create preorder session: %v", err)
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Preorder session #%d created for user %s (expires %s)", sessionID, userID, expiresAt.Format(time.RFC3339))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"session_id": sessionID,
		"expires_at": expiresAt.Format(time.RFC3339),
		"message":    "Payment session created. Upload your payment proof within 30 minutes.",
	})
}

// ─── Upload Payment Proof ───────────────────────────────────

func UploadPreorderPaymentProof(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID, _ := strconv.Atoi(vars["id"])

	// 10MB limit
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		http.Error(w, "Invalid multipart form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "Error retrieving image", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if err := validateImageHeader(header); err != nil {
		http.Error(w, "Unsupported image type", http.StatusBadRequest)
		return
	}

	// Verify session exists and is not expired
	var paymentStatus string
	var expiresAt time.Time
	var sessionUserID string
	err = configs.DB.QueryRow(`
		SELECT payment_status, expires_at, user_id FROM preorder_sessions WHERE id = $1
	`, sessionID).Scan(&paymentStatus, &expiresAt, &sessionUserID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "session_not_found", "message": "Session not found"})
		return
	}

	// Auth check
	tok := strings.TrimSpace(r.URL.Query().Get("t"))
	psid := ""
	if tok != "" {
		if verified, errTok := VerifyWebviewToken(tok); errTok == nil {
			psid = verified
		}
	}
	if psid == "" {
		psid = r.FormValue("user_id")
	}
	if psid != "" && psid != sessionUserID {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Not your session"})
		return
	}

	if time.Now().After(expiresAt) {
		// Expire the session
		configs.DB.Exec(`UPDATE preorder_sessions SET payment_status = 'expired', updated_at = NOW() WHERE id = $1`, sessionID)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "session_expired", "message": "This payment session has expired. Please create a new order."})
		return
	}

	if paymentStatus != "awaiting_payment" && paymentStatus != "rejected" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "invalid_status", "message": "Payment proof already uploaded or session is not active."})
		return
	}

	// Upload to Cloudinary
	cloudName := os.Getenv("CLOUDINARY_CLOUD_NAME")
	apiKey := os.Getenv("CLOUDINARY_API_KEY")
	apiSecret := os.Getenv("CLOUDINARY_API_SECRET")
	if cloudName == "" || apiKey == "" || apiSecret == "" {
		http.Error(w, "Upload service not configured", http.StatusInternalServerError)
		return
	}

	cld, err := cloudinary.NewFromParams(cloudName, apiKey, apiSecret)
	if err != nil {
		http.Error(w, "Upload service error", http.StatusInternalServerError)
		return
	}

	uploadParams := uploader.UploadParams{
		Folder:       "bakeflow/preorder-payments",
		ResourceType: "image",
		PublicID:     fmt.Sprintf("preorder_session_%d_%d", sessionID, time.Now().Unix()),
	}

	res, err := cld.Upload.Upload(r.Context(), file, uploadParams)
	if err != nil {
		log.Printf("❌ Cloudinary upload failed for preorder session #%d: %v", sessionID, err)
		http.Error(w, "Image upload failed", http.StatusInternalServerError)
		return
	}

	proofURL := res.SecureURL

	_, err = configs.DB.Exec(`
		UPDATE preorder_sessions
		SET payment_proof = $1, payment_status = 'proof_uploaded', updated_at = NOW()
		WHERE id = $2
	`, proofURL, sessionID)
	if err != nil {
		log.Printf("❌ Failed to save payment proof for session #%d: %v", sessionID, err)
		http.Error(w, "Failed to save proof", http.StatusInternalServerError)
		return
	}

	log.Printf("📸 Payment proof uploaded for preorder session #%d", sessionID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"proof_url": proofURL,
		"message":   "Payment proof uploaded! We'll verify it shortly.",
	})
}

// ─── Get Session Status (polling) ───────────────────────────

func GetPreorderSessionStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID, _ := strconv.Atoi(vars["id"])

	var paymentStatus string
	var expiresAt time.Time
	var orderID sql.NullInt64
	var proofURL sql.NullString

	err := configs.DB.QueryRow(`
		SELECT payment_status, expires_at, order_id, payment_proof
		FROM preorder_sessions WHERE id = $1
	`, sessionID).Scan(&paymentStatus, &expiresAt, &orderID, &proofURL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "not_found"})
		return
	}

	// Auto-expire if time is up and status is still pending
	if time.Now().After(expiresAt) && (paymentStatus == "awaiting_payment" || paymentStatus == "proof_uploaded") {
		configs.DB.Exec(`UPDATE preorder_sessions SET payment_status = 'expired', updated_at = NOW() WHERE id = $1`, sessionID)
		paymentStatus = "expired"
	}

	resp := map[string]interface{}{
		"success":        true,
		"payment_status": paymentStatus,
		"expires_at":     expiresAt.Format(time.RFC3339),
	}
	if orderID.Valid {
		resp["order_id"] = orderID.Int64
	}
	if proofURL.Valid {
		resp["proof_url"] = proofURL.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// ─── Admin: List Pending Sessions ───────────────────────────

func AdminGetPreorderSessions(w http.ResponseWriter, r *http.Request) {
	statusFilter := r.URL.Query().Get("status")
	if statusFilter == "" {
		statusFilter = "proof_uploaded" // default: show sessions awaiting admin verification
	}

	query := `
		SELECT id, user_id, items, customer_name, customer_phone, delivery_type, address, notes,
		       schedule_date, schedule_time, total_amount, payment_proof, payment_status,
		       order_id, expires_at, created_at, updated_at
		FROM preorder_sessions
	`
	var args []interface{}
	if statusFilter == "all" {
		query += " ORDER BY created_at DESC LIMIT 50"
	} else {
		query += " WHERE payment_status = $1 ORDER BY created_at DESC LIMIT 50"
		args = append(args, statusFilter)
	}

	rows, err := configs.DB.Query(query, args...)
	if err != nil {
		log.Printf("❌ Failed to fetch preorder sessions: %v", err)
		http.Error(w, "Failed to fetch sessions", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Session struct {
		ID            int             `json:"id"`
		UserID        string          `json:"user_id"`
		Items         json.RawMessage `json:"items"`
		CustomerName  string          `json:"customer_name"`
		CustomerPhone string          `json:"customer_phone"`
		DeliveryType  string          `json:"delivery_type"`
		Address       string          `json:"address"`
		Notes         string          `json:"notes"`
		ScheduleDate  string          `json:"schedule_date"`
		ScheduleTime  string          `json:"schedule_time"`
		TotalAmount   float64         `json:"total_amount"`
		PaymentProof  *string         `json:"payment_proof"`
		PaymentStatus string          `json:"payment_status"`
		OrderID       *int            `json:"order_id"`
		ExpiresAt     time.Time       `json:"expires_at"`
		CreatedAt     time.Time       `json:"created_at"`
		UpdatedAt     time.Time       `json:"updated_at"`
	}

	var sessions []Session
	for rows.Next() {
		var s Session
		var proofURL sql.NullString
		var oID sql.NullInt64
		if err := rows.Scan(&s.ID, &s.UserID, &s.Items, &s.CustomerName, &s.CustomerPhone, &s.DeliveryType, &s.Address, &s.Notes,
			&s.ScheduleDate, &s.ScheduleTime, &s.TotalAmount, &proofURL, &s.PaymentStatus,
			&oID, &s.ExpiresAt, &s.CreatedAt, &s.UpdatedAt); err != nil {
			log.Printf("⚠️ Error scanning preorder session: %v", err)
			continue
		}
		if proofURL.Valid {
			s.PaymentProof = &proofURL.String
		}
		if oID.Valid {
			id := int(oID.Int64)
			s.OrderID = &id
		}
		sessions = append(sessions, s)
	}

	if sessions == nil {
		sessions = []Session{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// ─── Admin: Verify Session Payment → Create Order ───────────

func AdminVerifyPreorderSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID, _ := strconv.Atoi(vars["id"])

	var req struct {
		Status string `json:"status"` // "verified" or "rejected"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Status != "verified" && req.Status != "rejected" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Status must be 'verified' or 'rejected'"})
		return
	}

	// Fetch session
	var (
		userID        string
		itemsJSON     []byte
		customerName  string
		customerPhone string
		deliveryType  string
		address       string
		notes         string
		scheduleDate  string
		scheduleTime  string
		totalAmount   float64
		paymentStatus string
		proofURL      sql.NullString
	)
	err := configs.DB.QueryRow(`
		SELECT user_id, items, customer_name, customer_phone, delivery_type, address, notes,
		       schedule_date, schedule_time, total_amount, payment_status, payment_proof
		FROM preorder_sessions WHERE id = $1
	`, sessionID).Scan(&userID, &itemsJSON, &customerName, &customerPhone, &deliveryType, &address, &notes,
		&scheduleDate, &scheduleTime, &totalAmount, &paymentStatus, &proofURL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Session not found"})
		return
	}

	if paymentStatus != "proof_uploaded" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": fmt.Sprintf("Session status is '%s', expected 'proof_uploaded'", paymentStatus)})
		return
	}

	// ── REJECTED ──
	if req.Status == "rejected" {
		_, err = configs.DB.Exec(`
			UPDATE preorder_sessions SET payment_status = 'rejected', updated_at = NOW() WHERE id = $1
		`, sessionID)
		if err != nil {
			log.Printf("❌ Failed to reject preorder session #%d: %v", sessionID, err)
		}

		// Notify user via Messenger
		go func() {
			defer func() { _ = recover() }()
			if isValidMessengerRecipientID(userID) {
				msg := fmt.Sprintf("❌ Your custom cake payment was not verified.\n\nPlease upload a clear payment screenshot or contact us for help.")
				SendMessageWithTag(userID, msg, "POST_PURCHASE_UPDATE")
			}
		}()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Payment rejected. User notified."})
		return
	}

	// ── VERIFIED → Create Order ──
	var items []PreorderSessionItem
	if err := json.Unmarshal(itemsJSON, &items); err != nil {
		log.Printf("❌ Failed to parse session items: %v", err)
		http.Error(w, "corrupted session data", http.StatusInternalServerError)
		return
	}

	// Begin transaction
	tx, err := configs.DB.Begin()
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Parse schedule
	var scheduledFor *time.Time
	if scheduleDate != "" && scheduleTime != "" {
		if t, err := time.Parse("2006-01-02T15:04:05", scheduleDate+"T"+scheduleTime+":00"); err == nil {
			scheduledFor = &t
		}
	}

	orderStatus := "confirmed" // Payment already verified → confirmed
	customerInfo := customerName
	if customerPhone != "" {
		customerInfo += " (" + customerPhone + ")"
	}

	totalItems := 0
	for _, item := range items {
		totalItems += item.Qty
	}

	var orderID int
	err = tx.QueryRow(`
		INSERT INTO orders (customer_name, delivery_type, address, status, total_items, subtotal, delivery_fee, total_amount,
		                    sender_id, scheduled_for, schedule_type, order_type, payment_method, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, 'custom', 'scan', NOW())
		RETURNING id
	`, customerInfo, deliveryType, address, orderStatus, totalItems, totalAmount, totalAmount,
		userID, scheduledFor, deliveryType, // schedule_type reuses delivery_type for simplicity
	).Scan(&orderID)
	if err != nil {
		log.Printf("❌ Failed to create order from preorder session #%d: %v", sessionID, err)
		http.Error(w, "failed to create order", http.StatusInternalServerError)
		return
	}

	// Insert order items
	for _, item := range items {
		_, err = tx.Exec(`
			INSERT INTO order_items (order_id, product, quantity, price, note, image_url, product_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, 0), NOW())
		`, orderID, item.Name, item.Qty, item.Price, item.Note, item.ImageURL, item.ProductID)
		if err != nil {
			log.Printf("⚠️ Failed to insert item %s for order #%d: %v", item.Name, orderID, err)
		}
	}

	// Also create a payment record for consistency with the payments system
	proofURLStr := ""
	if proofURL.Valid {
		proofURLStr = proofURL.String
	}
	_, _ = tx.Exec(`
		INSERT INTO payments (order_id, user_id, amount, method, status, proof_url, created_at)
		VALUES ($1, $2, $3, 'manual_upload', 'verified', $4, NOW())
	`, orderID, userID, totalAmount, proofURLStr)

	// Update session with order_id and verified status
	_, err = tx.Exec(`
		UPDATE preorder_sessions SET payment_status = 'verified', order_id = $1, updated_at = NOW() WHERE id = $2
	`, orderID, sessionID)
	if err != nil {
		log.Printf("❌ Failed to update preorder session #%d: %v", sessionID, err)
	}

	// Commit
	if err := tx.Commit(); err != nil {
		log.Printf("❌ Failed to commit order from preorder session #%d: %v", sessionID, err)
		http.Error(w, "failed to finalize order", http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Preorder session #%d verified → Order #%d created for user %s", sessionID, orderID, userID)

	// Notify user via Messenger
	go func() {
		defer func() { _ = recover() }()
		if !isValidMessengerRecipientID(userID) {
			return
		}

		productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
		if len(items) > 0 && strings.TrimSpace(items[0].ImageURL) != "" {
			img := strings.TrimSpace(items[0].ImageURL)
			if strings.HasPrefix(img, "https://") {
				productImage = img
			}
		}

		itemSummary := "Custom cake"
		if len(items) > 0 {
			itemSummary = items[0].Name
			if len(items) > 1 {
				itemSummary = fmt.Sprintf("%s + %d more", itemSummary, len(items)-1)
			}
		}

		whenLabel := ""
		if scheduleDate != "" && scheduleTime != "" {
			if t, err := time.Parse("2006-01-02T15:04", scheduleDate+"T"+scheduleTime); err == nil {
				whenLabel = t.Format("Jan 2, 3:04 PM")
			}
		}

		title := "🎂 Custom Cake Order Confirmed!"
		subtitle := fmt.Sprintf("Order #BF-%d • %s • Ks %.2f", orderID, itemSummary, totalAmount)
		if whenLabel != "" {
			subtitle += fmt.Sprintf(" • Ready %s", whenLabel)
		}

		frontendURL := resolveFrontendBaseURL()
		buttons := []Button{
			{Type: "web_url", Title: "View Order", URL: fmt.Sprintf("%s/order/%d", frontendURL, orderID)},
			{Type: "postback", Title: "Track Order", Payload: fmt.Sprintf("TRACK_ORDER_%d", orderID)},
		}

		if err := SendOrderCardWithTag(userID, orderID, title, subtitle, productImage, buttons, "POST_PURCHASE_UPDATE"); err != nil {
			msg := fmt.Sprintf("✅ Custom cake order #BF-%d confirmed! Payment verified. We'll start preparing your order.", orderID)
			SendMessageWithTag(userID, msg, "POST_PURCHASE_UPDATE")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"order_id": orderID,
		"message":  fmt.Sprintf("Payment verified. Order #BF-%d created.", orderID),
	})
}
