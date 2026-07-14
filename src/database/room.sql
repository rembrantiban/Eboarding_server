CREATE TABLE rooms (
    id SERIAL PRIMARY KEY,

    room_number VARCHAR(50) UNIQUE NOT NULL,

    capacity INTEGER NOT NULL
        CHECK (capacity > 0),

    price_per_month DECIMAL(10,2) NOT NULL
        CHECK (price_per_month >= 0),

    status VARCHAR(20) NOT NULL
        DEFAULT 'Available'
        CHECK (
            status IN (
                'Available',
                'Occupied',
                'Under Maintenance'
            )
        ),

    description TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_rooms_status
ON rooms(status);

CREATE INDEX idx_rooms_price
ON rooms(price_per_month);

-- Auto update updated_at
CREATE OR REPLACE FUNCTION update_rooms_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rooms_updated_at
BEFORE UPDATE ON rooms
FOR EACH ROW
EXECUTE FUNCTION update_rooms_updated_at_column();

{/* Implement automatic updates when assigning/removing boarders.*/}  

TRUNCATE TABLE payments, boarders RESTART IDENTITY CASCADE;

UPDATE beds SET status = 'Available';
UPDATE rooms SET status = 'Available';