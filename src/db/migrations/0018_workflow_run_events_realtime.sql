-- Migration 0018: enable Supabase Realtime publication on workflow_run_events.
--
-- The UI subscribes to INSERT events on this table (filtered by run_id)
-- to stream run progress without polling. The channel filter in the client
-- is: channel('run:{run_id}').on('postgres_changes', { event: 'INSERT',
-- schema: 'public', table: 'workflow_run_events', filter: 'run_id=eq.{run_id}' })
--
-- Requires postgres superuser — applied via Supabase MCP rather than
-- drizzle-kit push (hosted environments block ALTER PUBLICATION for the
-- `anon` / `authenticator` roles).
--
-- Applied: mcp__plugin_supabase_supabase__apply_migration on project locus
-- (wvobnayfskzegvrniomq) with migration name "workflow_run_events_realtime".

ALTER PUBLICATION supabase_realtime ADD TABLE workflow_run_events;
