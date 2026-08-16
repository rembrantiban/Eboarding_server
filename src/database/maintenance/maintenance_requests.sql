CREATE TABLE maintenance_requests (
    id SERIAL PRIMARY KEY,

    request_number VARCHAR(30) UNIQUE NOT NULL,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    room_id INTEGER NOT NULL
        REFERENCES rooms(id)
        ON DELETE CASCADE,

    category VARCHAR(100) NOT NULL,

    description TEXT NOT NULL,

    image_url TEXT,

    assigned_staff_id INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'Pending'
        CHECK (
            status IN (
                'Pending',
                'In Progress',
                'Completed',
                'Closed'
            )
        ),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);