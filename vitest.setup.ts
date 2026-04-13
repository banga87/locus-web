import '@testing-library/jest-dom/vitest';
import { config } from 'dotenv';

// Load .env.test if present; falls back silently when the file is absent.
config({ path: '.env.test' });
