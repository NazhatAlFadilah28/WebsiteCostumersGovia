import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';

/**
 * GET /api/refund/[code]
 * Status refund terakhir untuk sebuah booking (milik customer yang login).
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

  const bRes = await query(
    `SELECT id, customer_id, status FROM bookings WHERE kode_booking = $1`,
    [code]
  );
  if (bRes.rows.length === 0 || String(bRes.rows[0].customer_id) !== String(auth.id)) {
    return NextResponse.json({ success: false, message: 'Booking tidak ditemukan.' }, { status: 404 });
  }

  const rRes = await query(
    `SELECT id, alasan, potongan_persen, potongan_nominal, dana_kembali, status, catatan_admin, created_at, waktu_proses
     FROM refunds WHERE booking_id = $1 ORDER BY id DESC LIMIT 1`,
    [bRes.rows[0].id]
  );

  return NextResponse.json({
    success: true,
    booking_status: bRes.rows[0].status,
    refund: rRes.rows[0] || null,
  });
}
