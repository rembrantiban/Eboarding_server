
CREATE TABLE users (
  id SERIAL PRIMARY KEY,

  user_id_no VARCHAR(8) UNIQUE NOT NULL,

  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,

  email VARCHAR(150) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,

  country_code VARCHAR(10),
  contact_number VARCHAR(20),
  
  nationality VARCHAR(100),
  address TEXT,

  password TEXT NOT NULL,

  avatar_url TEXT,

  gender VARCHAR(20)
    CHECK (gender IN ('Male', 'Female')),

  age INT
    CHECK (age >= 0),
    
  valid_id_type VARCHAR(50),
  valid_id_image TEXT,
  valid_id_status VARCHAR(20)
  DEFAULT 'Under Review'
  CHECK (
      valid_id_status IN (
          'Under Review',
          'Approved',
          'Rejected'
      )
  ),

valid_id_rejection_reason TEXT,
valid_id_verified_by INT,
is_verified BOOLEAN NOT NULL DEFAULT FALSE,

-- Emergency Contact

emergency_contact_name VARCHAR(100),
  emergency_contact_number VARCHAR(20),
  emergency_contact_relationship VARCHAR(50),

  is_assigned BOOLEAN DEFAULT FALSE,

  user_type VARCHAR(20)
    NOT NULL
    CHECK (user_type IN ('Admin', 'Staff', 'Boarder')),

  status VARCHAR(20)
    NOT NULL
    DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),

  account_status VARCHAR(20)
  NOT NULL
  DEFAULT 'Active'
  CHECK (account_status IN ('Active', 'Deactivate')),
  reset_code VARCHAR(10),
  reset_code_expiry TIMESTAMP
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP,
  deleted_by INT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION generate_user_id_no()
RETURNS BIGINT AS $$
DECLARE
    new_id BIGINT;
BEGIN
    LOOP
        -- Generate a random 8-digit number
        new_id := FLOOR(10000000 + RANDOM() * 90000000);

        -- Exit if it doesn't already exist
        EXIT WHEN NOT EXISTS (
            SELECT 1
            FROM users
            WHERE user_id_no = new_id
        );
    END LOOP;

    RETURN new_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_user_id_no()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_id_no IS NULL THEN
        NEW.user_id_no := generate_user_id_no();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generate_user_id_trigger
BEFORE INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION set_user_id_no();