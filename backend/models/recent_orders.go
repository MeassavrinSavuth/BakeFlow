package models

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"bakeflow/configs"
)

func GetRecentOrdersBySenderID(senderID string, limit int) ([]Order, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	if limit <= 0 {
		limit = 5
	}
	if limit > 50 {
		limit = 50
	}

	rows, err := configs.DB.Query(`
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0), COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		WHERE sender_id = $1
		ORDER BY id DESC
		LIMIT $2
	`, senderID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	orders := make([]Order, 0)
	for rows.Next() {
		var o Order
		var completedAt sql.NullTime
		var reorderedFrom sql.NullInt64
		var ratingID sql.NullInt64
		var createdAt time.Time

		err := rows.Scan(
			&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status, &o.TotalItems,
			&o.Subtotal, &o.DeliveryFee, &o.TotalAmount, &o.Discount,
			&reorderedFrom, &ratingID, &o.SenderID, &createdAt, &completedAt,
		)
		if err != nil {
			return nil, err
		}
		o.CreatedAt = createdAt
		if completedAt.Valid {
			o.CompletedAt = &completedAt.Time
		}
		if reorderedFrom.Valid {
			v := int(reorderedFrom.Int64)
			o.ReorderedFrom = &v
		}
		if ratingID.Valid {
			v := int(ratingID.Int64)
			o.RatingID = &v
		}

		items, err := GetOrderItems(o.ID)
		if err == nil {
			o.Items = items
		}
		orders = append(orders, o)
	}

	return orders, nil
}

func GetLatestOrderBySenderIDAndStatuses(senderID string, statuses []string) (*Order, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	if senderID == "" || len(statuses) == 0 {
		return nil, nil
	}
	ph := make([]string, len(statuses))
	args := make([]interface{}, len(statuses)+1)
	args[0] = senderID
	for i, s := range statuses {
		ph[i] = fmt.Sprintf("$%d", i+2)
		args[i+1] = s
	}
	row := configs.DB.QueryRow(fmt.Sprintf(`
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0), COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		WHERE sender_id = $1 AND status IN (%s)
		ORDER BY id DESC
		LIMIT 1
	`, strings.Join(ph, ",")), args...)

	var o Order
	var completedAt sql.NullTime
	var reorderedFrom sql.NullInt64
	var ratingID sql.NullInt64
	var createdAt time.Time

	err := row.Scan(
		&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status, &o.TotalItems,
		&o.Subtotal, &o.DeliveryFee, &o.TotalAmount, &o.Discount,
		&reorderedFrom, &ratingID, &o.SenderID, &createdAt, &completedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	o.CreatedAt = createdAt
	if completedAt.Valid {
		o.CompletedAt = &completedAt.Time
	}
	if reorderedFrom.Valid {
		v := int(reorderedFrom.Int64)
		o.ReorderedFrom = &v
	}
	if ratingID.Valid {
		v := int(ratingID.Int64)
		o.RatingID = &v
	}

	items, err := GetOrderItems(o.ID)
	if err == nil {
		o.Items = items
	}

	return &o, nil
}

// GetAllOrdersBySenderIDAndStatuses returns all active orders for a sender
func GetAllOrdersBySenderIDAndStatuses(senderID string, statuses []string) ([]*Order, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	if senderID == "" || len(statuses) == 0 {
		return nil, nil
	}

	// Normalize status values to lowercase
	lowerStatuses := make([]string, len(statuses))
	for i, s := range statuses {
		lowerStatuses[i] = strings.ToLower(strings.TrimSpace(s))
	}

	ph := make([]string, len(lowerStatuses))
	allArgs := make([]interface{}, len(lowerStatuses)+1)
	allArgs[0] = senderID
	for i, s := range lowerStatuses {
		ph[i] = fmt.Sprintf("$%d", i+2)
		allArgs[i+1] = s
	}

	rows, err := configs.DB.Query(fmt.Sprintf(`
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0), COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		WHERE sender_id = $1 AND status IN (%s)
		ORDER BY id DESC
	`, strings.Join(ph, ",")), allArgs...)

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []*Order
	for rows.Next() {
		var o Order
		var completedAt sql.NullTime
		var reorderedFrom sql.NullInt64
		var ratingID sql.NullInt64
		var createdAt time.Time

		err := rows.Scan(
			&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status, &o.TotalItems,
			&o.Subtotal, &o.DeliveryFee, &o.TotalAmount, &o.Discount,
			&reorderedFrom, &ratingID, &o.SenderID, &createdAt, &completedAt,
		)
		if err != nil {
			continue
		}

		o.CreatedAt = createdAt
		if completedAt.Valid {
			o.CompletedAt = &completedAt.Time
		}
		if reorderedFrom.Valid {
			v := int(reorderedFrom.Int64)
			o.ReorderedFrom = &v
		}
		if ratingID.Valid {
			v := int(ratingID.Int64)
			o.RatingID = &v
		}

		items, err := GetOrderItems(o.ID)
		if err == nil {
			o.Items = items
		}

		orders = append(orders, &o)
	}

	if len(orders) == 0 {
		return nil, nil
	}
	return orders, nil
}

func GetLatestOrderByPhoneAndStatuses(phone string, statuses []string) (*Order, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	phone = strings.TrimSpace(phone)
	if phone == "" || len(statuses) == 0 {
		return nil, nil
	}
	ph := make([]string, len(statuses))
	args := make([]interface{}, len(statuses)+1)
	args[0] = phone
	for i, s := range statuses {
		ph[i] = fmt.Sprintf("$%d", i+2)
		args[i+1] = s
	}
	statusIn := strings.Join(ph, ",")
	row := configs.DB.QueryRow(fmt.Sprintf(`
		SELECT id, customer_name,
		       COALESCE(delivery_type, 'pickup') as delivery_type,
		       COALESCE(address, '') as address,
		       status, total_items,
		       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0), COALESCE(discount, 0),
		       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
		FROM orders
		WHERE status IN (%s)
		  AND (
		    customer_name ILIKE '%%' || $1 || '%%'
		    OR sender_id IN (SELECT psid FROM customer_phones WHERE phone = $1)
		  )
		ORDER BY id DESC
		LIMIT 1
	`, statusIn), args...)

	var o Order
	var completedAt sql.NullTime
	var reorderedFrom sql.NullInt64
	var ratingID sql.NullInt64
	var createdAt time.Time

	err := row.Scan(
		&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status, &o.TotalItems,
		&o.Subtotal, &o.DeliveryFee, &o.TotalAmount, &o.Discount,
		&reorderedFrom, &ratingID, &o.SenderID, &createdAt, &completedAt,
	)
	if err != nil && strings.Contains(err.Error(), "customer_phones") {
		row = configs.DB.QueryRow(fmt.Sprintf(`
			SELECT id, customer_name,
			       COALESCE(delivery_type, 'pickup') as delivery_type,
			       COALESCE(address, '') as address,
			       status, total_items,
			       COALESCE(subtotal, 0), COALESCE(delivery_fee, 0), COALESCE(total_amount, 0), COALESCE(discount, 0),
			       reordered_from, rating_id, COALESCE(sender_id, '') as sender_id, created_at, completed_at
			FROM orders
			WHERE customer_name ILIKE '%%' || $1 || '%%' AND status IN (%s)
			ORDER BY id DESC
			LIMIT 1
		`, statusIn), args...)
		err = row.Scan(
			&o.ID, &o.CustomerName, &o.DeliveryType, &o.Address, &o.Status, &o.TotalItems,
			&o.Subtotal, &o.DeliveryFee, &o.TotalAmount, &o.Discount,
			&reorderedFrom, &ratingID, &o.SenderID, &createdAt, &completedAt,
		)
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	o.CreatedAt = createdAt
	if completedAt.Valid {
		o.CompletedAt = &completedAt.Time
	}
	if reorderedFrom.Valid {
		v := int(reorderedFrom.Int64)
		o.ReorderedFrom = &v
	}
	if ratingID.Valid {
		v := int(ratingID.Int64)
		o.RatingID = &v
	}

	items, err := GetOrderItems(o.ID)
	if err == nil {
		o.Items = items
	}

	return &o, nil
}
