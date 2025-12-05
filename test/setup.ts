import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.test file before tests run (uses mock services)
config({ path: resolve(__dirname, '../.env.test') });
