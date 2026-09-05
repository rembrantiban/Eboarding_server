-- ============================================================
-- Maintenance requests — rename status "Completed" to "Resolved"
-- Run this once against your Postgres database.
-- Safe to re-run (idempotent).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Drop the old CHECK constraint (default Postgres-generated name)
-- so the UPDATE below isn't rejected.
-- ------------------------------------------------------------
ALTER TABLE maintenance_requests
    DROP CONSTRAINT IF EXISTS maintenance_requests_status_check;

-- ------------------------------------------------------------
-- Back-fill existing rows to the new status value.
-- ------------------------------------------------------------
UPDATE maintenance_requests
SET status = 'Resolved'
WHERE status = 'Completed';

-- ------------------------------------------------------------
-- Re-add the constraint with "Resolved" instead of "Completed".
-- ------------------------------------------------------------
ALTER TABLE maintenance_requests
    ADD CONSTRAINT maintenance_requests_status_check
    CHECK (
        status IN (
            'Pending',
            'In Progress',
            'Resolved',
            'Closed'
        )
    );

COMMIT;
