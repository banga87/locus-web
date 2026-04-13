import '@testing-library/jest-dom/vitest';
import { config } from 'dotenv';

// Load base .env first (DATABASE_URL, SUPABASE_URL, etc.).
// Then overlay .env.test if present so tests can override individual values.
config({ path: '.env' });
config({ path: '.env.test', override: true });
