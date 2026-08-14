CREATE TABLE billing_payments (
    id SERIAL PRIMARY KEY,

    billing_id INT NOT NULL
        REFERENCES billings(id)
        ON DELETE CASCADE,

    amount DECIMAL(10,2) NOT NULL,

    status VARCHAR(20) NOT NULL
    CHECK (
        status IN (
            'Pending',
            'Partial',
            'Paid',
            'Overdue',
            'Cancelled'
        )
    ),

    reason VARCHAR(255),
    notes TEXT,
    received_by INT NOT NULL
        REFERENCES users(id),

    received_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_payments_billing
ON billing_payments(billing_id);