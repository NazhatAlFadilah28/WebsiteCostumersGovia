import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { getAllPickupRequests } from '@/lib/pickup-store';

export async function GET(request: Request) {
  try {
    // Wajib login: ambil customer_id dari token JWT yang valid
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Anda harus login terlebih dahulu untuk melihat riwayat pesanan.'
        },
        { status: 401 }
      );
    }

    const customer_id = auth.id;

    const res = await query(
      `SELECT 
        b.id AS booking_id,
        b.kode_booking,
        b.total_harga,
        b.status AS status_booking,
        b.expired_at,
        b.created_at,
        s.id AS schedule_id,
        s.tanggal_berangkat,
        s.jam_berangkat,
        s.jam_tiba,
        s.status_perjalanan,
        s.lokasi_terakhir,
        bs.nama_bus,
        bs.plat_nomor,
        bs.kelas,
        ca.nama_kota AS asal_kota,
        ca.nama_terminal AS asal_terminal,
        ct.nama_kota AS tujuan_kota,
        ct.nama_terminal AS tujuan_terminal,
        (
          SELECT COUNT(*) FROM booking_details bd WHERE bd.booking_id = b.id
        ) AS jumlah_penumpang,
        (
          SELECT STRING_AGG(s2.nomor_kursi, ', ' ORDER BY s2.nomor_kursi)
          FROM booking_details bd2
          JOIN seats s2 ON bd2.seat_id = s2.id
          WHERE bd2.booking_id = b.id
        ) AS nomor_kursi,
        (
          SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.id DESC LIMIT 1
        ) AS status_pembayaran,
        (
          SELECT p.metode FROM payments p WHERE p.booking_id = b.id ORDER BY p.id DESC LIMIT 1
        ) AS metode_pembayaran
      FROM bookings b
      JOIN schedules s ON b.schedule_id = s.id
      JOIN buses bs ON s.bus_id = bs.id
      JOIN routes r ON s.route_id = r.id
      JOIN cities ca ON r.asal_id = ca.id
      JOIN cities ct ON r.tujuan_id = ct.id
      WHERE b.customer_id = $1
      ORDER BY b.created_at DESC`,
      [customer_id]
    );

    const allPickups = await getAllPickupRequests();
    const pickupByBooking = new Map(allPickups.map((p) => [p.kode_booking, p]));

    const enrichedRows = res.rows.map((row) => ({
      ...row,
      pickup: pickupByBooking.get(row.kode_booking) || null,
    }));


    return NextResponse.json({
      success: true,
      total: enrichedRows.length,
      history: enrichedRows,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Customer Booking History API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengambil riwayat booking customer.', error: errMessage },
      { status: 500 }
    );
  }
}
