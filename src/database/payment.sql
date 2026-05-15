CREATE TABLE payments (
  id SERIAL PRIMARY KEY,

  boarder_id INTEGER NOT NULL 
    REFERENCES boarders(id) ON DELETE CASCADE,

  amount DECIMAL(10,2) NOT NULL,
  due_date DATE NOT NULL,

  status VARCHAR(20) DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Paid', 'Overdue')),

  paid_at TIMESTAMP,

  penalty_amount DECIMAL(10,2) DEFAULT 0,

  reminder_1day_sent BOOLEAN DEFAULT FALSE,
  reminder_due_sent BOOLEAN DEFAULT FALSE,
  reminder_overdue_sent BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);