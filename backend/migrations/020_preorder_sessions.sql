-- Migration: Preorder payment sessions (pay-before-order for custom cakes)
-- Date: 2026-03-02
-- Purpose: Custom cake orders require payment BEFORE order creation.
--          A session holds the order data + payment proof for 30 minutes.
--          Admin verifies payment → system creates the real order.

CREATE TABLE IF NOT EXISTS preorder_sessions (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,                           -- Messenger PSID
    items           JSONB NOT NULL DEFAULT '[]',             -- cart items array
    customer_name   TEXT NOT NULL DEFAULT '',
    customer_phone  TEXT NOT NULL DEFAULT '',
    delivery_type   TEXT NOT NULL DEFAULT 'pickup',
    address         TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    schedule_date   TEXT NOT NULL DEFAULT '',                -- e.g. 2026-03-05
    schedule_time   TEXT NOT NULL DEFAULT '',                -- e.g. 14:00
    total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_proof   TEXT,                                    -- Cloudinary URL
    payment_status  TEXT NOT NULL DEFAULT 'awaiting_payment', -- awaiting_payment | proof_uploaded | verified | rejected | expired
    order_id        INT REFERENCES orders(id),               -- set when order is created after verification
    expires_at      TIMESTAMPTZ NOT NULL,                    -- 30 minutes from creation
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user lookups (active sessions)
CREATE INDEX IF NOT EXISTS idx_preorder_sessions_user ON preorder_sessions(user_id, payment_status);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_preorder_sessions_expires ON preorder_sessions(expires_at) WHERE payment_status IN ('awaiting_payment', 'proof_uploaded');
