package controllers

import (
	"bakeflow/configs"
	"bakeflow/models"
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
	qrcode "github.com/skip2/go-qrcode"
)

// InitiatePaymentHandler creates a payment record (optional, can be implicit)
func InitiatePaymentHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OrderID int     `json:"order_id"`
		Amount  float64 `json:"amount"`
		Method  string  `json:"method"` // "kpay", "wave", etc.
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// In a real app, you might create a "Payment" record here with status "pending"
	// For this simple version, we'll just acknowledge it.

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Payment initiated",
	})
}

// GetQRCodeHandler generates a QR code for a specific order amount
func GetQRCodeHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	orderIDStr := vars["id"] // "order_123.png" -> we need to parse this if complex, or just use ID

	// Simply parse "order_{id}.png"
	var orderID int
	fmt.Sscanf(orderIDStr, "order_%d.png", &orderID)

	// In a real app, fetch order total to embed in QR
	// For now, generating a generic payment QR
	// You could embed a deep link like: "kpay://pay?amount=..."

	png, err := qrcode.Encode(fmt.Sprintf("https://bakeflow.com/pay/order/%d", orderID), qrcode.Medium, 256)
	if err != nil {
		http.Error(w, "Failed to generate QR", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Write(png)
}

// UploadPaymentImageHandler handles the receipt screenshot upload via Cloudinary
func UploadPaymentImageHandler(w http.ResponseWriter, r *http.Request) {
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

	// Validate image type
	if err := validateImageHeader(header); err != nil {
		http.Error(w, "Unsupported image type", http.StatusBadRequest)
		return
	}

	orderIDStr := r.FormValue("order_id")
	orderID, _ := strconv.Atoi(orderIDStr)

	// Check if order is expired or cancelled — block upload
	var currentOrderStatus string
	if err := configs.DB.QueryRow("SELECT status FROM orders WHERE id = $1", orderID).Scan(&currentOrderStatus); err == nil {
		normalized := strings.ToLower(strings.TrimSpace(currentOrderStatus))
		if normalized == "expired" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "order_expired",
				"message": "This order has expired. Please create a new order.",
			})
			return
		}
		if normalized == "cancelled" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "order_cancelled",
				"message": "This order has been cancelled.",
			})
			return
		}
	}

	// --- Upload to Cloudinary ---
	cloudName := os.Getenv("CLOUDINARY_CLOUD_NAME")
	apiKey := os.Getenv("CLOUDINARY_API_KEY")
	apiSecret := os.Getenv("CLOUDINARY_API_SECRET")
	if cloudName == "" || apiKey == "" || apiSecret == "" {
		log.Println("❌ Cloudinary env vars not configured")
		http.Error(w, "Upload service not configured", http.StatusInternalServerError)
		return
	}

	cld, err := cloudinary.NewFromParams(cloudName, apiKey, apiSecret)
	if err != nil {
		log.Printf("❌ Cloudinary init failed: %v", err)
		http.Error(w, "Upload service error", http.StatusInternalServerError)
		return
	}

	uploadParams := uploader.UploadParams{
		Folder:       "bakeflow/payments",
		ResourceType: "image",
		PublicID:     fmt.Sprintf("payment_%d_%d", orderID, time.Now().Unix()),
	}

	res, err := cld.Upload.Upload(r.Context(), file, uploadParams)
	if err != nil {
		log.Printf("❌ Cloudinary upload failed: %v", err)
		http.Error(w, "Image upload failed", http.StatusInternalServerError)
		return
	}

	proofURL := res.SecureURL

	var orderTotal sql.NullFloat64
	if err := configs.DB.QueryRow("SELECT COALESCE(total_amount, 0) FROM orders WHERE id = $1", orderID).Scan(&orderTotal); err != nil {
		log.Printf("⚠️ Failed to fetch order total: %v", err)
		http.Error(w, "Order not found", http.StatusNotFound)
		return
	}

	amount := 0.0
	if orderTotal.Valid {
		amount = orderTotal.Float64
	}

	// Save payment record to DB
	_, err = configs.DB.Exec(`
        INSERT INTO payments (order_id, user_id, amount, method, status, proof_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, orderID, r.FormValue("user_id"), amount, "manual_upload", "pending", proofURL)

	if err != nil {
		log.Printf("⚠️ Failed to insert payment record: %v", err)
	}

	// Update order status to pending_verification
	_, _ = configs.DB.Exec(`UPDATE orders SET status = 'pending_verification' WHERE id = $1 AND status IN ('pending_payment', 'pending')`, orderID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"url":     proofURL,
		"message": "Receipt uploaded successfully",
	})
}

// GetPaymentStatusHandler checks the status
func GetPaymentStatusHandler(w http.ResponseWriter, r *http.Request) {
	orderIDStr := r.URL.Query().Get("order_id")
	orderID, _ := strconv.Atoi(orderIDStr)

	// Check payments table
	var status string
	var proofURL sql.NullString
	err := configs.DB.QueryRow("SELECT status, proof_url FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1", orderID).Scan(&status, &proofURL)
	if err == sql.ErrNoRows {
		status = "none"
	} else if err != nil {
		status = "error"
	}

	response := map[string]interface{}{
		"status": status,
	}
	if proofURL.Valid {
		response["proof_url"] = proofURL.String
	}

	// Check if order itself is expired or cancelled (overrides payment status)
	var orderStatus string
	if err := configs.DB.QueryRow("SELECT status FROM orders WHERE id = $1", orderID).Scan(&orderStatus); err == nil {
		normalized := strings.ToLower(strings.TrimSpace(orderStatus))
		if normalized == "expired" {
			response["status"] = "expired"
		} else if normalized == "cancelled" {
			response["status"] = "cancelled"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// AdminGetPayments returns a list of payments, optionally filtered by status
func AdminGetPayments(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")

	query := `
		SELECT id, order_id, user_id, amount, method, status, proof_url, created_at
		FROM payments
	`
	var args []interface{}

	if status != "" {
		query += " WHERE status = $1"
		args = append(args, status)
	}

	query += " ORDER BY created_at DESC LIMIT 50"

	rows, err := configs.DB.Query(query, args...)
	if err != nil {
		log.Printf("❌ Error fetching payments: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Failed to fetch payments",
		})
		return
	}
	defer rows.Close()

	type Payment struct {
		ID        int       `json:"id"`
		OrderID   int       `json:"order_id"`
		UserID    string    `json:"user_id"`
		Amount    float64   `json:"amount"`
		Method    string    `json:"method"`
		Status    string    `json:"status"`
		ProofURL  string    `json:"proof_url"`
		CreatedAt time.Time `json:"created_at"`
	}

	var payments []Payment
	for rows.Next() {
		var p Payment
		if err := rows.Scan(&p.ID, &p.OrderID, &p.UserID, &p.Amount, &p.Method, &p.Status, &p.ProofURL, &p.CreatedAt); err != nil {
			log.Printf("❌ Error scanning payment: %v", err)
			continue
		}
		payments = append(payments, p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payments)
}

// AdminVerifyPayment updates the payment status (approve/reject)
func AdminVerifyPayment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	paymentIDStr := vars["id"]
	paymentID, _ := strconv.Atoi(paymentIDStr)

	var req struct {
		Status string `json:"status"` // "verified", "rejected"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Invalid request",
		})
		return
	}

	if req.Status != "verified" && req.Status != "rejected" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Invalid status",
		})
		return
	}

	// Begin transaction
	tx, err := configs.DB.Begin()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Database error",
		})
		return
	}
	defer tx.Rollback()

	// Update payment status
	_, err = tx.Exec("UPDATE payments SET status = $1 WHERE id = $2", req.Status, paymentID)
	if err != nil {
		log.Printf("❌ Failed to update payment status: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Failed to update payment",
		})
		return
	}

	// If verified, update order status to 'confirmed' or 'preparing'
	if req.Status == "verified" {
		var orderID int
		err := tx.QueryRow("SELECT order_id FROM payments WHERE id = $1", paymentID).Scan(&orderID)
		if err == nil {
			// Update order status
			_, _ = tx.Exec("UPDATE orders SET status = 'confirmed' WHERE id = $1", orderID)
		}
	}

	// If rejected, reset order status so user can re-upload
	if req.Status == "rejected" {
		var rejOrderID int
		err := tx.QueryRow("SELECT order_id FROM payments WHERE id = $1", paymentID).Scan(&rejOrderID)
		if err == nil {
			_, _ = tx.Exec("UPDATE orders SET status = 'pending_payment' WHERE id = $1 AND status = 'pending_verification'", rejOrderID)
		}
	}

	if err := tx.Commit(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Failed to commit transaction",
		})
		return
	}

	// Post-commit notifications (best effort)
	if req.Status == "verified" {
		var userID string
		var orderID int
		var paymentMethod sql.NullString
		configs.DB.QueryRow("SELECT user_id, order_id, method FROM payments WHERE id = $1", paymentID).Scan(&userID, &orderID, &paymentMethod)

		if orderID > 0 {
			order, err := models.GetOrderByID(orderID)
			if err == nil {
				recipientID := userID
				if strings.TrimSpace(recipientID) == "" {
					recipientID = order.SenderID
				}
				if strings.TrimSpace(recipientID) != "" {
					customerName := strings.TrimSpace(order.CustomerName)
					if customerName == "" {
						customerName = "Customer"
					}
					items := make([]ReceiptElement, 0, len(order.Items))
					for _, item := range order.Items {
						element := ReceiptElement{
							Title:    item.Product,
							Quantity: item.Quantity,
							Price:    item.Price,
							Currency: "MMK",
						}
						if strings.TrimSpace(item.Note) != "" {
							element.Subtitle = item.Note
						}
						if strings.TrimSpace(item.ImageURL) != "" {
							element.ImageURL = strings.TrimSpace(item.ImageURL)
						}
						items = append(items, element)
					}
					summary := ReceiptSummary{
						Subtotal:     order.Subtotal,
						ShippingCost: order.DeliveryFee,
						TotalTax:     0,
						TotalCost:    order.TotalAmount,
					}
					orderURL := fmt.Sprintf("%s/order/%d", resolveFrontendBaseURL(), order.ID)
					address := buildReceiptAddress(order.DeliveryType, order.Address)
					receiptMethod := buildReceiptPaymentMethod(paymentMethod)
					if err := SendReceiptTemplate(recipientID, order.ID, customerName, items, address, summary, orderURL, receiptMethod); err != nil {
						log.Printf("❌ Failed to send receipt template: %v", err)
						msg := fmt.Sprintf("✅ **Payment Verified!**\n\nYour payment for Order #%d has been confirmed. We are preparing your order now! 🍰", orderID)
						SendMessageWithTag(recipientID, msg, "POST_PURCHASE_UPDATE")
					}
				}
			} else if userID != "" {
				msg := fmt.Sprintf("✅ **Payment Verified!**\n\nYour payment for Order #%d has been confirmed. We are preparing your order now! 🍰", orderID)
				SendMessageWithTag(userID, msg, "POST_PURCHASE_UPDATE")
			}
		}
	} else if req.Status == "rejected" {
		var userID string
		var orderID int
		configs.DB.QueryRow("SELECT user_id, order_id FROM payments WHERE id = $1", paymentID).Scan(&userID, &orderID)

		if userID != "" {
			msg := fmt.Sprintf("❌ **Payment Issue**\n\nWe couldn't verify your payment for Order #%d. Please upload a clear receipt or contact support.", orderID)
			SendMessageWithTag(userID, msg, "POST_PURCHASE_UPDATE")
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Payment status updated",
	})
}

func buildReceiptPaymentMethod(method sql.NullString) string {
	if !method.Valid {
		return "Paid"
	}
	raw := strings.TrimSpace(strings.ToLower(method.String))
	if raw == "" {
		return "Paid"
	}
	switch raw {
	case "manual_upload":
		return "Paid via Transfer"
	case "kpay":
		return "Paid via KPay"
	case "wave":
		return "Paid via Wave"
	default:
		return "Paid"
	}
}

func buildReceiptAddress(deliveryType, rawAddress string) *ReceiptAddress {
	if strings.TrimSpace(strings.ToLower(deliveryType)) != "delivery" {
		return nil
	}
	address := strings.TrimSpace(rawAddress)
	if address == "" {
		return nil
	}
	parts := strings.Split(address, ",")
	segments := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			segments = append(segments, trimmed)
		}
	}
	if len(segments) == 0 {
		return nil
	}
	remaining := append([]string{}, segments...)
	country := ""
	if len(remaining) > 0 {
		country = remaining[len(remaining)-1]
		remaining = remaining[:len(remaining)-1]
	}
	postal := ""
	if len(remaining) > 0 {
		for i := len(remaining) - 1; i >= 0; i-- {
			if isPostalCodePart(remaining[i]) {
				postal = remaining[i]
				remaining = append(remaining[:i], remaining[i+1:]...)
				break
			}
		}
	}
	state := ""
	if len(remaining) > 0 {
		state = remaining[len(remaining)-1]
		remaining = remaining[:len(remaining)-1]
	}
	city := ""
	if len(remaining) > 0 {
		city = remaining[len(remaining)-1]
		remaining = remaining[:len(remaining)-1]
	}
	street1 := strings.TrimSpace(strings.Join(remaining, ", "))
	if street1 == "" {
		street1 = address
	}
	if city == "" {
		city = state
	}
	if city == "" {
		city = "Unknown"
	}
	if state == "" {
		state = "Unknown"
	}
	if country == "" {
		country = "Unknown"
	}
	return &ReceiptAddress{
		Street1:    street1,
		City:       city,
		PostalCode: postal,
		State:      state,
		Country:    country,
	}
}

func isPostalCodePart(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(value) >= 4 && len(value) <= 6
}
