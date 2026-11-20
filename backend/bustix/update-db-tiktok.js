/**
 * Script: Tambah kolom TikTok (tiktok_id, tiktok_username, tiktok_avatar) ke database PostgreSQL
 * Jalankan: node update-db-tiktok.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('DATABASE_URL belum diatur di environment atau .env');
}

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  ssl: { rejectUnauthorized: false }
});

async function updateDB() {
  const client = await pool.connect();
  try {
    console.log('=== MEMPERBARUI TABEL CUSTOMERS UNTUK TIKTOK LOGIN ===');

    await client.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS tiktok_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS tiktok_username VARCHAR(255),
      ADD COLUMN IF NOT EXISTS tiktok_avatar TEXT;
    `);

    console.log('✅ Update tabel customers dengan kolom TikTok berhasil!');

    const cols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'customers'
      ORDER BY ordinal_position;
    `);
    console.table(cols.rows);
  } catch (err) {
    console.error('❌ Error updating DB:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

updateDB();

