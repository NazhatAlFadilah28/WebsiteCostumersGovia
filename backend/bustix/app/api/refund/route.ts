import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';

/**
 * POST /api/refund
 * Ajukan refund tiket (hanya booking yang sudah LUNAS).
 * Body: { booking_code, alasan }
 *
 * Kebijakan potongan (disengaja sederhana, lihat ponytail):
 *  - > 24 jam sebelum keberangkatan : potongan 10%
 *  - <= 24 jam sebelum keberangkatan : potongan 25%
 *  - sudah berangkat                 : ditolak
 */
export async function POST(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, message: 'Anda harus login terlebih dahulu untuk mengajukan refund.' },
      { status: 401 }
    );
  }

  let body: { booking_code?: string; alasan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: 'Format request tidak valid.' }, { status: 400 });
  }

  const bookingCode = (body.booking_code || '').trim();
  const alasan = (body.alasan || '').trim();
  if (!bookingCode || !alasan) {
    return NextResponse.json(
      { success: false, message: 'Kode booking dan alasan refund wajib diisi.' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Booking harus milik customer yang login + sudah lunas
    const bRes = await client.query(
      `SELECT b.id, b.customer_id, b.status, b.total_harga, b.schedule_id,
              s.tanggal_berangkat, s.jam_berangkat
       FROM bookings b
       JOIN schedules s ON b.schedule_id = s.id
       WHERE b.kode_booking = $1
       FOR UPDATE`,
      [bookingCode]
    );
    if (bRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, message: 'Booking tidak ditemukan.' }, { status: 404 });
    }
    const booking = bRes.rows[0];
    if (String(booking.customer_id) !== String(auth.id)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, message: 'Booking tidak ditemukan.' }, { status: 404 });
    }
    if (booking.status !== 'lunas') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, message: `Hanya booking berstatus lunas yang bisa di-refund (status: ${booking.status}).` },
        { status: 400 }
      );
    }

    // Satu booking hanya boleh punya satu klaim aktif
    const dup = await client.query(
      `SELECT id FROM refunds WHERE booking_id = $1 AND status IN ('menunggu', 'selesai') LIMIT 1`,
      [booking.id]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, message: 'Refund untuk booking ini sudah pernah diajukan.' },
        { status: 400 }
      );
    }

    // Hitung potongan berdasarkan jarak waktu keberangkatan
    // Catatan: pg mengembalikan kolom `date` sebagai objek Date (bukan string).
    const tgl = booking.tanggal_berangkat;
    const berangkat = tgl instanceof Date
      ? new Date(tgl.getFullYear(), tgl.getMonth(), tgl.getDate(),
          ...String(booking.jam_berangkat).split(':').map(Number))
      : new Date(`${String(tgl).slice(0, 10)}T${booking.jam_berangkat}`);
    const jamSebelum = (berangkat.getTime() - Date.now()) / 3_600_000;
    if (jamSebelum <= 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, message: 'Jadwal sudah berangkat, refund tidak lagi tersedia.' },
        { status: 400 }
      );
    }
    const potonganPersen = jamSebelum > 24 ? 10 : 25;

    const total = Number(booking.total_harga || 0);
    const potonganNominal = Math.round((total * potonganPersen) / 100);
    const danaKembali = total - potonganNominal;

    const rRes = await client.query(
      `INSERT INTO refunds (booking_id, alasan, potongan_persen, potongan_nominal, biaya_admin, dana_kembali, status, klaim_status, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, 'menunggu', 'menunggu', NOW())
       RETURNING id, booking_id, alasan, potongan_persen, potongan_nominal, dana_kembali, status, created_at`,
      [booking.id, alasan, potonganPersen, potonganNominal, danaKembali]
    );
    await client.query(`UPDATE bookings SET status = 'menunggu_refund', updated_at = NOW() WHERE id = $1`, [booking.id]);
    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: 'Pengajuan refund berhasil dikirim dan sedang menunggu persetujuan admin.',
      refund: rRes.rows[0],
    });
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Refund Create API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengajukan refund.', error: errMessage },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
