CREATE TABLE IF NOT EXISTS rule_acknowledgments (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL,

    acknowledged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_rule_acknowledgment_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_rule_acknowledgment_user
        UNIQUE (user_id)
);
