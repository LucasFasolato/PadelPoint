-- Map a Postgres constraint name to table + definition.
SELECT
  conname,
  conrelid::regclass AS table_name,
  pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
WHERE conname = 'REL_6a6e2e2804aaf5d2fa7d83f8fa';
