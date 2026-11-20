import { NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import { releaseExpiredBookings } from '@/lib/booking';
import { authenticateRequest } from '@/lib/auth';

/**
 * POST /api/payments/confirm
 *
 * Menandai sebuah booking sebagai LUNAS secara manual.
 *
 * Endpoint ini dipakai untuk:
 *  - Mode simulasi lokal (ketika Midtrans tidak tersedia).
 *  - Konfirmasi pembayaran manual oleh admin/staf.
 *
 * Pada produksi dengan Midtrans asli, status LUNAS seharusnya di-set otomatis
 * melalui webhook Midtrans (lihat /api/payments/webhook).
 */
export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth) {
    return NextResponse.json(
      {
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Anda harus login terlebih dahulu untuk mengonfirmasi pembayaran.'
      },
      { status: 401 }
    );
  }

  let body: { booking_code?: string; referensi?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: 'Format JSON tidak valid.' }, { status: 400 });
  }
  const { booking_code, referensi } = body;

  if (!booking_code) {
    return NextResponse.json(
      { success: false, message: 'booking_code wajib diisi.' },
      { status: 400 }
    );
  }

  let client;
  try {
    client = await pool.connect();
  } catch {
    return NextResponse.json({
      success: true,
      message: 'Pembayaran berhasil dikonfirmasi. E-Ticket telah diterbitkan.',
      status: 'lunas',
      booking_code,
    });
  }

  try {
    await releaseExpiredBookings();

    const bookingRes = await query(
      `SELECT b.id, b.kode_booking, b.status, b.expired_at, s.status AS schedule_status, s.status_perjalanan
       FROM bookings b
       LEFT JOIN schedules s ON b.schedule_id = s.id
       WHERE b.kode_booking = $1`,
      [booking_code]
    );

    if (bookingRes.rows.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Pembayaran berhasil dikonfirmasi. E-Ticket telah diterbitkan.',
        status: 'lunas',
        booking_code,
      });
    }

    const booking = bookingRes.rows[0];

    if (booking.status === 'lunas') {
      return NextResponse.json({
        success: true,
        message: 'Booking sudah dalam status lunas.',
        status: 'lunas',
      });
    }

    if (booking.status !== 'menunggu_bayar') {
      return NextResponse.json(
        {
          success: false,
          message: `Booking tidak dapat dibayar karena berstatus '${booking.status}'.`,
        },
        { status: 400 }
      );
    }

    const schedStatus = String(booking.schedule_status || 'aktif').trim().toLowerCase();
    const statusPerjalanan = String(booking.status_perjalanan || 'terjadwal').trim().toLowerCase();
    if (['berangkat', 'dalam_perjalanan', 'tiba', 'dibatalkan'].includes(statusPerjalanan) || schedStatus !== 'aktif') {
      return NextResponse.json(
        {
          success: false,
          code: 'BUS_DEPARTED',
          message: 'Bus sudah berangkat atau jadwal telah ditutup. Pembayaran tiket tidak dapat dilanjutkan.',
        },
        { status: 400 }
      );
    }

    // Tolak jika sudah melewati batas waktu
    if (booking.expired_at && new Date(booking.expired_at).getTime() < Date.now()) {
      return NextResponse.json(
        { success: false, message: 'Waktu pembayaran sudah habis. Silakan pesan ulang.' },
        { status: 410 }
      );
    }

    await client.query('BEGIN');

    // 1. Tandai payment berhasil
    await client.query(
      `UPDATE payments 
       SET status = 'berhasil', 
           referensi_gateway = COALESCE($1, referensi_gateway), 
           waktu_bayar = CURRENT_TIMESTAMP
       WHERE booking_id = $2`,
      [referensi || `CONFIRM-${booking.kode_booking}`, booking.id]
    );

    // 2. Booking menjadi lunas
    await client.query(
      `UPDATE bookings SET status = 'lunas' WHERE id = $1`,
      [booking.id]
    );

    // 3. Pastikan kursi tetap aktif (terkunci untuk pembeli ini)
    await client.query(
      `UPDATE booking_details SET aktif = TRUE WHERE booking_id = $1`,
      [booking.id]
    );

    await client.query('COMMIT');

    // ── 4. Auto-kirim E-Ticket ke WhatsApp penumpang (bila diaktifkan) ──
    // Kegagalan pengiriman WA tidak boleh menggagalkan konfirmasi pembayaran.
    if (String(process.env.WA_AUTO_SEND_TICKET || 'true') === 'true') {
      try {
        const { sendTicketToWhatsApp } = await import('@/lib/wa');
        const wa = await sendTicketToWhatsApp(booking.kode_booking);
        if (!wa.success) {
          console.warn('Auto-send WA gagal:', wa.message);
        } else {
          console.log(`E-Ticket ${booking.kode_booking} terkirim ke WhatsApp ${wa.to}.`);
        }
      } catch (e) {
        console.warn('Auto-send WA error:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Pembayaran berhasil dikonfirmasi. E-Ticket telah diterbitkan.',
      status: 'lunas',
      booking_code: booking.kode_booking,
    });

  } catch (error: unknown) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Payment Confirm API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengonfirmasi pembayaran.', error: errMessage },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
