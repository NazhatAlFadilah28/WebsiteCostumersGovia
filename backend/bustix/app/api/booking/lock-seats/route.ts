import { NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import { generateBookingCode, generateTicketCode } from '@/lib/helpers';
import { authenticateRequest } from '@/lib/auth';
import { releaseExpiredBookings } from '@/lib/booking';
import { createPickupRequest } from '@/lib/pickup-store';
import {
  MAX_SEAT_QUEUE_CAPACITY,
  clearSeatFromAllContenders,
  getSeatQueueSnapshot,
  leaveSeatQueue,
  nextBookingAttemptNumber,
} from '@/lib/seat-queue';

function pickRandomItems<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

interface DatabaseError extends Error {
  code?: string;
}

// Daftar metode pembayaran yang valid (sesuai ENUM metode_bayar di database)
const VALID_METODE = ['virtual_account', 'ewallet', 'qris', 'cash'];

const globalForCashEnum = globalThis as unknown as { cashEnumEnsured?: boolean };
async function ensureCashPaymentMethod() {
  if (globalForCashEnum.cashEnumEnsured) return;
  try {
    await query(`ALTER TYPE metode_bayar ADD VALUE IF NOT EXISTS 'cash';`);
    globalForCashEnum.cashEnumEnsured = true;
  } catch {
    /* abaikan jika sudah ada atau bukan enum */
  }
}

export async function POST(request: Request) {
  let body: {
    schedule_id?: string | number;
    metode_pembayaran?: string;
    session_id?: string;
    passengers?: Array<{
      seat_id?: string | number;
      nama_penumpang: string;
      no_identitas: string;
      no_hp: string;
      nomor_kursi?: string;
    }>;
    pickup_info?: Record<string, unknown> | null;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: 'Format JSON tidak valid.' }, { status: 400 });
  }

  const { schedule_id, metode_pembayaran = 'qris', session_id, passengers, pickup_info } = body;
  const metode = VALID_METODE.includes(String(metode_pembayaran).toLowerCase())
    ? String(metode_pembayaran).toLowerCase()
    : 'qris';
  const isCashPayment = metode === 'cash';

  // ── 1. AUTENTIKASI WAJIB (khususnya saat memakai Cash atau pemesanan tiket) ──
  const auth = authenticateRequest(request);
  if (!auth || !auth.id) {
    return NextResponse.json(
      {
        success: false,
        code: 'UNAUTHORIZED',
        message: isCashPayment
          ? 'Pembayaran Cash (tunai langsung) mewajibkan login / autentikasi terlebih dahulu.'
          : 'Anda harus login terlebih dahulu untuk memesan tiket.',
      },
      { status: 401 }
    );
  }

  const customer_id = auth.id;

  if (!schedule_id || !passengers || !Array.isArray(passengers) || passengers.length === 0) {
    return NextResponse.json(
      { success: false, message: 'Data booking (schedule_id, passengers) tidak lengkap.' },
      { status: 400 }
    );
  }

  if (passengers.length > 4) {
    return NextResponse.json(
      { success: false, message: 'Maksimal 4 kursi per satu pemesanan.' },
      { status: 400 }
    );
  }

  if (isCashPayment) {
    await ensureCashPaymentMethod();
  }

  const isPickupMode = Boolean(pickup_info && pickup_info.tipe_keberangkatan === 'pickup');
  const biayaTambahanPickup = isPickupMode
    ? Math.max(0, Number(pickup_info?.biaya_tambahan || 0))
    : 0;

  // Catat nomor antrean atomik untuk request ini (mendukung lonjakan hingga 20.000 pemesan bersamaan)
  const queueTicketNumber = nextBookingAttemptNumber(String(schedule_id));
  const queueSnapBefore = getSeatQueueSnapshot(String(schedule_id), session_id);

  let client: import('pg').PoolClient | null = null;
  try {
    client = await pool.connect();
  } catch (connErr) {
    console.error('Database offline on lock-seats:', connErr);
    return NextResponse.json({ success: false, message: 'Database tidak dapat dihubungi. Pemesanan gagal.' }, { status: 500 });
  }

  try {
    // ── 2. Bersihkan kursi kedaluwarsa sebelum cek ketersediaan ──────
    await releaseExpiredBookings();

    // ── 3. Validasi jadwal ───────────────────────────────────────────
    const schedRes = await client.query(
      `SELECT s.id, s.harga, s.status, s.status_perjalanan, s.jam_berangkat,
              b.nama_bus, b.plat_nomor,
              COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
              COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota
       FROM schedules s
       JOIN buses b ON s.bus_id = b.id
       JOIN routes r ON s.route_id = r.id
       LEFT JOIN cities ca ON r.asal_id = ca.id
       LEFT JOIN cities ct ON r.tujuan_id = ct.id
       WHERE s.id = $1`,
      [schedule_id]
    );

    if (schedRes.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Jadwal tidak ditemukan.' }, { status: 404 });
    }

    const schedule = schedRes.rows[0];
    const schedStatus = String(schedule.status || 'aktif').trim().toLowerCase();
    const statusPerjalanan = String(schedule.status_perjalanan || 'terjadwal').trim().toLowerCase();

    if (['berangkat', 'dalam_perjalanan'].includes(statusPerjalanan)) {
      return NextResponse.json(
        {
          success: false,
          code: 'BUS_DEPARTED',
          message: 'Bus sudah berangkat dari terminal. Pemesanan tiket untuk jadwal ini telah ditutup.',
        },
        { status: 400 }
      );
    }

    if (statusPerjalanan === 'tiba') {
      return NextResponse.json(
        {
          success: false,
          code: 'BUS_ARRIVED',
          message: 'Bus sudah tiba di terminal tujuan. Pemesanan tiket telah ditutup.',
        },
        { status: 400 }
      );
    }

    if (schedStatus !== 'aktif' || !['terjadwal', 'menunggu'].includes(statusPerjalanan)) {
      return NextResponse.json(
        {
          success: false,
          code: 'SCHEDULE_INACTIVE',
          message: 'Jadwal bus sudah tidak aktif atau dibatalkan. Silakan pilih jadwal lain.',
        },
        { status: 400 }
      );
    }

    // ── 4. Mulai transaksi dengan PostgreSQL Advisory Lock (Antrean 20.000+ Konkuren) ──
    await client.query('BEGIN');

    let resolvedPassengers: Array<{
      seat_id: string | number;
      nomor_kursi: string;
      nama_penumpang: string;
      no_identitas: string;
      no_hp: string;
    }> = [];
    const seatNumberMap = new Map<string, string>();

    if (isPickupMode) {
      // Kunci antrean alokasi kursi random tingkat jadwal agar pemesan titik jemput bersamaan tidak bentrok
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pickup_schedule:${schedule_id}`]);

      const availRes = await client.query(
        `SELECT st.id, st.nomor_kursi
         FROM seats st
         JOIN schedules s ON s.bus_id = st.bus_id
         LEFT JOIN booking_details bd
           ON bd.seat_id = st.id AND bd.schedule_id = s.id AND bd.aktif = TRUE
         WHERE s.id = $1 AND bd.id IS NULL
         ORDER BY st.id ASC`,
        [schedule_id]
      );

      const availableRows = availRes.rows as Array<{ id: string | number; nomor_kursi: string }>;
      if (availableRows.length < passengers.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            success: false,
            code: 'SEAT_TAKEN',
            message: `Maaf, sisa kursi tersedia (${availableRows.length}) tidak mencukupi untuk ${passengers.length} penumpang titik jemput.`,
          },
          { status: 409 }
        );
      }

      const randomPicked = pickRandomItems(availableRows, passengers.length);
      resolvedPassengers = passengers.map((p, idx) => {
        const chosen = randomPicked[idx];
        seatNumberMap.set(String(chosen.id), chosen.nomor_kursi);
        return {
          seat_id: chosen.id,
          nomor_kursi: chosen.nomor_kursi,
          nama_penumpang: p.nama_penumpang,
          no_identitas: p.no_identitas,
          no_hp: p.no_hp,
        };
      });
    } else {
      const busSeatsRes = await client.query(
        `SELECT st.id, st.nomor_kursi
         FROM seats st
         JOIN schedules s ON s.bus_id = st.bus_id
         WHERE s.id = $1`,
        [schedule_id]
      );
      const busSeats = busSeatsRes.rows as Array<{ id: string | number; nomor_kursi: string }>;

      const matched = passengers.map((p) => {
        const code = String(p.nomor_kursi || '').toUpperCase();
        return (
          (code && busSeats.find((s) => String(s.nomor_kursi).toUpperCase() === code)) ||
          busSeats.find((s) => String(s.id) === String(p.seat_id))
        );
      });

      if (matched.some((m) => !m) || busSeats.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, message: 'Kursi yang dipilih tidak ditemukan pada bus jadwal ini.' },
          { status: 400 }
        );
      }

      const uniqueIds = new Set(matched.map((m) => String(m!.id)));
      if (uniqueIds.size !== matched.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, message: 'Terdapat kursi yang dipilih lebih dari satu kali.' },
          { status: 400 }
        );
      }

      resolvedPassengers = passengers.map((p, idx) => {
        const m = matched[idx]!;
        seatNumberMap.set(String(m.id), m.nomor_kursi);
        return {
          seat_id: m.id,
          nomor_kursi: m.nomor_kursi,
          nama_penumpang: p.nama_penumpang,
          no_identitas: p.no_identitas,
          no_hp: p.no_hp,
        };
      });

      // Kunci setiap kursi secara urut (ascending seat_id) dengan PostgreSQL Advisory Lock
      // agar 20.000 request paralel untuk kursi yang sama dieksekusi First-Come First-Served tanpa deadlock!
      const sortedSeatIds = [...resolvedPassengers]
        .map((p) => Number(p.seat_id))
        .sort((a, b) => a - b);

      for (const sid of sortedSeatIds) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`seat:${schedule_id}:${sid}`]);
      }

      // Cek langsung di DB apakah kursi sudah dimenangkan pemesan lebih dulu
      const takenRes = await client.query(
        `SELECT bd.seat_id, st.nomor_kursi, bk.kode_booking
         FROM booking_details bd
         JOIN seats st ON st.id = bd.seat_id
         JOIN bookings bk ON bk.id = bd.booking_id
         WHERE bd.schedule_id = $1
           AND bd.seat_id = ANY($2::bigint[])
           AND bd.aktif = TRUE
         LIMIT 1`,
        [schedule_id, sortedSeatIds]
      );

      if (takenRes.rows.length > 0) {
        const conflict = takenRes.rows[0];
        await client.query('ROLLBACK');
        clearSeatFromAllContenders(String(schedule_id), [conflict.nomor_kursi]);
        return NextResponse.json(
          {
            success: false,
            code: 'SEAT_TAKEN',
            message: `Antrean #${queueTicketNumber}: Maaf, Kursi ${conflict.nomor_kursi} baru saja dimenangkan oleh pemesan lebih awal (Booking #${conflict.kode_booking}). Silakan pilih kursi lain.`,
            seat: conflict.nomor_kursi,
            winner_booking: conflict.kode_booking,
            queue_number: queueTicketNumber,
          },
          { status: 409 }
        );
      }
    }

    const totalHarga = Number(schedule.harga) * resolvedPassengers.length + biayaTambahanPickup;
    const kodeBooking = generateBookingCode();
    // Cash langsung berstatus 'lunas' (aktif untuk boarding & bayar tunai langsung), Midtrans 'menunggu_bayar' 2 jam
    const bookingStatus = isCashPayment ? 'lunas' : 'menunggu_bayar';
    const expiredAt = isCashPayment ? null : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const bookingRes = await client.query(
      `INSERT INTO bookings (kode_booking, customer_id, schedule_id, total_harga, status, expired_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kode_booking, total_harga, status, expired_at, created_at`,
      [kodeBooking, customer_id, schedule_id, totalHarga, bookingStatus, expiredAt]
    );

    const booking = bookingRes.rows[0];
    const createdTickets = [];

    for (const passenger of resolvedPassengers) {
      const { seat_id, nama_penumpang, no_identitas, no_hp } = passenger;

      if (!seat_id || !nama_penumpang || !no_identitas || !no_hp) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, message: 'Identitas penumpang harus diisi lengkap (Nama, NIK, No. WhatsApp).' },
          { status: 400 }
        );
      }

      const kodeTiket = generateTicketCode();

      try {
        const bdRes = await client.query(
          `INSERT INTO booking_details
            (booking_id, schedule_id, seat_id, nama_penumpang, no_identitas, no_hp, aktif, kode_tiket, status_tiket)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, 'belum_naik')
           RETURNING id, seat_id, nama_penumpang, kode_tiket, status_tiket`,
          [booking.id, schedule_id, seat_id, nama_penumpang, no_identitas, no_hp, kodeTiket]
        );

        createdTickets.push({
          ...bdRes.rows[0],
          nomor_kursi: seatNumberMap.get(String(seat_id)) || null,
        });
      } catch (err: unknown) {
        const dbErr = err as DatabaseError;
        if (dbErr.code === '23505') {
          await client.query('ROLLBACK');
          const seatNum = seatNumberMap.get(String(seat_id)) || seat_id;
          return NextResponse.json(
            {
              success: false,
              code: 'SEAT_TAKEN',
              message: `Antrean #${queueTicketNumber}: Kursi ${seatNum} baru saja dimenangkan oleh pemesan lain. Silakan pilih kursi lain.`,
              seat: seatNum,
              queue_number: queueTicketNumber,
            },
            { status: 409 }
          );
        }
        throw err;
      }
    }

    const paymentRef = isCashPayment ? `CASH-DIRECT-${kodeBooking}` : null;
    const paymentRes = await client.query(
      `INSERT INTO payments (booking_id, metode, jumlah, status, referensi_gateway)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING id, metode, jumlah, status, referensi_gateway`,
      [booking.id, metode, totalHarga, paymentRef]
    );

    await client.query('COMMIT');

    // Bersihkan kursi dari antrean pemilihan aktif
    const assignedSeatList = createdTickets.map((t) => t.nomor_kursi).filter(Boolean) as string[];
    clearSeatFromAllContenders(String(schedule_id), assignedSeatList);
    if (session_id) {
      leaveSeatQueue(String(schedule_id), session_id);
    }

    // Simpan data Titik Penjemputan GPS ke tabel pickup_requests jika mode pickup
    let savedPickup = null;
    if (isPickupMode && pickup_info) {
      try {
        const primaryPassenger = resolvedPassengers[0];
        savedPickup = await createPickupRequest({
          kode_booking: kodeBooking,
          schedule_id: String(schedule_id),
          customer_id,
          nama_customer: primaryPassenger.nama_penumpang || auth.nama || 'Customer',
          no_hp: primaryPassenger.no_hp || '-',
          tipe_keberangkatan: 'pickup',
          nama_lokasi: String(pickup_info.nama_lokasi || 'Titik Jemput Jalan Raya (GPS)'),
          kategori_lokasi: String(pickup_info.kategori_lokasi || 'Pinggir Jalan Raya (GPS)'),
          alamat_lengkap: String(pickup_info.alamat_lengkap || '-'),
          lat: Number(pickup_info.lat || 0),
          lng: Number(pickup_info.lng || 0),
          jarak_ke_rute_km: Number(pickup_info.jarak_ke_rute_km || 0),
          estimasi_bus_tiba: String(pickup_info.estimasi_bus_tiba || `${String(schedule.jam_berangkat || '07:30').slice(0, 5)} WIB`),
          status_validasi: 'valid',
          status_penjemputan: 'Menunggu Konfirmasi',
          biaya_tambahan: biayaTambahanPickup,
          catatan_customer: String(pickup_info.catatan_customer || (isCashPayment ? 'Pembayaran Cash langsung saat naik' : '')),
          catatan_admin: isCashPayment
            ? 'Tiket Titik Jemput GPS (Cash saat naik) — Menunggu persetujuan Staf.'
            : 'Tiket Titik Jemput GPS (Midtrans) — Menunggu persetujuan Staf.',
          catatan_staf_sopir: 'Menunggu persetujuan Staf untuk penjemputan di pinggir jalan raya (GPS).',
          rute_asal: String(pickup_info.rute_asal || schedule.asal_kota || '-'),
          rute_tujuan: String(pickup_info.rute_tujuan || schedule.tujuan_kota || '-'),
          nama_bus: String(pickup_info.nama_bus || schedule.nama_bus || '-'),
          plat_nomor: String(pickup_info.plat_nomor || schedule.plat_nomor || '-'),
          nomor_kursi: assignedSeatList.join(', ') || '-',
        });
      } catch (pkpErr) {
        console.warn('Simpan pickup_requests warning:', pkpErr);
      }
    }

    const assignedSeatsText = assignedSeatList.join(', ');
    return NextResponse.json(
      {
        success: true,
        is_cash: isCashPayment,
        direct_ticket: isCashPayment,
        message: isPickupMode
          ? isCashPayment
            ? `Tiket Titik Jemput (Cash) berhasil diterbitkan! Kursi otomatis: ${assignedSeatsText}. Silakan bayar tunai langsung saat naik.`
            : `Berhasil! Kursi otomatis (${assignedSeatsText}) telah disiapkan. Lanjutkan pembayaran via Midtrans.`
          : isCashPayment
          ? `Antrean #${queueTicketNumber} Berhasil! Tiket kursi ${assignedSeatsText} terbit (Bayar Cash langsung saat naik).`
          : `Antrean #${queueTicketNumber} Berhasil! Anda memenangkan kursi ${assignedSeatsText}.`,
        queue_info: {
          urutan_antrean: queueTicketNumber,
          total_antrean_jadwal: Math.max(queueSnapBefore.total_active_queue, 1),
          max_queue_capacity: MAX_SEAT_QUEUE_CAPACITY,
          mode_kursi: isPickupMode ? 'RANDOM_SISTEM_PICKUP' : 'PILIHAN_TERMINAL_FCFS',
          assigned_seats: assignedSeatList,
        },
        booking: {
          id: booking.id,
          kode_booking: booking.kode_booking,
          total_harga: booking.total_harga,
          status: booking.status,
          expired_at: booking.expired_at,
          created_at: booking.created_at,
          tickets: createdTickets,
          payment: paymentRes.rows[0],
          pickup: savedPickup,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    try {
      await client?.query('ROLLBACK');
    } catch {
      /* ignore rollback error */
    }
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Lock Seats API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal memproses pemesanan kursi.', error: errMessage },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
