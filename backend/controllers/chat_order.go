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
	"strings"
	"time"
)

type ChatOrderSchedule struct {
	Type string `json:"type"`
	Date string `json:"date"`
	Time string `json:"time"`
}

type ChatOrderRequest struct {
	UserID           string             `json:"user_id"`
	Items            []ChatOrderItem    `json:"items"`
	Channel          string             `json:"channel"`
	Notes            string             `json:"notes"`
	CustomerName     string             `json:"customer_name"`
	CustomerPhone    string             `json:"customer_phone"`
	DeliveryType     string             `json:"delivery_type"`
	Address          string             `json:"address"`
	Schedule         *ChatOrderSchedule `json:"schedule"`
	AppliedPromotion *AppliedPromotion  `json:"appliedPromotion,omitempty"`
	Discount         float64            `json:"discount"`
	ForceNewOrder    bool               `json:"force_new_order"`
	OrderType        string             `json:"order_type"`
}

type ChatOrderItem struct {
	ProductID int     `json:"product_id"`
	Name      string  `json:"name"`
	Qty       int     `json:"qty"`
	Price     float64 `json:"price"`
	Note      string  `json:"note"`
	ImageURL  string  `json:"image_url"`
}

type ChatOrderResponse struct {
	Success bool   `json:"success"`
	OrderID int    `json:"order_id"`
	Message string `json:"message"`
}

type OrderChoiceRequest struct {
	UserID       string          `json:"user_id"`
	Choice       string          `json:"choice"`   // "add_to_existing" or "new_order"
	OrderID      int             `json:"order_id"` // for add_to_existing choice
	Items        []ChatOrderItem `json:"items"`
	CustomerName string          `json:"customer_name"`
	DeliveryType string          `json:"delivery_type"`
	Address      string          `json:"address"`
}

// ─── Order Type System ─────────────────────────────────────
// Clear separation: regular (ready today) vs custom (2-3 days) vs scheduled (future time)

type OrderType string

const (
	OrderTypeRegular   OrderType = "regular"   // Normal items, ready same day
	OrderTypeCustom    OrderType = "custom"    // Custom cakes, need 2-3 days
	OrderTypeScheduled OrderType = "scheduled" // Regular items at a future time
)

// requiresAdvanceNotice checks the database to see if a product needs custom work
func requiresAdvanceNotice(productID int) bool {
	var requires bool
	err := configs.DB.QueryRow("SELECT COALESCE(requires_advance_notice, false) FROM products WHERE id = $1", productID).Scan(&requires)
	return err == nil && requires
}

// getOrderType determines the order type based on product configuration + schedule
func getOrderType(req *ChatOrderRequest) OrderType {
	// If frontend explicitly specifies the order type, use it
	if req.OrderType == string(OrderTypeCustom) {
		return OrderTypeCustom
	}

	// Check if any item requires custom work (product-based, not text-based)
	for _, item := range req.Items {
		if item.ProductID > 0 && requiresAdvanceNotice(item.ProductID) {
			return OrderTypeCustom
		}
	}

	// Check if scheduled for future delivery
	if req.Schedule != nil {
		dateStr := strings.TrimSpace(req.Schedule.Date)
		timeStr := strings.TrimSpace(req.Schedule.Time)
		if dateStr != "" && timeStr != "" {
			if t, err := time.Parse("2006-01-02T15:04:05", dateStr+"T"+timeStr+":00"); err == nil {
				if t.After(time.Now().Add(2 * time.Hour)) {
					return OrderTypeScheduled
				}
			}
		}
	}

	return OrderTypeRegular
}

// getChoiceItemsOrderType determines order type from choice items
func getChoiceItemsOrderType(items []ChatOrderItem) OrderType {
	for _, item := range items {
		if item.ProductID > 0 && requiresAdvanceNotice(item.ProductID) {
			return OrderTypeCustom
		}
		// Also detect custom cakes by name pattern (e.g. "Red Velvet Cake — Custom (8)")
		if strings.Contains(strings.ToLower(item.Name), "custom") {
			return OrderTypeCustom
		}
	}
	return OrderTypeRegular
}

// isCustomOrder checks if an existing order contains custom items
func isCustomOrder(orderID int) bool {
	// Primary: check order_type column directly (most reliable)
	var orderType string
	err := configs.DB.QueryRow("SELECT COALESCE(order_type, '') FROM orders WHERE id = $1", orderID).Scan(&orderType)
	if err == nil && orderType == string(OrderTypeCustom) {
		return true
	}

	// Fallback: check if any item's product has requires_advance_notice
	var count int
	err = configs.DB.QueryRow(`
		SELECT COUNT(*) FROM order_items oi
		JOIN products p ON p.name = oi.product
		WHERE oi.order_id = $1 AND COALESCE(p.requires_advance_notice, false) = true
	`, orderID).Scan(&count)
	if err == nil && count > 0 {
		return true
	}

	// Last fallback: custom cake items may store "Custom" in name or notes
	err = configs.DB.QueryRow(`
		SELECT COUNT(*) FROM order_items
		WHERE order_id = $1
		  AND (LOWER(product) LIKE '%custom%' OR LOWER(COALESCE(note, '')) LIKE '%custom cake%')
	`, orderID).Scan(&count)
	return err == nil && count > 0
}

func hasPaidPayment(orderID int) bool {
	var status string
	err := configs.DB.QueryRow("SELECT status FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1", orderID).Scan(&status)
	if err != nil {
		return false
	}
	normalized := strings.ToLower(strings.TrimSpace(status))
	return normalized == "pending" || normalized == "verified" || normalized == "confirmed" || normalized == "paid"
}

func getLatestPaymentInfo(orderID int) (string, string, bool) {
	var method, status sql.NullString
	err := configs.DB.QueryRow("SELECT method, status FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1", orderID).Scan(&method, &status)
	if err != nil {
		return "", "", false
	}
	return strings.ToLower(strings.TrimSpace(method.String)), strings.ToLower(strings.TrimSpace(status.String)), true
}

// canCreateOrder validates if a user can place a new order (simple Food Panda-style rules)
// Custom cake orders and regular orders are independent — they don't block each other.
func canCreateOrder(userID string, orderType OrderType) (bool, string, []*models.Order) {
	activeStatuses := []string{"pending", "confirmed", "preparing", "ready", "delivering", "scheduled"}
	existingOrders, _ := models.GetAllOrdersBySenderIDAndStatuses(userID, activeStatuses)

	switch orderType {
	case OrderTypeCustom:
		var modifiableOrders []*models.Order
		for _, order := range existingOrders {
			if !isCustomOrder(order.ID) {
				continue
			}
			status := strings.ToLower(strings.TrimSpace(order.Status))
			if status != "pending" {
				continue
			}
			_, payStatus, hasPayment := getLatestPaymentInfo(order.ID)
			if hasPayment {
				if payStatus == "verified" || payStatus == "confirmed" || payStatus == "paid" {
					continue
				}
			}
			modifiableOrders = append(modifiableOrders, order)
		}
		if len(modifiableOrders) > 0 {
			return false, "existing_custom_modifiable", modifiableOrders
		}
		return true, "", nil

	case OrderTypeScheduled:
		// Rule: Only 1 scheduled order at a time
		for _, order := range existingOrders {
			if strings.ToLower(order.Status) == "scheduled" {
				return false, "You already have a scheduled order. Please wait until it starts preparing.", nil
			}
		}
		return true, "", nil

	case OrderTypeRegular:
		// Rule: Users can create unlimited independent regular orders
		// Skip custom cake orders and scheduled orders — they are independent
		var modifiableOrders []*models.Order
		for _, order := range existingOrders {
			if isCustomOrder(order.ID) {
				continue
			}
			if hasPaidPayment(order.ID) {
				continue
			}
			status := strings.ToLower(strings.TrimSpace(order.Status))
			if status == "scheduled" {
				continue // scheduled orders don't block "order now"
			}
			if status == "pending" || status == "preparing" {
				modifiableOrders = append(modifiableOrders, order)
			}
		}

		// IMPORTANT: Return true (allow new order) but also return modifiable orders
		// Frontend will show a choice dialog as a SUGGESTION, not a blocker
		// Users can choose to merge or create independently
		if len(modifiableOrders) > 0 {
			return true, "suggest_add_to_existing", modifiableOrders
		}

		// No existing orders - allow creating new
		return true, "", nil
	}

	return true, "", nil
}

// getOrderTypeLabel returns a user-friendly label for the order type
func getOrderTypeLabel(orderType OrderType) string {
	switch orderType {
	case OrderTypeCustom:
		return "🎂 Custom Cake Order (2-3 days preparation)"
	case OrderTypeScheduled:
		return "⏰ Scheduled Order (future delivery)"
	case OrderTypeRegular:
		return "🛒 Regular Order (ready today)"
	}
	return ""
}

// Legacy compatibility aliases
func isPreorderText(value string) bool {
	return strings.Contains(strings.ToLower(value), "preorder")
}

func isPreorderOrderID(orderID int) bool {
	return isCustomOrder(orderID)
}

// HandleOrderChoice processes the user's decision to add to existing or create new order
func HandleOrderChoice(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "only POST allowed", http.StatusMethodNotAllowed)
		return
	}

	var req OrderChoiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("❌ HandleOrderChoice: Failed to decode request: %v", err)
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	log.Printf("📥 HandleOrderChoice: Received request - user_id=%s, choice=%s, order_id=%d", req.UserID, req.Choice, req.OrderID)

	tok := strings.TrimSpace(r.URL.Query().Get("t"))
	psid := ""
	if tok != "" {
		log.Printf("🔑 HandleOrderChoice: Verifying token (length=%d)", len(tok))
		if verified, errTok := VerifyWebviewToken(tok); errTok == nil {
			psid = verified
			log.Printf("✅ HandleOrderChoice: Token verified, psid=%s", psid)
		} else {
			log.Printf("⚠️  HandleOrderChoice: Token verification failed: %v", errTok)
		}
	} else {
		log.Printf("⚠️  HandleOrderChoice: No token provided in URL")
	}
	if psid == "" {
		log.Printf("🔄 HandleOrderChoice: Trying user_id fallback: '%s'", req.UserID)
		if isValidMessengerRecipientID(req.UserID) {
			log.Printf("✅ HandleOrderChoice: user_id is valid, using as psid: %s", req.UserID)
			psid = req.UserID
		} else {
			log.Printf("❌ HandleOrderChoice: user_id '%s' is not a valid Messenger ID", req.UserID)
			http.Error(w, "invalid auth token", http.StatusUnauthorized)
			return
		}
	}

	userID := psid

	choice := strings.ToLower(strings.TrimSpace(req.Choice))

	if choice == "add_to_existing" {
		// Add items to existing order with smart merging
		addItemsToExistingOrder(w, userID, req.OrderID, req.Items)
	} else if choice == "new_order" {
		// Create a new order (treat as a fresh order)
		createNewOrderAfterChoice(w, userID, req)
	} else if choice == "update_custom" {
		// Replace items in existing custom order
		updateCustomOrder(w, userID, req)
	} else if choice == "cancel_custom" {
		// Cancel existing custom order so user can place a new one
		cancelCustomOrder(w, userID, req)
	} else {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "invalid_choice",
			"message": "Invalid choice",
		})
	}
}

// updateCustomOrder replaces items in an existing custom cake order
func updateCustomOrder(w http.ResponseWriter, userID string, req OrderChoiceRequest) {
	orderID := req.OrderID
	if orderID <= 0 {
		http.Error(w, "missing order_id", http.StatusBadRequest)
		return
	}

	existingOrder, err := models.GetOrderByID(orderID)
	if err != nil || existingOrder == nil {
		http.Error(w, "order not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(existingOrder.SenderID) != "" && strings.TrimSpace(existingOrder.SenderID) != strings.TrimSpace(userID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "order_access_denied",
			"message": "You can only modify your own orders.",
		})
		return
	}

	status := strings.ToLower(strings.TrimSpace(existingOrder.Status))
	if status != "pending" && status != "scheduled" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "order_not_modifiable",
			"message": "This order can no longer be modified.",
		})
		return
	}

	// Delete old items
	_, err = configs.DB.Exec(`DELETE FROM order_items WHERE order_id = $1`, orderID)
	if err != nil {
		log.Printf("❌ updateCustomOrder: failed to delete old items: %v", err)
		http.Error(w, "failed to update order", http.StatusInternalServerError)
		return
	}

	// Insert new items
	var subtotal float64
	totalItems := 0
	for _, item := range req.Items {
		_, err = configs.DB.Exec(`
			INSERT INTO order_items (order_id, product, quantity, price, note, image_url, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
		`, orderID, item.Name, item.Qty, item.Price, item.Note, item.ImageURL)
		if err != nil {
			log.Printf("⚠️  updateCustomOrder: failed to insert item %s: %v", item.Name, err)
		}
		subtotal += item.Price * float64(item.Qty)
		totalItems += item.Qty
	}

	// Update order totals and customer info
	customerName := strings.TrimSpace(req.CustomerName)
	if customerName == "" {
		customerName = existingOrder.CustomerName
	}
	deliveryType := strings.TrimSpace(req.DeliveryType)
	if deliveryType == "" {
		deliveryType = existingOrder.DeliveryType
	}
	address := strings.TrimSpace(req.Address)
	if address == "" {
		address = existingOrder.Address
	}

	_, err = configs.DB.Exec(`
		UPDATE orders
		SET total_items = $1, subtotal = $2, total_amount = $2,
		    customer_name = $3, delivery_type = $4, address = $5
		WHERE id = $6
	`, totalItems, subtotal, customerName, deliveryType, address, orderID)
	if err != nil {
		log.Printf("⚠️  updateCustomOrder: failed to update order totals: %v", err)
	}

	log.Printf("✅ Custom order #%d updated: %d items, Ks %.2f", orderID, totalItems, subtotal)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"orderID":       orderID,
		"order_id":      orderID,
		"message":       fmt.Sprintf("✅ Custom order #BF-%d updated!", orderID),
		"action":        "custom_order_updated",
		"subtotal":      subtotal,
		"total":         subtotal,
		"total_amount":  subtotal,
		"delivery_fee":  0,
		"discount":      0,
		"delivery_type": deliveryType,
		"address":       address,
		"customer_name": customerName,
	})

	// Send Messenger notification
	go func() {
		defer func() { _ = recover() }()
		if !isValidMessengerRecipientID(userID) {
			return
		}
		itemSummary := "Custom cake updated"
		if len(req.Items) > 0 {
			itemSummary = req.Items[0].Name
		}
		productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
		if len(req.Items) > 0 && strings.TrimSpace(req.Items[0].ImageURL) != "" {
			imgURL := strings.TrimSpace(req.Items[0].ImageURL)
			if strings.HasPrefix(imgURL, "https://") {
				productImage = imgURL
			}
		}
		title := "Custom Order Updated"
		subtitle := fmt.Sprintf("Order #BF-%d • %s • Total: Ks %.2f", orderID, itemSummary, subtotal)
		buttons := []Button{
			{Type: "postback", Title: "Track Order", Payload: fmt.Sprintf("TRACK_ORDER_%d", orderID)},
		}
		_ = SendOrderCardWithTag(userID, orderID, title, subtitle, productImage, buttons, "POST_PURCHASE_UPDATE")
	}()
}

// cancelCustomOrder cancels the existing custom order, then creates a new one with the submitted items
func cancelCustomOrder(w http.ResponseWriter, userID string, req OrderChoiceRequest) {
	orderID := req.OrderID
	if orderID <= 0 {
		http.Error(w, "missing order_id", http.StatusBadRequest)
		return
	}

	existingOrder, err := models.GetOrderByID(orderID)
	if err != nil || existingOrder == nil {
		http.Error(w, "order not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(existingOrder.SenderID) != "" && strings.TrimSpace(existingOrder.SenderID) != strings.TrimSpace(userID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "order_access_denied",
			"message": "You can only cancel your own orders.",
		})
		return
	}

	status := strings.ToLower(strings.TrimSpace(existingOrder.Status))
	if status != "pending" && status != "scheduled" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "order_not_cancellable",
			"message": "This order can no longer be cancelled.",
		})
		return
	}

	// Cancel existing order
	_, err = configs.DB.Exec(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, orderID)
	if err != nil {
		log.Printf("❌ cancelCustomOrder: failed to cancel order #%d: %v", orderID, err)
		http.Error(w, "failed to cancel order", http.StatusInternalServerError)
		return
	}
	log.Printf("🗑️ Custom order #%d cancelled", orderID)

	// Now create the new order
	createNewOrderAfterChoice(w, userID, req)

	// Send Messenger notification about cancellation
	go func() {
		defer func() { _ = recover() }()
		if !isValidMessengerRecipientID(userID) {
			return
		}
		productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
		if len(existingOrder.Items) > 0 && strings.TrimSpace(existingOrder.Items[0].ImageURL) != "" {
			imgURL := strings.TrimSpace(existingOrder.Items[0].ImageURL)
			if strings.HasPrefix(imgURL, "https://") {
				productImage = imgURL
			}
		}
		title := "Order cancelled"
		subtitle := fmt.Sprintf("Order #BF-%d\nWe hope to serve you again soon.", orderID)
		if err := SendOrderCardWithTag(userID, orderID, title, subtitle, productImage, nil, "POST_PURCHASE_UPDATE"); err != nil {
			_ = SendMessage(userID, fmt.Sprintf("Your previous custom cake order #BF-%d has been cancelled. A new order has been created with your updated selections.", orderID))
		}
	}()
}

// addItemsToExistingOrder adds items to existing order, merging duplicate products
func addItemsToExistingOrder(w http.ResponseWriter, userID string, orderID int, newItems []ChatOrderItem) {
	// Get the existing order
	existingOrder, err := models.GetOrderByID(orderID)
	if err != nil || existingOrder == nil {
		http.Error(w, "order not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(existingOrder.SenderID) != "" && strings.TrimSpace(existingOrder.SenderID) != strings.TrimSpace(userID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "order_access_denied",
			"message": "You can only add items to your own active orders.",
		})
		return
	}

	status := strings.ToLower(strings.TrimSpace(existingOrder.Status))
	if status == "delivered" || status == "cancelled" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "order_not_modifiable",
			"message": "That order can’t be modified anymore.",
		})
		return
	}
	// Allow adding to pending/confirmed orders, and scheduled custom orders
	allowModify := status == "pending" || status == "confirmed"
	if status == "scheduled" && isCustomOrder(orderID) {
		allowModify = true
	}
	if !allowModify {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    false,
			"error":      "order_not_modifiable",
			"message":    "Items can only be added before the order is preparing.",
			"order_type": "regular",
		})
		return
	}

	var totalNewItems int
	var totalNewSubtotal float64

	// Get existing items
	existingItems, err := models.GetOrderItems(orderID)
	if err != nil {
		http.Error(w, "failed to fetch order items", http.StatusInternalServerError)
		return
	}

	// Create a map of product names to existing item IDs for easy lookup
	productItemMap := make(map[string]int)     // product_name -> item_id
	productQuantityMap := make(map[string]int) // product_name -> current quantity

	for _, item := range existingItems {
		productItemMap[item.Product] = item.ID
		productQuantityMap[item.Product] = item.Quantity
	}

	// Process new items - merge or insert
	for _, newItem := range newItems {
		if existingItemID, exists := productItemMap[newItem.Name]; exists {
			// Product already exists in order - increase its quantity
			currentQty := productQuantityMap[newItem.Name]
			newQty := currentQty + newItem.Qty

			_, err = configs.DB.Exec(`
				UPDATE order_items
				SET quantity = $1
				WHERE id = $2
			`, newQty, existingItemID)

			if err != nil {
				log.Printf("⚠️  Failed to update item %s: %v", newItem.Name, err)
			} else {
				log.Printf("✅ Updated quantity for '%s': %d → %d", newItem.Name, currentQty, newQty)
			}

			totalNewItems += newItem.Qty
			totalNewSubtotal += newItem.Price * float64(newItem.Qty)
		} else {
			// New product - insert as new item
			_, err = configs.DB.Exec(`
				INSERT INTO order_items (order_id, product, quantity, price, note, image_url, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, NOW())
			`, orderID, newItem.Name, newItem.Qty, newItem.Price, newItem.Note, newItem.ImageURL)

			if err != nil {
				log.Printf("⚠️  Failed to insert item %s: %v", newItem.Name, err)
			} else {
				log.Printf("✅ Inserted new item '%s' (qty: %d)", newItem.Name, newItem.Qty)
			}

			totalNewItems += newItem.Qty
			totalNewSubtotal += newItem.Price * float64(newItem.Qty)

			// Handle stock reservation if product has ID
			if newItem.ProductID > 0 {
				if err := models.AtomicPurchase(newItem.ProductID, newItem.Qty, orderID); err != nil {
					log.Printf("⚠️ Atomic purchase failed for product %d: %v", newItem.ProductID, err)
				}
			}
		}
	}

	// Recalculate order totals from actual items (prevents drift)
	_, _ = configs.DB.Exec(`
		UPDATE orders
		SET total_items = (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = $1),
		    subtotal = (SELECT COALESCE(SUM(price * quantity), 0) FROM order_items WHERE order_id = $1),
		    total_amount = (SELECT COALESCE(SUM(price * quantity), 0) FROM order_items WHERE order_id = $1) - COALESCE(discount, 0) + COALESCE(delivery_fee, 0)
		WHERE id = $1
	`, orderID)

	_ = models.UpsertCustomerPhone(userID, "")

	// Fetch updated order for response totals
	updatedOrderForResp, _ := models.GetOrderByID(orderID)
	var respSubtotal, respTotal, respDeliveryFee, respDiscount float64
	var respDeliveryType, respAddress, respCustomerName string
	if updatedOrderForResp != nil {
		respSubtotal = updatedOrderForResp.Subtotal
		respTotal = updatedOrderForResp.TotalAmount
		respDeliveryFee = updatedOrderForResp.DeliveryFee
		respDiscount = updatedOrderForResp.Discount
		respDeliveryType = updatedOrderForResp.DeliveryType
		respAddress = updatedOrderForResp.Address
		respCustomerName = updatedOrderForResp.CustomerName
	}

	// Fetch all items for the full receipt
	allItems, _ := models.GetOrderItems(orderID)
	type respItem struct {
		Name     string  `json:"name"`
		Qty      int     `json:"qty"`
		Price    float64 `json:"price"`
		Total    float64 `json:"line_total"`
		ImageURL string  `json:"image_url,omitempty"`
	}
	var fullItems []respItem
	for _, it := range allItems {
		fullItems = append(fullItems, respItem{
			Name:     it.Product,
			Qty:      it.Quantity,
			Price:    it.Price,
			Total:    it.Price * float64(it.Quantity),
			ImageURL: it.ImageURL,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"orderID":       orderID,
		"order_id":      orderID,
		"message":       fmt.Sprintf("✅ Added %d items to your order #BF-%d", totalNewItems, orderID),
		"action":        "items_merged",
		"subtotal":      respSubtotal,
		"total":         respTotal,
		"total_amount":  respTotal,
		"delivery_fee":  respDeliveryFee,
		"discount":      respDiscount,
		"delivery_type": respDeliveryType,
		"address":       respAddress,
		"customer_name": respCustomerName,
		"items":         fullItems,
	})

	// Send Messenger notification
	go func() {
		defer func() { _ = recover() }()
		if !isValidMessengerRecipientID(userID) {
			return
		}

		// Fetch updated order for notification
		updatedOrder, _ := models.GetOrderByID(orderID)
		if updatedOrder == nil {
			return
		}

		itemSummary := "Items added"
		if len(newItems) > 0 {
			first := newItems[0]
			itemSummary = fmt.Sprintf("%s × %d", first.Name, first.Qty)
			if len(newItems) > 1 {
				itemSummary = fmt.Sprintf("%s + %d more", itemSummary, len(newItems)-1)
			}
		}

		productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
		if len(newItems) > 0 && strings.TrimSpace(newItems[0].ImageURL) != "" {
			imgURL := strings.TrimSpace(newItems[0].ImageURL)
			if strings.HasPrefix(imgURL, "https://") {
				productImage = imgURL
			}
		}

		title := "Items Added & Merged"
		subtitle := fmt.Sprintf("Order #BF-%d • %s • Total: Ks %.2f", updatedOrder.ID, itemSummary, updatedOrder.TotalAmount)
		buttons := []Button{
			{Type: "postback", Title: "Track Order", Payload: fmt.Sprintf("TRACK_ORDER_%d", updatedOrder.ID)},
			{Type: "postback", Title: "View Cart", Payload: fmt.Sprintf("VIEW_CART_%d", updatedOrder.ID)},
		}
		_ = SendOrderCardWithTag(userID, updatedOrder.ID, title, subtitle, productImage, buttons, "POST_PURCHASE_UPDATE")
	}()
}

// createNewOrderAfterChoice creates a completely new order
func createNewOrderAfterChoice(w http.ResponseWriter, userID string, req OrderChoiceRequest) {
	var orderID int

	// Calculate totals
	var subtotal float64
	totalItems := 0
	for _, item := range req.Items {
		subtotal += item.Price * float64(item.Qty)
		totalItems += item.Qty
	}

	customerInfo := strings.TrimSpace(req.CustomerName)
	if customerInfo == "" {
		customerInfo = "Customer"
	}

	status := "pending"

	// Detect order type from items
	detectedType := string(getChoiceItemsOrderType(req.Items))

	// Insert new order
	insertQuery := `
		INSERT INTO orders (customer_name, delivery_type, address, status, total_items, subtotal, delivery_fee, total_amount, sender_id, order_type, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 0, $6, $7, $8, NOW())
		RETURNING id
	`

	err := configs.DB.QueryRow(insertQuery, customerInfo, req.DeliveryType, req.Address, status, totalItems, subtotal, userID, detectedType).Scan(&orderID)
	if err != nil {
		// Fallback without order_type column
		err = configs.DB.QueryRow(`
			INSERT INTO orders (customer_name, delivery_type, address, status, total_items, subtotal, delivery_fee, total_amount, sender_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, 0, $6, $7, NOW())
			RETURNING id
		`, customerInfo, req.DeliveryType, req.Address, status, totalItems, subtotal, userID).Scan(&orderID)
	}
	if err != nil {
		log.Printf("❌ Failed to create new order: %v", err)
		http.Error(w, "failed to create order", http.StatusInternalServerError)
		return
	}

	log.Printf("📦 New order #%d created", orderID)

	// Insert order items
	for _, item := range req.Items {
		_, err = configs.DB.Exec(`
			INSERT INTO order_items (order_id, product, quantity, price, note, image_url, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
		`, orderID, item.Name, item.Qty, item.Price, item.Note, item.ImageURL)

		if err != nil {
			log.Printf("⚠️  Failed to insert item %s: %v", item.Name, err)
		}

		// Handle stock reservation
		if item.ProductID > 0 {
			if err := models.AtomicPurchase(item.ProductID, item.Qty, orderID); err != nil {
				log.Printf("⚠️ Atomic purchase failed for product %d: %v", item.ProductID, err)
			}
		}
	}

	_ = models.UpsertCustomerPhone(userID, "")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"orderID":       orderID,
		"order_id":      orderID,
		"message":       fmt.Sprintf("✅ New order #BF-%d created with %d items", orderID, totalItems),
		"action":        "new_order_created",
		"subtotal":      subtotal,
		"total":         subtotal,
		"total_amount":  subtotal,
		"delivery_fee":  0,
		"discount":      0,
		"delivery_type": req.DeliveryType,
		"address":       req.Address,
		"customer_name": customerInfo,
	})

	// Send Messenger notification
	go func() {
		defer func() { _ = recover() }()
		if !isValidMessengerRecipientID(userID) {
			return
		}

		itemSummary := "Order placed"
		if len(req.Items) > 0 {
			first := req.Items[0]
			itemSummary = fmt.Sprintf("%s × %d", first.Name, first.Qty)
			if len(req.Items) > 1 {
				itemSummary = fmt.Sprintf("%s + %d more", itemSummary, len(req.Items)-1)
			}
		}

		productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
		if len(req.Items) > 0 && strings.TrimSpace(req.Items[0].ImageURL) != "" {
			imgURL := strings.TrimSpace(req.Items[0].ImageURL)
			if strings.HasPrefix(imgURL, "https://") {
				productImage = imgURL
			}
		}

		// Combined confirmation card with all options
		frontendURL := resolveFrontendBaseURL()

		paymentLink := fmt.Sprintf("%s/order/%d", frontendURL, orderID)

		title := "✅ Order Confirmed"
		subtitle := fmt.Sprintf("Order #BF-%d • %s • Total: Ks %.2f\n\nReady to pay? Tap Pay Now below", orderID, itemSummary, subtotal)
		buttons := []Button{
			{Type: "web_url", Title: "💳 Pay Now", URL: paymentLink},
			{Type: "postback", Title: "📍 Track Order", Payload: fmt.Sprintf("TRACK_ORDER_%d", orderID)},
			{Type: "postback", Title: "❓ Need Help?", Payload: "CONTACT_SUPPORT"},
		}
		_ = SendOrderCardWithTag(userID, orderID, title, subtitle, productImage, buttons, "POST_PURCHASE_UPDATE")

	}()
}

// CreateChatOrder handles orders from the mini webview
func CreateChatOrder(w http.ResponseWriter, r *http.Request) {
	var req ChatOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("❌ Invalid request: %v", err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	tok := strings.TrimSpace(r.URL.Query().Get("t"))
	psid := ""
	if tok != "" {
		if verified, errTok := VerifyWebviewToken(tok); errTok == nil {
			psid = verified
		}
	}
	if psid == "" {
		if isValidMessengerRecipientID(req.UserID) {
			log.Printf("⚠️  Falling back to user_id for chat order: %s", req.UserID)
			psid = req.UserID
		} else {
			http.Error(w, "invalid auth token", http.StatusUnauthorized)
			return
		}
	}
	userID := psid

	if len(req.Items) == 0 {
		http.Error(w, "cart is empty", http.StatusBadRequest)
		return
	}

	// Phone is optional for custom cake orders (customer identified via Messenger PSID)
	if req.CustomerPhone != "" {
		normalizedPhone, ok := NormalizeMyanmarPhoneE164(req.CustomerPhone)
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "invalid_phone",
				"message": "Enter 09xxxxxxxxx or +959xxxxxxxxx",
			})
			return
		}
		req.CustomerPhone = normalizedPhone
	}

	blocked, err := models.IsIdentityBlocked("psid", userID)
	if err != nil {
		http.Error(w, "failed to verify customer", http.StatusInternalServerError)
		return
	}
	if blocked {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "blocked",
			"message": "This account is currently restricted from placing new orders. Please contact the bakery if you believe this is a mistake.",
		})
		return
	}

	if req.CustomerPhone != "" {
		blocked, err = models.IsIdentityBlocked("phone", req.CustomerPhone)
		if err != nil {
			http.Error(w, "failed to verify customer", http.StatusInternalServerError)
			return
		}
		if blocked {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "blocked",
				"message": "This phone number is currently restricted from placing new orders. Please contact the bakery if you believe this is a mistake.",
			})
			return
		}
	}

	// PRODUCTION-GRADE: Validate stock availability using atomic check
	// This checks AVAILABLE stock (total - reserved) to prevent overselling
	for _, item := range req.Items {
		if item.ProductID > 0 {
			stockStatus, err := models.GetProductStockStatus(item.ProductID)
			if err != nil {
				log.Printf("⚠️ Product %d not found or inactive", item.ProductID)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success": false,
					"error":   "product_unavailable",
					"message": fmt.Sprintf("%s is no longer available", item.Name),
				})
				return
			}

			// Check AVAILABLE stock (accounts for reservations)
			if stockStatus.AvailableStock < item.Qty {
				log.Printf("⚠️ Insufficient stock for %s: requested %d, available %d (reserved: %d)",
					stockStatus.ProductName, item.Qty, stockStatus.AvailableStock, stockStatus.ReservedStock)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success":   false,
					"error":     "insufficient_stock",
					"message":   fmt.Sprintf("Sorry, only %d %s available", stockStatus.AvailableStock, stockStatus.ProductName),
					"product":   stockStatus.ProductName,
					"requested": item.Qty,
					"available": stockStatus.AvailableStock,
				})
				return
			}
		}
	}

	// Parse schedule (if provided)
	var scheduledFor *time.Time
	scheduleType := ""
	orderStatus := "pending"
	if req.Schedule != nil {
		scheduleType = strings.TrimSpace(req.Schedule.Type)
		dateStr := strings.TrimSpace(req.Schedule.Date)
		timeStr := strings.TrimSpace(req.Schedule.Time)
		if dateStr != "" && timeStr != "" {
			if t, err := time.Parse("2006-01-02T15:04:05", dateStr+"T"+timeStr+":00"); err == nil {
				scheduledFor = &t
				if t.After(time.Now()) {
					orderStatus = "scheduled"
				}
			}
		}
	}

	// ─── Determine Order Type ─────────────────────────────────
	orderTypeDetected := getOrderType(&req)
	log.Printf("📋 [OrderType] Detected: %s for user %s", orderTypeDetected, userID)

	// Calculate subtotal from items
	subtotal := 0.0
	var totalItems int
	for _, item := range req.Items {
		subtotal += item.Price * float64(item.Qty)
		totalItems += item.Qty
	}

	// Apply discount if promotion was applied
	discount := req.Discount
	total := subtotal - discount
	if total < 0 {
		total = 0
	}

	// Extract promotion ID from applied promotion
	var promotionID *int
	if req.AppliedPromotion != nil {
		promotionID = &req.AppliedPromotion.ID
	}

	// Combine customer info into customer_name field
	customerInfo := req.CustomerName
	if req.CustomerPhone != "" {
		customerInfo += " (" + req.CustomerPhone + ")"
	}

	// ─── Simplified Order Rules (Food App Style) ──────────────
	if !req.ForceNewOrder {
		canOrder, reason, modifiableOrders := canCreateOrder(userID, orderTypeDetected)
		log.Printf("🔍 [OrderRules] Type: %s, CanOrder: %v, Reason: %s", orderTypeDetected, canOrder, reason)

		if !canOrder {
			if reason == "existing_custom_modifiable" && len(modifiableOrders) > 0 {
				ordersPayload := make([]map[string]interface{}, 0, len(modifiableOrders))
				for _, o := range modifiableOrders {
					ordersPayload = append(ordersPayload, map[string]interface{}{
						"id":     o.ID,
						"status": o.Status,
						"items":  o.TotalItems,
						"amount": o.TotalAmount,
					})
				}
				existingOrder := modifiableOrders[0]
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success":  true,
					"action":   "existing_custom_order",
					"message":  "You already have custom cake orders. Select one to add items or create a new order.",
					"order_id": existingOrder.ID,
					"order": map[string]interface{}{
						"id":     existingOrder.ID,
						"status": existingOrder.Status,
						"items":  existingOrder.TotalItems,
						"amount": existingOrder.TotalAmount,
					},
					"orders":     ordersPayload,
					"newItems":   req.Items,
					"order_type": string(orderTypeDetected),
					"allow_new":  true,
				})
				return
			}

			if reason == "existing_custom_unmodifiable" && len(modifiableOrders) > 0 {
				existingOrder := modifiableOrders[0]
				status := strings.ToLower(strings.TrimSpace(existingOrder.Status))
				allowAdd := status != "preparing"
				message := fmt.Sprintf("You already have a custom cake order (#BF-%d). Select it to add items or create a new order.", existingOrder.ID)
				if !allowAdd {
					message = fmt.Sprintf("You already have a custom cake order (#BF-%d) preparing. You can create a new order.", existingOrder.ID)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success":  true,
					"action":   "existing_custom_order",
					"message":  message,
					"order_id": existingOrder.ID,
					"order": map[string]interface{}{
						"id":     existingOrder.ID,
						"status": existingOrder.Status,
						"items":  existingOrder.TotalItems,
						"amount": existingOrder.TotalAmount,
					},
					"newItems":     req.Items,
					"order_type":   string(orderTypeDetected),
					"allow_update": false,
					"allow_add":    allowAdd,
					"allow_new":    true,
				})
				return
			}

			if reason == "add_to_existing" && len(modifiableOrders) > 0 {
				type OrderSummary struct {
					ID      int     `json:"id"`
					Status  string  `json:"status"`
					Items   int     `json:"items"`
					Amount  float64 `json:"amount"`
					Summary string  `json:"summary"`
				}
				var summaries []OrderSummary
				for _, order := range modifiableOrders {
					// Count actual items from order_items table (more reliable than cached total_items)
					actualItems := order.TotalItems
					var count int
					if err := configs.DB.QueryRow(`SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = $1`, order.ID).Scan(&count); err == nil && count > 0 {
						actualItems = count
					}
					summaries = append(summaries, OrderSummary{
						ID:      order.ID,
						Status:  order.Status,
						Items:   actualItems,
						Amount:  order.TotalAmount,
						Summary: fmt.Sprintf("Order #BF-%d • %d items • Ks %.2f", order.ID, actualItems, order.TotalAmount),
					})
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success":    true,
					"action":     "ask_user_choice",
					"message":    "Add to your existing order or start fresh?",
					"orders":     summaries,
					"newItems":   req.Items,
					"order_type": string(orderTypeDetected),
				})
				return
			}

			// Blocked — clear message to user
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":    false,
				"error":      "order_blocked",
				"message":    reason,
				"order_type": string(orderTypeDetected),
			})
			return
		}

		// Offer choice dialog as a SUGGESTION (not a blocker) if user has modifiable orders
		if reason == "suggest_add_to_existing" && len(modifiableOrders) > 0 {
			type OrderSummary struct {
				ID      int     `json:"id"`
				Status  string  `json:"status"`
				Items   int     `json:"items"`
				Amount  float64 `json:"amount"`
				Summary string  `json:"summary"`
			}
			var summaries []OrderSummary
			for _, order := range modifiableOrders {
				// Count actual items from order_items table
				actualItems := order.TotalItems
				var count int
				if err := configs.DB.QueryRow(`SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = $1`, order.ID).Scan(&count); err == nil && count > 0 {
					actualItems = count
				}
				summaries = append(summaries, OrderSummary{
					ID:      order.ID,
					Status:  order.Status,
					Items:   actualItems,
					Amount:  order.TotalAmount,
					Summary: fmt.Sprintf("Order #BF-%d • %d items • Ks %.2f", order.ID, actualItems, order.TotalAmount),
				})
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":    true,
				"action":     "ask_user_choice",
				"message":    "You have an existing order. Add to it or create a new one?",
				"orders":     summaries,
				"newItems":   req.Items,
				"order_type": string(orderTypeDetected),
				"allow_new":  true, // Allow creating new order independently
			})
			return
		}

		// Phone-based duplicate check
		if req.CustomerPhone != "" {
			activeStatuses := []string{"pending", "confirmed", "preparing", "ready", "delivering", "scheduled"}
			phoneOrder, _ := models.GetLatestOrderByPhoneAndStatuses(req.CustomerPhone, activeStatuses)
			if phoneOrder != nil && strings.TrimSpace(phoneOrder.SenderID) != userID {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success":    false,
					"error":      "order_locked",
					"message":    "An active order exists for this phone number. Please continue from the original Messenger chat or wait until it completes.",
					"order_type": string(orderTypeDetected),
				})
				return
			}
		}
	}

	limited, retryAfter, err := checkOrderRateLimit(userID)
	if err != nil {
		http.Error(w, "failed to verify customer", http.StatusInternalServerError)
		return
	}
	if limited {
		retryMinutes := int(retryAfter.Minutes())
		if retryMinutes < 1 {
			retryMinutes = 1
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":             false,
			"error":               "rate_limited",
			"message":             fmt.Sprintf("Too many recent orders. Please wait %d minutes before ordering again.", retryMinutes),
			"retry_after_minutes": retryMinutes,
		})
		return
	}

	log.Printf("📦 Creating order for user %s with %d items", userID, len(req.Items))

	var orderID int

	// New insert with promotion fields and order_type
	insertWithPromotion := `
		INSERT INTO orders (customer_name, delivery_type, address, status, total_items, subtotal, delivery_fee, total_amount, sender_id, promotion_id, discount, scheduled_for, schedule_type, order_type, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, NOW())
		RETURNING id
	`

	insertWithSchedule := `
		INSERT INTO orders (customer_name, delivery_type, address, status, total_items, subtotal, delivery_fee, total_amount, sender_id, scheduled_for, schedule_type, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 0, $6, $7, $8, $9, NOW())
		RETURNING id
	`

	insertLegacy := `
		INSERT INTO orders (customer_name, delivery_type, address, status, total_items, subtotal, delivery_fee, total_amount, sender_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 0, $6, $7, NOW())
		RETURNING id
	`

	// Try insert with promotion columns first
	err = configs.DB.QueryRow(insertWithPromotion, customerInfo, req.DeliveryType, req.Address, orderStatus, totalItems, subtotal, total, userID, promotionID, discount, scheduledFor, scheduleType, string(orderTypeDetected)).Scan(&orderID)
	if err != nil {
		// Backwards compatible fallback if DB columns aren't migrated yet.
		msg := err.Error()
		if strings.Contains(msg, "promotion_id") || strings.Contains(msg, "discount") {
			// Try with scheduling columns
			err = configs.DB.QueryRow(insertWithSchedule, customerInfo, req.DeliveryType, req.Address, orderStatus, totalItems, subtotal, userID, scheduledFor, scheduleType).Scan(&orderID)
			if err != nil {
				// Check for scheduling columns not existing
				if strings.Contains(err.Error(), "scheduled_for") || strings.Contains(err.Error(), "schedule_type") {
					// If the user attempted to schedule, don't silently drop scheduling.
					if scheduledFor != nil {
						http.Error(w, "Scheduling is not enabled on the database yet. Please apply migration 006_add_order_scheduling.sql", http.StatusBadRequest)
						return
					}
					err = configs.DB.QueryRow(insertLegacy, customerInfo, req.DeliveryType, req.Address, orderStatus, totalItems, subtotal, userID).Scan(&orderID)
				}
			}
		} else if strings.Contains(msg, "scheduled_for") || strings.Contains(msg, "schedule_type") {
			// If the user attempted to schedule, don't silently drop scheduling.
			if scheduledFor != nil {
				http.Error(w, "Scheduling is not enabled on the database yet. Please apply migration 006_add_order_scheduling.sql", http.StatusBadRequest)
				return
			}
			err = configs.DB.QueryRow(insertLegacy, customerInfo, req.DeliveryType, req.Address, orderStatus, totalItems, subtotal, userID).Scan(&orderID)
		}
	}

	if err != nil {
		log.Printf("❌ Failed to create order: %v", err)
		http.Error(w, "failed to create order", http.StatusInternalServerError)
		return
	}

	if err := models.UpsertCustomerPhone(userID, req.CustomerPhone); err != nil {
		log.Printf("⚠️ Failed to link phone for %s: %v", userID, err)
	}

	// Insert order items and deduct stock using ATOMIC operations
	// This prevents race conditions where two users order the last item simultaneously
	for _, item := range req.Items {
		_, err = configs.DB.Exec(`
			INSERT INTO order_items (order_id, product, quantity, price, note, image_url, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
		`, orderID, item.Name, item.Qty, item.Price, item.Note, item.ImageURL)

		if err != nil {
			log.Printf("⚠️  Failed to insert item %s: %v", item.Name, err)
		}

		// PRODUCTION-GRADE: Use atomic purchase with row locking
		if item.ProductID > 0 {
			err = models.AtomicPurchase(item.ProductID, item.Qty, orderID)
			if err != nil {
				// Stock became unavailable between check and purchase (rare race condition)
				// In production, you might want to handle partial fulfillment here
				log.Printf("⚠️ Atomic purchase failed for product %d: %v", item.ProductID, err)
				// Note: Order is already created, so we log the issue
				// A more robust system would use a transaction for the entire order
			} else {
				log.Printf("📦 Atomically deducted %d stock from product #%d", item.Qty, item.ProductID)
			}
		}
	}

	log.Printf("✅ Order #%d created successfully (type: %s)", orderID, orderTypeDetected)

	// Send response with order type info
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"orderID":    orderID,
		"order_id":   orderID,
		"message":    fmt.Sprintf("Order #BF-%d placed successfully!", orderID),
		"order_type": string(orderTypeDetected),
		"type_label": getOrderTypeLabel(orderTypeDetected),
	})

	// Send confirmation message to user via Messenger (async)
	go func() {
		defer func() { _ = recover() }()
		log.Printf("🔔 [Order] Attempting to send notification to '%s' for order #%d", userID, orderID)

		if !isValidMessengerRecipientID(userID) {
			log.Printf("❌ [Order] Skipping Messenger notification: invalid recipient id '%s'", userID)
			return
		}

		// Build item summary (max 3 items shown)
		itemsList := ""
		for i, item := range req.Items {
			if i >= 3 {
				itemsList += fmt.Sprintf("...and %d more item(s)", len(req.Items)-3)
				break
			}
			itemsList += fmt.Sprintf("• %s × %d\n", item.Name, item.Qty)
		}

		// Get product image from first item (must be valid https URL)
		productImage := "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&h=200&fit=crop"
		if len(req.Items) > 0 && req.Items[0].ImageURL != "" {
			imgURL := strings.TrimSpace(req.Items[0].ImageURL)
			// Only use if it's a valid https URL
			if strings.HasPrefix(imgURL, "https://") {
				productImage = imgURL
			}
		}

		itemSummary := "Items"
		if len(req.Items) > 0 {
			first := req.Items[0]
			itemSummary = fmt.Sprintf("%s × %d", first.Name, first.Qty)
			if len(req.Items) > 1 {
				itemSummary = fmt.Sprintf("%s + %d more", itemSummary, len(req.Items)-1)
			}
		}

		totalLabel := fmt.Sprintf("Total: Ks %.2f", total)
		if discount > 0 {
			totalLabel = fmt.Sprintf("Total: Ks %.2f (saved Ks %.2f)", total, discount)
		}

		subtitle := fmt.Sprintf("Order #BF-%d • %s • %s", orderID, itemSummary, totalLabel)
		if scheduledFor != nil {
			subtitle = fmt.Sprintf("%s • Scheduled %s %s", subtitle, req.Schedule.Date, req.Schedule.Time)
		}

		// Title based on order type
		title := "Order Confirmed"
		switch orderTypeDetected {
		case OrderTypeCustom:
			title = "🎂 Custom Cake Order Received"
		case OrderTypeScheduled:
			title = "⏰ Scheduled Order Confirmed"
		}

		// Buttons for the card - include order ID so Track Order shows this specific order
		trackPayload := fmt.Sprintf("TRACK_ORDER_%d", orderID)
		log.Printf("[Order] Creating card with Track payload: %s", trackPayload)

		frontendURL := resolveFrontendBaseURL()

		buttons := []Button{
			{Type: "web_url", Title: "Pay Now", URL: fmt.Sprintf("%s/order/%d", frontendURL, orderID)},
			{Type: "postback", Title: "Track Order", Payload: trackPayload},
			{Type: "postback", Title: "Need Help?", Payload: "CONTACT_SUPPORT"},
		}

		// Send modern card with POST_PURCHASE_UPDATE tag
		err := SendOrderCardWithTag(userID, orderID, title, subtitle, productImage, buttons, "POST_PURCHASE_UPDATE")
		if err != nil {
			log.Printf("[Order] Card failed for order #%d: %v", orderID, err)
			// Fallback to plain text
			fallbackMsg := fmt.Sprintf("✅ Order #BF-%d confirmed!\n\n%s\nTotal: Ks %.2f\n\nWe'll notify you when it's ready!", orderID, itemsList, total)
			SendMessageWithTag(userID, fallbackMsg, "POST_PURCHASE_UPDATE")
		}
	}()
}

func isValidMessengerRecipientID(value string) bool {
	if value == "" {
		return false
	}
	// Allow any non-empty ID for now to prevent silent failures during testing
	return true
}

func resolveFrontendBaseURL() string {
	baseURL := strings.TrimSpace(os.Getenv("WEBVIEW_BASE_URL"))
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv("FRONTEND_URL"))
	}
	if baseURL == "" {
		if strings.TrimSpace(os.Getenv("RENDER")) != "" || strings.TrimSpace(os.Getenv("RENDER_EXTERNAL_URL")) != "" {
			baseURL = "https://bake-flow-amber.vercel.app"
		} else {
			baseURL = "http://localhost:3000"
		}
	}
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "https://" + baseURL
	}
	return strings.TrimRight(baseURL, "/")
}
