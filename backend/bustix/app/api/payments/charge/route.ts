import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { releaseExpiredBookings } from '@/lib/booking';
import { authenticateRequest } from '@/lib/auth';
import midtransClient from 'midtrans-client';

// Inisialisasi Midtrans Snap API Client
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
});

// Peta metode dari frontend â†’ ENUM `metode_bayar` di database
// ENUM hanya menerima: virtual_account | ewallet | qris
const METODE_MAP: Record<string, string> = {
  qris: 'qris',
  va: 'virtual_account',
  virtual_account: 'virtual_account',
  ewallet: 'ewallet',
  ew: 'ewallet',
  cc: 'qris', // Kartu kredit dipetakan ke qris agar tidak melanggar ENUM
};

export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Anda harus login terlebih dahulu untuk melakukan transaksi pembayaran.'
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { booking_code, metode } = body;

    if (!booking_code) {
      return NextResponse.json(
        { success: false, message: 'kode_booking wajib diisi.' },
        { status: 400 }
      );
    }

    // Bersihkan booking kedaluwarsa agar tidak memproses yang sudah lewat waktu
    await releaseExpiredBookings();

    // Ambil data booking dari database sekaligus status jadwal bus
    const bookingRes = await query(
      `SELECT b.*, c.nama, c.email, c.no_hp, s.status AS schedule_status, s.status_perjalanan
       FROM bookings b 
       LEFT JOIN customers c ON b.customer_id = c.id 
       LEFT JOIN schedules s ON b.schedule_id = s.id
       WHERE b.kode_booking = $1`,
      [booking_code]
    );

    if (bookingRes.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Booking tidak ditemukan.' }, { status: 404 });
    }
    const booking = bookingRes.rows[0];

    if (booking.status === 'lunas') {
      return NextResponse.json(
        { success: false, message: 'Booking ini sudah lunas.', status: 'lunas' },
        { status: 400 }
      );
    }

    if (booking.status !== 'menunggu_bayar') {
      return NextResponse.json(
        { success: false, message: `Booking sudah berstatus ${booking.status}.` },
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

    // Ambil detail tiket/kursi + harga dari jadwal (bukan dari booking_details,
    // karena harga kursi disimpan di tabel schedules)
    const detailsRes = await query(
      `SELECT bd.id, bd.seat_id, s.nomor_kursi, sch.harga
       FROM booking_details bd 
       LEFT JOIN seats s ON bd.seat_id = s.id 
       JOIN schedules sch ON bd.schedule_id = sch.id
       WHERE bd.booking_id = $1`,
      [booking.id]
    );

    const grossAmount = Math.round(Number(booking.total_harga));

    const itemDetails = detailsRes.rows.map((item) => ({
      id: String(item.seat_id || `ITEM-${item.id}`),
      price: Math.round(Number(item.harga)),
      quantity: 1,
      name: `Tiket Bus (Kursi ${item.nomor_kursi || '-'})`,
    }));

    const mappedMetode = METODE_MAP[String(metode || '').toLowerCase()] || 'qris';

    // â”€â”€ Coba buat transaksi di Midtrans Snap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const parameter = {
        transaction_details: {
          order_id: booking.kode_booking,
          gross_amount: grossAmount,
        },
        customer_details: {
          first_name: booking.nama || 'Customer',
          email: booking.email || undefined,
          phone: booking.no_hp || undefined,
        },
        item_details: itemDetails.length > 0 ? itemDetails : [
          {
            id: booking.kode_booking,
            price: grossAmount,
            quantity: 1,
            name: `Tiket Bus ${booking.kode_booking}`,
          },
        ],
        credit_card: { secure: true },
      };

      const snapTransaction = await snap.createTransaction(parameter);

      // Simpan token & metode ke payments
      await query(
        `UPDATE payments 
         SET metode = $1, referensi_gateway = $2 
         WHERE booking_id = $3 AND status = 'pending'`,
        [mappedMetode, snapTransaction.token, booking.id]
      );

      return NextResponse.json({
        success: true,
        mode: 'midtrans',
        message: 'Transaksi Midtrans Snap berhasil dibuat.',
        token: snapTransaction.token,
        redirect_url: snapTransaction.redirect_url,
        booking_code: booking.kode_booking,
        total_harga: booking.total_harga,
      });
    } catch (midtransErr: unknown) {
      const mErr = midtransErr instanceof Error ? midtransErr.message : String(midtransErr);
      console.error('Midtrans createTransaction gagal:', mErr);
      return NextResponse.json({ success: false, message: 'Gateway pembayaran tidak tersedia. Silakan coba lagi nanti.', error: mErr }, { status: 502 });
    }

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Payment Charge Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal membuat transaksi pembayaran.', error: errMessage },
      { status: 500 }
    );
  }
}
