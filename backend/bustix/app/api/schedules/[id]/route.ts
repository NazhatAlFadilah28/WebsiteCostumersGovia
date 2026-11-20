import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;


  try {
    const res = await query(
      `SELECT 
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
        b.foto_bus,
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
      WHERE s.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Jadwal tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: res.rows[0]
    });
  } catch (error: unknown) {
    console.error('Schedule ById error:', error);
    return NextResponse.json({ success: false, message: 'Gagal memuat jadwal dari database' }, { status: 500 });
  }
}
