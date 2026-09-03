CREATE TABLE penalty_settlements (
    id SERIAL PRIMARY KEY,

    penalty_id INTEGER NOT NULL
        REFERENCES penalties(id)
        ON DELETE CASCADE,

    amount_paid DECIMAL(10,2) NOT NULL,

    payment_date DATE DEFAULT CURRENT_DATE,

    payment_method VARCHAR(50),

    remarks TEXT,

    received_by INTEGER
        REFERENCES users(id),

    settled_at TIMESTAMP;
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);