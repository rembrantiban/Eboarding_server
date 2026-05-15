CREATE TABLE boarders (
  id SERIAL PRIMARY KEY,

  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  room_id INTEGER NOT NULL
    REFERENCES rooms(id) ON DELETE CASCADE,

  bed_id INTEGER NOT NULL
    REFERENCES beds(id) ON DELETE CASCADE,

  assigned_by INTEGER
    REFERENCES users(id) ON DELETE SET NULL,

  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,

  status VARCHAR(20) DEFAULT 'Active'
    CHECK (status IN ('Active', 'Completed')),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);