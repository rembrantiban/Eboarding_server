CREATE TABLE IF NOT EXISTS penalty_rules (
    id SERIAL PRIMARY KEY,

    penalty_name VARCHAR(150) NOT NULL,
    description TEXT,

    amount DECIMAL(10,2) NOT NULL
        CHECK (amount >= 0),

    is_active BOOLEAN DEFAULT TRUE,

    created_by INTEGER
        REFERENCES users(id),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);