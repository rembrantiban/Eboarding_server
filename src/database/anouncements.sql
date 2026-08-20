CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'General' CHECK (
        category IN (
            'General',
            'Maintenance',
            'Billing'
        )
    ),
    audience VARCHAR(20) NOT NULL DEFAULT 'Boarders' CHECK (
        audience IN ('Boarders', 'Staff', 'All')
    ),
    status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (
        status IN ('Active', 'Archived')
    ),
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_announcement_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
);