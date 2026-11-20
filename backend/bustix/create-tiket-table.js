/**
 * Script: Buat tabel tiket_perjalanan di Supabase PostgreSQL
 * Jalankan: node create-tiket-table.js
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

async function createTable() {
  const client = await pool.connect();
  try {
    console.log('=== MEMBUAT TABEL tiket_perjalanan ===');

    await client.query(`
      CREATE TABLE IF NOT EXISTS tiket_perjalanan (
        id                SERIAL PRIMARY KEY,
        nama_penumpang    VARCHAR(200)  NOT NULL,
        no_identitas      VARCHAR(50)   NOT NULL,
        asal_kota         VARCHAR(200)  NOT NULL,
        tujuan_kota       VARCHAR(200)  NOT NULL,
        tanggal_berangkat DATE          NOT NULL,
        kelas_layanan     VARCHAR(50)   NOT NULL DEFAULT 'Eksekutif',
        status_pemesanan  VARCHAR(50)   NOT NULL DEFAULT 'terkonfirmasi',
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);

    console.log('✅ Tabel tiket_perjalanan berhasil dibuat (atau sudah ada).');

    // Tampilkan struktur tabel
    const cols = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'tiket_perjalanan'
      ORDER BY ordinal_position;
    `);

    console.log('\n📋 Struktur Tabel tiket_perjalanan:');
    console.table(cols.rows);

    // Cek apakah ada data
    const count = await client.query('SELECT COUNT(*) FROM tiket_perjalanan');
    console.log(`\n📊 Total data saat ini: ${count.rows[0].count} baris`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

createTable();
