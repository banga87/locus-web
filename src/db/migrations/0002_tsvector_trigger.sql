-- Migration 0002: tsvector trigger for documents.search_vector
--
-- Drizzle does not manage Postgres triggers, so this migration is
-- hand-written and applied via scripts/apply-custom-migrations.ts
-- after drizzle-kit push has installed the base schema.
--
-- The trigger keeps documents.search_vector in sync with title + content
-- on every INSERT and content-affecting UPDATE. Title is weighted higher
-- (weight A) than content (weight B) so title matches rank higher.
-- The search_brain tool queries this column with plainto_tsquery +
-- ts_rank, backed by the GIN index created in 0001_initial_schema.sql.

CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DROP first so re-running this migration is idempotent. CREATE OR REPLACE
-- TRIGGER exists only on Postgres 14+; this DROP+CREATE pattern works
-- everywhere.
DROP TRIGGER IF EXISTS documents_search_vector_trigger ON documents;
CREATE TRIGGER documents_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, content ON documents
  FOR EACH ROW
  EXECUTE FUNCTION documents_search_vector_update();
