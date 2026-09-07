import { Pool } from 'pg';

export const db = new Pool({
  user: 'admin',
  password: 'password',
  host: 'localhost',
  port: 5432,
  database: 'telemetria',
});
