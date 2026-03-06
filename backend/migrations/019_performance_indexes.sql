-- Migration: Add missing performance indexes
-- Date: 2026-03-02
-- Fixes slow queries caused by missing indexes on critical tables

-- 🔴 P0: payments table has ZERO indexes — every payment lookup is a full table scan
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id_created ON payments(order_id, created_at DESC);

-- 🟠 P1: orders(sender_id, status) — used by every user-facing order check
-- The existing idx_orders_sender_id is single-column, can't filter by status efficiently
CREATE INDEX IF NOT EXISTS idx_orders_sender_status ON orders(sender_id, status);

-- 🟠 P1: orders(status, id DESC) — used by admin dashboard listing/pagination
CREATE INDEX IF NOT EXISTS idx_orders_status_id ON orders(status, id DESC);

-- 🟡 P2: order_items product_id column for direct product lookups (avoid fuzzy LIKE matching)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id INT REFERENCES products(id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- Backfill product_id for existing order_items using exact name match
UPDATE order_items oi
SET product_id = p.id
FROM products p
WHERE oi.product_id IS NULL
  AND p.deleted_at IS NULL
  AND LOWER(p.name) = LOWER(oi.product);

-- 🟡 P2: products partial index for active-only queries
CREATE INDEX IF NOT EXISTS idx_products_active ON products(id) WHERE deleted_at IS NULL;
