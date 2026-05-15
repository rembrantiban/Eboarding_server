CREATE TABLE beds (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  bed_number VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'Available'
    CHECK (status IN ('Available', 'Occupied')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

{/* Implement automatic updates when assigning/removing boarders.*/}  
TRUNCATE TABLE payments, boarders RESTART IDENTITY CASCADE;
UPDATE beds SET status = 'Available';