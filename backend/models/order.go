package models

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"bakeflow/configs"
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
	PaymentMethod string      `json:"payment_method,omitempty"`
	OrderType     string      `json:"order_type,omitempty"`
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
	return GetAllOrdersPaginated(0, 100)
}

// GetAllOrdersPaginated returns orders with LIMIT/OFFSET
func GetAllOrdersPaginated(offset, limit int) ([]Order, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	log.Printf("🔍 Querying orders table (limit=%d, offset=%d)...", limit, offset)
	rows, err := configs.DB.Query(`
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, scheduled_for, COALESCE(schedule_type, '') as schedule_type, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       promotion_id, COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id,
		       COALESCE(payment_method, 'cash') as payment_method,
		       COALESCE(order_type, '') as order_type,
		       created_at, completed_at
		FROM orders
		ORDER BY id DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		log.Printf("❌ Query failed: %v", err)
		return nil, err
	}
	defer rows.Close()

	orders := scanOrders(rows)
	if err := rows.Err(); err != nil {
		return nil, err
	}
	loadOrderItems(orders)
	log.Printf("📦 Loaded %d orders", len(orders))
	return orders, nil
}

func GetOrdersByStatus(status string) ([]Order, error) {
	return GetOrdersByStatusPaginated(status, 0, 100)
}

// GetOrdersByStatusPaginated returns orders filtered by status with LIMIT/OFFSET
func GetOrdersByStatusPaginated(status string, offset, limit int) ([]Order, error) {
	log.Println("🔍 Querying orders table with status filter...")
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		return GetAllOrdersPaginated(offset, limit)
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := configs.DB.Query(`
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, scheduled_for, COALESCE(schedule_type, '') as schedule_type, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0),
		       promotion_id, COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id,
		       COALESCE(payment_method, 'cash') as payment_method,
		       COALESCE(order_type, '') as order_type,
		       created_at, completed_at
		FROM orders
		WHERE status = $1
		ORDER BY id DESC
		LIMIT $2 OFFSET $3
	`, status, limit, offset)
	if err != nil {
		log.Printf("❌ Query failed: %v", err)
		return nil, err
	}
	defer rows.Close()

	orders := scanOrders(rows)
	if err := rows.Err(); err != nil {
		return nil, err
	}
	loadOrderItems(orders)
	log.Printf("📦 Loaded %d orders", len(orders))
	return orders, nil
}

// scanOrders scans order rows into an Order slice (shared by GetAllOrders and GetOrdersByStatus)
func scanOrders(rows *sql.Rows) []Order {
	var orders []Order
	for rows.Next() {
		var o Order
		var completedAt sql.NullTime
		var scheduledFor sql.NullTime
		var scheduleType sql.NullString
		var paymentMethod sql.NullString
		var orderType sql.NullString
		err := rows.Scan(
			&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status,
			&scheduledFor, &scheduleType,
			&o.TotalItems,
			&o.Subtotal, &o.DeliveryFee, &o.TotalAmount,
			&o.PromotionID, &o.Discount,
			&o.ReorderedFrom, &o.RatingID, &o.SenderID,
			&paymentMethod,
			&orderType,
			&o.CreatedAt, &completedAt,
		)
		if err != nil {
			log.Printf("❌ Scan error: %v", err)
			continue
		}
		if paymentMethod.Valid {
			o.PaymentMethod = paymentMethod.String
		}
		if orderType.Valid {
			o.OrderType = orderType.String
		}
		if scheduledFor.Valid {
			o.ScheduledFor = &scheduledFor.Time
		}
		if scheduleType.Valid {
			o.ScheduleType = scheduleType.String
		}
		if completedAt.Valid {
			o.CompletedAt = &completedAt.Time
		}
		orders = append(orders, o)
	}
	return orders
}

// loadOrderItems batch-loads items for all orders in a single query (avoids N+1)
func loadOrderItems(orders []Order) {
	if len(orders) == 0 {
		return
	}
	orderIDs := make([]int, len(orders))
	orderMap := make(map[int]int)
	for i, o := range orders {
		orderIDs[i] = o.ID
		orderMap[o.ID] = i
	}

	// Build explicit IN ($1,$2,...) placeholders — PgBouncer doesn't handle ANY($1) with array params
	placeholders := make([]string, len(orderIDs))
	args := make([]interface{}, len(orderIDs))
	for i, id := range orderIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	inClause := strings.Join(placeholders, ",")

	// Fast query: use product_id FK if available, fall back to stored image_url
	itemRows, err := configs.DB.Query(fmt.Sprintf(`
		SELECT
			oi.id, oi.order_id,
			COALESCE(oi.product_id, 0) as product_id,
			oi.product, oi.quantity, oi.price,
			COALESCE(oi.note, '') as note,
			COALESCE(
				(SELECT pr.image_url FROM products pr WHERE pr.id = oi.product_id AND pr.deleted_at IS NULL),
				oi.image_url,
				''
			) as image_url,
			oi.created_at
		FROM order_items oi
		WHERE oi.order_id IN (%s)
		ORDER BY oi.order_id, oi.id
	`, inClause), args...)
	if err != nil {
		log.Printf("⚠️ Failed to load order items: %v", err)
		return
	}
	defer itemRows.Close()

	for itemRows.Next() {
		var item OrderItem
		var pid int
		if err := itemRows.Scan(&item.ID, &item.OrderID, &pid, &item.Product, &item.Quantity, &item.Price, &item.Note, &item.ImageURL, &item.CreatedAt); err == nil {
			if pid > 0 {
				item.ProductID = &pid
			}
			if idx, ok := orderMap[item.OrderID]; ok {
				orders[idx].Items = append(orders[idx].Items, item)
			}
		}
	}
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

	placeholders := make([]string, len(orderIDs))
	args := make([]interface{}, len(orderIDs))
	for i, id := range orderIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	rows, err := configs.DB.Query(fmt.Sprintf(`
		SELECT order_id, MAX(created_at) as last_item_at
		FROM order_items
		WHERE order_id IN (%s)
		GROUP BY order_id
	`, strings.Join(placeholders, ",")), args...)
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

// GetCustomerPhonesBatch fetches the most recent phone for multiple PSIDs in one query
func GetCustomerPhonesBatch(psids []string) (map[string]string, error) {
	result := make(map[string]string)
	if len(psids) == 0 || configs.DB == nil {
		return result, nil
	}
	placeholders := make([]string, len(psids))
	args := make([]interface{}, len(psids))
	for i, p := range psids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = p
	}
	rows, err := configs.DB.Query(fmt.Sprintf(`
		SELECT DISTINCT ON (psid) psid, phone
		FROM customer_phones
		WHERE psid IN (%s)
		ORDER BY psid, last_seen_at DESC
	`, strings.Join(placeholders, ",")), args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var psid, phone string
		if err := rows.Scan(&psid, &phone); err == nil {
			result[psid] = phone
		}
	}
	return result, nil
}

// GetOrdersCount returns total order count (optionally filtered by status)
func GetOrdersCount(status string) (int, error) {
	var count int
	var err error
	status = strings.ToLower(strings.TrimSpace(status))
	if status == "" {
		err = configs.DB.QueryRow("SELECT COUNT(*) FROM orders").Scan(&count)
	} else {
		err = configs.DB.QueryRow("SELECT COUNT(*) FROM orders WHERE status = $1", status).Scan(&count)
	}
	return count, err
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
	err := configs.QueryRowRetry(`
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
		ph := make([]string, len(phones))
		delArgs := make([]interface{}, len(phones))
		for i, p := range phones {
			ph[i] = fmt.Sprintf("$%d", i+1)
			delArgs[i] = p
		}
		if _, err := tx.Exec(fmt.Sprintf(`
			DELETE FROM blocked_identities
			WHERE identity_type = 'phone' AND value IN (%s)
		`, strings.Join(ph, ",")), delArgs...); err != nil {
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
