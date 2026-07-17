CREATE TABLE billing_payments (
    id SERIAL PRIMARY KEY,
    billing_id INT NOT NULL REFERENCES billings(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    received_by INT NOT NULL REFERENCES users(id),
    received_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_payments_billing
ON billing_payments(billing_id);