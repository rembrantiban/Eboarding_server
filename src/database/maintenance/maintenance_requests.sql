CREATE TABLE IF NOT EXISTS maintenance_requests (
    id SERIAL PRIMARY KEY,

    request_number VARCHAR(30) UNIQUE NOT NULL,

    -- The boarder the issue is about (drives "Requested By").
    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    -- Who filed the request (self for a boarder; the staff member when filed on a boarder's behalf).
    created_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

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
                'Resolved',
                'Closed'
            )
        ),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);