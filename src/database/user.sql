CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  contact_number VARCHAR(20),
  address TEXT,
  password TEXT NOT NULL,
  avatar_url TEXT, 
  is_assigned BOOLEAN DEFAULT FALSE,
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('Admin', 'Staff', 'Boarder')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();