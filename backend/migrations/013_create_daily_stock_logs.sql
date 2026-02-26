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

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_stock_logs_date_product ON daily_stock_logs(log_date, product_id);
CREATE INDEX IF NOT EXISTS idx_daily_stock_logs_date ON daily_stock_logs(log_date);

DROP TRIGGER IF EXISTS update_daily_stock_logs_updated_at ON daily_stock_logs;
CREATE TRIGGER update_daily_stock_logs_updated_at
    BEFORE UPDATE ON daily_stock_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
