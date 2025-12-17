package controllers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"bakeflow/models"

	"github.com/gorilla/mux"
)

// AdminGetOrders returns all orders for admin dashboard
func AdminGetOrders(w http.ResponseWriter, r *http.Request) {
	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Set JSON header before any response
	w.Header().Set("Content-Type", "application/json")
	
	log.Printf("📋 Fetching all orders from database...")
	
	// Get all orders from database
	orders, err := models.GetAllOrders()
	if err != nil {
		log.Printf("❌ Error fetching orders: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Error fetching orders",
			"details": err.Error(),
			"orders": []interface{}{},
			"total": 0,
		})
		return
	}

	log.Printf("✅ Found %d orders", len(orders))

	// Return orders as JSON
	response := map[string]interface{}{
		"orders": orders,
		"total":  len(orders),
	}

	json.NewEncoder(w).Encode(response)
}

// AdminUpdateOrderStatus updates the status of an order
func AdminUpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
	w.Header().Set("Access-Control-Allow-Methods", "PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	
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

	// Validate status
	validStatuses := map[string]bool{
		"pending":   true,
		"preparing": true,
		"ready":     true,
		"delivered": true,
	}

	if !validStatuses[requestBody.Status] {
		http.Error(w, "Invalid status", http.StatusBadRequest)
		return
	}

	// Load existing order to check current status & sender
	currentOrder, err := models.GetOrderByID(orderID)
	if err != nil {
		log.Printf("❌ Failed to load order #%d before update: %v", orderID, err)
		http.Error(w, "Order not found", http.StatusNotFound)
		return
	}

	// Validate allowed status transition (no skipping)
	allowedNext := map[string]string{
		"pending":   "preparing",
		"preparing": "ready",
		"ready":     "delivered",
		"delivered": "",
	}
	if next, ok := allowedNext[currentOrder.Status]; !ok {
		http.Error(w, "Invalid current status", http.StatusBadRequest)
		return
	} else {
		if next == "" {
			// Already delivered; cannot advance further
			resp := map[string]interface{}{"success": true, "duplicate": true, "order_id": orderID, "status": currentOrder.Status, "message": "Order already delivered"}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		if requestBody.Status != next {
			http.Error(w, fmt.Sprintf("Invalid transition: %s -> %s", currentOrder.Status, requestBody.Status), http.StatusBadRequest)
			return
		}
	}

	if currentOrder.Status == requestBody.Status {
		// Duplicate / idempotent update; respond quickly
		resp := map[string]interface{}{
			"success":   true,
			"duplicate": true,
			"order_id":  orderID,
			"status":    currentOrder.Status,
			"message":   "Status unchanged",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// Perform DB update (prevent duplicate race by using current different status)
	err = models.UpdateOrderStatus(orderID, requestBody.Status)
	if err != nil {
		log.Printf("❌ Error updating order status: %v", err)
		http.Error(w, "Error updating order status", http.StatusInternalServerError)
		return
	}
	log.Printf("✅ Order #%d status updated to: %s", orderID, requestBody.Status)

	// Respond immediately before potentially slow external notification
	resp := map[string]interface{}{
		"success":   true,
		"order_id":  orderID,
		"new_status": requestBody.Status,
		"message":   "Order status updated",
		"notification_dispatched": currentOrder.SenderID != "", // whether we'll attempt notification
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)

	// Async notification (non-blocking)
	if currentOrder.SenderID != "" {
		go func(orderID int, senderID, status string) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("⚠️ Panic recovered in notification goroutine for order #%d: %v", orderID, r)
				}
			}()
			statusMessages := map[string]string{
				"pending":   "✅ Your order #%d has been received! We'll start preparing it soon.",
				"preparing": "🍰 Great news! We've started preparing your order #%d. It will be ready soon!",
				"ready":     "✅ Your order #%d is ready! Please come pick it up or wait for delivery.",
				"delivered": "🎉 Your order #%d has been delivered! Enjoy your delicious treats!",
			}
			if msgTemplate, ok := statusMessages[status]; ok {
				text := fmt.Sprintf(msgTemplate, orderID)
				if err := SendMessage(senderID, text); err != nil {
					log.Printf("⚠️ Failed to send async notification for order #%d: %v", orderID, err)
				} else {
					log.Printf("📬 Async status notification queued for order #%d", orderID)
				}
			} else {
				log.Printf("ℹ️ Status '%s' not configured for notifications (order #%d)", status, orderID)
			}
			// Optional: small delay to avoid hammering external service bursts (tunable)
			time.Sleep(10 * time.Millisecond)
		}(orderID, currentOrder.SenderID, requestBody.Status)
	} else {
		log.Printf("ℹ️ No SenderID for order #%d; skipping async notification", orderID)
	}
}
