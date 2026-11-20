import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { sendTicketEmail } from '@/lib/mailer';

/**
 * POST /api/tickets/send-email
 * Mengirimkan E-Ticket resmi lengkap ke email customer/penumpang
 */
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, message: 'Anda harus login untuk mengirim tiket ke email.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { booking_code, email_override } = body as { booking_code?: string; email_override?: string };

    if (!booking_code) {
      return NextResponse.json(
        { success: false, message: 'booking_code wajib diisi.' },
        { status: 400 }
      );
    }

    // Ambil data detail booking & tiket dari database
    const bookingRes = await query(
      `SELECT 
        b.id,
        b.kode_booking,
        b.total_harga,
        b.status AS status_booking,
        c.nama AS customer_nama,
        c.email AS customer_email,
        sch.tanggal_berangkat,
        sch.jam_berangkat,
        sch.jam_tiba,
        bus.nama_bus,
        bus.plat_nomor,
        bus.kelas,
        ca.nama_kota AS asal_kota,
        ca.nama_terminal AS asal_terminal,
        ct.nama_kota AS tujuan_kota,
        ct.nama_terminal AS tujuan_terminal
       FROM bookings b
       JOIN customers c ON b.customer_id = c.id
       JOIN schedules sch ON b.schedule_id = sch.id
       JOIN buses bus ON sch.bus_id = bus.id
       JOIN routes r ON sch.route_id = r.id
       JOIN cities ca ON r.asal_id = ca.id
       JOIN cities ct ON r.tujuan_id = ct.id
       WHERE b.kode_booking = $1`,
      [booking_code]
    );

    if (bookingRes.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Booking tidak ditemukan.' }, { status: 404 });
    }

    const b = bookingRes.rows[0];

    // Ambil rincian kursi & penumpang
    const detailsRes = await query(
      `SELECT bd.kode_tiket, bd.nama_penumpang, s.nomor_kursi 
       FROM booking_details bd
       LEFT JOIN seats s ON bd.seat_id = s.id
       WHERE bd.booking_id = $1`,
      [b.id]
    );

    const firstDetail = detailsRes.rows[0] || {};
    const nomorKursiList = detailsRes.rows.map((r) => r.nomor_kursi || '-').join(', ');
    const targetEmail = email_override || b.customer_email || auth.email;

    if (!targetEmail) {
      return NextResponse.json({ success: false, message: 'Alamat email tujuan tidak ditemukan.' }, { status: 400 });
    }

    const formatTgl = (tgl: string) => {
      try {
        return new Date(tgl).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      } catch {
        return tgl;
      }
    };

    const resMail = await sendTicketEmail({
      to: targetEmail,
      nama: firstDetail.nama_penumpang || b.customer_nama,
      kodeBooking: b.kode_booking,
      kodeTiket: firstDetail.kode_tiket || b.kode_booking,
      nomorKursi: nomorKursiList,
      asalKota: b.asal_kota,
      asalTerminal: b.asal_terminal,
      tujuanKota: b.tujuan_kota,
      tujuanTerminal: b.tujuan_terminal,
      tanggalBerangkat: formatTgl(b.tanggal_berangkat),
      jamBerangkat: String(b.jam_berangkat || '').substring(0, 5).replace(':', '.'),
      jamTiba: String(b.jam_tiba || '').substring(0, 5).replace(':', '.'),
      namaBus: b.nama_bus,
      kelas: b.kelas,
      platNomor: b.plat_nomor,
      totalHarga: b.total_harga,
    });

    return NextResponse.json({
      success: true,
      message: resMail.sent
        ? `E-Ticket berhasil dikirimkan ke email ${targetEmail}`
        : `Email tiket disiapkan (Dev Mode: ${targetEmail})`,
      to: targetEmail,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengirim email tiket.', error: errMessage },
      { status: 500 }
    );
  }
}

