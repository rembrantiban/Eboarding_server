CREATE TABLE IF NOT EXISTS maintenance_history (
    id SERIAL PRIMARY KEY,

    maintenance_id INTEGER NOT NULL
        REFERENCES maintenance_requests(id)
        ON DELETE CASCADE,

    status VARCHAR(30) NOT NULL,

    remarks TEXT,

    updated_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);