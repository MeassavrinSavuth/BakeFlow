package models

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"bakeflow/configs"
)

type SavedOrder struct {
	ID         int              `json:"id"`
	SenderID   string           `json:"sender_id"`
	Name       string           `json:"name"`
	Note       string           `json:"note,omitempty"`
	Tags       []string         `json:"tags"`
	LastUsedAt *time.Time       `json:"last_used_at,omitempty"`
	CreatedAt  time.Time        `json:"created_at"`
	UpdatedAt  time.Time        `json:"updated_at"`
	Items      []SavedOrderItem `json:"items"`
}

type SavedOrderItem struct {
	ID           int       `json:"id"`
	SavedOrderID int       `json:"saved_order_id"`
	ProductID    *int      `json:"product_id,omitempty"`
	Name         string    `json:"name"`
	Qty          int       `json:"qty"`
	Price        float64   `json:"price"`
	ImageURL     string    `json:"image_url,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type SaveSavedOrderRequest struct {
	ID    int              `json:"id"`
	Name  string           `json:"name"`
	Note  string           `json:"note"`
	Tags  []string         `json:"tags"`
	Items []SavedOrderItem `json:"items"`
}

func GetSavedOrdersBySenderID(senderID string) ([]SavedOrder, error) {
	rows, err := configs.DB.Query(`
		SELECT id, sender_id, name, COALESCE(note, ''), COALESCE(tags, '[]'::jsonb), last_used_at, created_at, updated_at
		FROM saved_orders
		WHERE sender_id = $1
		ORDER BY updated_at DESC, id DESC
	`, senderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	orders := make([]SavedOrder, 0)
	for rows.Next() {
		var so SavedOrder
		var lastUsed sql.NullTime
		var tagsJSON []byte
		err := rows.Scan(&so.ID, &so.SenderID, &so.Name, &so.Note, &tagsJSON, &lastUsed, &so.CreatedAt, &so.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			so.LastUsedAt = &lastUsed.Time
		}
		so.Tags = decodeJSONStringArray(tagsJSON)

		items, err := GetSavedOrderItems(so.ID)
		if err == nil {
			so.Items = items
		}
		orders = append(orders, so)
	}
	return orders, nil
}

func GetSavedOrderItems(savedOrderID int) ([]SavedOrderItem, error) {
	rows, err := configs.DB.Query(`
		SELECT
			soi.id,
			soi.saved_order_id,
			COALESCE(
				soi.product_id,
				(
					SELECT p.id
					FROM products p
					WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(soi.name))
					  AND p.deleted_at IS NULL
					  AND p.status = 'active'
					LIMIT 1
				)
			) AS resolved_product_id,
			soi.name,
			soi.qty,
			COALESCE(soi.price, 0),
			COALESCE(soi.image_url, ''),
			soi.created_at
		FROM saved_order_items soi
		WHERE soi.saved_order_id = $1
		ORDER BY soi.id
	`, savedOrderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]SavedOrderItem, 0)
	for rows.Next() {
		var it SavedOrderItem
		var pid sql.NullInt64
		if err := rows.Scan(&it.ID, &it.SavedOrderID, &pid, &it.Name, &it.Qty, &it.Price, &it.ImageURL, &it.CreatedAt); err != nil {
			return nil, err
		}
		if pid.Valid {
			v := int(pid.Int64)
			it.ProductID = &v
		}
		items = append(items, it)
	}
	return items, nil
}

func UpsertSavedOrder(senderID string, req SaveSavedOrderRequest) (*SavedOrder, error) {
	if configs.DB == nil {
		return nil, sql.ErrConnDone
	}
	if senderID == "" {
		return nil, errors.New("missing sender_id")
	}
	if req.Name == "" {
		return nil, errors.New("missing name")
	}
	if len(req.Items) == 0 {
		return nil, errors.New("missing items")
	}

	tx, err := configs.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	tagsJSON := encodeJSONStringArray(req.Tags)

	var savedID int
	if req.ID > 0 {
		// Ensure ownership
		res, err := tx.Exec(`
			UPDATE saved_orders
			SET name = $1, note = $2, tags = $3::jsonb
			WHERE id = $4 AND sender_id = $5
		`, req.Name, req.Note, tagsJSON, req.ID, senderID)
		if err != nil {
			return nil, err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return nil, sql.ErrNoRows
		}
		savedID = req.ID

		_, err = tx.Exec(`DELETE FROM saved_order_items WHERE saved_order_id = $1`, savedID)
		if err != nil {
			return nil, err
		}
	} else {
		err := tx.QueryRow(`
			INSERT INTO saved_orders (sender_id, name, note, tags, created_at)
			VALUES ($1, $2, $3, $4::jsonb, NOW())
			RETURNING id
		`, senderID, req.Name, req.Note, tagsJSON).Scan(&savedID)
		if err != nil {
			return nil, err
		}
	}

	for _, it := range req.Items {
		qty := it.Qty
		if qty <= 0 {
			qty = 1
		}
		name := it.Name
		if name == "" {
			name = "Item"
		}

		_, err := tx.Exec(`
			INSERT INTO saved_order_items (saved_order_id, product_id, name, qty, price, image_url, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
		`, savedID, nullableIntPtr(it.ProductID), name, qty, it.Price, it.ImageURL)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// Load back full saved order
	orders, err := GetSavedOrdersBySenderID(senderID)
	if err != nil {
		return nil, err
	}
	for _, so := range orders {
		if so.ID == savedID {
			return &so, nil
		}
	}
	return nil, sql.ErrNoRows
}

func DeleteSavedOrder(senderID string, id int) error {
	if configs.DB == nil {
		return sql.ErrConnDone
	}
	if id <= 0 {
		return errors.New("invalid id")
	}
	res, err := configs.DB.Exec(`DELETE FROM saved_orders WHERE id = $1 AND sender_id = $2`, id, senderID)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func encodeJSONStringArray(tags []string) string {
	// Store as JSONB array. Return string so pg treats it as text (casted to jsonb).
	b, _ := jsonMarshal(tags)
	if len(b) == 0 {
		return "[]"
	}
	return string(b)
}

func decodeJSONStringArray(b []byte) []string {
	var tags []string
	_ = jsonUnmarshal(b, &tags)
	if tags == nil {
		return []string{}
	}
	return tags
}

func nullableIntPtr(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// Local indirection to avoid adding imports in many files.
// (We keep stdlib only.)
func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

func jsonUnmarshal(data []byte, v any) error {
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}
