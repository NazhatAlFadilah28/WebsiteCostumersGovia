import { query } from './db';

/**
 * Lepas kursi yang sudah kedaluwarsa secara on-demand.
 *
 * Logika ini SAMA dengan fungsi SQL `lepas_booking_kedaluwarsa()` di skema DB,
 * tetapi dipanggil langsung dari API (tanpa perlu menunggu pg_cron). Ini memastikan
 * kursi yang ditahan oleh booking `menunggu_bayar` yang sudah lewat `expired_at`
 * otomatis kembali menjadi 'tersedia' sehingga tidak "nyangkut" selamanya.
 *
 * Aman dipanggil berkali-kali (idempotent).
 */
export async function releaseExpiredBookings(): Promise<void> {
  // 1. Nonaktifkan detail kursi dari booking yang sudah kedaluwarsa
  await query(
    `UPDATE booking_details bd
     SET aktif = FALSE
     FROM bookings b
     WHERE bd.booking_id = b.id
       AND b.status = 'menunggu_bayar'
       AND b.expired_at < CURRENT_TIMESTAMP`
  );

  // 2. Tandai payment sebagai kedaluwarsa
  await query(
    `UPDATE payments p
     SET status = 'kedaluwarsa'
     FROM bookings b
     WHERE p.booking_id = b.id
       AND b.status = 'menunggu_bayar'
       AND b.expired_at < CURRENT_TIMESTAMP`
  );

  // 3. Tandai booking sebagai kedaluwarsa
  await query(
    `UPDATE bookings
     SET status = 'kedaluwarsa'
     WHERE status = 'menunggu_bayar'
       AND expired_at < CURRENT_TIMESTAMP`
  );
}

/**
 * Lepas kursi dari satu booking tertentu (mis. saat user membatalkan pesanan
 * atau ketika pembayaran gagal/kedaluwarsa).
 */
export async function releaseBookingSeats(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  bookingId: string | number
): Promise<void> {
  await client.query(
    `UPDATE booking_details SET aktif = FALSE WHERE booking_id = $1`,
    [bookingId]
  );
}
