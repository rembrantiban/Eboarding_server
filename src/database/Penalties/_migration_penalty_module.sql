-- ============================================================
-- Penalty Management Module — schema migration
-- Run this once against your Postgres database.
-- Safe to re-run (idempotent).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- penalties: track when a penalty was fully settled or waived
-- ------------------------------------------------------------
ALTER TABLE penalties
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP;

-- ------------------------------------------------------------
-- 5.7  penalty_settlements
-- The original script had a syntax error (";" instead of ",")
-- so the table may never have been created. This rebuilds it
-- with a valid definition and back-fills missing columns.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS penalty_settlements (
    id SERIAL PRIMARY KEY,

    penalty_id INTEGER NOT NULL
        REFERENCES penalties(id) ON DELETE CASCADE,

    amount_paid DECIMAL(10,2) NOT NULL CHECK (amount_paid > 0),

    payment_date DATE DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    remarks TEXT,

    received_by INTEGER REFERENCES users(id),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE penalty_settlements
    ADD COLUMN IF NOT EXISTS payment_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE penalty_settlements
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE penalty_settlements
    ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);
ALTER TABLE penalty_settlements
    ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE penalty_settlements
    ADD COLUMN IF NOT EXISTS received_by INTEGER REFERENCES users(id);

-- ------------------------------------------------------------
-- Helpful indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_penalty_settlements_penalty_id
    ON penalty_settlements(penalty_id);
CREATE INDEX IF NOT EXISTS idx_penalties_boarder_id
    ON penalties(boarder_id);
CREATE INDEX IF NOT EXISTS idx_penalties_status
    ON penalties(status);

COMMIT;
