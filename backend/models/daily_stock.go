package models

import (
	"sync"
	"time"

	"bakeflow/configs"
)

type DailyStockLog struct {
	ID           int       `json:"id"`
	LogDate      time.Time `json:"log_date"`
	ProductID    int       `json:"product_id"`
	ProductName  string    `json:"product_name"`
	OpeningStock int       `json:"opening_stock"`
	StockIn      int       `json:"stock_in"`
	Expired      int       `json:"expired"`
	FOC          int       `json:"foc"`
	Sold         int       `json:"sold"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

var dailyStockSetupOnce sync.Once

func ensureDailyStockTable() {
	dailyStockSetupOnce.Do(func() {
		_, _ = configs.DB.Exec(`
			CREATE OR REPLACE FUNCTION update_updated_at_column()
			RETURNS TRIGGER AS $$
			BEGIN
			    NEW.updated_at = CURRENT_TIMESTAMP;
			    RETURN NEW;
			END;
			$$ LANGUAGE plpgsql;
		`)
		_, _ = configs.DB.Exec(`
			CREATE TABLE IF NOT EXISTS daily_stock_logs (
			    id SERIAL PRIMARY KEY,
			    log_date DATE NOT NULL,
			    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
			    opening_stock INTEGER NOT NULL DEFAULT 0,
			    stock_in INTEGER NOT NULL DEFAULT 0,
			    expired INTEGER NOT NULL DEFAULT 0,
			    foc INTEGER NOT NULL DEFAULT 0,
			    sold INTEGER NOT NULL DEFAULT 0,
			    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
			    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
			);
		`)
		_, _ = configs.DB.Exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_stock_logs_date_product ON daily_stock_logs(log_date, product_id);
		`)
		_, _ = configs.DB.Exec(`
			CREATE INDEX IF NOT EXISTS idx_daily_stock_logs_date ON daily_stock_logs(log_date);
		`)
		_, _ = configs.DB.Exec(`
			DROP TRIGGER IF EXISTS update_daily_stock_logs_updated_at ON daily_stock_logs;
			CREATE TRIGGER update_daily_stock_logs_updated_at
			    BEFORE UPDATE ON daily_stock_logs
			    FOR EACH ROW
			    EXECUTE FUNCTION update_updated_at_column();
		`)
	})
}

func TruncateDate(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func GetDailyStockLog(logDate time.Time, productID int) (*DailyStockLog, error) {
	ensureDailyStockTable()
	row := configs.DB.QueryRow(`
		SELECT d.id, d.log_date, d.product_id, p.name,
		       d.opening_stock, d.stock_in, d.expired, d.foc, d.sold,
		       d.created_at, d.updated_at
		FROM daily_stock_logs d
		LEFT JOIN products p ON p.id = d.product_id
		WHERE d.log_date = $1 AND d.product_id = $2
	`, logDate, productID)

	var log DailyStockLog
	err := row.Scan(
		&log.ID, &log.LogDate, &log.ProductID, &log.ProductName,
		&log.OpeningStock, &log.StockIn, &log.Expired, &log.FOC, &log.Sold,
		&log.CreatedAt, &log.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &log, nil
}

func GetDailySold(logDate time.Time, productID int) (int, error) {
	ensureDailyStockTable()
	row := configs.DB.QueryRow(`
		SELECT COALESCE(sold, 0)
		FROM daily_stock_logs
		WHERE log_date = $1 AND product_id = $2
	`, logDate, productID)
	var sold int
	if err := row.Scan(&sold); err != nil {
		return 0, err
	}
	return sold, nil
}

func EnsureDailyStockLog(logDate time.Time, productID int, openingStock int) error {
	ensureDailyStockTable()
	_, err := configs.DB.Exec(`
		INSERT INTO daily_stock_logs (log_date, product_id, opening_stock, stock_in, expired, foc, sold)
		VALUES ($1, $2, $3, 0, 0, 0, 0)
		ON CONFLICT (log_date, product_id) DO NOTHING
	`, logDate, productID, openingStock)
	return err
}

func AddDailyStockDeltas(logDate time.Time, productID int, stockIn, expired, foc, sold int) error {
	ensureDailyStockTable()
	_, err := configs.DB.Exec(`
		UPDATE daily_stock_logs
		SET stock_in = stock_in + $3,
		    expired = expired + $4,
		    foc = foc + $5,
		    sold = sold + $6,
		    updated_at = NOW()
		WHERE log_date = $1 AND product_id = $2
	`, logDate, productID, stockIn, expired, foc, sold)
	return err
}

func GetDailyStockLogsBetween(startDate, endDate time.Time) ([]DailyStockLog, error) {
	ensureDailyStockTable()
	rows, err := configs.DB.Query(`
		SELECT d.id, d.log_date, d.product_id, COALESCE(p.name, ''),
		       d.opening_stock, d.stock_in, d.expired, d.foc, d.sold,
		       d.created_at, d.updated_at
		FROM daily_stock_logs d
		LEFT JOIN products p ON p.id = d.product_id
		WHERE d.log_date >= $1 AND d.log_date <= $2
		ORDER BY d.log_date, p.name
	`, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []DailyStockLog
	for rows.Next() {
		var log DailyStockLog
		if err := rows.Scan(
			&log.ID, &log.LogDate, &log.ProductID, &log.ProductName,
			&log.OpeningStock, &log.StockIn, &log.Expired, &log.FOC, &log.Sold,
			&log.CreatedAt, &log.UpdatedAt,
		); err != nil {
			continue
		}
		logs = append(logs, log)
	}
	return logs, nil
}
