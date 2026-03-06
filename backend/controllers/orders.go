package controllers

import (
	"bakeflow/configs"
	"bakeflow/models"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

func GetOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := models.GetAllOrders()
	if err != nil {
		http.Error(w, "Cannot fetch orders", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orders)
}	

// GetOrderByID returns a single order with its items
// GET /api/orders/{id}
func GetOrderByID(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	idStr := vars["id"]
	orderID, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid order ID", http.StatusBadRequest)
		return
	}

	order, err := models.GetOrderByID(orderID)
	if err != nil {
		http.Error(w, "Order not found", http.StatusNotFound)
		return
	}

	// Format items for frontend compatibility
	items := make([]map[string]interface{}, len(order.Items))
	for i, item := range order.Items {
		items[i] = map[string]interface{}{
			"name":       item.Product,
			"qty":        item.Quantity,
			"quantity":   item.Quantity,
			"price":      item.Price,
			"unit_price": item.Price,
			"line_total": item.Price * float64(item.Quantity),
			"total":      item.Price * float64(item.Quantity),
			"note":       item.Note,
			"image_url":  item.ImageURL,
		}
	}

	response := map[string]interface{}{
		"id":            order.ID,
		"customer_name": order.CustomerName,
		"sender_id":     order.SenderID,
		"delivery_type": order.DeliveryType,
		"address":       order.Address,
		"status":        order.Status,
		"total_amount":  order.TotalAmount,
		"total":         order.TotalAmount,
		"subtotal":      order.Subtotal,
		"discount":      order.Discount,
		"delivery_fee":  order.DeliveryFee,
		"created_at":    order.CreatedAt,
		"items":         items,
	}
	var proofURL sql.NullString
	if err := configs.DB.QueryRow(`SELECT proof_url FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, orderID).Scan(&proofURL); err == nil {
		trimmed := strings.TrimSpace(proofURL.String)
		if trimmed != "" {
			response["payment_proof_url"] = trimmed
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
