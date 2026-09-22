-- ============================================================
-- Maintenance requests — add created_by (who filed the request)
-- separately from user_id (the boarder the issue is about).
--
-- Lets staff file a maintenance request on behalf of a boarder:
--   user_id    = the boarder the request is for ("Requested By")
--   created_by = whoever submitted it ("Created By" — the boarder
--                themselves, or the staff member who filed it for them)
--
-- Run this once against your Postgres database.
-- Safe to re-run (idempotent).
-- ============================================================

BEGIN;

ALTER TABLE maintenance_requests
    ADD COLUMN IF NOT EXISTS created_by INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Back-fill existing rows: until now every request was filed by
-- the boarder it belongs to, so created_by = user_id.
-- ------------------------------------------------------------
UPDATE maintenance_requests
SET created_by = user_id
WHERE created_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_created_by
    ON maintenance_requests(created_by);

COMMIT;
