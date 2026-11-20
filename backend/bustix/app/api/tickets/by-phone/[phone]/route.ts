import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/tickets/by-phone/[phone]
 *
 * Mengambil tiket TERBARU milik penumpang berdasarkan nomor HP.
 * Dipakai oleh CHAT BOT WhatsApp: ketika penumpang hanya menulis
 * "kirim tiket saya" tanpa kode booking, bot mencocokkan nomor WA
 * pengirim dengan kolom booking_details.no_hp.
 *
 * Catatan: nomor dinormalisasi ke format 62xxxx agar cocok dengan
 * berbagai penulisan (0812..., +62812..., 62812...).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ phone: string }> }
) {
  try {
    const { phone } = await params;

    // Normalisasi: ambil digit saja, ubah 0/8 di depan menjadi 62
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    else if (digits.startsWith('8')) digits = '62' + digits;

    if (!digits) {
      return NextResponse.json(
        { success: false, message: 'Nomor HP tidak valid.' },
        { status: 400 }
      );
    }

    // Cocokkan dengan no_hp pada booking_details (bisa tersimpan dalam
    // berbagai format, jadi kita bandingkan versi digit-nya via regexp).
    const res = await query(
      `SELECT 
        bd.kode_tiket,
        b.kode_booking,
        b.status AS status_booking,
        b.created_at
       FROM booking_details bd
       JOIN bookings b ON bd.booking_id = b.id
       WHERE regexp_replace(bd.no_hp, '\\D', '', 'g') LIKE $1
          OR regexp_replace(bd.no_hp, '\\D', '', 'g') LIKE $2
       ORDER BY b.created_at DESC
       LIMIT 1`,
      [`%${digits.slice(-10)}`, `%${digits.slice(-9)}`]
    );

    if (res.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Tidak ada tiket untuk nomor ini.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: res.rows[0] });

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Ticket by-phone API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengambil tiket.', error: errMessage },
      { status: 500 }
    );
  }
}
