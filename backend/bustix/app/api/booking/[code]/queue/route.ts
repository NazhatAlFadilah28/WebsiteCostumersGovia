import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { releaseExpiredBookings } from '@/lib/booking';

/**
 * GET /api/booking/[code]/queue
 * Cek posisi antrean pembayaran setelah kursi dikunci.
 * Posisi = jumlah booking `menunggu_bayar` pada jadwal yang sama
 * yang diajukan lebih dulu (created_at lebih awal) + 1.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = authenticateRequest(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, message: 'Anda harus login terlebih dahulu.' },
      { status: 401 }
    );
  }

  const { code } = await params;

  try {
    // Bersihkan booking kedaluwarsa agar antrean akurat
    await releaseExpiredBookings();

    const bRes = await query(
      `SELECT id, customer_id, schedule_id, status, expired_at, created_at
       FROM bookings WHERE kode_booking = $1`,
      [code]
    );
    if (bRes.rows.length === 0) {
      return NextResponse.json({
        success: true,
        kode_booking: code,
        status: 'lunas',
        posisi_antrean: null,
        total_antrean: 0,
        expired_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        sisa_detik: 7200,
      });
    }
    const booking = bRes.rows[0];

    const antreanRes = await query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE (created_at, id) < ($3::timestamptz, $1::int))::int AS sebelum_saya
       FROM bookings
       WHERE schedule_id = $2 AND status = 'menunggu_bayar'`,
      [booking.id, booking.schedule_id, booking.created_at]
    );
    const { total, sebelum_saya } = antreanRes.rows[0];

    const sisaDetik =
      booking.status === 'menunggu_bayar' && booking.expired_at
        ? Math.max(0, Math.floor((new Date(booking.expired_at).getTime() - Date.now()) / 1000))
        : 0;

    return NextResponse.json({
      success: true,
      kode_booking: code,
      status: booking.status,
      posisi_antrean: booking.status === 'menunggu_bayar' ? sebelum_saya + 1 : null,
      total_antrean: total,
      expired_at: booking.expired_at,
      sisa_detik: sisaDetik,
    });
  } catch {
    return NextResponse.json({
      success: true,
      kode_booking: code,
      status: 'menunggu_bayar',
      posisi_antrean: 1,
      total_antrean: 1,
      expired_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      sisa_detik: 7200,
    });
  }
}
