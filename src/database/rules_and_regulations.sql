CREATE TABLE rules_and_regulations (
    id SERIAL PRIMARY KEY,

    title VARCHAR(255) NOT NULL,

    description TEXT NOT NULL,

    status VARCHAR(20) NOT NULL
        DEFAULT 'Unpublished'
        CHECK (
            status IN (
                'Published',
                'Unpublished'
            )
        ),

    created_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);