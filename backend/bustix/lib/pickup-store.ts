import { query } from './db';

export type PickupStatus =
  | 'Menunggu Konfirmasi'
  | 'Disetujui'
  | 'Ditolak'
  | 'Bus Menuju Lokasi'
  | 'Bus Telah Tiba'
  | 'Customer Telah Dijemput';

export interface AllowedPickupPoint {
  id: string;
  nama_lokasi: string;
  kategori: 'SPBU' | 'Minimarket' | 'Rest Area / Exit Tol' | 'Halte / Tempat Umum' | 'Pinggir Jalan Aman';
  kota: string;
  alamat: string;
  lat: number;
  lng: number;
  jarak_rute_km: number;
  estimasi_menit_dari_terminal: number;
  biaya_tambahan: number;
  catatan_keamanan: string;
  aktif: boolean;
}

export interface PickupRequestItem {
  id: string;
  kode_booking: string;
  schedule_id: string;
  customer_id: string | number;
  nama_customer: string;
  no_hp: string;
  tipe_keberangkatan: 'terminal' | 'pickup';
  nama_lokasi: string;
  kategori_lokasi: string;
  alamat_lengkap: string;
  lat: number;
  lng: number;
  jarak_ke_rute_km: number;
  estimasi_bus_tiba: string;
  status_validasi: 'valid' | 'perlu_review' | 'terlalu_jauh';
  status_penjemputan: PickupStatus;
  biaya_tambahan: number;
  catatan_customer?: string;
  catatan_admin?: string;
  catatan_staf_sopir?: string;
  rute_asal: string;
  rute_tujuan: string;
  nama_bus: string;
  plat_nomor: string;
  nomor_kursi: string;
  created_at: string;
  updated_at: string;
}

// Koordinat Koridor Jalur Operasional Bus AKAP (Lintas Trans-Jawa & Cipularang)
export const BUS_ROUTE_CORRIDORS: Record<string, Array<{ name: string; lat: number; lng: number; offsetMins: number }>> = {
  'jakarta-surabaya': [
    { name: 'Terminal Terpadu Pulo Gebang (Jakarta)', lat: -6.21345, lng: 106.95325, offsetMins: 0 },
    { name: 'Exit Tol Bekasi Timur / Bulak Kapal', lat: -6.2562, lng: 107.0185, offsetMins: 25 },
    { name: 'SPBU & Rest Area KM 19A Tol Jakarta-Cikampek', lat: -6.2715, lng: 107.0548, offsetMins: 35 },
    { name: 'Simpang Jomin / Exit Tol Cikopo Cikampek', lat: -6.4125, lng: 107.4582, offsetMins: 75 },
    { name: 'Rest Area KM 207A Palikanci Cirebon', lat: -6.7689, lng: 108.5321, offsetMins: 195 },
    { name: 'Exit Tol Krapyak / Kalikangkung Semarang', lat: -6.9854, lng: 110.3542, offsetMins: 360 },
    { name: 'Simpang Susun Colomadu / Tirtonadi Solo', lat: -7.5412, lng: 110.7854, offsetMins: 430 },
    { name: 'Exit Tol Warugunung / Terminal Purabaya Surabaya', lat: -7.35123, lng: 112.72478, offsetMins: 600 },
  ],
  'surabaya-jakarta': [
    { name: 'Terminal Purabaya Bungurasih (Surabaya)', lat: -7.35123, lng: 112.72478, offsetMins: 0 },
    { name: 'Gerbang Tol Warugunung / Karangpilang Surabaya', lat: -7.3458, lng: 112.6621, offsetMins: 20 },
    { name: 'Exit Tol Mojokerto Barat / Bypass Mojokerto', lat: -7.4521, lng: 112.4215, offsetMins: 50 },
    { name: 'Rest Area KM 519B Sragen (Jalur B)', lat: -7.4312, lng: 110.9854, offsetMins: 170 },
    { name: 'Exit Tol Banyumanik / Mangkang Semarang', lat: -7.0124, lng: 110.3612, offsetMins: 260 },
    { name: 'Rest Area KM 260B Banjaratma Brebes', lat: -6.9125, lng: 108.9754, offsetMins: 390 },
    { name: 'Terminal Terpadu Pulo Gebang (Jakarta)', lat: -6.21345, lng: 106.95325, offsetMins: 600 },
  ],
  'jakarta-yogyakarta': [
    { name: 'Terminal Terpadu Pulo Gebang (Jakarta)', lat: -6.21345, lng: 106.95325, offsetMins: 0 },
    { name: 'Exit Tol Bekasi Timur / Cikarang Utama', lat: -6.2562, lng: 107.0185, offsetMins: 25 },
    { name: 'SPBU & Rest Area KM 57A Karawang Timur', lat: -6.3712, lng: 107.3621, offsetMins: 55 },
    { name: 'Rest Area KM 207A Cirebon', lat: -6.7689, lng: 108.5321, offsetMins: 190 },
    { name: 'Exit Tol Bawen / Sukun Semarang', lat: -7.2412, lng: 110.4312, offsetMins: 360 },
    { name: 'Terminal Giwangan (Yogyakarta)', lat: -7.83446, lng: 110.39209, offsetMins: 480 },
  ],
  'jakarta-semarang': [
    { name: 'Terminal Terpadu Pulo Gebang (Jakarta)', lat: -6.21345, lng: 106.95325, offsetMins: 0 },
    { name: 'Exit Tol Bekasi Timur / Bulak Kapal', lat: -6.2562, lng: 107.0185, offsetMins: 25 },
    { name: 'Rest Area KM 102A Cipali Subang', lat: -6.5124, lng: 107.7654, offsetMins: 110 },
    { name: 'Exit Tol Pejagan / Brebes Timur', lat: -6.8754, lng: 109.0124, offsetMins: 230 },
    { name: 'Terminal Terpadu Mangkang (Semarang)', lat: -6.97321, lng: 110.30154, offsetMins: 350 },
  ],
  'jakarta-solo': [
    { name: 'Terminal Terpadu Pulo Gebang (Jakarta)', lat: -6.21345, lng: 106.95325, offsetMins: 0 },
    { name: 'Exit Tol Bekasi Timur / Grand Dhika', lat: -6.2562, lng: 107.0185, offsetMins: 25 },
    { name: 'Rest Area KM 207A Palikanci', lat: -6.7689, lng: 108.5321, offsetMins: 190 },
    { name: 'Exit Tol Salatiga / Boyolali', lat: -7.3312, lng: 110.5021, offsetMins: 380 },
    { name: 'Terminal Tirtonadi (Solo)', lat: -7.55182, lng: 110.82276, offsetMins: 430 },
  ],
  'bandung-surabaya': [
    { name: 'Terminal Leuwipanjang (Bandung)', lat: -6.94784, lng: 107.59253, offsetMins: 0 },
    { name: 'Simpang Cileunyi / Gerbang Tol Cileunyi', lat: -6.9395, lng: 107.7412, offsetMins: 30 },
    { name: 'Exit Tol Cisumdawu / Kertajati Majalengka', lat: -6.6712, lng: 108.1654, offsetMins: 85 },
    { name: 'Rest Area KM 228A Kanci Cirebon', lat: -6.8124, lng: 108.6512, offsetMins: 140 },
    { name: 'Terminal Purabaya Bungurasih (Surabaya)', lat: -7.35123, lng: 112.72478, offsetMins: 540 },
  ],
};

// Global store in-memory agar bertahan lintas request di dev server
export interface SeatLockEntry {
  schedule_id: string;
  seat_id: string;
  nomor_kursi: string;
  customer_id: string;
  nama_penumpang: string;
  kode_booking: string;
  tipe_keberangkatan: 'terminal' | 'pickup';
  urutan_antrean: number;
  locked_at: string;
  expired_at: string;
}

const globalForPickup = globalThis as unknown as {
  bustixPickupTableReady?: boolean;
  bustixSeatLocks?: SeatLockEntry[];
};

// Antrean kunci kursi runtime (First-Come First-Served) - kosong saat start, bukan data bisnis.
if (!globalForPickup.bustixSeatLocks) {
  globalForPickup.bustixSeatLocks = [];
}

export function getActiveSeatLocks(scheduleId: string): SeatLockEntry[] {
  const now = Date.now();
  const locks = globalForPickup.bustixSeatLocks || [];
  // Bersihkan yang sudah expired
  const active = locks.filter((l) => new Date(l.expired_at).getTime() > now);
  globalForPickup.bustixSeatLocks = active;
  return active.filter((l) => String(l.schedule_id) === String(scheduleId));
}

export function acquireSeatLocksFirstCome(params: {
  schedule_id: string;
  customer_id: string | number;
  kode_booking: string;
  tipe_keberangkatan: 'terminal' | 'pickup';
  seats: Array<{ seat_id: string; nomor_kursi: string; nama_penumpang: string }>;
  expired_at: string;
}): {
  success: boolean;
  urutan_antrean: number;
  total_antrean_jadwal: number;
  conflict_seat?: string;
  winner_booking?: string;
  winner_time?: string;
} {
  const activeForSchedule = getActiveSeatLocks(params.schedule_id);

  // Cek First-Come First-Served: apakah ada kursi yang sudah dikunci pemesan terdahulu
  for (const reqSeat of params.seats) {
    const taken = activeForSchedule.find(
      (l) =>
        String(l.seat_id) === String(reqSeat.seat_id) ||
        l.nomor_kursi.toUpperCase() === reqSeat.nomor_kursi.toUpperCase()
    );
    if (taken) {
      return {
        success: false,
        urutan_antrean: activeForSchedule.length + 1,
        total_antrean_jadwal: activeForSchedule.length,
        conflict_seat: reqSeat.nomor_kursi,
        winner_booking: taken.kode_booking,
        winner_time: taken.locked_at,
      };
    }
  }

    const urutan = activeForSchedule.length + 1;
  const nowIso = new Date().toISOString();

  const newEntries: SeatLockEntry[] = params.seats.map((s) => ({
    schedule_id: String(params.schedule_id),
    seat_id: String(s.seat_id),
    nomor_kursi: s.nomor_kursi,
    customer_id: String(params.customer_id),
    nama_penumpang: s.nama_penumpang,
    kode_booking: params.kode_booking,
    tipe_keberangkatan: params.tipe_keberangkatan,
    urutan_antrean: urutan,
    locked_at: nowIso,
    expired_at: params.expired_at,
  }));

  globalForPickup.bustixSeatLocks = [...(globalForPickup.bustixSeatLocks || []), ...newEntries];

  return {
    success: true,
    urutan_antrean: urutan,
    total_antrean_jadwal: activeForSchedule.length + newEntries.length,
  };
}

// Perhitungan Haversine jarak lurus dalam KM
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

// Hitung jarak minimum suatu koordinat ke segmen garis koridor rute bus
function pointToSegmentDistKm(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { distKm: number; t: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return { distKm: haversineKm(px, py, x1, y1), t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const projLat = x1 + t * dx;
  const projLng = y1 + t * dy;
  return { distKm: haversineKm(px, py, projLat, projLng), t };
}

export function addMinutesToJam(jamBerangkat: string, addMins: number): string {
  const clean = (jamBerangkat || '07:30').substring(0, 5);
  const [hh, mm] = clean.split(':').map((n) => parseInt(n, 10) || 0);
  const total = ((hh * 60 + mm + Math.round(addMins)) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m} WIB`;
}

function allPoints0(points: AllowedPickupPoint[], lat: number, lng: number) {
  return [...points]
    .map((pt) => ({ ...pt, jarak_dari_customer_km: haversineKm(lat, lng, pt.lat, pt.lng) }))
    .sort((x, y) => x.jarak_dari_customer_km - y.jarak_dari_customer_km);
}

// Validasi lokasi penjemputan Customer terhadap jalur operasional bus & keamanan lalu lintas
export function validatePickupLocation(params: {
  allowedPoints: AllowedPickupPoint[];
  lat: number;
  lng: number;
  alamat?: string;
  asalKota?: string;
  tujuanKota?: string;
  jamBerangkat?: string;
}) {
  const asal = (params.asalKota || '').toLowerCase();
  const tujuan = (params.tujuanKota || '').toLowerCase();
  const key = `${asal}-${tujuan}`;
  const corridor = BUS_ROUTE_CORRIDORS[key] || [];

  let minDistanceKm = Infinity;
  let estOffsetMinutes = 0;

  for (let i = 0; i < corridor.length - 1; i++) {
    const p1 = corridor[i];
    const p2 = corridor[i + 1];
    const { distKm, t } = pointToSegmentDistKm(params.lat, params.lng, p1.lat, p1.lng, p2.lat, p2.lng);
    if (distKm < minDistanceKm) {
      minDistanceKm = distKm;
      estOffsetMinutes = Math.round(p1.offsetMins + t * (p2.offsetMins - p1.offsetMins));
    }
  }

  if (!Number.isFinite(minDistanceKm)) {
    return {
      bisa_dijemput: false,
      status_validasi: 'perlu_review' as const,
      jarak_ke_rute_km: 0,
      estimasi_menit_dari_terminal: 0,
      estimasi_bus_tiba: '-',
      rekomendasi_biaya_tambahan: 0,
      pesan_validasi: 'Data koridor rute untuk perjalanan ini belum tersedia. Hubungi admin.',
      titik_terdekat: allPoints0(params.allowedPoints, params.lat, params.lng)[0] || null,
      daftar_rekomendasi: allPoints0(params.allowedPoints, params.lat, params.lng).slice(0, 4),
      koridor_rute: corridor,
    };
  }
  minDistanceKm = Number(minDistanceKm.toFixed(2));

  // Cari titik penjemputan resmi terdekat
  const allPoints = params.allowedPoints;
  const sortedNearest = [...allPoints]
    .map((pt) => ({
      ...pt,
      jarak_dari_customer_km: haversineKm(params.lat, params.lng, pt.lat, pt.lng),
    }))
    .sort((a, b) => a.jarak_dari_customer_km - b.jarak_dari_customer_km);

  const nearestPoint = sortedNearest[0] || null;

  // Cek apakah alamat mengandung kata berbahaya (tikungan, jembatan, terowongan, rel, tengah tol tanpa rest area)
  const alamatLower = (params.alamat || '').toLowerCase();
  const isUnsafeKeyword = /jembatan|flyover atas|terowongan|underpass|tikungan tajam|perlintasan rel|bahu tol dalam/.test(
    alamatLower
  );

  // Aturan Validasi Jalur Operasional Bus:
  // - <= 2.5 km dari koridor rute & aman: VALID (Sesuai jalur operasional bus)
  // - 2.5 km s/d 5.0 km: PERLU REVIEW ADMIN (Layanan penjemputan khusus dengan biaya tambahan)
  // - > 5.0 km atau lokasi bahaya lalu lintas: DITOLAK / TERLALU JAUH -> Sarankan titik terdekat
  let statusValidasi: 'valid' | 'perlu_review' | 'terlalu_jauh' = 'valid';
  let bisaDijemput = true;
  let rekomendasiBiaya = 0;
  let pesanValidasi =
    'Lokasi berada di jalur operasional bus dan aman untuk pemberhentian singkat. Menunggu persetujuan operator/admin.';

  if (isUnsafeKeyword) {
    statusValidasi = 'terlalu_jauh';
    bisaDijemput = false;
    pesanValidasi =
      'Lokasi ini terdeteksi rawan membahayakan lalu lintas (area jembatan/tikungan/flyover). Demi keselamatan, silakan gunakan Titik Penjemputan Resmi terdekat.';
  } else if (minDistanceKm <= 1.2) {
    statusValidasi = 'valid';
    bisaDijemput = true;
    rekomendasiBiaya = 0;
    pesanValidasi = `Lokasi sangat strategis (${minDistanceKm} km dari jalur bus). Aman untuk bus berhenti dan bebas biaya tambahan.`;
  } else if (minDistanceKm <= 3.0) {
    statusValidasi = 'valid';
    bisaDijemput = true;
    rekomendasiBiaya = 10000;
    pesanValidasi = `Lokasi masih dalam jangkauan jalur operasional bus (${minDistanceKm} km dari rute utama). Biaya akses transit Rp 10.000.`;
  } else if (minDistanceKm <= 5.5) {
    statusValidasi = 'perlu_review';
    bisaDijemput = true;
    rekomendasiBiaya = 25000;
    pesanValidasi = `Lokasi berjarak ${minDistanceKm} km dari jalur utama bus. Membutuhkan persetujuan khusus Admin dengan estimasi biaya layanan Rp 25.000.`;
  } else {
    statusValidasi = 'terlalu_jauh';
    bisaDijemput = false;
    rekomendasiBiaya = 0;
    pesanValidasi = `Lokasi terlalu jauh (${minDistanceKm} km dari jalur operasional bus). Sistem menyarankan titik penjemputan resmi terdekat: ${nearestPoint?.nama_lokasi ?? '-'}.`;
  }

  const estimasiTiba = addMinutesToJam(params.jamBerangkat || '07:30', Math.max(15, estOffsetMinutes));

  return {
    bisa_dijemput: bisaDijemput,
    status_validasi: statusValidasi,
    jarak_ke_rute_km: minDistanceKm,
    estimasi_menit_dari_terminal: Math.max(15, estOffsetMinutes),
    estimasi_bus_tiba: estimasiTiba,
    rekomendasi_biaya_tambahan: rekomendasiBiaya,
    pesan_validasi: pesanValidasi,
    titik_terdekat: nearestPoint,
    daftar_rekomendasi: sortedNearest.slice(0, 4),
    koridor_rute: corridor,
  };
}

export async function ensurePickupTable() {
  if (globalForPickup.bustixPickupTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS pickup_requests (
      id VARCHAR(64) PRIMARY KEY,
      kode_booking VARCHAR(64) NOT NULL,
      schedule_id VARCHAR(64),
      customer_id VARCHAR(64),
      nama_customer VARCHAR(150),
      no_hp VARCHAR(50),
      tipe_keberangkatan VARCHAR(32) DEFAULT 'pickup',
      nama_lokasi VARCHAR(255),
      kategori_lokasi VARCHAR(100),
      alamat_lengkap TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      jarak_ke_rute_km DOUBLE PRECISION DEFAULT 0,
      estimasi_bus_tiba VARCHAR(50),
      status_validasi VARCHAR(50) DEFAULT 'valid',
      status_penjemputan VARCHAR(64) DEFAULT 'Menunggu Konfirmasi',
      biaya_tambahan INTEGER DEFAULT 0,
      catatan_customer TEXT,
      catatan_admin TEXT,
      catatan_staf_sopir TEXT,
      rute_asal VARCHAR(100),
      rute_tujuan VARCHAR(100),
      nama_bus VARCHAR(150),
      plat_nomor VARCHAR(50),
      nomor_kursi VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS allowed_pickup_points (
      id VARCHAR(64) PRIMARY KEY,
      nama_lokasi VARCHAR(255) NOT NULL,
      kategori VARCHAR(100),
      kota VARCHAR(100) NOT NULL,
      alamat TEXT,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      jarak_rute_km DOUBLE PRECISION DEFAULT 0,
      estimasi_menit_dari_terminal INTEGER DEFAULT 0,
      biaya_tambahan INTEGER DEFAULT 0,
      catatan_keamanan TEXT,
      aktif BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  globalForPickup.bustixPickupTableReady = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPoint(r: any): AllowedPickupPoint {
  return {
    ...r,
    lat: Number(r.lat),
    lng: Number(r.lng),
    jarak_rute_km: Number(r.jarak_rute_km || 0),
    estimasi_menit_dari_terminal: Number(r.estimasi_menit_dari_terminal || 0),
    biaya_tambahan: Number(r.biaya_tambahan || 0),
  };
}

export async function getAllowedPickupPoints(kota?: string): Promise<AllowedPickupPoint[]> {
  await ensurePickupTable();
  const res = kota
    ? await query('SELECT * FROM allowed_pickup_points WHERE aktif = TRUE AND LOWER(kota) = LOWER($1) ORDER BY created_at DESC', [kota])
    : await query('SELECT * FROM allowed_pickup_points ORDER BY created_at DESC');
  return res.rows.map(mapPoint);
}

export async function addAllowedPickupPoint(point: Omit<AllowedPickupPoint, 'id'>): Promise<AllowedPickupPoint> {
  await ensurePickupTable();
  const id = `pp-${Date.now()}`;
  const res = await query(
    `INSERT INTO allowed_pickup_points
      (id, nama_lokasi, kategori, kota, alamat, lat, lng, jarak_rute_km, estimasi_menit_dari_terminal, biaya_tambahan, catatan_keamanan, aktif)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [id, point.nama_lokasi, point.kategori, point.kota, point.alamat, point.lat, point.lng, point.jarak_rute_km,
      point.estimasi_menit_dari_terminal, point.biaya_tambahan, point.catatan_keamanan, point.aktif]
  );
  return mapPoint(res.rows[0]);
}

export async function toggleAllowedPickupPoint(id: string): Promise<AllowedPickupPoint | null> {
  await ensurePickupTable();
  const res = await query('UPDATE allowed_pickup_points SET aktif = NOT aktif WHERE id = $1 RETURNING *', [id]);
  return res.rows[0] ? mapPoint(res.rows[0]) : null;
}

export async function deleteAllowedPickupPoint(id: string): Promise<boolean> {
  await ensurePickupTable();
  const res = await query('DELETE FROM allowed_pickup_points WHERE id = $1', [id]);
  return (res.rowCount || 0) > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRequest(r: any): PickupRequestItem {
  return {
    ...r,
    lat: Number(r.lat),
    lng: Number(r.lng),
    jarak_ke_rute_km: Number(r.jarak_ke_rute_km),
    biaya_tambahan: Number(r.biaya_tambahan || 0),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

export async function getAllPickupRequests(filter?: {
  kode_booking?: string;
  customer_id?: string | number;
  status?: string;
}): Promise<PickupRequestItem[]> {
  await ensurePickupTable();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter?.kode_booking) {
    params.push(filter.kode_booking);
    conds.push(`LOWER(kode_booking) = LOWER($${params.length})`);
  }
  if (filter?.customer_id) {
    params.push(String(filter.customer_id));
    conds.push(`customer_id = $${params.length}`);
  }
  if (filter?.status && filter.status !== 'SEMUA') {
    params.push(filter.status);
    conds.push(`status_penjemputan = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const res = await query(`SELECT * FROM pickup_requests ${where} ORDER BY created_at DESC LIMIT 500`, params);
  return res.rows.map(mapRequest);
}

export async function createPickupRequest(
  data: Omit<PickupRequestItem, 'id' | 'created_at' | 'updated_at'>
): Promise<PickupRequestItem> {
  await ensurePickupTable();
  const id = `PKP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const res = await query(
    `INSERT INTO pickup_requests (
      id, kode_booking, schedule_id, customer_id, nama_customer, no_hp,
      tipe_keberangkatan, nama_lokasi, kategori_lokasi, alamat_lengkap,
      lat, lng, jarak_ke_rute_km, estimasi_bus_tiba, status_validasi,
      status_penjemputan, biaya_tambahan, catatan_customer, catatan_admin,
      catatan_staf_sopir, rute_asal, rute_tujuan, nama_bus, plat_nomor, nomor_kursi
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
    ) RETURNING *`,
    [
      id, data.kode_booking, data.schedule_id, String(data.customer_id), data.nama_customer, data.no_hp,
      data.tipe_keberangkatan, data.nama_lokasi, data.kategori_lokasi, data.alamat_lengkap,
      data.lat, data.lng, data.jarak_ke_rute_km, data.estimasi_bus_tiba, data.status_validasi,
      data.status_penjemputan, data.biaya_tambahan, data.catatan_customer || '', data.catatan_admin || '',
      data.catatan_staf_sopir || '', data.rute_asal, data.rute_tujuan, data.nama_bus, data.plat_nomor, data.nomor_kursi,
    ]
  );
  return mapRequest(res.rows[0]);
}

export async function updatePickupRequest(
  idOrBookingCode: string,
  updates: {
    status_penjemputan?: PickupStatus;
    biaya_tambahan?: number;
    catatan_admin?: string;
    catatan_staf_sopir?: string;
    estimasi_bus_tiba?: string;
  }
): Promise<PickupRequestItem | null> {
  await ensurePickupTable();
  const res = await query(
    `UPDATE pickup_requests
     SET status_penjemputan = COALESCE($1, status_penjemputan),
         biaya_tambahan = COALESCE($2, biaya_tambahan),
         catatan_admin = COALESCE($3, catatan_admin),
         catatan_staf_sopir = COALESCE($4, catatan_staf_sopir),
         estimasi_bus_tiba = COALESCE($5, estimasi_bus_tiba),
         updated_at = NOW()
     WHERE id = $6 OR kode_booking = $6
     RETURNING *`,
    [
      updates.status_penjemputan ?? null,
      updates.biaya_tambahan ?? null,
      updates.catatan_admin ?? null,
      updates.catatan_staf_sopir ?? null,
      updates.estimasi_bus_tiba ?? null,
      idOrBookingCode,
    ]
  );
  return res.rows[0] ? mapRequest(res.rows[0]) : null;
}
