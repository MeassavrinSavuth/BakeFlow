package models

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"bakeflow/configs"
)

// Product represents a product in the system
type Product struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Category    string       `json:"category"`
	Tags        []string     `json:"tags"`
	Price       float64      `json:"price"`
	Stock       int          `json:"stock"`
	ImageURL    string       `json:"image_url"`
	Status      string       `json:"status"` // draft, active, inactive, archived
	AvgRating   float64      `json:"avg_rating"`
	RatingCount int          `json:"rating_count"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	DeletedAt   sql.NullTime `json:"deleted_at,omitempty"`
}

type PreorderSettings struct {
	ID         int       `json:"id"`
	Enabled    bool      `json:"enabled"`
	ProductIDs []int     `json:"product_ids"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type PreorderProductSettings struct {
	ID          int                `json:"id"`
	ProductID   int                `json:"product_id"`
	Enabled     bool               `json:"enabled"`
	StartDate   *time.Time         `json:"start_date,omitempty"`
	EndDate     *time.Time         `json:"end_date,omitempty"`
	Sizes       []string           `json:"sizes"`
	Layers      []string           `json:"layers"`
	Creams      []string           `json:"creams"`
	Flavors     []string           `json:"flavors"`
	SizePrices  map[string]float64 `json:"size_prices"`
	LayerPrices map[string]float64 `json:"layer_prices"`
	CreamPrices map[string]float64 `json:"cream_prices"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

// ProductLog represents an audit log entry for product changes
type ProductLog struct {
	ID        int             `json:"id"`
	ProductID int             `json:"product_id"`
	AdminID   sql.NullInt64   `json:"admin_id"`
	Action    string          `json:"action"`
	Changes   json.RawMessage `json:"changes"`
	CreatedAt time.Time       `json:"created_at"`
}

// ProductAnalytics represents analytics data for a product
type ProductAnalytics struct {
	ID              int          `json:"id"`
	ProductID       int          `json:"product_id"`
	Views           int          `json:"views"`
	Purchases       int          `json:"purchases"`
	LastViewedAt    sql.NullTime `json:"last_viewed_at,omitempty"`
	LastPurchasedAt sql.NullTime `json:"last_purchased_at,omitempty"`
	CreatedAt       time.Time    `json:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at"`
}

// AdminRole represents an admin role with permissions
type AdminRole struct {
	ID          int             `json:"id"`
	Name        string          `json:"name"`
	Permissions json.RawMessage `json:"permissions"`
	CreatedAt   time.Time       `json:"created_at"`
}

// Admin represents an admin user
type Admin struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // Don't expose password hash
	RoleID       int       `json:"role_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ProductFilter represents filters for product queries
type ProductFilter struct {
	Category string
	Status   string
	MinPrice float64
	MaxPrice float64
	Search   string
	Limit    int
	Offset   int
	SortBy   string
	SortDir  string
}

// Validate validates product data
func (p *Product) Validate() error {
	if p.Name == "" {
		return errors.New("product name is required")
	}
	if len(p.Name) > 255 {
		return errors.New("product name must be less than 255 characters")
	}
	if p.Category == "" {
		return errors.New("product category is required")
	}
	if p.Price < 0 {
		return errors.New("product price cannot be negative")
	}
	if p.Stock < 0 {
		return errors.New("product stock cannot be negative")
	}
	if p.Status != "" && p.Status != "draft" && p.Status != "active" && p.Status != "inactive" && p.Status != "archived" {
		return errors.New("invalid product status")
	}
	return nil
}

// IsLowStock checks if product stock is low (less than 10)
func (p *Product) IsLowStock() bool {
	return p.Stock < 10
}

// IsOutOfStock checks if product is out of stock
func (p *Product) IsOutOfStock() bool {
	return p.Stock == 0
}

// CanPublish checks if product can be published
func (p *Product) CanPublish() bool {
	return p.Status == "draft" && p.Name != "" && p.Price > 0
}

// CreateLogEntry creates a log entry for this product
func CreateLogEntry(db *sql.DB, productID int, adminID sql.NullInt64, action string, changes map[string]interface{}) error {
	changesJSON, err := json.Marshal(changes)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO product_logs (product_id, admin_id, action, changes)
		VALUES ($1, $2, $3, $4)
	`
	_, err = db.Exec(query, productID, adminID, action, changesJSON)
	return err
}

// IncrementViews increments the view count for a product
func IncrementViews(db *sql.DB, productID int) error {
	query := `
		INSERT INTO product_analytics (product_id, views, last_viewed_at)
		VALUES ($1, 1, CURRENT_TIMESTAMP)
		ON CONFLICT (product_id) 
		DO UPDATE SET 
			views = product_analytics.views + 1,
			last_viewed_at = CURRENT_TIMESTAMP
	`
	_, err := db.Exec(query, productID)
	return err
}

// IncrementPurchases increments the purchase count for a product
func IncrementPurchases(db *sql.DB, productID int) error {
	query := `
		INSERT INTO product_analytics (product_id, purchases, last_purchased_at)
		VALUES ($1, 1, CURRENT_TIMESTAMP)
		ON CONFLICT (product_id) 
		DO UPDATE SET 
			purchases = product_analytics.purchases + 1,
			last_purchased_at = CURRENT_TIMESTAMP
	`
	_, err := db.Exec(query, productID)
	return err
}

// GetActiveProducts returns active, non-deleted products (limited)
func GetActiveProducts(db *sql.DB, limit int, offset int, category string, search string) ([]Product, error) {
	query := `
		SELECT id, name, description, category, COALESCE(tags, '[]'::jsonb) as tags, price, stock, image_url, status, created_at, updated_at
		FROM products
		WHERE deleted_at IS NULL AND status = 'active'
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		var desc sql.NullString
		var img sql.NullString
		var tagsJSON []byte
		if err := rows.Scan(&p.ID, &p.Name, &desc, &p.Category, &tagsJSON, &p.Price, &p.Stock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Tags = decodeStringArrayJSON(tagsJSON)
		if desc.Valid {
			p.Description = desc.String
		}
		if img.Valid {
			p.ImageURL = img.String
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

// GetProductByID fetches a single product by ID
func GetProductByID(db *sql.DB, id int) (*Product, error) {
	query := `
		SELECT id, name, description, category, COALESCE(tags, '[]'::jsonb) as tags, price, stock, image_url, status, created_at, updated_at
		FROM products
		WHERE id = $1 AND deleted_at IS NULL
	`
	var p Product
	var desc sql.NullString
	var img sql.NullString
	var tagsJSON []byte
	err := db.QueryRow(query, id).Scan(&p.ID, &p.Name, &desc, &p.Category, &tagsJSON, &p.Price, &p.Stock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Tags = decodeStringArrayJSON(tagsJSON)
	if desc.Valid {
		p.Description = desc.String
	}
	if img.Valid {
		p.ImageURL = img.String
	}
	return &p, nil
}

// GetRecentProducts returns recent, non-deleted products regardless of status
func GetRecentProducts(db *sql.DB, limit int, offset int) ([]Product, error) {
	query := `
		SELECT id, name, description, category, COALESCE(tags, '[]'::jsonb) as tags, price, stock, image_url, status, created_at, updated_at
		FROM products
		WHERE deleted_at IS NULL
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		var desc sql.NullString
		var img sql.NullString
		var tagsJSON []byte
		if err := rows.Scan(&p.ID, &p.Name, &desc, &p.Category, &tagsJSON, &p.Price, &p.Stock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Tags = decodeStringArrayJSON(tagsJSON)
		if desc.Valid {
			p.Description = desc.String
		}
		if img.Valid {
			p.ImageURL = img.String
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func GetProductsByIDs(ids []int, onlyActive bool) ([]Product, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	if len(ids) == 0 {
		return []Product{}, nil
	}
	ph := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		ph[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	inClause := strings.Join(ph, ",")

	query := fmt.Sprintf(`
		SELECT id, name, description, category, COALESCE(tags, '[]'::jsonb) as tags, price, stock, image_url, status, created_at, updated_at
		FROM products
		WHERE deleted_at IS NULL AND id IN (%s)
	`, inClause)
	if onlyActive {
		query += " AND status = 'active'"
	}
	query += fmt.Sprintf(" ORDER BY array_position(ARRAY[%s]::int[], id)", inClause)
	rows, err := configs.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		var desc sql.NullString
		var img sql.NullString
		var tagsJSON []byte
		if err := rows.Scan(&p.ID, &p.Name, &desc, &p.Category, &tagsJSON, &p.Price, &p.Stock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Tags = decodeStringArrayJSON(tagsJSON)
		if desc.Valid {
			p.Description = desc.String
		}
		if img.Valid {
			p.ImageURL = img.String
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func GetPreorderSettings() (*PreorderSettings, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	var s PreorderSettings
	var idsJSON []byte
	err := configs.DB.QueryRow(`
		SELECT id, enabled, COALESCE(product_ids, '[]'::jsonb) as product_ids, created_at, updated_at
		FROM preorder_settings
		ORDER BY id ASC
		LIMIT 1
	`).Scan(&s.ID, &s.Enabled, &idsJSON, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		err = configs.DB.QueryRow(`
			INSERT INTO preorder_settings (enabled, product_ids)
			VALUES (TRUE, '[]'::jsonb)
			RETURNING id, enabled, product_ids, created_at, updated_at
		`).Scan(&s.ID, &s.Enabled, &idsJSON, &s.CreatedAt, &s.UpdatedAt)
	}
	if err != nil {
		return nil, err
	}
	s.ProductIDs = decodeIntArrayJSON(idsJSON)
	return &s, nil
}

func UpdatePreorderSettings(enabled bool, productIDs []int) (*PreorderSettings, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	payload, _ := json.Marshal(productIDs)
	var s PreorderSettings
	var idsJSON []byte
	err := configs.DB.QueryRow(`
		UPDATE preorder_settings
		SET enabled = $1, product_ids = $2, updated_at = NOW()
		WHERE id = (SELECT id FROM preorder_settings ORDER BY id ASC LIMIT 1)
		RETURNING id, enabled, product_ids, created_at, updated_at
	`, enabled, payload).Scan(&s.ID, &s.Enabled, &idsJSON, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		err = configs.DB.QueryRow(`
			INSERT INTO preorder_settings (enabled, product_ids)
			VALUES ($1, $2)
			RETURNING id, enabled, product_ids, created_at, updated_at
		`, enabled, payload).Scan(&s.ID, &s.Enabled, &idsJSON, &s.CreatedAt, &s.UpdatedAt)
	}
	if err != nil {
		return nil, err
	}
	s.ProductIDs = decodeIntArrayJSON(idsJSON)
	return &s, nil
}

func GetPreorderProductSettings(productID int) (*PreorderProductSettings, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	if productID <= 0 {
		return nil, errors.New("invalid product id")
	}
	var s PreorderProductSettings
	var sizesJSON []byte
	var layersJSON []byte
	var creamsJSON []byte
	var flavorsJSON []byte
	var sizePricesJSON []byte
	var layerPricesJSON []byte
	var creamPricesJSON []byte
	var startDate sql.NullTime
	var endDate sql.NullTime
	err := configs.DB.QueryRow(`
		SELECT id, product_id, enabled, start_date, end_date,
		       COALESCE(sizes, '[]'::jsonb) as sizes,
		       COALESCE(layers, '[]'::jsonb) as layers,
		       COALESCE(creams, '[]'::jsonb) as creams,
		       COALESCE(flavors, '[]'::jsonb) as flavors,
		       COALESCE(size_prices, '{}'::jsonb) as size_prices,
		       COALESCE(layer_prices, '{}'::jsonb) as layer_prices,
		       COALESCE(cream_prices, '{}'::jsonb) as cream_prices,
		       created_at, updated_at
		FROM preorder_product_settings
		WHERE product_id = $1
	`, productID).Scan(
		&s.ID, &s.ProductID, &s.Enabled, &startDate, &endDate,
		&sizesJSON, &layersJSON, &creamsJSON, &flavorsJSON,
		&sizePricesJSON, &layerPricesJSON, &creamPricesJSON,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if startDate.Valid {
		s.StartDate = &startDate.Time
	}
	if endDate.Valid {
		s.EndDate = &endDate.Time
	}
	s.Sizes = decodeStringArrayJSON(sizesJSON)
	s.Layers = decodeStringArrayJSON(layersJSON)
	s.Creams = decodeStringArrayJSON(creamsJSON)
	s.Flavors = decodeStringArrayJSON(flavorsJSON)
	s.SizePrices = decodePriceMapJSON(sizePricesJSON)
	s.LayerPrices = decodePriceMapJSON(layerPricesJSON)
	s.CreamPrices = decodePriceMapJSON(creamPricesJSON)
	return &s, nil
}

func UpsertPreorderProductSettings(productID int, enabled bool, startDate, endDate *time.Time, sizes, layers, creams, flavors []string, sizePrices, layerPrices, creamPrices map[string]float64) (*PreorderProductSettings, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	if productID <= 0 {
		return nil, errors.New("invalid product id")
	}
	sizesPayload, _ := json.Marshal(sizes)
	layersPayload, _ := json.Marshal(layers)
	creamsPayload, _ := json.Marshal(creams)
	flavorsPayload, _ := json.Marshal(flavors)
	sizePricesPayload, _ := json.Marshal(sizePrices)
	layerPricesPayload, _ := json.Marshal(layerPrices)
	creamPricesPayload, _ := json.Marshal(creamPrices)
	var startParam interface{} = nil
	var endParam interface{} = nil
	if startDate != nil {
		startParam = *startDate
	}
	if endDate != nil {
		endParam = *endDate
	}
	var s PreorderProductSettings
	var sizesJSON []byte
	var layersJSON []byte
	var creamsJSON []byte
	var flavorsJSON []byte
	var sizePricesJSON []byte
	var layerPricesJSON []byte
	var creamPricesJSON []byte
	var startOut sql.NullTime
	var endOut sql.NullTime
	err := configs.DB.QueryRow(`
		INSERT INTO preorder_product_settings
		    (product_id, enabled, start_date, end_date, sizes, layers, creams, flavors, size_prices, layer_prices, cream_prices)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (product_id) DO UPDATE
		SET enabled = EXCLUDED.enabled,
		    start_date = EXCLUDED.start_date,
		    end_date = EXCLUDED.end_date,
		    sizes = EXCLUDED.sizes,
		    layers = EXCLUDED.layers,
		    creams = EXCLUDED.creams,
		    flavors = EXCLUDED.flavors,
		    size_prices = EXCLUDED.size_prices,
		    layer_prices = EXCLUDED.layer_prices,
		    cream_prices = EXCLUDED.cream_prices,
		    updated_at = NOW()
		RETURNING id, product_id, enabled, start_date, end_date,
		          COALESCE(sizes, '[]'::jsonb) as sizes,
		          COALESCE(layers, '[]'::jsonb) as layers,
		          COALESCE(creams, '[]'::jsonb) as creams,
		          COALESCE(flavors, '[]'::jsonb) as flavors,
		          COALESCE(size_prices, '{}'::jsonb) as size_prices,
		          COALESCE(layer_prices, '{}'::jsonb) as layer_prices,
		          COALESCE(cream_prices, '{}'::jsonb) as cream_prices,
		          created_at, updated_at
	`, productID, enabled, startParam, endParam, sizesPayload, layersPayload, creamsPayload, flavorsPayload, sizePricesPayload, layerPricesPayload, creamPricesPayload).Scan(
		&s.ID, &s.ProductID, &s.Enabled, &startOut, &endOut,
		&sizesJSON, &layersJSON, &creamsJSON, &flavorsJSON,
		&sizePricesJSON, &layerPricesJSON, &creamPricesJSON,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if startOut.Valid {
		s.StartDate = &startOut.Time
	}
	if endOut.Valid {
		s.EndDate = &endOut.Time
	}
	s.Sizes = decodeStringArrayJSON(sizesJSON)
	s.Layers = decodeStringArrayJSON(layersJSON)
	s.Creams = decodeStringArrayJSON(creamsJSON)
	s.Flavors = decodeStringArrayJSON(flavorsJSON)
	s.SizePrices = decodePriceMapJSON(sizePricesJSON)
	s.LayerPrices = decodePriceMapJSON(layerPricesJSON)
	s.CreamPrices = decodePriceMapJSON(creamPricesJSON)
	return &s, nil
}

func decodeStringArrayJSON(b []byte) []string {
	var out []string
	_ = json.Unmarshal(b, &out)
	if out == nil {
		return []string{}
	}
	return out
}

func decodeIntArrayJSON(b []byte) []int {
	var out []int
	_ = json.Unmarshal(b, &out)
	if out == nil {
		return []int{}
	}
	return out
}

func decodePriceMapJSON(b []byte) map[string]float64 {
	out := map[string]float64{}
	_ = json.Unmarshal(b, &out)
	if out == nil {
		out = map[string]float64{}
	}
	return out
}
