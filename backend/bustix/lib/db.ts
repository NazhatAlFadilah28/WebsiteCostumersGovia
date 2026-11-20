import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';

// PostgreSQL Connection Pool using DATABASE_URL environment variable
const connectionString = process.env.DATABASE_URL || '';

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  max: 4,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 15000,
});

// Helper for executing SQL queries
export async function query(text: string, params?: unknown[]) {
  const res = await pool.query(text, params);
  return res;
}

// Supabase Client initialization
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
