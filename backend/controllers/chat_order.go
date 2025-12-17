package controllers

import (
	"bakeflow/configs"
	"encoding/json"
	"log"
	"net/http"
)

type ChatOrderRequest struct {
	UserID       string          `json:"user_id"`
	Items        []ChatOrderItem `json:"items"`
	Channel      string          `json:"channel"`
	Notes        string          `json:"notes"`
	CustomerName string          `json:"customer_name"`
	CustomerPhone string         `json:"customer_phone"`
	DeliveryType string          `json:"delivery_type"`
	Address      string          `json:"address"`
}

type ChatOrderItem struct {
	ProductID int     `json:"product_id"`
	Name      string  `json:"name"`
	Qty       int     `json:"qty"`
	Price     float64 `json:"price"`
}

type ChatOrderResponse struct {
	Success bool   `json:"success"`
	OrderID int    `json:"order_id"`
	Message string `json:"message"`
}

// CreateChatOrder handles orders from the mini webview
func CreateChatOrder(w http.ResponseWriter, r *http.Request) {
	var req ChatOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("❌ Invalid request: %v", err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if len(req.Items) == 0 {
		http.Error(w, "cart is empty", http.StatusBadRequest)
		return
	}

	log.Printf("📦 Creating order for user %s with %d items", req.UserID, len(req.Items))

	// Calculate total and item count
	var total float64
	var totalItems int
	for _, item := range req.Items {
		total += item.Price * float64(item.Qty)
		totalItems += item.Qty
	}

	// Combine customer info into customer_name field
	customerInfo := req.CustomerName
	if req.CustomerPhone != "" {
		customerInfo += " (" + req.CustomerPhone + ")"
	}

	// Insert order into database
	var orderID int
	err := configs.DB.QueryRow(`
		INSERT INTO orders (customer_name, delivery_type, address, status, total_items, subtotal, delivery_fee, total_amount, sender_id, created_at)
		VALUES ($1, $2, $3, 'pending', $4, $5, 0, $5, $6, NOW())
		RETURNING id
	`, customerInfo, req.DeliveryType, req.Address, totalItems, total, req.UserID).Scan(&orderID)

	if err != nil {
		log.Printf("❌ Failed to create order: %v", err)
		http.Error(w, "failed to create order", http.StatusInternalServerError)
		return
	}

	// Insert order items
	for _, item := range req.Items {
		_, err = configs.DB.Exec(`
			INSERT INTO order_items (order_id, product, quantity, price, created_at)
			VALUES ($1, $2, $3, $4, NOW())
		`, orderID, item.Name, item.Qty, item.Price)

		if err != nil {
			log.Printf("⚠️  Failed to insert item %s: %v", item.Name, err)
		}
	}

	log.Printf("✅ Order #%d created successfully", orderID)

	// Send response
	resp := ChatOrderResponse{
		Success: true,
		OrderID: orderID,
		Message: "Order placed successfully!",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)

	// Send confirmation message to user via Messenger (async)
	go func() {
		defer func() { _ = recover() }()
		
		itemsList := ""
		for i, item := range req.Items {
			if i < 3 {
				itemsList += item.Name + " × " + string(rune(item.Qty+'0')) + "\n"
			}
		}
		if len(req.Items) > 3 {
			itemsList += "...and more\n"
		}

		msg := "🎉 Order Confirmed!\n\n" +
			"Order #" + string(rune(orderID+'0')) + "\n" +
			itemsList +
			"\nTotal: $" + string(rune(int(total))) + "\n" +
			"Status: ⏳ Pending\n\n" +
			"We'll start preparing your order soon!"

		SendMessage(req.UserID, msg)
	}()
}
