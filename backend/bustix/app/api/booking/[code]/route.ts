import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { releaseExpiredBookings } from '@/lib/booking';
import { authenticateRequest } from '@/lib/auth';
import { getAllPickupRequests } from '@/lib/pickup-store';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Anda harus login terlebih dahulu untuk mengakses data booking.'
        },
        { status: 401 }
      );
    }

    // Bersihkan booking kedaluwarsa agar status yang ditampilkan akurat
    await releaseExpiredBookings();

    // 1. Get booking details
    const bookingRes = await query(
      `SELECT 
        b.id,
        b.kode_booking,
        b.customer_id,
        b.schedule_id,
        b.total_harga,
        b.status,
        b.expired_at,
        b.created_at,
        c.nama AS customer_nama,
        c.email AS customer_email,
        c.no_hp AS customer_no_hp,
        s.tanggal_berangkat,
        s.jam_berangkat,
        s.jam_tiba,
        s.status AS schedule_status,
        s.status_perjalanan,
        s.lokasi_terakhir,
        s.catatan_operasional,
        bs.nama_bus,
        bs.plat_nomor,
        bs.kelas,
        COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
        COALESCE(ca.nama_terminal, r.terminal_asal) AS asal_terminal,
        COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota,
        COALESCE(ct.nama_terminal, r.terminal_tujuan) AS tujuan_terminal
      FROM bookings b
      JOIN customers c ON b.customer_id = c.id
      JOIN schedules s ON b.schedule_id = s.id
      JOIN buses bs ON s.bus_id = bs.id
      JOIN routes r ON s.route_id = r.id
      LEFT JOIN cities ca ON r.asal_id = ca.id
      LEFT JOIN cities ct ON r.tujuan_id = ct.id
      WHERE b.kode_booking = $1`,
      [code]
    );

    if (bookingRes.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Booking tidak ditemukan.' },
        { status: 404 }
      );
    }

    const booking = bookingRes.rows[0];

    // 2. Get tickets & passenger list
    const ticketsRes = await query(
      `SELECT 
        bd.id,
        bd.nama_penumpang,
        bd.no_identitas,
        bd.no_hp,
        bd.kode_tiket,
        bd.status_tiket,
        bd.waktu_scan,
        st.nomor_kursi
      FROM booking_details bd
      JOIN seats st ON bd.seat_id = st.id
      WHERE bd.booking_id = $1`,
      [booking.id]
    );

    // 3. Get payment status
    const paymentRes = await query(
      `SELECT id, metode, jumlah, status, referensi_gateway, waktu_bayar
       FROM payments WHERE booking_id = $1 ORDER BY id DESC LIMIT 1`,
      [booking.id]
    );

    const pickupList = await getAllPickupRequests({ kode_booking: booking.kode_booking });

    return NextResponse.json({
      success: true,
      data: {
        ...booking,
        passengers: ticketsRes.rows,
        payment: paymentRes.rows[0] || null,
        pickup: pickupList[0] || null,
      }
    });

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Booking Code Detail API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengambil data booking.', error: errMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/booking/[code]
 * Membatalkan booking yang masih menunggu pembayaran dan melepaskan kursinya
 * sehingga bisa dipesan orang lain lagi.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Anda harus login terlebih dahulu untuk membatalkan pesanan.'
        },
        { status: 401 }
      );
    }

    const { code } = await params;

    const bookingRes = await query(
      'SELECT id, kode_booking, status FROM bookings WHERE kode_booking = $1',
      [code]
    );

    if (bookingRes.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Booking tidak ditemukan.' },
        { status: 404 }
      );
    }

    const booking = bookingRes.rows[0];

    if (booking.status === 'lunas') {
      return NextResponse.json(
        { success: false, message: 'Booking yang sudah lunas tidak dapat dibatalkan. Ajukan refund.' },
        { status: 400 }
      );
    }

    if (booking.status !== 'menunggu_bayar') {
      return NextResponse.json(
        { success: false, message: `Booking sudah berstatus '${booking.status}'.` },
        { status: 400 }
      );
    }

    // Lepas kursi & batalkan booking
    await query('UPDATE booking_details SET aktif = FALSE WHERE booking_id = $1', [booking.id]);
    await query(`UPDATE payments SET status = 'gagal' WHERE booking_id = $1 AND status = 'pending'`, [booking.id]);
    await query(`UPDATE bookings SET status = 'dibatalkan' WHERE id = $1`, [booking.id]);

    return NextResponse.json({
      success: true,
      message: 'Pesanan berhasil dibatalkan dan kursi telah dilepas.',
    });

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Booking Cancel API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal membatalkan booking.', error: errMessage },
      { status: 500 }
    );
  }
}
