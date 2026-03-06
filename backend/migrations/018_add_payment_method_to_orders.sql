-- Migration: Add payment_method column to orders table
-- This enables direct querying for COD vs scan payment orders
-- Date: 2026-03-01

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'cash';

-- Backfill existing orders: if a payment record exists with scan method, mark as scan
UPDATE orders SET payment_method = 'scan'
WHERE id IN (
    SELECT DISTINCT order_id FROM payments WHERE LOWER(method) IN ('kpay', 'wave', 'manual_upload')
)
AND (payment_method IS NULL OR payment_method = 'cash');

-- Also mark orders with pending_payment/pending_verification status as scan
UPDATE orders SET payment_method = 'scan'
WHERE status IN ('pending_payment', 'pending_verification')
AND (payment_method IS NULL OR payment_method = 'cash');
