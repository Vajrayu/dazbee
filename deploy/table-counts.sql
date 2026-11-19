-- Prints each table's row count as `<schema>.<table> <count>`, one line per table, in name order:
-- backup.sh records it beside a dump, in the dump's snapshot, and restore.sh checks a restore by it.
-- Run it with psql -X -q -t -A.
SELECT format(
  'SELECT %L || '' '' || count(*) FROM %I.%I',
  format('%I.%I', n.nspname, c.relname), n.nspname, c.relname
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname <> 'information_schema'
  AND n.nspname NOT LIKE 'pg\_%'
ORDER BY n.nspname, c.relname
\gexec
