CREATE TABLE billings (
    id SERIAL PRIMARY KEY,
    billing_no VARCHAR(50) UNIQUE NOT NULL,
    room_number VARCHAR(50),
    bed_number VARCHAR(50),
    user_id INT NOT NULL REFERENCES users (id),
    assignment_id INT REFERENCES room_assignments (id),
    billing_type VARCHAR(30) NOT NULL DEFAULT 'Monthly Rent',
    billing_month DATE,
    due_date DATE NOT NULL,
    room_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
    utilities_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
    other_charges DECIMAL(10, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    late_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(10, 2) NOT NULL,
    paid_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    balance DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (
        status IN (
            'Upcoming',
            'Pending',
            'Partial',
            'Paid',
            'Overdue',
            'Cancelled'
        )
    ),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);