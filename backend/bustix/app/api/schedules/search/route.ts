import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { releaseExpiredBookings } from '@/lib/booking';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asal_id = searchParams.get('asal_id');
  const tujuan_id = searchParams.get('tujuan_id');
  const asal_kota = searchParams.get('asal_kota');
  const tujuan_kota = searchParams.get('tujuan_kota');
  const tanggal = searchParams.get('tanggal');
  const kelas = searchParams.get('kelas');
  const min_harga = searchParams.get('min_harga');
  const max_harga = searchParams.get('max_harga');

  try {
    // Bersihkan booking kedaluwarsa (dibungkus try-catch agar tidak memutus pencarian jika gagal)
    try {
      await releaseExpiredBookings();
    } catch {
      /* abaikan jika DB sedang sibuk */
    }

    let sql = `
      SELECT 
        s.id,
        s.tanggal_berangkat,
        s.jam_berangkat,
        s.jam_tiba,
        s.harga,
        s.status,
        s.status_perjalanan,
        s.lokasi_terakhir,
        s.catatan_operasional,
        b.id AS bus_id,
        b.nama_bus,
        b.plat_nomor,
        b.kelas,
        b.kapasitas,
        COALESCE(ca.id, r.asal_id) AS asal_id,
        COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
        COALESCE(ca.nama_terminal, r.terminal_asal) AS asal_terminal,
        COALESCE(ct.id, r.tujuan_id) AS tujuan_id,
        COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota,
        COALESCE(ct.nama_terminal, r.terminal_tujuan) AS tujuan_terminal,
        COALESCE(
          b.kapasitas - (
            SELECT COUNT(*) 
            FROM booking_details bd 
            WHERE bd.schedule_id = s.id AND bd.aktif = TRUE
          ), b.kapasitas
        ) AS sisa_kursi
      FROM schedules s
      JOIN buses b ON s.bus_id = b.id
      JOIN routes r ON s.route_id = r.id
      LEFT JOIN cities ca ON r.asal_id = ca.id
      LEFT JOIN cities ct ON r.tujuan_id = ct.id
      WHERE s.status = 'aktif'
        AND b.status = 'aktif'
    `;

    const params: unknown[] = [];
    let paramIdx = 1;

    if (asal_id) {
      sql += ` AND r.asal_id = $${paramIdx++}`;
      params.push(asal_id);
    }
    if (tujuan_id) {
      sql += ` AND r.tujuan_id = $${paramIdx++}`;
      params.push(tujuan_id);
    }
    if (asal_kota) {
      sql += ` AND LOWER(COALESCE(ca.nama_kota, r.kota_asal)) = LOWER($${paramIdx++})`;
      params.push(asal_kota.trim());
    }
    if (tujuan_kota) {
      sql += ` AND LOWER(COALESCE(ct.nama_kota, r.kota_tujuan)) = LOWER($${paramIdx++})`;
      params.push(tujuan_kota.trim());
    }
    if (tanggal) {
      sql += ` AND s.tanggal_berangkat = $${paramIdx++}`;
      params.push(tanggal);
    }
    if (kelas) {
      sql += ` AND b.kelas = $${paramIdx++}`;
      params.push(kelas);
    }
    if (min_harga) {
      sql += ` AND s.harga >= $${paramIdx++}`;
      params.push(min_harga);
    }
    if (max_harga) {
      sql += ` AND s.harga <= $${paramIdx++}`;
      params.push(max_harga);
    }

    sql += ` ORDER BY s.tanggal_berangkat ASC, s.jam_berangkat ASC`;

    const res = await query(sql, params);

    // Kembalikan array kosong apa adanya jika belum ada jadwal/bus aktif di database
    return NextResponse.json({
      success: true,
      total: res.rows.length,
      data: res.rows
    });
  } catch (error: unknown) {
    console.error('Schedule Search error:', error);
    return NextResponse.json({ success: false, message: 'Gagal memuat jadwal dari database', data: [] }, { status: 500 });
  }
}

