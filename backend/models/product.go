package models

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Product represents a product in the system
type Product struct {
	ID          int             `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	Price       float64         `json:"price"`
	Stock       int             `json:"stock"`
	ImageURL    string          `json:"image_url"`
	Status      string          `json:"status"` // draft, active, inactive, archived
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	DeletedAt   sql.NullTime    `json:"deleted_at,omitempty"`
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
	ID               int          `json:"id"`
	ProductID        int          `json:"product_id"`
	Views            int          `json:"views"`
	Purchases        int          `json:"purchases"`
	LastViewedAt     sql.NullTime `json:"last_viewed_at,omitempty"`
	LastPurchasedAt  sql.NullTime `json:"last_purchased_at,omitempty"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
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
		SELECT id, name, description, category, price, stock, image_url, status, created_at, updated_at
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
		if err := rows.Scan(&p.ID, &p.Name, &desc, &p.Category, &p.Price, &p.Stock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
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
		SELECT id, name, description, category, price, stock, image_url, status, created_at, updated_at
		FROM products
		WHERE id = $1 AND deleted_at IS NULL
	`
	var p Product
	var desc sql.NullString
	var img sql.NullString
	err := db.QueryRow(query, id).Scan(&p.ID, &p.Name, &desc, &p.Category, &p.Price, &p.Stock, &img, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if desc.Valid {
		p.Description = desc.String
	}
	if img.Valid {
		p.ImageURL = img.String
	}
	return &p, nil
}
