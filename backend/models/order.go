package models

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"
	"time"

	"bakeflow/configs"

	"github.com/lib/pq"
)

type Order struct {
	ID            int         `json:"id"`
	CustomerName  string      `json:"customer_name"`
	DeliveryType  string      `json:"delivery_type"` // "pickup" or "delivery"
	Address       string      `json:"address"`
	Status        string      `json:"status"`
	ScheduledFor  *time.Time  `json:"scheduled_for,omitempty"`
	ScheduleType  string      `json:"schedule_type,omitempty"`
	TotalItems    int         `json:"total_items"`
	Subtotal      float64     `json:"subtotal"`
	DeliveryFee   float64     `json:"delivery_fee"`
	TotalAmount   float64     `json:"total_amount"`
	PromotionID   *int        `json:"promotion_id,omitempty"`
	Discount      float64     `json:"discount"`
	ReorderedFrom *int        `json:"reordered_from,omitempty"`
	RatingID      *int        `json:"rating_id,omitempty"`
	SenderID      string      `json:"sender_id,omitempty"`
	FBName        string      `json:"fb_name,omitempty"`
	FBAvatar      string      `json:"fb_avatar,omitempty"`
	CreatedAt     time.Time   `json:"created_at"`
	CompletedAt   *time.Time  `json:"completed_at,omitempty"`
	LastItemAt    *time.Time  `json:"last_item_at,omitempty"`
	Items         []OrderItem `json:"items,omitempty"` // For including items in responses
}

type OrderItem struct {
	ID        int       `json:"id"`
	OrderID   int       `json:"order_id"`
	ProductID *int      `json:"product_id,omitempty"`
	Product   string    `json:"product"`
	Quantity  int       `json:"quantity"`
	Price     float64   `json:"price"`
	Note      string    `json:"note,omitempty"`
	ImageURL  string    `json:"image_url,omitempty"`
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

type CustomerVerification struct {
	PSID                string     `json:"psid"`
	Verified            bool       `json:"verified"`
	VerificationMethod  string     `json:"verification_method,omitempty"`
	VerifiedAt          *time.Time `json:"verified_at,omitempty"`
	VerifiedByAdminID   *int       `json:"verified_by_admin_id,omitempty"`
	PendingVerification bool       `json:"pending_verification"`
	PendingRequestedAt  *time.Time `json:"pending_requested_at,omitempty"`
}

// GetAllOrders returns all orders from the database with their items

func GetAllOrders() ([]Order, error) {
	log.Println("🔍 Querying orders table...")
	queryWithPromotion := `
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, scheduled_for, COALESCE(schedule_type, '') as schedule_type, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       promotion_id, COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		ORDER BY id DESC
	`

	queryWithSchedule := `
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, scheduled_for, COALESCE(schedule_type, '') as schedule_type, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		ORDER BY id DESC
	`

	queryLegacy := `
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		ORDER BY id DESC
	`

	// Try newest schema first with promotion fields
	rows, err := configs.DB.Query(queryWithPromotion)
	usePromotionCols := true
	useScheduleCols := true
	if err != nil {
		// Fallback to schema with scheduling but no promotion
		msg := err.Error()
		if strings.Contains(msg, "promotion_id") || strings.Contains(msg, "discount") {
			usePromotionCols = false
			rows, err = configs.DB.Query(queryWithSchedule)
			if err != nil {
				// Fallback to legacy schema
				msg = err.Error()
				if strings.Contains(msg, "scheduled_for") || strings.Contains(msg, "schedule_type") {
					useScheduleCols = false
					rows, err = configs.DB.Query(queryLegacy)
				}
			}
		} else if strings.Contains(msg, "scheduled_for") || strings.Contains(msg, "schedule_type") {
			// Promotion columns exist but not scheduling
			useScheduleCols = false
			rows, err = configs.DB.Query(queryLegacy)
		}
		if err != nil {
			log.Printf("❌ Query failed: %v", err)
			return nil, err
		}
	}
	defer rows.Close()

	log.Println("✅ Query executed, scanning rows...")
	var orders []Order
	for rows.Next() {
		var o Order
		var completedAt sql.NullTime
		if usePromotionCols {
			// Schema with promotion fields
			var scheduledFor sql.NullTime
			var scheduleType sql.NullString
			err := rows.Scan(
				&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status,
				&scheduledFor, &scheduleType,
				&o.TotalItems,
				&o.Subtotal, &o.DeliveryFee, &o.TotalAmount,
				&o.PromotionID, &o.Discount,
				&o.ReorderedFrom, &o.RatingID, &o.SenderID, &o.CreatedAt, &completedAt,
			)
			if err != nil {
				log.Printf("❌ Scan error: %v", err)
				return nil, err
			}
			if scheduledFor.Valid {
				o.ScheduledFor = &scheduledFor.Time
			}
			if scheduleType.Valid {
				o.ScheduleType = scheduleType.String
			}
		} else if useScheduleCols {
			// Schema with scheduling but no promotion
			var scheduledFor sql.NullTime
			var scheduleType sql.NullString
			err := rows.Scan(
				&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status,
				&scheduledFor, &scheduleType,
				&o.TotalItems,
				&o.Subtotal, &o.DeliveryFee, &o.TotalAmount,
				&o.ReorderedFrom, &o.RatingID, &o.SenderID, &o.CreatedAt, &completedAt,
			)
			if err != nil {
				log.Printf("❌ Scan error: %v", err)
				return nil, err
			}
			if scheduledFor.Valid {
				o.ScheduledFor = &scheduledFor.Time
			}
			if scheduleType.Valid {
				o.ScheduleType = scheduleType.String
			}
		} else {
			// Legacy schema
			err := rows.Scan(
				&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status,
				&o.TotalItems,
				&o.Subtotal, &o.DeliveryFee, &o.TotalAmount,
				&o.ReorderedFrom, &o.RatingID, &o.SenderID, &o.CreatedAt, &completedAt,
			)
			if err != nil {
				log.Printf("❌ Scan error: %v", err)
				return nil, err
			}
		}
		if completedAt.Valid {
			o.CompletedAt = &completedAt.Time
		}

		orders = append(orders, o)
	}

	// Batch load all items in a single query (avoids N+1 problem)
	if len(orders) > 0 {
		orderIDs := make([]int, len(orders))
		orderMap := make(map[int]int) // orderID -> index in orders slice
		for i, o := range orders {
			orderIDs[i] = o.ID
			orderMap[o.ID] = i
		}

		// Build query with IN clause
		itemsQuery := `
			SELECT 
				oi.id, oi.order_id, COALESCE(p.id, 0) as product_id, oi.product, oi.quantity, oi.price,
				COALESCE(oi.note, '') as note,
				COALESCE(p.image_url, oi.image_url, '') as image_url,
				oi.created_at
			FROM order_items oi
			LEFT JOIN LATERAL (
				SELECT pr.id, pr.image_url
				FROM products pr
				WHERE pr.deleted_at IS NULL
				  AND (
					LOWER(pr.name) = LOWER(oi.product)
					OR LOWER(pr.name) LIKE '%' || LOWER(oi.product) || '%'
					OR LOWER(oi.product) LIKE '%' || LOWER(pr.name) || '%'
				  )
				ORDER BY 
				  CASE WHEN LOWER(pr.name) = LOWER(oi.product) THEN 0 ELSE 1 END,
				  ABS(LENGTH(pr.name) - LENGTH(oi.product))
				LIMIT 1
			) p ON TRUE
			WHERE oi.order_id = ANY($1)
			ORDER BY oi.order_id, oi.id
		`
		itemRows, err := configs.DB.Query(itemsQuery, pq.Array(orderIDs))
		if err == nil {
			defer itemRows.Close()
			for itemRows.Next() {
				var item OrderItem
				var pid sql.NullInt64
				if err := itemRows.Scan(&item.ID, &item.OrderID, &pid, &item.Product, &item.Quantity, &item.Price, &item.Note, &item.ImageURL, &item.CreatedAt); err == nil {
					if pid.Valid && pid.Int64 > 0 {
						v := int(pid.Int64)
						item.ProductID = &v
					}
					if idx, ok := orderMap[item.OrderID]; ok {
						orders[idx].Items = append(orders[idx].Items, item)
					}
				}
			}
		}
	}

	log.Printf("📦 Loaded %d orders", len(orders))

	return orders, nil
}

func GetOrdersByStatus(status string) ([]Order, error) {
	log.Println("🔍 Querying orders table with status filter...")
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		return GetAllOrders()
	}
	queryWithPromotion := `
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, scheduled_for, COALESCE(schedule_type, '') as schedule_type, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       promotion_id, COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		WHERE LOWER(status) = $1
		ORDER BY id DESC
	`

	queryWithSchedule := `
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, scheduled_for, COALESCE(schedule_type, '') as schedule_type, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		WHERE LOWER(status) = $1
		ORDER BY id DESC
	`

	queryLegacy := `
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		WHERE LOWER(status) = $1
		ORDER BY id DESC
	`

	rows, err := configs.DB.Query(queryWithPromotion, status)
	usePromotionCols := true
	useScheduleCols := true
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "promotion_id") || strings.Contains(msg, "discount") {
			usePromotionCols = false
			rows, err = configs.DB.Query(queryWithSchedule, status)
			if err != nil {
				msg = err.Error()
				if strings.Contains(msg, "scheduled_for") || strings.Contains(msg, "schedule_type") {
					useScheduleCols = false
					rows, err = configs.DB.Query(queryLegacy, status)
				}
			}
		} else if strings.Contains(msg, "scheduled_for") || strings.Contains(msg, "schedule_type") {
			useScheduleCols = false
			rows, err = configs.DB.Query(queryLegacy, status)
		}
		if err != nil {
			log.Printf("❌ Query failed: %v", err)
			return nil, err
		}
	}
	defer rows.Close()

	log.Println("✅ Query executed, scanning rows...")
	var orders []Order
	for rows.Next() {
		var o Order
		var completedAt sql.NullTime
		if usePromotionCols {
			var scheduledFor sql.NullTime
			var scheduleType sql.NullString
			err := rows.Scan(
				&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status,
				&scheduledFor, &scheduleType,
				&o.TotalItems,
				&o.Subtotal, &o.DeliveryFee, &o.TotalAmount,
				&o.PromotionID, &o.Discount,
				&o.ReorderedFrom, &o.RatingID, &o.SenderID, &o.CreatedAt, &completedAt,
			)
			if err != nil {
				log.Printf("❌ Scan error: %v", err)
				return nil, err
			}
			if scheduledFor.Valid {
				o.ScheduledFor = &scheduledFor.Time
			}
			if scheduleType.Valid {
				o.ScheduleType = scheduleType.String
			}
		} else if useScheduleCols {
			var scheduledFor sql.NullTime
			var scheduleType sql.NullString
			err := rows.Scan(
				&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status,
				&scheduledFor, &scheduleType,
				&o.TotalItems,
				&o.Subtotal, &o.DeliveryFee, &o.TotalAmount,
				&o.ReorderedFrom, &o.RatingID, &o.SenderID, &o.CreatedAt, &completedAt,
			)
			if err != nil {
				log.Printf("❌ Scan error: %v", err)
				return nil, err
			}
			if scheduledFor.Valid {
				o.ScheduledFor = &scheduledFor.Time
			}
			if scheduleType.Valid {
				o.ScheduleType = scheduleType.String
			}
		} else {
			err := rows.Scan(
				&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status,
				&o.TotalItems,
				&o.Subtotal, &o.DeliveryFee, &o.TotalAmount,
				&o.ReorderedFrom, &o.RatingID, &o.SenderID, &o.CreatedAt, &completedAt,
			)
			if err != nil {
				log.Printf("❌ Scan error: %v", err)
				return nil, err
			}
		}
		if completedAt.Valid {
			o.CompletedAt = &completedAt.Time
		}
		orders = append(orders, o)
	}

	if len(orders) > 0 {
		orderIDs := make([]int, len(orders))
		orderMap := make(map[int]int)
		for i, o := range orders {
			orderIDs[i] = o.ID
			orderMap[o.ID] = i
		}
		itemsQuery := `
			SELECT 
				oi.id, oi.order_id, COALESCE(p.id, 0) as product_id, oi.product, oi.quantity, oi.price,
				COALESCE(oi.note, '') as note,
				COALESCE(p.image_url, oi.image_url, '') as image_url,
				oi.created_at
			FROM order_items oi
			LEFT JOIN LATERAL (
				SELECT pr.id, pr.image_url
				FROM products pr
				WHERE pr.deleted_at IS NULL
				  AND (
					LOWER(pr.name) = LOWER(oi.product)
					OR LOWER(pr.name) LIKE '%' || LOWER(oi.product) || '%'
					OR LOWER(oi.product) LIKE '%' || LOWER(pr.name) || '%'
				  )
				ORDER BY 
				  CASE WHEN LOWER(pr.name) = LOWER(oi.product) THEN 0 ELSE 1 END,
				  ABS(LENGTH(pr.name) - LENGTH(oi.product))
				LIMIT 1
			) p ON TRUE
			WHERE oi.order_id = ANY($1)
			ORDER BY oi.order_id, oi.id
		`
		itemRows, err := configs.DB.Query(itemsQuery, pq.Array(orderIDs))
		if err == nil {
			defer itemRows.Close()
			for itemRows.Next() {
				var item OrderItem
				var pid sql.NullInt64
				if err := itemRows.Scan(&item.ID, &item.OrderID, &pid, &item.Product, &item.Quantity, &item.Price, &item.Note, &item.ImageURL, &item.CreatedAt); err == nil {
					if pid.Valid && pid.Int64 > 0 {
						v := int(pid.Int64)
						item.ProductID = &v
					}
					if idx, ok := orderMap[item.OrderID]; ok {
						orders[idx].Items = append(orders[idx].Items, item)
					}
				}
			}
		}
	}

	log.Printf("📦 Loaded %d orders", len(orders))

	return orders, nil
}

// GetOrderItems returns all items for a specific order
func GetOrderItems(orderID int) ([]OrderItem, error) {
	rows, err := configs.DB.Query(`
		SELECT id, order_id, product, quantity, price, COALESCE(note, '') as note, COALESCE(image_url, '') as image_url, created_at 
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
		err := rows.Scan(&item.ID, &item.OrderID, &item.Product, &item.Quantity, &item.Price, &item.Note, &item.ImageURL, &item.CreatedAt)
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
	var senderID, deliveryType, address sql.NullString
	var totalAmount, subtotal, discount, deliveryFee sql.NullFloat64

	// Full query with all fields needed for order details
	err := configs.DB.QueryRow(
		`SELECT id, customer_name, status, sender_id, delivery_type, address, 
		        COALESCE(subtotal, 0) as subtotal,
		        COALESCE(discount, 0) as discount,
		        COALESCE(delivery_fee, 0) as delivery_fee,
		        COALESCE(total_amount, 0) as total_amount, created_at 
		 FROM orders WHERE id = $1`,
		orderID,
	).Scan(&o.ID, &o.CustomerName, &o.Status, &senderID, &deliveryType, &address,
		&subtotal, &discount, &deliveryFee, &totalAmount, &o.CreatedAt)

	if err != nil {
		return nil, err
	}

	// Handle nullable strings
	if senderID.Valid {
		o.SenderID = senderID.String
	}
	if deliveryType.Valid {
		o.DeliveryType = deliveryType.String
	} else {
		o.DeliveryType = "pickup"
	}
	if address.Valid {
		o.Address = address.String
	}
	if totalAmount.Valid {
		o.TotalAmount = totalAmount.Float64
	}
	if subtotal.Valid {
		o.Subtotal = subtotal.Float64
	}
	if discount.Valid {
		o.Discount = discount.Float64
	}
	if deliveryFee.Valid {
		o.DeliveryFee = deliveryFee.Float64
	}

	// Load items (this has the product images)
	items, itemsErr := GetOrderItems(o.ID)
	if itemsErr == nil {
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

	_, err := configs.DB.Exec("UPDATE orders SET status = $1 WHERE id = $2", newStatus, orderID)
	return err
}

func GetOrderLastItemTimes(orderIDs []int) (map[int]time.Time, error) {
	result := make(map[int]time.Time)
	if configs.DB == nil {
		return result, sql.ErrConnDone
	}
	if len(orderIDs) == 0 {
		return result, nil
	}

	rows, err := configs.DB.Query(`
		SELECT order_id, MAX(created_at) as last_item_at
		FROM order_items
		WHERE order_id = ANY($1)
		GROUP BY order_id
	`, pq.Array(orderIDs))
	if err != nil {
		return result, err
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var ts time.Time
		if err := rows.Scan(&id, &ts); err != nil {
			return result, err
		}
		result[id] = ts
	}
	return result, nil
}

func UpsertCustomerPhone(psid string, phone string) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	phone = strings.TrimSpace(phone)
	if psid == "" || phone == "" {
		return nil
	}
	_, err := configs.DB.Exec(`
		INSERT INTO customer_phones (psid, phone, first_seen_at, last_seen_at)
		VALUES ($1, $2, NOW(), NOW())
		ON CONFLICT (psid, phone)
		DO UPDATE SET last_seen_at = NOW()
	`, psid, phone)
	return err
}

func GetCustomerPhones(psid string) ([]string, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	if psid == "" {
		return []string{}, nil
	}
	rows, err := configs.DB.Query(`
		SELECT phone
		FROM customer_phones
		WHERE psid = $1
		ORDER BY last_seen_at DESC
	`, psid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	phones := []string{}
	for rows.Next() {
		var phone string
		if err := rows.Scan(&phone); err != nil {
			return nil, err
		}
		phones = append(phones, phone)
	}
	return phones, nil
}

func IsIdentityBlocked(identityType string, value string) (bool, error) {
	if configs.DB == nil {
		return false, sql.ErrConnDone
	}
	identityType = strings.TrimSpace(identityType)
	value = strings.TrimSpace(value)
	if identityType == "" || value == "" {
		return false, nil
	}
	var exists bool
	err := configs.DB.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM blocked_identities WHERE identity_type = $1 AND value = $2
		)
	`, identityType, value).Scan(&exists)
	return exists, err
}

func GetBlockedIdentityDetails(identityType string, value string) (bool, string, *time.Time, error) {
	if configs.DB == nil {
		return false, "", nil, sql.ErrConnDone
	}
	identityType = strings.TrimSpace(identityType)
	value = strings.TrimSpace(value)
	if identityType == "" || value == "" {
		return false, "", nil, nil
	}
	var reason sql.NullString
	var createdAt time.Time
	err := configs.DB.QueryRow(`
		SELECT reason, created_at
		FROM blocked_identities
		WHERE identity_type = $1 AND value = $2
	`, identityType, value).Scan(&reason, &createdAt)
	if err == sql.ErrNoRows {
		return false, "", nil, nil
	}
	if err != nil {
		return false, "", nil, err
	}
	return true, reason.String, &createdAt, nil
}

func BlockCustomerIdentity(psid string, phones []string, reason string) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	reason = strings.TrimSpace(reason)
	if psid == "" {
		return nil
	}
	tx, err := configs.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := blockIdentityTx(tx, "psid", psid, reason); err != nil {
		return err
	}

	seen := map[string]struct{}{}
	for _, phone := range phones {
		clean := strings.TrimSpace(phone)
		if clean == "" {
			continue
		}
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		if err := blockIdentityTx(tx, "phone", clean, reason); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func UnblockCustomerIdentity(psid string) ([]string, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	if psid == "" {
		return []string{}, nil
	}
	phones, err := GetCustomerPhones(psid)
	if err != nil {
		return nil, err
	}
	tx, err := configs.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		DELETE FROM blocked_identities WHERE identity_type = 'psid' AND value = $1
	`, psid); err != nil {
		return nil, err
	}

	if len(phones) > 0 {
		if _, err := tx.Exec(`
			DELETE FROM blocked_identities
			WHERE identity_type = 'phone' AND value = ANY($1)
		`, pq.Array(phones)); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return phones, nil
}

func blockIdentityTx(tx *sql.Tx, identityType string, value string, reason string) error {
	_, err := tx.Exec(`
		INSERT INTO blocked_identities (identity_type, value, reason, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (identity_type, value) DO NOTHING
	`, identityType, value, reason)
	return err
}

func SetCustomerVerification(psid string, verified bool, method string, adminID sql.NullInt64) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	method = strings.TrimSpace(method)
	if psid == "" {
		return nil
	}
	methodValue := sql.NullString{Valid: verified && method != "", String: method}
	adminValue := sql.NullInt64{Valid: verified && adminID.Valid, Int64: adminID.Int64}

	_, err := configs.DB.Exec(`
		INSERT INTO customer_verifications (psid, verified, verification_method, verified_at, verified_by_admin_id)
		VALUES ($1, $2, $3, CASE WHEN $2 THEN NOW() ELSE NULL END, CASE WHEN $2 THEN $4 ELSE NULL END)
		ON CONFLICT (psid) DO UPDATE SET
			verified = EXCLUDED.verified,
			verification_method = EXCLUDED.verification_method,
			verified_at = EXCLUDED.verified_at,
			verified_by_admin_id = EXCLUDED.verified_by_admin_id
	`, psid, verified, methodValue, adminValue)
	return err
}

func GetCustomerVerification(psid string) (CustomerVerification, error) {
	result := CustomerVerification{PSID: strings.TrimSpace(psid)}
	if configs.DB == nil {
		return result, sql.ErrConnDone
	}
	if result.PSID == "" {
		return result, nil
	}
	var verified bool
	var method sql.NullString
	var verifiedAt sql.NullTime
	var verifiedBy sql.NullInt64
	err := configs.DB.QueryRow(`
		SELECT verified, verification_method, verified_at, verified_by_admin_id
		FROM customer_verifications
		WHERE psid = $1
	`, result.PSID).Scan(&verified, &method, &verifiedAt, &verifiedBy)
	if err != nil && err != sql.ErrNoRows {
		return result, err
	}
	if err == nil {
		result.Verified = verified
		if method.Valid {
			result.VerificationMethod = method.String
		}
		if verifiedAt.Valid {
			t := verifiedAt.Time
			result.VerifiedAt = &t
		}
		if verifiedBy.Valid {
			id := int(verifiedBy.Int64)
			result.VerifiedByAdminID = &id
		}
	}

	var pendingAt sql.NullTime
	err = configs.DB.QueryRow(`
		SELECT requested_at
		FROM customer_verification_requests
		WHERE psid = $1 AND status = 'pending'
		ORDER BY requested_at DESC
		LIMIT 1
	`, result.PSID).Scan(&pendingAt)
	if err != nil && err != sql.ErrNoRows {
		return result, err
	}
	if pendingAt.Valid {
		result.PendingVerification = true
		t := pendingAt.Time
		result.PendingRequestedAt = &t
	}

	return result, nil
}

func UpsertMessengerVerificationRequest(psid string, adminID sql.NullInt64) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	if psid == "" {
		return nil
	}
	tx, err := configs.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE customer_verification_requests
		SET status = 'expired'
		WHERE psid = $1 AND status = 'pending'
	`, psid); err != nil {
		return err
	}

	if _, err := tx.Exec(`
		INSERT INTO customer_verification_requests (psid, status, requested_by_admin_id, requested_at)
		VALUES ($1, 'pending', $2, NOW())
	`, psid, adminID); err != nil {
		return err
	}

	return tx.Commit()
}

func HasPendingMessengerVerification(psid string) (bool, error) {
	if configs.DB == nil {
		return false, sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	if psid == "" {
		return false, nil
	}
	var exists bool
	err := configs.DB.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM customer_verification_requests WHERE psid = $1 AND status = 'pending'
		)
	`, psid).Scan(&exists)
	return exists, err
}

func MarkMessengerVerificationConfirmed(psid string) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	psid = strings.TrimSpace(psid)
	if psid == "" {
		return nil
	}
	_, err := configs.DB.Exec(`
		UPDATE customer_verification_requests
		SET status = 'confirmed', confirmed_at = NOW()
		WHERE psid = $1 AND status = 'pending'
	`, psid)
	return err
}

func LogAdminAction(psid string, actionType string, reason string, metadata map[string]interface{}, adminID sql.NullInt64) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	actionType = strings.TrimSpace(actionType)
	psid = strings.TrimSpace(psid)
	reason = strings.TrimSpace(reason)
	if actionType == "" {
		return nil
	}
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = configs.DB.Exec(`
		INSERT INTO admin_action_logs (admin_id, action_type, psid, reason, metadata, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
	`, adminID, actionType, psid, reason, metadataJSON)
	return err
}
