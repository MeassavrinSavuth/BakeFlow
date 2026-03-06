package models

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"bakeflow/configs"
)

// StockStatus represents the availability state of a product
type StockStatus string

const (
	StockInStock    StockStatus = "in_stock"
	StockLowStock   StockStatus = "low_stock"
	StockOutOfStock StockStatus = "out_of_stock"
)

// ProductStock represents real-time stock information
type ProductStock struct {
	ProductID      int         `json:"product_id"`
	ProductName    string      `json:"product_name"`
	TotalStock     int         `json:"total_stock"`
	ReservedStock  int         `json:"reserved_stock"`
	AvailableStock int         `json:"available_stock"`
	Status         StockStatus `json:"status"`
}

// StockReservation represents a pending stock reservation
type StockReservation struct {
	ID            int        `json:"id"`
	ProductID     int        `json:"product_id"`
	OrderID       *int       `json:"order_id,omitempty"`
	SessionID     string     `json:"session_id,omitempty"`
	Quantity      int        `json:"quantity"`
	Status        string     `json:"status"` // pending, confirmed, released, expired
	ExpiresAt     time.Time  `json:"expires_at"`
	CreatedAt     time.Time  `json:"created_at"`
	ConfirmedAt   *time.Time `json:"confirmed_at,omitempty"`
	ReleasedAt    *time.Time `json:"released_at,omitempty"`
	ReleaseReason string     `json:"release_reason,omitempty"`
}

// StockTransaction represents an audit log entry
type StockTransaction struct {
	ID               int       `json:"id"`
	ProductID        int       `json:"product_id"`
	TransactionType  string    `json:"transaction_type"` // reserve, confirm, release, adjust, restock, sale
	Quantity         int       `json:"quantity"`
	PreviousStock    int       `json:"previous_stock"`
	NewStock         int       `json:"new_stock"`
	PreviousReserved int       `json:"previous_reserved"`
	NewReserved      int       `json:"new_reserved"`
	OrderID          *int      `json:"order_id,omitempty"`
	ReservationID    *int      `json:"reservation_id,omitempty"`
	AdminID          *int      `json:"admin_id,omitempty"`
	Reason           string    `json:"reason,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// StockCheckResult represents the result of a stock availability check
type StockCheckResult struct {
	ProductID   int         `json:"product_id"`
	ProductName string      `json:"product_name"`
	Requested   int         `json:"requested"`
	Available   int         `json:"available"`
	CanFulfill  bool        `json:"can_fulfill"`
	Status      StockStatus `json:"status"`
}

// Common errors
var (
	ErrInsufficientStock  = errors.New("insufficient stock")
	ErrProductNotFound    = errors.New("product not found or inactive")
	ErrReservationFailed  = errors.New("failed to reserve stock")
	ErrInvalidReservation = errors.New("invalid or already processed reservation")
)

// GetAvailableStock returns the available stock for a product (total - reserved)
// This is the ONLY source of truth for stock availability
func GetAvailableStock(productID int) (int, error) {
	var available int
	err := configs.DB.QueryRow(
		"SELECT COALESCE(get_available_stock($1), 0)",
		productID,
	).Scan(&available)

	if err != nil {
		// Fallback if function doesn't exist
		err = configs.DB.QueryRow(`
			SELECT GREATEST(stock - COALESCE(reserved_stock, 0), 0)
			FROM products
			WHERE id = $1 AND deleted_at IS NULL
		`, productID).Scan(&available)
	}

	return available, err
}

// GetProductStockStatus returns detailed stock information
func GetProductStockStatus(productID int) (*ProductStock, error) {
	var ps ProductStock
	var reserved sql.NullInt64

	err := configs.QueryRowRetry(`
		SELECT id, name, stock, COALESCE(reserved_stock, 0)
		FROM products
		WHERE id = $1 AND deleted_at IS NULL
	`, productID).Scan(&ps.ProductID, &ps.ProductName, &ps.TotalStock, &reserved)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrProductNotFound
		}
		// DB connection / query error — not a missing product
		log.Printf("❌ DB error checking stock for product %d: %v", productID, err)
		return nil, fmt.Errorf("database error: %w", err)
	}

	ps.ReservedStock = int(reserved.Int64)
	ps.AvailableStock = ps.TotalStock - ps.ReservedStock
	if ps.AvailableStock < 0 {
		ps.AvailableStock = 0
	}

	// Determine status
	if ps.AvailableStock <= 0 {
		ps.Status = StockOutOfStock
	} else if ps.AvailableStock <= 5 {
		ps.Status = StockLowStock
	} else {
		ps.Status = StockInStock
	}

	return &ps, nil
}

// CheckStockAvailability checks if all items can be fulfilled
// Returns detailed results for each item
func CheckStockAvailability(items []struct{ ProductID, Quantity int }) ([]StockCheckResult, error) {
	results := make([]StockCheckResult, len(items))

	for i, item := range items {
		stock, err := GetProductStockStatus(item.ProductID)
		if err != nil {
			results[i] = StockCheckResult{
				ProductID:  item.ProductID,
				Requested:  item.Quantity,
				Available:  0,
				CanFulfill: false,
				Status:     StockOutOfStock,
			}
			continue
		}

		results[i] = StockCheckResult{
			ProductID:   stock.ProductID,
			ProductName: stock.ProductName,
			Requested:   item.Quantity,
			Available:   stock.AvailableStock,
			CanFulfill:  stock.AvailableStock >= item.Quantity,
			Status:      stock.Status,
		}
	}

	return results, nil
}

// ReserveStock atomically reserves stock for a product
// Uses database function with row locking to prevent race conditions
// Returns reservation ID on success, error on failure
func ReserveStock(productID, quantity int, sessionID string, timeoutMinutes int) (int, error) {
	if timeoutMinutes <= 0 {
		timeoutMinutes = 15 // Default 15-minute reservation
	}

	var reservationID int

	// Try using the database function first
	err := configs.DB.QueryRow(
		"SELECT reserve_stock($1, $2, $3, $4)",
		productID, quantity, sessionID, timeoutMinutes,
	).Scan(&reservationID)

	if err != nil || reservationID == 0 {
		// Fallback: manual implementation with transaction
		return reserveStockManual(productID, quantity, sessionID, timeoutMinutes)
	}

	if reservationID == 0 {
		return 0, ErrInsufficientStock
	}

	return reservationID, nil
}

// reserveStockManual is a fallback implementation without database functions
func reserveStockManual(productID, quantity int, sessionID string, timeoutMinutes int) (int, error) {
	tx, err := configs.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Lock the product row
	var stock, reserved int
	err = tx.QueryRow(`
		SELECT stock, COALESCE(reserved_stock, 0)
		FROM products
		WHERE id = $1 AND deleted_at IS NULL AND status = 'active'
		FOR UPDATE
	`, productID).Scan(&stock, &reserved)

	if err != nil {
		return 0, ErrProductNotFound
	}

	available := stock - reserved
	if available < quantity {
		return 0, ErrInsufficientStock
	}

	// Create reservation
	var reservationID int
	expiresAt := time.Now().Add(time.Duration(timeoutMinutes) * time.Minute)

	err = tx.QueryRow(`
		INSERT INTO stock_reservations (product_id, session_id, quantity, expires_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, productID, sessionID, quantity, expiresAt).Scan(&reservationID)

	if err != nil {
		return 0, err
	}

	// Update reserved count
	_, err = tx.Exec(`
		UPDATE products SET reserved_stock = COALESCE(reserved_stock, 0) + $1
		WHERE id = $2
	`, quantity, productID)

	if err != nil {
		return 0, err
	}

	// Log transaction
	_, err = tx.Exec(`
		INSERT INTO stock_transactions (
			product_id, transaction_type, quantity,
			previous_stock, new_stock, previous_reserved, new_reserved,
			reservation_id, reason
		) VALUES ($1, 'reserve', $2, $3, $3, $4, $5, $6, 'Cart reservation')
	`, productID, quantity, stock, reserved, reserved+quantity, reservationID)

	if err != nil {
		log.Printf("Warning: Failed to log stock transaction: %v", err)
		// Don't fail the reservation for logging errors
	}

	if err = tx.Commit(); err != nil {
		return 0, err
	}

	return reservationID, nil
}

// ConfirmReservation converts a pending reservation to an actual sale
// Called when order is confirmed/paid
func ConfirmReservation(reservationID, orderID int) error {
	var success bool

	// Try database function first
	err := configs.DB.QueryRow(
		"SELECT confirm_reservation($1, $2)",
		reservationID, orderID,
	).Scan(&success)

	if err != nil || !success {
		// Fallback to manual implementation
		return confirmReservationManual(reservationID, orderID)
	}

	return nil
}

func confirmReservationManual(reservationID, orderID int) error {
	tx, err := configs.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock and get reservation
	var productID, quantity int
	var status string
	err = tx.QueryRow(`
		SELECT product_id, quantity, status
		FROM stock_reservations
		WHERE id = $1
		FOR UPDATE
	`, reservationID).Scan(&productID, &quantity, &status)

	if err != nil || status != "pending" {
		return ErrInvalidReservation
	}

	// Update reservation
	_, err = tx.Exec(`
		UPDATE stock_reservations
		SET status = 'confirmed', order_id = $1, confirmed_at = NOW()
		WHERE id = $2
	`, orderID, reservationID)
	if err != nil {
		return err
	}

	// Deduct from both stock and reserved
	_, err = tx.Exec(`
		UPDATE products
		SET stock = stock - $1, reserved_stock = GREATEST(reserved_stock - $1, 0)
		WHERE id = $2
	`, quantity, productID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// ReleaseReservation releases reserved stock back to available pool
// Called on timeout, cancellation, or payment failure
func ReleaseReservation(reservationID int, reason string) error {
	var success bool

	err := configs.DB.QueryRow(
		"SELECT release_reservation($1, $2)",
		reservationID, reason,
	).Scan(&success)

	if err != nil || !success {
		return releaseReservationManual(reservationID, reason)
	}

	return nil
}

func releaseReservationManual(reservationID int, reason string) error {
	tx, err := configs.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock and get reservation
	var productID, quantity int
	var status string
	err = tx.QueryRow(`
		SELECT product_id, quantity, status
		FROM stock_reservations
		WHERE id = $1
		FOR UPDATE
	`, reservationID).Scan(&productID, &quantity, &status)

	if err != nil || status != "pending" {
		return ErrInvalidReservation
	}

	// Update reservation
	_, err = tx.Exec(`
		UPDATE stock_reservations
		SET status = 'released', released_at = NOW(), release_reason = $1
		WHERE id = $2
	`, reason, reservationID)
	if err != nil {
		return err
	}

	// Release reserved stock
	_, err = tx.Exec(`
		UPDATE products
		SET reserved_stock = GREATEST(reserved_stock - $1, 0)
		WHERE id = $2
	`, quantity, productID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// AtomicPurchase performs a single-step stock deduction with row locking
// Use this for immediate checkout without cart holding
// This is the PRODUCTION-SAFE version that prevents overselling
func AtomicPurchase(productID, quantity, orderID int) error {
	tx, err := configs.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock the product row and check availability
	var stock, reserved int
	var productName string
	err = tx.QueryRow(`
		SELECT stock, COALESCE(reserved_stock, 0), name
		FROM products
		WHERE id = $1 AND deleted_at IS NULL AND status = 'active'
		FOR UPDATE
	`, productID).Scan(&stock, &reserved, &productName)

	if err == sql.ErrNoRows {
		return ErrProductNotFound
	}
	if err != nil {
		return err
	}

	available := stock - reserved
	if available < quantity {
		return fmt.Errorf("%w: requested %d, available %d for %s",
			ErrInsufficientStock, quantity, available, productName)
	}

	// Deduct stock
	_, err = tx.Exec(`
		UPDATE products SET stock = stock - $1 WHERE id = $2
	`, quantity, productID)
	if err != nil {
		return err
	}

	// Log transaction
	_, err = tx.Exec(`
		INSERT INTO stock_transactions (
			product_id, transaction_type, quantity,
			previous_stock, new_stock, previous_reserved, new_reserved,
			order_id, reason
		) VALUES ($1, 'sale', $2, $3, $4, $5, $5, $6, 'Direct purchase')
	`, productID, -quantity, stock, stock-quantity, reserved, orderID)

	if err != nil {
		log.Printf("Warning: Failed to log stock transaction: %v", err)
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	logDate := TruncateDate(time.Now())
	soldSoFar, _ := GetDailySold(logDate, productID)
	opening := stock + soldSoFar
	_ = EnsureDailyStockLog(logDate, productID, opening)
	_ = AddDailyStockDeltas(logDate, productID, 0, 0, 0, quantity)
	return nil
}

// RestoreStock returns stock to available pool (cancellation, refund)
func RestoreStock(productID, quantity, orderID int, reason string) error {
	tx, err := configs.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var stock, reserved int
	err = tx.QueryRow(`
		SELECT stock, COALESCE(reserved_stock, 0)
		FROM products WHERE id = $1
		FOR UPDATE
	`, productID).Scan(&stock, &reserved)

	if err != nil {
		return err
	}

	_, err = tx.Exec(`
		UPDATE products SET stock = stock + $1 WHERE id = $2
	`, quantity, productID)
	if err != nil {
		return err
	}

	// Log transaction
	_, err = tx.Exec(`
		INSERT INTO stock_transactions (
			product_id, transaction_type, quantity,
			previous_stock, new_stock, previous_reserved, new_reserved,
			order_id, reason
		) VALUES ($1, 'restock', $2, $3, $4, $5, $5, $6, $7)
	`, productID, quantity, stock, stock+quantity, reserved, orderID, reason)

	if err := tx.Commit(); err != nil {
		return err
	}

	logDate := TruncateDate(time.Now())
	soldSoFar, _ := GetDailySold(logDate, productID)
	opening := stock + soldSoFar
	_ = EnsureDailyStockLog(logDate, productID, opening)
	_ = AddDailyStockDeltas(logDate, productID, 0, 0, 0, -quantity)
	return nil
}

// CleanupExpiredReservations releases all expired reservations
// Should be called periodically (e.g., every minute)
func CleanupExpiredReservations() (int, error) {
	var count int

	// Try database function first
	err := configs.DB.QueryRow("SELECT cleanup_expired_reservations()").Scan(&count)
	if err == nil {
		return count, nil
	}

	// Fallback: manual cleanup
	rows, err := configs.DB.Query(`
		SELECT id FROM stock_reservations
		WHERE status = 'pending' AND expires_at < NOW()
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			continue
		}
		if err := ReleaseReservation(id, "timeout"); err == nil {
			count++
		}
	}

	return count, nil
}

// GetStockTransactions returns the audit trail for a product
func GetStockTransactions(productID int, limit int) ([]StockTransaction, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := configs.DB.Query(`
		SELECT id, product_id, transaction_type, quantity,
			   previous_stock, new_stock, previous_reserved, new_reserved,
			   order_id, reservation_id, admin_id, reason, created_at
		FROM stock_transactions
		WHERE product_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, productID, limit)

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transactions []StockTransaction
	for rows.Next() {
		var t StockTransaction
		var orderID, reservationID, adminID sql.NullInt64
		var reason sql.NullString

		err := rows.Scan(
			&t.ID, &t.ProductID, &t.TransactionType, &t.Quantity,
			&t.PreviousStock, &t.NewStock, &t.PreviousReserved, &t.NewReserved,
			&orderID, &reservationID, &adminID, &reason, &t.CreatedAt,
		)
		if err != nil {
			continue
		}

		if orderID.Valid {
			id := int(orderID.Int64)
			t.OrderID = &id
		}
		if reservationID.Valid {
			id := int(reservationID.Int64)
			t.ReservationID = &id
		}
		if adminID.Valid {
			id := int(adminID.Int64)
			t.AdminID = &id
		}
		t.Reason = reason.String

		transactions = append(transactions, t)
	}

	return transactions, nil
}
