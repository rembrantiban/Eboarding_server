CREATE TABLE room_assignments (
    id SERIAL PRIMARY KEY,

    boarder_id INTEGER NOT NULL
        REFERENCES boarders(id) ON DELETE CASCADE,

    room_id INTEGER NOT NULL
        REFERENCES rooms(id) ON DELETE CASCADE,

    bed_id INTEGER NOT NULL
        REFERENCES beds(id) ON DELETE CASCADE,

    assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,

    expected_checkout DATE,

    actual_checkout DATE,

    status VARCHAR(20) NOT NULL DEFAULT 'Active'
        CHECK (
            status IN (
                'Active',
                'Transferred',
                'Checked-Out'
            )
        ),

    assigned_by INTEGER
        REFERENCES users(id),

    remarks TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX idx_room_assignments_boarder
ON room_assignments(boarder_id);

CREATE INDEX idx_room_assignments_room
ON room_assignments(room_id);

CREATE INDEX idx_room_assignments_status
ON room_assignments(status);

CREATE UNIQUE INDEX uq_boarder_active_room
ON room_assignments(boarder_id)
WHERE status = 'Active';