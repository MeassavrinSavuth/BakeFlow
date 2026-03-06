package controllers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"bakeflow/models"

	"github.com/gorilla/mux"
)

// StockStatusResponse represents stock availability for a single product
type StockStatusResponse struct {
	ProductID      int    `json:"product_id"`
	TotalStock     int    `json:"total_stock"`
	ReservedStock  int    `json:"reserved_stock"`
	AvailableStock int    `json:"available_stock"`
	Status         string `json:"status"` // "in_stock", "low_stock", "out_of_stock"
	Message        string `json:"message,omitempty"`
}

// BulkStockRequest for checking multiple products at once
type BulkStockRequest struct {
	ProductIDs []int `json:"product_ids"`
}

// BulkStockResponse for multiple products
type BulkStockResponse struct {
	Products []StockStatusResponse `json:"products"`
}

// GetProductStockStatus returns real-time stock status for a single product
// GET /api/stock/{id}
func GetProductStockStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Get product ID from URL
	vars := mux.Vars(r)
	productID, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, `{"error": "Invalid product ID"}`, http.StatusBadRequest)
		return
	}

	// Get stock status
	status, err := models.GetProductStockStatus(productID)
	if err != nil {
		http.Error(w, `{"error": "Product not found"}`, http.StatusNotFound)
		return
	}

	// Build response
	response := StockStatusResponse{
		ProductID:      productID,
		TotalStock:     status.TotalStock,
		ReservedStock:  status.ReservedStock,
		AvailableStock: status.AvailableStock,
	}

	// Determine status and message
	if status.AvailableStock <= 0 {
		response.Status = "out_of_stock"
		response.Message = "Out of stock"
	} else if status.AvailableStock <= 5 {
		response.Status = "low_stock"
		response.Message = "Only " + strconv.Itoa(status.AvailableStock) + " left"
	} else {
		response.Status = "in_stock"
	}

	json.NewEncoder(w).Encode(response)
}

// GetBulkStockStatus returns stock status for multiple products
// POST /api/stock/bulk
func GetBulkStockStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Parse request body
	var req BulkStockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(req.ProductIDs) == 0 {
		http.Error(w, `{"error": "No product IDs provided"}`, http.StatusBadRequest)
		return
	}

	// Limit to 100 products per request
	if len(req.ProductIDs) > 100 {
		http.Error(w, `{"error": "Maximum 100 products per request"}`, http.StatusBadRequest)
		return
	}

	// Get stock status for all products
	response := BulkStockResponse{
		Products: make([]StockStatusResponse, 0, len(req.ProductIDs)),
	}

	for _, productID := range req.ProductIDs {
		status, err := models.GetProductStockStatus(productID)
		if err != nil {
			// Skip products that don't exist
			continue
		}

		item := StockStatusResponse{
			ProductID:      productID,
			TotalStock:     status.TotalStock,
			ReservedStock:  status.ReservedStock,
			AvailableStock: status.AvailableStock,
		}

		// Determine status and message
		if status.AvailableStock <= 0 {
			item.Status = "out_of_stock"
			item.Message = "Out of stock"
		} else if status.AvailableStock <= 5 {
			item.Status = "low_stock"
			item.Message = "Only " + strconv.Itoa(status.AvailableStock) + " left"
		} else {
			item.Status = "in_stock"
		}

		response.Products = append(response.Products, item)
	}

	json.NewEncoder(w).Encode(response)
}

// ValidateCartStock validates stock availability for cart items before checkout
// POST /api/stock/validate-cart
func ValidateCartStock(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Parse request body
	type CartItem struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}
	type ValidateRequest struct {
		Items []CartItem `json:"items"`
	}
	type ItemValidation struct {
		ProductID      int    `json:"product_id"`
		RequestedQty   int    `json:"requested_qty"`
		AvailableStock int    `json:"available_stock"`
		IsAvailable    bool   `json:"is_available"`
		Message        string `json:"message,omitempty"`
	}
	type ValidateResponse struct {
		Valid   bool             `json:"valid"`
		Items   []ItemValidation `json:"items"`
		Message string           `json:"message,omitempty"`
	}

	var req ValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(req.Items) == 0 {
		http.Error(w, `{"error": "No items to validate"}`, http.StatusBadRequest)
		return
	}

	// Validate each item
	response := ValidateResponse{
		Valid: true,
		Items: make([]ItemValidation, 0, len(req.Items)),
	}

	var insufficientItems []string

	for _, item := range req.Items {
		status, err := models.GetProductStockStatus(item.ProductID)
		if err != nil {
			if errors.Is(err, models.ErrProductNotFound) {
				// Product genuinely doesn't exist
				response.Valid = false
				response.Items = append(response.Items, ItemValidation{
					ProductID:      item.ProductID,
					RequestedQty:   item.Quantity,
					AvailableStock: 0,
					IsAvailable:    false,
					Message:        "Product not found",
				})
				insufficientItems = append(insufficientItems, "Unknown product")
				continue
			}
			// DB connection error (Neon cold start, etc.) — don't falsely say "not found"
			log.Printf("❌ DB error during stock validation for product %d: %v", item.ProductID, err)
			http.Error(w, `{"error": "Temporary database issue, please try again"}`, http.StatusServiceUnavailable)
			return
		}

		validation := ItemValidation{
			ProductID:      item.ProductID,
			RequestedQty:   item.Quantity,
			AvailableStock: status.AvailableStock,
			IsAvailable:    status.AvailableStock >= item.Quantity,
		}

		if !validation.IsAvailable {
			response.Valid = false
			if status.AvailableStock <= 0 {
				validation.Message = "Out of stock"
			} else {
				validation.Message = "Only " + strconv.Itoa(status.AvailableStock) + " available"
			}
			insufficientItems = append(insufficientItems, validation.Message)
		}

		response.Items = append(response.Items, validation)
	}

	if !response.Valid {
		response.Message = "Some items have insufficient stock"
	}

	json.NewEncoder(w).Encode(response)
}
