package controllers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"bakeflow/models"

	"github.com/gorilla/mux"
)

type contextKey string

const adminIDContextKey contextKey = "admin_id"

type ProductController struct {
	DB *sql.DB
}

// GetProducts handles GET /api/products - list all products with filters
func (pc *ProductController) GetProducts(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters for filtering
	category := r.URL.Query().Get("category")
	status := r.URL.Query().Get("status")
	search := r.URL.Query().Get("search")
	tag := r.URL.Query().Get("tag")
	minPriceStr := r.URL.Query().Get("min_price")
	maxPriceStr := r.URL.Query().Get("max_price")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")
	sortBy := r.URL.Query().Get("sort_by")
	sortDir := r.URL.Query().Get("sort_dir")
	includeStockParam := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("include_stock")))
	includeStock := includeStockParam == "1" || includeStockParam == "true"

	// Build query
	query := `
		SELECT p.id, p.name, p.description, p.category, COALESCE(p.tags, '[]'::jsonb) as tags, p.price, p.stock,
		       COALESCE(p.reserved_stock, 0) as reserved_stock,
		       p.image_url, p.status, p.created_at, p.updated_at,
		       COALESCE(pa.views, 0) as views, COALESCE(pa.purchases, 0) as purchases,
		       COALESCE(p.avg_rating, 0) as avg_rating, COALESCE(p.rating_count, 0) as rating_count
		FROM products p
		LEFT JOIN product_analytics pa ON p.id = pa.product_id
		WHERE p.deleted_at IS NULL
	`
	args := []interface{}{}
	argNum := 1

	// Apply filters
	if category != "" {
		query += fmt.Sprintf(" AND p.category = $%d", argNum)
		args = append(args, category)
		argNum++
	}
	if status != "" {
		query += fmt.Sprintf(" AND p.status = $%d", argNum)
		args = append(args, status)
		argNum++
	}
	if search != "" {
		query += fmt.Sprintf(" AND (p.name ILIKE $%d OR p.description ILIKE $%d)", argNum, argNum)
		args = append(args, "%"+search+"%")
		argNum++
	}
	if tag != "" {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag != "" {
			query += fmt.Sprintf(" AND COALESCE(p.tags, '[]'::jsonb) ? $%d", argNum)
			args = append(args, tag)
			argNum++
		}
	}
	if minPriceStr != "" {
		if minPrice, err := strconv.ParseFloat(minPriceStr, 64); err == nil {
			query += fmt.Sprintf(" AND p.price >= $%d", argNum)
			args = append(args, minPrice)
			argNum++
		}
	}
	if maxPriceStr != "" {
		if maxPrice, err := strconv.ParseFloat(maxPriceStr, 64); err == nil {
			query += fmt.Sprintf(" AND p.price <= $%d", argNum)
			args = append(args, maxPrice)
			argNum++
		}
	}

	// Sorting
	validSortFields := map[string]string{
		"name":       "p.name",
		"price":      "p.price",
		"stock":      "p.stock",
		"created_at": "p.created_at",
		"views":      "views",     // Alias in SELECT
		"purchases":  "purchases", // Alias in SELECT
	}
	sortField := validSortFields[sortBy]
	if sortField == "" {
		sortField = "p.created_at"
	}
	if sortDir != "ASC" && sortDir != "DESC" {
		sortDir = "DESC"
	}
	query += fmt.Sprintf(" ORDER BY %s %s", sortField, sortDir)

	// Pagination
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}
	offset := 0
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argNum, argNum+1)
	args = append(args, limit, offset)

	// Execute query
	rows, err := pc.DB.Query(query, args...)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch products", err)
		return
	}
	defer rows.Close()

	products := []map[string]interface{}{}
	for rows.Next() {
		var p models.Product
		var reservedStock int
		var views, purchases int
		var avgRating float64
		var ratingCount int
		var desc sql.NullString
		var img sql.NullString
		var tagsJSON []byte
		err := rows.Scan(&p.ID, &p.Name, &desc, &p.Category, &tagsJSON, &p.Price,
			&p.Stock, &reservedStock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt, &views, &purchases,
			&avgRating, &ratingCount)
		if err != nil {
			continue
		}
		p.Tags = decodeStringArrayJSON(tagsJSON)
		if desc.Valid {
			p.Description = desc.String
		}
		if img.Valid {
			p.ImageURL = img.String
		}

		// Compute availability status (don't expose exact stock numbers to customers)
		availableStock := p.Stock - reservedStock
		if availableStock < 0 {
			availableStock = 0
		}
		availabilityStatus := "available"
		if availableStock <= 0 {
			availabilityStatus = "sold_out"
		} else if availableStock <= 5 {
			availabilityStatus = "limited"
		}

		productPayload := map[string]interface{}{
			"id":                  p.ID,
			"name":                p.Name,
			"description":         p.Description,
			"category":            p.Category,
			"tags":                p.Tags,
			"price":               p.Price,
			"image_url":           p.ImageURL,
			"status":              p.Status,
			"created_at":          p.CreatedAt,
			"updated_at":          p.UpdatedAt,
			"views":               views,
			"purchases":           purchases,
			"availability_status": availabilityStatus,
			"avg_rating":          avgRating,
			"rating_count":        ratingCount,
		}
		if includeStock {
			productPayload["stock"] = p.Stock
		}
		products = append(products, productPayload)
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"products": products,
		"count":    len(products),
	})
}

func (pc *ProductController) GetProductTags(w http.ResponseWriter, r *http.Request) {
	rows, err := pc.DB.Query(`
		SELECT DISTINCT jsonb_array_elements_text(
			CASE
				WHEN jsonb_typeof(tags) = 'array' THEN tags
				ELSE '[]'::jsonb
			END
		) AS tag
		FROM products
		WHERE deleted_at IS NULL
		ORDER BY tag ASC
	`)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch tags", err)
		return
	}
	defer rows.Close()

	seen := map[string]struct{}{}
	tags := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			continue
		}
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}
	sort.Strings(tags)

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"tags":  tags,
		"count": len(tags),
	})
}

// GetProduct handles GET /api/products/:id - get single product
func (pc *ProductController) GetProduct(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid product ID", err)
		return
	}

	query := `
		SELECT p.id, p.name, p.description, p.category, COALESCE(p.tags, '[]'::jsonb) as tags, p.price, p.stock,
		       COALESCE(p.reserved_stock, 0) as reserved_stock,
		       p.image_url, p.status, p.created_at, p.updated_at,
		       COALESCE(pa.views, 0) as views, COALESCE(pa.purchases, 0) as purchases
		FROM products p
		LEFT JOIN product_analytics pa ON p.id = pa.product_id
		WHERE p.id = $1 AND p.deleted_at IS NULL
	`

	var p models.Product
	var reservedStock int
	var views, purchases int
	var desc sql.NullString
	var img sql.NullString
	var tagsJSON []byte
	err = pc.DB.QueryRow(query, id).Scan(
		&p.ID, &p.Name, &desc, &p.Category, &tagsJSON, &p.Price,
		&p.Stock, &reservedStock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt,
		&views, &purchases,
	)
	if err == sql.ErrNoRows {
		respondWithError(w, http.StatusNotFound, "Product not found", nil)
		return
	}
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch product", err)
		return
	}
	if desc.Valid {
		p.Description = desc.String
	}
	if img.Valid {
		p.ImageURL = img.String
	}
	p.Tags = decodeStringArrayJSON(tagsJSON)

	availableStock := p.Stock - reservedStock
	if availableStock < 0 {
		availableStock = 0
	}
	isOutOfStock := availableStock <= 0
	isLowStock := availableStock > 0 && availableStock <= 5

	// Increment view count
	go models.IncrementViews(pc.DB, id)

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"product": map[string]interface{}{
			"id":           p.ID,
			"name":         p.Name,
			"description":  p.Description,
			"category":     p.Category,
			"tags":         p.Tags,
			"price":        p.Price,
			"stock":        p.Stock,
			"image_url":    p.ImageURL,
			"status":       p.Status,
			"created_at":   p.CreatedAt,
			"updated_at":   p.UpdatedAt,
			"views":        views,
			"purchases":    purchases,
			"low_stock":    isLowStock,
			"out_of_stock": isOutOfStock,
		},
	})
}

// CreateProduct handles POST /api/products - create new product
func (pc *ProductController) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var product models.Product
	if err := json.NewDecoder(r.Body).Decode(&product); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err)
		return
	}

	// Validate product
	if err := product.Validate(); err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	product.Tags = normalizeTags(product.Tags)

	// Set default status if not provided
	if product.Status == "" {
		product.Status = "draft"
	}

	// Insert product
	query := `
		INSERT INTO products (name, description, category, tags, price, stock, image_url, status)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at
	`
	tagsEncoded := encodeStringArrayJSON(product.Tags)
	err := pc.DB.QueryRow(
		query,
		product.Name, product.Description, product.Category, tagsEncoded,
		product.Price, product.Stock, product.ImageURL, product.Status,
	).Scan(&product.ID, &product.CreatedAt, &product.UpdatedAt)

	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to create product", err)
		return
	}

	// Log the creation
	adminID := getAdminIDFromContext(r) // You'll need to implement this based on your auth
	changes := map[string]interface{}{
		"action":  "created",
		"product": product,
	}
	go models.CreateLogEntry(pc.DB, product.ID, adminID, "CREATE", changes)

	// Initialize analytics
	go func() {
		initQuery := `
			INSERT INTO product_analytics (product_id)
			VALUES ($1)
			ON CONFLICT (product_id) DO NOTHING
		`
		pc.DB.Exec(initQuery, product.ID)
	}()

	respondWithJSON(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Product created successfully",
		"product": product,
	})
}

// UpdateProduct handles PUT /api/products/:id - update product
func (pc *ProductController) UpdateProduct(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid product ID", err)
		return
	}

	// Get existing product for comparison
	var oldProduct models.Product
	query := `SELECT id, name, description, category, COALESCE(tags, '[]'::jsonb) as tags, price, stock, image_url, status 
	          FROM products WHERE id = $1 AND deleted_at IS NULL`
	var desc sql.NullString
	var img sql.NullString
	var oldTagsJSON []byte
	err = pc.DB.QueryRow(query, id).Scan(
		&oldProduct.ID, &oldProduct.Name, &desc,
		&oldProduct.Category, &oldTagsJSON, &oldProduct.Price, &oldProduct.Stock,
		&img, &oldProduct.Status,
	)
	if err == sql.ErrNoRows {
		respondWithError(w, http.StatusNotFound, "Product not found", nil)
		return
	}
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch product", err)
		return
	}
	if desc.Valid {
		oldProduct.Description = desc.String
	}
	if img.Valid {
		oldProduct.ImageURL = img.String
	}
	oldProduct.Tags = decodeStringArrayJSON(oldTagsJSON)

	// Decode new product data
	var product models.Product
	if err := json.NewDecoder(r.Body).Decode(&product); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err)
		return
	}
	product.ID = id

	// Validate
	if err := product.Validate(); err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	product.Tags = normalizeTags(product.Tags)

	// Update product
	updateQuery := `
		UPDATE products 
		SET name = $1, description = $2, category = $3, tags = $4::jsonb, price = $5, 
		    stock = $6, image_url = $7, status = $8
		WHERE id = $9 AND deleted_at IS NULL
		RETURNING updated_at
	`
	tagsEncoded := encodeStringArrayJSON(product.Tags)
	err = pc.DB.QueryRow(
		updateQuery,
		product.Name, product.Description, product.Category, tagsEncoded,
		product.Price, product.Stock, product.ImageURL, product.Status, id,
	).Scan(&product.UpdatedAt)

	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to update product", err)
		return
	}

	// Log the changes
	adminID := getAdminIDFromContext(r)
	changes := map[string]interface{}{
		"action": "updated",
		"old":    oldProduct,
		"new":    product,
	}
	go models.CreateLogEntry(pc.DB, product.ID, adminID, "UPDATE", changes)

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Product updated successfully",
		"product": product,
	})
}

// UpdateProductStatus handles PATCH /api/products/:id/status - change product status
func (pc *ProductController) UpdateProductStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid product ID", err)
		return
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err)
		return
	}

	// Validate status
	validStatuses := map[string]bool{
		"draft": true, "active": true, "inactive": true, "archived": true,
	}
	if !validStatuses[body.Status] {
		respondWithError(w, http.StatusBadRequest, "Invalid status", nil)
		return
	}

	// Get old status
	var oldStatus string
	err = pc.DB.QueryRow("SELECT status FROM products WHERE id = $1 AND deleted_at IS NULL", id).Scan(&oldStatus)
	if err == sql.ErrNoRows {
		respondWithError(w, http.StatusNotFound, "Product not found", nil)
		return
	}
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch product", err)
		return
	}

	// Update status
	query := `UPDATE products SET status = $1 WHERE id = $2 AND deleted_at IS NULL`
	_, err = pc.DB.Exec(query, body.Status, id)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to update status", err)
		return
	}

	// Log the change
	adminID := getAdminIDFromContext(r)
	changes := map[string]interface{}{
		"action":     "status_changed",
		"old_status": oldStatus,
		"new_status": body.Status,
	}
	go models.CreateLogEntry(pc.DB, id, adminID, "STATUS_CHANGE", changes)

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Product status updated to %s", body.Status),
	})
}

// UpdateProductStock handles PATCH /api/products/:id/stock - quick stock adjustment
func (pc *ProductController) UpdateProductStock(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid product ID", err)
		return
	}

	var body struct {
		Stock      *int   `json:"stock"`      // Absolute value
		Adjustment *int   `json:"adjustment"` // Relative +/- value
		Reason     string `json:"reason"`     // Optional reason for the change
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid request payload", err)
		return
	}

	// Get current stock
	var oldStock int
	var productName string
	err = pc.DB.QueryRow("SELECT stock, name FROM products WHERE id = $1 AND deleted_at IS NULL", id).Scan(&oldStock, &productName)
	if err == sql.ErrNoRows {
		respondWithError(w, http.StatusNotFound, "Product not found", nil)
		return
	}
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch product", err)
		return
	}

	// Calculate new stock
	var newStock int
	if body.Stock != nil {
		// Absolute value provided
		newStock = *body.Stock
	} else if body.Adjustment != nil {
		// Relative adjustment
		newStock = oldStock + *body.Adjustment
	} else {
		respondWithError(w, http.StatusBadRequest, "Either stock or adjustment is required", nil)
		return
	}

	// Ensure stock doesn't go negative
	if newStock < 0 {
		newStock = 0
	}

	// Update stock
	_, err = pc.DB.Exec("UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2", newStock, id)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to update stock", err)
		return
	}

	// Log the change
	adminID := getAdminIDFromContext(r)
	changes := map[string]interface{}{
		"action":    "stock_updated",
		"old_stock": oldStock,
		"new_stock": newStock,
		"reason":    body.Reason,
	}
	go models.CreateLogEntry(pc.DB, id, adminID, "STOCK_UPDATE", changes)

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"message":   fmt.Sprintf("Stock updated: %d → %d", oldStock, newStock),
		"old_stock": oldStock,
		"new_stock": newStock,
		"product":   productName,
	})
}

// DeleteProduct handles DELETE /api/products/:id - soft delete/archive product
func (pc *ProductController) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid product ID", err)
		return
	}

	// Check if product exists
	var exists bool
	err = pc.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = $1 AND deleted_at IS NULL)", id).Scan(&exists)
	if err != nil || !exists {
		respondWithError(w, http.StatusNotFound, "Product not found", nil)
		return
	}

	// Soft delete (set deleted_at timestamp)
	query := `UPDATE products SET deleted_at = CURRENT_TIMESTAMP, status = 'archived' WHERE id = $1`
	_, err = pc.DB.Exec(query, id)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to delete product", err)
		return
	}

	// Log the deletion
	adminID := getAdminIDFromContext(r)
	changes := map[string]interface{}{
		"action":     "deleted",
		"product_id": id,
	}
	go models.CreateLogEntry(pc.DB, id, adminID, "DELETE", changes)

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Product archived successfully",
	})
}

// GetProductLogs handles GET /api/products/:id/logs - get product change history
func (pc *ProductController) GetProductLogs(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "Invalid product ID", err)
		return
	}

	query := `
		SELECT pl.id, pl.product_id, pl.admin_id, pl.action, pl.changes, pl.created_at,
		       a.username
		FROM product_logs pl
		LEFT JOIN admins a ON pl.admin_id = a.id
		WHERE pl.product_id = $1
		ORDER BY pl.created_at DESC
		LIMIT 50
	`

	rows, err := pc.DB.Query(query, id)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch logs", err)
		return
	}
	defer rows.Close()

	logs := []map[string]interface{}{}
	for rows.Next() {
		var log models.ProductLog
		var username sql.NullString
		err := rows.Scan(&log.ID, &log.ProductID, &log.AdminID, &log.Action,
			&log.Changes, &log.CreatedAt, &username)
		if err != nil {
			continue
		}

		logEntry := map[string]interface{}{
			"id":         log.ID,
			"product_id": log.ProductID,
			"action":     log.Action,
			"changes":    json.RawMessage(log.Changes),
			"created_at": log.CreatedAt,
		}
		if username.Valid {
			logEntry["admin"] = username.String
		}
		logs = append(logs, logEntry)
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"logs":  logs,
		"count": len(logs),
	})
}

// GetLowStockProducts handles GET /api/products/low-stock - get products with low stock
func (pc *ProductController) GetLowStockProducts(w http.ResponseWriter, r *http.Request) {
	threshold := 10
	if t := r.URL.Query().Get("threshold"); t != "" {
		if parsedT, err := strconv.Atoi(t); err == nil && parsedT > 0 {
			threshold = parsedT
		}
	}

	query := `
		SELECT id, name, category, stock, status
		FROM products
		WHERE stock < $1 AND status = 'active' AND deleted_at IS NULL
		ORDER BY stock ASC
	`

	rows, err := pc.DB.Query(query, threshold)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch low stock products", err)
		return
	}
	defer rows.Close()

	products := []map[string]interface{}{}
	for rows.Next() {
		var id, stock int
		var name, category, status string
		if err := rows.Scan(&id, &name, &category, &stock, &status); err != nil {
			continue
		}
		products = append(products, map[string]interface{}{
			"id":       id,
			"name":     name,
			"category": category,
			"stock":    stock,
			"status":   status,
		})
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"products":  products,
		"count":     len(products),
		"threshold": threshold,
	})
}

// SeedProducts handles GET /api/products/seed - populate sample products if none exist
// NOTE: Intended for development convenience. Consider removing or protecting in production.
func (pc *ProductController) SeedProducts(w http.ResponseWriter, r *http.Request) {
	// Check if products already exist (non-deleted)
	var count int
	err := pc.DB.QueryRow("SELECT COUNT(*) FROM products WHERE deleted_at IS NULL").Scan(&count)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to check products", err)
		return
	}
	if count > 0 {
		respondWithJSON(w, http.StatusOK, map[string]interface{}{
			"success":        true,
			"message":        "Products already exist; seed skipped",
			"existing_count": count,
		})
		return
	}

	// Insert a few sample products
	tx, err := pc.DB.Begin()
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to begin transaction", err)
		return
	}

	samples := []struct {
		name, desc, category, image, status string
		price                               float64
		stock                               int
	}{
		{"Chocolate Fudge Cake", "Rich chocolate cake with fudge frosting", "Cakes", "", "active", 29.99, 12},
		{"Vanilla Cupcakes", "Classic vanilla cupcakes with buttercream", "Cupcakes", "", "active", 3.50, 60},
		{"Blueberry Muffins", "Moist muffins packed with blueberries", "Muffins", "", "active", 2.75, 40},
		{"Fruit Tart", "Seasonal fruits over custard in a crisp tart", "Tarts", "", "draft", 24.00, 5},
		{"Chocolate Chip Cookies", "Crispy on the edges, chewy inside", "Cookies", "", "active", 1.50, 120},
	}

	insertQuery := `
		INSERT INTO products (name, description, category, price, stock, image_url, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`

	inserted := 0
	for _, s := range samples {
		var id int
		if err := tx.QueryRow(insertQuery, s.name, s.desc, s.category, s.price, s.stock, s.image, s.status).Scan(&id); err != nil {
			tx.Rollback()
			respondWithError(w, http.StatusInternalServerError, "Failed to insert sample product", err)
			return
		}
		// Initialize analytics
		if _, err := tx.Exec("INSERT INTO product_analytics (product_id) VALUES ($1) ON CONFLICT (product_id) DO NOTHING", id); err != nil {
			tx.Rollback()
			respondWithError(w, http.StatusInternalServerError, "Failed to init analytics", err)
			return
		}
		inserted++
	}

	if err := tx.Commit(); err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to commit seed", err)
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success":  true,
		"message":  "Sample products inserted",
		"inserted": inserted,
	})
}

// DebugProducts handles GET /api/products/debug - returns counts and sample rows to help diagnose
func (pc *ProductController) DebugProducts(w http.ResponseWriter, r *http.Request) {
	type C struct {
		Label string
		Count int
	}
	counts := []C{}

	// Total products
	var total int
	_ = pc.DB.QueryRow("SELECT COUNT(*) FROM products").Scan(&total)
	counts = append(counts, C{"total", total})

	// Non-deleted
	var nonDeleted int
	_ = pc.DB.QueryRow("SELECT COUNT(*) FROM products WHERE deleted_at IS NULL").Scan(&nonDeleted)
	counts = append(counts, C{"non_deleted", nonDeleted})

	// By status for non-deleted
	rows, err := pc.DB.Query("SELECT status, COUNT(*) FROM products WHERE deleted_at IS NULL GROUP BY status")
	byStatus := map[string]int{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var status string
			var cnt int
			if err := rows.Scan(&status, &cnt); err == nil {
				byStatus[status] = cnt
			}
		}
	}

	// Sample 5 non-deleted rows
	samples := []map[string]interface{}{}
	sampleRows, err := pc.DB.Query(`SELECT id, name, category, price, stock, status, deleted_at FROM products WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 5`)
	if err == nil {
		defer sampleRows.Close()
		for sampleRows.Next() {
			var id, stock int
			var name, category, status string
			var price float64
			var deletedAt sql.NullTime
			if err := sampleRows.Scan(&id, &name, &category, &price, &stock, &status, &deletedAt); err == nil {
				samples = append(samples, map[string]interface{}{
					"id":       id,
					"name":     name,
					"category": category,
					"price":    price,
					"stock":    stock,
					"status":   status,
					"deleted_at": func() interface{} {
						if deletedAt.Valid {
							return deletedAt.Time
						}
						return nil
					}(),
				})
			}
		}
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"counts":    counts,
		"by_status": byStatus,
		"samples":   samples,
	})
}

// Helper function to get admin ID from request context
func getAdminIDFromContext(r *http.Request) sql.NullInt64 {
	v := r.Context().Value(adminIDContextKey)
	switch t := v.(type) {
	case int:
		if t <= 0 {
			return sql.NullInt64{Valid: false}
		}
		return sql.NullInt64{Int64: int64(t), Valid: true}
	case int64:
		if t <= 0 {
			return sql.NullInt64{Valid: false}
		}
		return sql.NullInt64{Int64: t, Valid: true}
	case sql.NullInt64:
		return t
	default:
		return sql.NullInt64{Valid: false}
	}
}

// Helper functions for JSON responses
func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, _ := json.Marshal(payload)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(response)
}

func respondWithError(w http.ResponseWriter, code int, message string, err error) {
	respondWithJSON(w, code, map[string]interface{}{
		"error": message,
		"details": func() string {
			if err != nil {
				return err.Error()
			}
			return ""
		}(),
	})
}

func decodeStringArrayJSON(b []byte) []string {
	var out []string
	_ = json.Unmarshal(b, &out)
	if out == nil {
		return []string{}
	}
	return out
}

func encodeStringArrayJSON(tags []string) string {
	b, err := json.Marshal(tags)
	if err != nil || len(b) == 0 {
		return "[]"
	}
	return string(b)
}

func normalizeTags(tags []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(tags))
	for _, t := range tags {
		v := strings.ToLower(strings.TrimSpace(t))
		if v == "" {
			continue
		}
		if len(v) > 32 {
			v = v[:32]
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
		if len(out) >= 20 {
			break
		}
	}
	return out
}
