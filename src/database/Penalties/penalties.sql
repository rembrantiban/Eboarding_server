CREATE TABLE penalties (
    id SERIAL PRIMARY KEY,

    penalty_rule_id INTEGER
        REFERENCES penalty_rules(id)
        ON DELETE SET NULL,

    boarder_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    assigned_by INTEGER NOT NULL
        REFERENCES users(id),

    penalty_date DATE NOT NULL DEFAULT CURRENT_DATE,

    amount DECIMAL(10,2) NOT NULL
        CHECK (amount >= 0),
    
    is_deleted BOOLEAN DEFAULT FALSE,

    reason TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (
            status IN (
                'Pending',
                'Partially Paid',
                'Paid',
                'Waived'
            )
        ),

    due_date DATE,
    amount_paid DECIMAL(10,2) DEFAULT 0,

    settled_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Run this if the table already exists:
-- ALTER TABLE penalties ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP;