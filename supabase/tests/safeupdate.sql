-- LOCAL Supabase PostgreSQL only; requires its preinstalled safeupdate library
-- and a disposable database initialized with bootstrap.sql and the migration.
-- Run as local supabase_admin; never disable safeupdate to make RPC saves pass.
load 'safeupdate';
show safeupdate.enabled;
\ir security.sql
\ir tool_metadata.sql
