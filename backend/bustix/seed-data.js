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

async function seedDatabase() {
  const client = await pool.connect();
  try {
    console.log('=== MEMULAI SEEDING DATA MASTER BUSTIX ===');
    await client.query('BEGIN');

    // 1. Insert Cities
    console.log('1. Seeding Cities...');
    const cityList = [
      ['Jakarta', 'Terminal Terpadu Pulo Gebang'],
      ['Surabaya', 'Terminal Bungurasih (Purabaya)'],
      ['Yogyakarta', 'Terminal Giwangan'],
      ['Semarang', 'Terminal Mangkang'],
      ['Solo', 'Terminal Tirtonadi'],
      ['Bandung', 'Terminal Leuwipanjang']
    ];

    for (const [kota, term] of cityList) {
      const exist = await client.query('SELECT id FROM cities WHERE nama_kota = $1', [kota]);
      if (exist.rows.length === 0) {
        await client.query('INSERT INTO cities (nama_kota, nama_terminal) VALUES ($1, $2)', [kota, term]);
      }
    }

    const allCities = (await client.query('SELECT id, nama_kota FROM cities')).rows;
    const getCityId = (name) => allCities.find(c => c.nama_kota.toLowerCase() === name.toLowerCase())?.id;

    const jktId = getCityId('Jakarta');
    const sbyId = getCityId('Surabaya');
    const ygyId = getCityId('Yogyakarta');
    const smgId = getCityId('Semarang');
    const sloId = getCityId('Solo');
    const bdgId = getCityId('Bandung');

    // 2. Insert Routes
    console.log('2. Seeding Routes...');
    const routePairs = [
      [jktId, sbyId], [sbyId, jktId],
      [jktId, ygyId], [ygyId, jktId],
      [jktId, smgId], [smgId, jktId],
      [jktId, sloId], [sloId, jktId],
      [bdgId, sbyId], [sbyId, bdgId]
    ];

    for (const [asal, tujuan] of routePairs) {
      if (asal && tujuan) {
        const exist = await client.query('SELECT id FROM routes WHERE asal_id = $1 AND tujuan_id = $2', [asal, tujuan]);
        if (exist.rows.length === 0) {
          await client.query('INSERT INTO routes (asal_id, tujuan_id) VALUES ($1, $2)', [asal, tujuan]);
        }
      }
    }

    const allRoutes = (await client.query('SELECT id, asal_id, tujuan_id FROM routes')).rows;
    const jktSbyRoute = allRoutes.find(r => r.asal_id === jktId && r.tujuan_id === sbyId)?.id;

    // 3. Insert Buses
    console.log('3. Seeding Buses...');
    const busList = [
      ['Nusantara Trans Double Decker', 'B 7123 NTA', 'eksekutif', 32, 'aktif'],
      ['Royal Dream Suite Class', 'B 7999 RYD', 'sleeper', 20, 'aktif'],
      ['Sinar Kencana Super Top', 'B 7456 SKC', 'eksekutif', 30, 'aktif'],
      ['Harapan Jaya Mandiri AC', 'B 7888 HJM', 'bisnis', 36, 'aktif']
    ];

    for (const [nama, plat, kelas, kap, st] of busList) {
      const exist = await client.query('SELECT id FROM buses WHERE plat_nomor = $1', [plat]);
      if (exist.rows.length === 0) {
        await client.query('INSERT INTO buses (nama_bus, plat_nomor, kelas, kapasitas, status) VALUES ($1, $2, $3, $4, $5)', [nama, plat, kelas, kap, st]);
      }
    }

    const allBuses = (await client.query('SELECT id, nama_bus, kapasitas FROM buses')).rows;

    // 4. Insert Seats untuk setiap bus (disesuaikan dengan kapasitas masing-masing bus)
    console.log('4. Seeding Seats for buses...');
    const ALL_POSSIBLE_SEATS = [
      '1A','1B','1C','1D',
      '2A','2B','2C','2D',
      '3A','3B','3C','3D',
      '4A','4B','4C','4D',
      '5A','5B','5C','5D',
      '6A','6B','6C','6D',
      '7A','7B','7C','7D',
      '8A','8B','8C','8D',
      '9A','9B','9C','9D',
      '10A','10B','10C','10D'
    ];
    for (const bus of allBuses) {
      const existingSeats = (await client.query('SELECT nomor_kursi FROM seats WHERE bus_id = $1', [bus.id])).rows.map(r => r.nomor_kursi);
      const seatCodes = ALL_POSSIBLE_SEATS.slice(0, bus.kapasitas);
      for (const code of seatCodes) {
        if (!existingSeats.includes(code)) {
          await client.query('INSERT INTO seats (bus_id, nomor_kursi) VALUES ($1, $2)', [bus.id, code]);
        }
      }
    }

    // 5. Insert Schedules (Jadwal Keberangkatan Semua Arah Kota Asal & Tujuan)
    console.log('5. Seeding Schedules for all routes...');
    const bus1 = allBuses[0]?.id; // Nusantara Trans Double Decker (eksekutif, 32)
    const bus2 = allBuses[1]?.id; // Royal Dream Suite Class (sleeper, 20)
    const bus3 = allBuses[2]?.id; // Sinar Kencana Super Top (eksekutif, 30)
    const bus4 = allBuses[3]?.id; // Harapan Jaya Mandiri AC (bisnis, 36)

    const cityById = Object.fromEntries(
      (await client.query('SELECT id, nama_kota, nama_terminal FROM cities')).rows.map(c => [c.id, c])
    );

    for (const route of allRoutes) {
      const schedExist = await client.query('SELECT id FROM schedules WHERE route_id = $1', [route.id]);
      if (schedExist.rows.length === 0 && bus1 && bus2 && bus3 && bus4) {
        const asalTerm = cityById[route.asal_id]?.nama_terminal || 'Terminal Keberangkatan';
        await client.query(`
          INSERT INTO schedules (bus_id, route_id, tanggal_berangkat, jam_berangkat, jam_tiba, harga, status, status_perjalanan, lokasi_terakhir) VALUES
          ($1, $2, CURRENT_DATE, '07:30:00', '16:45:00', 385000, 'aktif', 'terjadwal', $6),
          ($3, $2, CURRENT_DATE, '14:00:00', '23:15:00', 327500, 'aktif', 'terjadwal', $7),
          ($4, $2, CURRENT_DATE, '19:30:00', '05:00:00', 525000, 'aktif', 'terjadwal', $8),
          ($5, $2, CURRENT_DATE, '20:45:00', '06:30:00', 295000, 'aktif', 'terjadwal', $9)
        `, [
          bus1,
          route.id,
          bus3,
          bus2,
          bus4,
          `${asalTerm} - Jalur 04`,
          `${asalTerm} - Jalur 07`,
          `${asalTerm} - Jalur 01 VIP`,
          `${asalTerm} - Jalur 09`,
        ]);
      }
    }

    await client.query('COMMIT');
    console.log('=== SEEDING MASTER DATA BERHASIL 100% ===');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('SEEDING GAGAL:', err);
  } finally {
    client.release();
    pool.end();
  }
}

seedDatabase();
