import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file before tests run
config({ path: resolve(__dirname, '../.env') });
