import { NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import crypto from 'crypto';

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
      transaction_id,
    } = body;

    // 1. Verifikasi Signature Key Midtrans demi Keamanan
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    if (!serverKey) {
      return NextResponse.json(
        { success: false, message: 'MIDTRANS_SERVER_KEY belum dikonfigurasi.' },
        { status: 500 }
      );
    }
    const payloadSignature = `${order_id}${status_code}${gross_amount}${serverKey}`;
    const calculatedSignature = crypto.createHash('sha512').update(payloadSignature).digest('hex');

    if (signature_key && signature_key !== calculatedSignature) {
      return NextResponse.json(
        { success: false, message: 'Invalid signature key.' },
        { status: 403 }
      );
    }

    const kode_booking = order_id;

    // 2. Cari data booking
    const bookingRes = await query('SELECT * FROM bookings WHERE kode_booking = $1', [kode_booking]);
    if (bookingRes.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Booking tidak ditemukan.' },
        { status: 404 }
      );
    }

    const booking = bookingRes.rows[0];
    await client.query('BEGIN');

    // 3. Tangani Status Transaksi dari Midtrans
    if (
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept')
    ) {
      // Pembayaran BERHASIL
      await client.query(
        `UPDATE payments 
         SET status = 'berhasil', referensi_gateway = $1, waktu_bayar = CURRENT_TIMESTAMP
         WHERE booking_id = $2`,
        [transaction_id || order_id, booking.id]
      );

      await client.query(
        `UPDATE bookings 
         SET status = 'lunas' 
         WHERE id = $1`,
        [booking.id]
      );

      await client.query(
        `UPDATE booking_details 
         SET aktif = TRUE 
         WHERE booking_id = $1`,
        [booking.id]
      );

      await client.query('COMMIT');

      // Auto-kirim E-Ticket ke WhatsApp penumpang (tidak menggagalkan webhook bila gagal)
      if (String(process.env.WA_AUTO_SEND_TICKET || 'true') === 'true') {
        try {
          const { sendTicketToWhatsApp } = await import('@/lib/wa');
          const wa = await sendTicketToWhatsApp(booking.kode_booking);
          if (!wa.success) console.warn('Auto-send WA (webhook) gagal:', wa.message);
        } catch (e) {
          console.warn('Auto-send WA (webhook) error:', e instanceof Error ? e.message : e);
        }
      }

      return NextResponse.json({
        success: true,
        message: `Pembayaran Midtrans booking ${kode_booking} BERHASIL (settlement).`,
      });

    } else if (
      transaction_status === 'cancel' ||
      transaction_status === 'deny' ||
      transaction_status === 'expire'
    ) {
      // Pembayaran GAGAL / EXPIRED
      const statusPayment = transaction_status === 'expire' ? 'kedaluwarsa' : 'gagal';

      await client.query(
        `UPDATE payments 
         SET status = $1 
         WHERE booking_id = $2`,
        [statusPayment, booking.id]
      );

      await client.query(
        `UPDATE bookings 
         SET status = 'kedaluwarsa' 
         WHERE id = $1`,
        [booking.id]
      );

      await client.query(
        `UPDATE booking_details 
         SET aktif = FALSE 
         WHERE booking_id = $1`,
        [booking.id]
      );

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: `Pembayaran Midtrans booking ${kode_booking} ${transaction_status.toUpperCase()}.`,
      });

    } else if (transaction_status === 'pending') {
      // Pembayaran PENDING
      await client.query('COMMIT');
      return NextResponse.json({
        success: true,
        message: `Pembayaran Midtrans booking ${kode_booking} PENDING.`,
      });

    } else {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, message: `Status transaksi '${transaction_status}' diabaikan.` },
        { status: 200 }
      );
    }

  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Midtrans Webhook Notification Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal memproses notifikasi Midtrans.', error: errMessage },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
