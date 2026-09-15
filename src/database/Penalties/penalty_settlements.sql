CREATE TABLE IF NOT EXISTS penalty_settlements (
    id SERIAL PRIMARY KEY,

    penalty_id INTEGER NOT NULL
        REFERENCES penalties(id)
        ON DELETE CASCADE,

    amount_paid DECIMAL(10,2) NOT NULL
        CHECK (amount_paid > 0),

    payment_date DATE DEFAULT CURRENT_DATE,

    payment_method VARCHAR(50),

    payment_reference VARCHAR(100),

    remarks TEXT,

    received_by INTEGER
        REFERENCES users(id),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Run this if the table already exists with the old (invalid) definition:
-- ALTER TABLE penalty_settlements ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);
