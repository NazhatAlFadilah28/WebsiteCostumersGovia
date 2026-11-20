import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { releaseExpiredBookings } from '@/lib/booking';
import { getActiveSeatLocks } from '@/lib/pickup-store';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Lepas dulu kursi dari booking yang sudah kedaluwarsa agar status kursi akurat
    try {
      await releaseExpiredBookings();
    } catch {
      /* abaikan jika DB sedang sibuk */
    }

    // 1. Get bus_id, kapasitas, and current departure status for schedule
    const schedRes = await query(
      `SELECT s.bus_id, s.status, s.status_perjalanan, s.lokasi_terakhir, s.catatan_operasional, b.kapasitas 
       FROM schedules s 
       JOIN buses b ON s.bus_id = b.id 
       WHERE s.id = $1`,
      [id]
    );
    if (schedRes.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Jadwal tidak ditemukan' }, { status: 404 });
    }
    const busId = schedRes.rows[0].bus_id;
    const kapasitas = Number(schedRes.rows[0].kapasitas) || 32;
    const schedStatus = schedRes.rows[0].status || 'aktif';
    const schedDepartureStatus = schedRes.rows[0].status_perjalanan || 'terjadwal';
    const lokasiTerakhir = schedRes.rows[0].lokasi_terakhir || null;
    const catatanOperasional = schedRes.rows[0].catatan_operasional || null;

    // 2. Get all seats of this bus (limited to bus kapasitas) with their booking status for this schedule
    const seatsRes = await query(
      `SELECT 
        st.id AS seat_id,
        st.nomor_kursi,
        CASE 
          WHEN bd.id IS NOT NULL THEN 'terisi'
          ELSE 'tersedia'
        END AS status
      FROM seats st
      LEFT JOIN booking_details bd 
        ON st.id = bd.seat_id 
       AND bd.schedule_id = $1 
       AND bd.aktif = TRUE
      WHERE st.bus_id = $2
      ORDER BY 
        LENGTH(st.nomor_kursi) ASC,
        st.nomor_kursi ASC
      LIMIT $3`,
      [id, busId, kapasitas]
    );

    const activeLocks = getActiveSeatLocks(id);
    const lockedCodes = new Set(activeLocks.map((l) => l.nomor_kursi.toUpperCase()));
    const mergedSeats = seatsRes.rows.map((row: { seat_id: string | number; nomor_kursi: string; status: string }) => ({
      ...row,
      status: lockedCodes.has(String(row.nomor_kursi).toUpperCase()) ? 'terisi' : row.status,
    }));

    return NextResponse.json({
      success: true,
      schedule_id: id,
      bus_id: busId,
      kapasitas,
      status: schedStatus,
      status_perjalanan: schedDepartureStatus,
      lokasi_terakhir: lokasiTerakhir,
      catatan_operasional: catatanOperasional,
      total_seats: mergedSeats.length,
      total_antrean_aktif: activeLocks.length,
      seats: mergedSeats
    });
  } catch (error: unknown) {
    console.error('Schedule Seats error:', error);
    return NextResponse.json({ success: false, message: 'Gagal memuat kursi dari database' }, { status: 500 });
  }
}

