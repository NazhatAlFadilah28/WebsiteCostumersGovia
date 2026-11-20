import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
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
          message: 'Anda harus login terlebih dahulu untuk mengakses data tiket.'
        },
        { status: 401 }
      );
    }

    const res = await query(
      `SELECT 
        bd.id AS ticket_id,
        bd.kode_tiket,
        bd.nama_penumpang,
        bd.no_identitas,
        bd.no_hp AS penumpang_no_hp,
        bd.status_tiket,
        bd.waktu_scan,
        st.nomor_kursi,
        b.kode_booking,
        b.status AS status_booking,
        s.id AS schedule_id,
        s.tanggal_berangkat,
        s.jam_berangkat,
        s.jam_tiba,
        s.status_perjalanan,
        bs.nama_bus,
        bs.plat_nomor,
        bs.kelas,
        COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
        COALESCE(ca.nama_terminal, r.terminal_asal) AS asal_terminal,
        COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota,
        COALESCE(ct.nama_terminal, r.terminal_tujuan) AS tujuan_terminal,
        p.metode AS metode_pembayaran,
        p.status AS status_pembayaran,
        p.referensi_gateway
      FROM booking_details bd
      JOIN bookings b ON bd.booking_id = b.id
      JOIN seats st ON bd.seat_id = st.id
      JOIN schedules s ON bd.schedule_id = s.id
      JOIN buses bs ON s.bus_id = bs.id
      JOIN routes r ON s.route_id = r.id
      LEFT JOIN cities ca ON r.asal_id = ca.id
      LEFT JOIN cities ct ON r.tujuan_id = ct.id
      LEFT JOIN LATERAL (
        SELECT metode, status, referensi_gateway
        FROM payments
        WHERE booking_id = b.id
        ORDER BY id DESC
        LIMIT 1
      ) p ON TRUE
      WHERE bd.kode_tiket = $1 OR b.kode_booking = $1
      ORDER BY bd.id ASC`,
      [code]
    );

    if (res.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Tiket tidak ditemukan.' },
        { status: 404 }
      );
    }

    const ticket = res.rows[0];

    // Payload formatted for QR code generator
    const qrPayload = JSON.stringify({
      kode_tiket: ticket.kode_tiket,
      kode_booking: ticket.kode_booking,
      nama: ticket.nama_penumpang,
      kursi: ticket.nomor_kursi,
      schedule_id: ticket.schedule_id
    });

    const pickupList = await getAllPickupRequests({ kode_booking: ticket.kode_booking });

    return NextResponse.json({
      success: true,
      data: {
        ...ticket,
        // Semua tiket dalam satu booking (bila kode yang dikirim adalah kode_booking)
        passengers: res.rows,
        qr_payload: qrPayload,
        pickup: pickupList[0] || null,
      }
    });

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Ticket Detail API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengambil data tiket.', error: errMessage },
      { status: 500 }
    );
  }
}
