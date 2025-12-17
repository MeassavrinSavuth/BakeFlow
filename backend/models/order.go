package models

import (
	"database/sql"
	"log"
	"time"

	"bakeflow/configs"
)

type Order struct {
	ID            int         `json:"id"`
	CustomerName  string      `json:"customer_name"`
	DeliveryType  string      `json:"delivery_type"` // "pickup" or "delivery"
	Address       string      `json:"address"`
	Status        string      `json:"status"`
	TotalItems    int         `json:"total_items"`
	Subtotal      float64     `json:"subtotal"`
	DeliveryFee   float64     `json:"delivery_fee"`
	TotalAmount   float64     `json:"total_amount"`
	ReorderedFrom *int        `json:"reordered_from,omitempty"`
	RatingID      *int        `json:"rating_id,omitempty"`
	SenderID     string      `json:"sender_id,omitempty"`
	CreatedAt     time.Time   `json:"created_at"`
	CompletedAt   *time.Time  `json:"completed_at,omitempty"`
	Items         []OrderItem `json:"items,omitempty"` // For including items in responses
}

type OrderItem struct {
	ID        int       `json:"id"`
	OrderID   int       `json:"order_id"`
	Product   string    `json:"product"`
	Quantity  int       `json:"quantity"`
	Price     float64   `json:"price"`
	CreatedAt time.Time `json:"created_at"`
}

type Rating struct {
	ID        int       `json:"id"`
	OrderID   int       `json:"order_id"`
	UserID    string    `json:"user_id"`
	Stars     int       `json:"stars"` // 1-5
	Comment   string    `json:"comment,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// GetAllOrders returns all orders from the database with their items

func GetAllOrders() ([]Order, error) {
	log.Println("🔍 Querying orders table...")
	rows, err := configs.DB.Query(`
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		ORDER BY id DESC
	`)
	if err != nil {
		log.Printf("❌ Query failed: %v", err)
		return nil, err
	}
	defer rows.Close()

	log.Println("✅ Query executed, scanning rows...")
	var orders []Order
	for rows.Next() {
		var o Order
		err := rows.Scan(&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status, &o.TotalItems,
			&o.Subtotal, &o.DeliveryFee, &o.TotalAmount, &o.ReorderedFrom, &o.RatingID, &o.SenderID, &o.CreatedAt, &o.CompletedAt)
		if err != nil {
			log.Printf("❌ Scan error: %v", err)
			return nil, err
		}
		
		// Load items for this order
		items, err := GetOrderItems(o.ID)
		if err == nil {
			o.Items = items
		}
		
		orders = append(orders, o)
	}
	
	log.Printf("📦 Loaded %d orders", len(orders))

	return orders, nil
}

// GetOrderItems returns all items for a specific order
func GetOrderItems(orderID int) ([]OrderItem, error) {
	rows, err := configs.DB.Query(`
		SELECT id, order_id, product, quantity, price, created_at 
		FROM order_items 
		WHERE order_id = $1 
		ORDER BY id
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []OrderItem
	for rows.Next() {
		var item OrderItem
		err := rows.Scan(&item.ID, &item.OrderID, &item.Product, &item.Quantity, &item.Price, &item.CreatedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

// CreateOrder inserts a new order and its items into the database
func CreateOrder(o *Order, items []OrderItem) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}

	// Start a transaction
	tx, err := configs.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Insert the order
	query := `
		INSERT INTO orders (customer_name, delivery_type, address, status, total_items,
		                    subtotal, delivery_fee, total_amount, reordered_from, sender_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
		RETURNING id, created_at
	`

	err = tx.QueryRow(query, o.CustomerName, o.DeliveryType, o.Address, o.Status, o.TotalItems,
		o.Subtotal, o.DeliveryFee, o.TotalAmount, o.ReorderedFrom, o.SenderID).Scan(&o.ID, &o.CreatedAt)
	if err != nil {
		return err
	}

	// Insert all order items
	itemQuery := `
		INSERT INTO order_items (order_id, product, quantity, price, created_at)
		VALUES ($1, $2, $3, $4, NOW())
	`
	
	for _, item := range items {
		_, err = tx.Exec(itemQuery, o.ID, item.Product, item.Quantity, item.Price)
		if err != nil {
			return err
		}
	}

	// Commit the transaction
	return tx.Commit()
}

// GetUserOrders returns all orders for a specific user ID
func GetUserOrders(userID string) ([]Order, error) {
	// Note: We'll need to add user_id to orders table in future
	// For now, returning all orders (temporary solution)
	return GetAllOrders()
}

// GetOrderByID returns a single order with its items
func GetOrderByID(orderID int) (*Order, error) {
	var o Order
	query := `
		SELECT id, customer_name, delivery_type, address, status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, ''), created_at, completed_at
		FROM orders
		WHERE id = $1
	`
	
	var reorderedFrom, ratingID sql.NullInt64
	var completedAt sql.NullTime
	
	err := configs.DB.QueryRow(query, orderID).Scan(
		&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status, &o.TotalItems,
		&o.Subtotal, &o.DeliveryFee, &o.TotalAmount, &reorderedFrom, &ratingID, &o.SenderID,
		&o.CreatedAt, &completedAt,
	)
	if err != nil {
		return nil, err
	}
	
	// Handle nullable fields
	if reorderedFrom.Valid {
		val := int(reorderedFrom.Int64)
		o.ReorderedFrom = &val
	}
	if ratingID.Valid {
		val := int(ratingID.Int64)
		o.RatingID = &val
	}
	if completedAt.Valid {
		o.CompletedAt = &completedAt.Time
	}
	
	// Load items
	items, err := GetOrderItems(o.ID)
	if err == nil {
		o.Items = items
	}
	
	return &o, nil
}

// CreateRating saves a customer rating for an order
func CreateRating(r *Rating) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	
	query := `
		INSERT INTO ratings (order_id, user_id, stars, comment, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		RETURNING id, created_at
	`
	
	return configs.DB.QueryRow(query, r.OrderID, r.UserID, r.Stars, r.Comment).Scan(&r.ID, &r.CreatedAt)
}

// GetRatingByOrderID returns the rating for a specific order
func GetRatingByOrderID(orderID int) (*Rating, error) {
	var r Rating
	query := `
		SELECT id, order_id, user_id, stars, comment, created_at
		FROM ratings
		WHERE order_id = $1
	`
	
	err := configs.DB.QueryRow(query, orderID).Scan(&r.ID, &r.OrderID, &r.UserID, &r.Stars, &r.Comment, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	
	return &r, nil
}

// UpdateOrderStatus updates the status of an order
func UpdateOrderStatus(orderID int, newStatus string) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	
	query := `UPDATE orders SET status = $1 WHERE id = $2`
	_, err := configs.DB.Exec(query, newStatus, orderID)
	return err
}



