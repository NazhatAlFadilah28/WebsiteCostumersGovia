import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool, query } from '@/lib/db';
import { authenticateRequest, type TokenPayload } from '@/lib/auth';
import { releaseExpiredBookings } from '@/lib/booking';
import { generateBookingCode, generateTicketCode } from '@/lib/helpers';
import { getActiveSeatLocks } from '@/lib/pickup-store';
import { clearSeatFromAllContenders } from '@/lib/seat-queue';

/**
 * POST /api/chat
 *
 * GOVIA AI Assistant berbasis Google Gemini Function Calling.
 * Mendukung percakapan bebas & alami (seperti Gemini AI) sekaligus transaksi nyata
 * ke PostgreSQL/Supabase: cari jadwal, cek kursi, buat pesanan tiket, & cek status booking.
 */

const DEFAULT_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
];

const LEGACY_UNHEALTHY_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-flash-latest',
]);

function getModelCandidates(): string[] {
  const configured = (process.env.GEMINI_MODEL || '').trim();
  const list: string[] = [];
  if (configured && !LEGACY_UNHEALTHY_MODELS.has(configured)) {
    list.push(configured);
  }
  for (const m of DEFAULT_MODELS) {
    if (!list.includes(m)) list.push(m);
  }
  return list;
}

const GEMINI_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const VALID_PAYMENT_METHODS = ['qris', 'virtual_account', 'ewallet', 'cash'] as const;

const CITY_ALIASES: Record<string, string> = {
  jkt: 'Jakarta',
  dki: 'Jakarta',
  'dki jakarta': 'Jakarta',
  'pulo gebang': 'Jakarta',
  pulogebang: 'Jakarta',
  sby: 'Surabaya',
  bungurasih: 'Surabaya',
  purabaya: 'Surabaya',
  jogja: 'Yogyakarta',
  yogya: 'Yogyakarta',
  diy: 'Yogyakarta',
  giwangan: 'Yogyakarta',
  bdg: 'Bandung',
  leuwipanjang: 'Bandung',
  smg: 'Semarang',
  mangkang: 'Semarang',
  slo: 'Solo',
  surakarta: 'Solo',
  tirtonadi: 'Solo',
  dps: 'Denpasar',
  bali: 'Denpasar',
  mlg: 'Malang',
};

// ── Tipe Data Internal & UI Cards ──────────────────────────────────────────────

export interface ChatScheduleItem {
  id: string;
  nama_bus: string;
  plat_nomor: string;
  kelas: string;
  kapasitas: number;
  sisa_kursi: number;
  tanggal_berangkat: string;
  jam_berangkat: string;
  jam_tiba: string;
  harga: number;
  asal_kota: string;
  asal_terminal: string;
  tujuan_kota: string;
  tujuan_terminal: string;
  status_perjalanan: string;
}

export interface ChatSeatItem {
  seat_id: string;
  nomor_kursi: string;
  status: 'tersedia' | 'terisi';
}

export type ChatUiCard =
  | {
      type: 'schedules';
      title: string;
      schedules: ChatScheduleItem[];
    }
  | {
      type: 'seat_picker';
      schedule: ChatScheduleItem;
      seats: ChatSeatItem[];
      available_seats: string[];
      requires_login: boolean;
      prefill_user: { nama: string; email: string; no_hp: string } | null;
    }
  | {
      type: 'booking_created';
      booking: {
        kode_booking: string;
        total_harga: number;
        status: string;
        is_cash: boolean;
        expired_at: string | null;
        metode_pembayaran: string;
        nama_bus: string;
        plat_nomor: string;
        kelas: string;
        asal_kota: string;
        tujuan_kota: string;
        tanggal_berangkat: string;
        jam_berangkat: string;
        tickets: Array<{
          kode_tiket: string;
          nama_penumpang: string;
          nomor_kursi: string;
        }>;
      };
    }
  | {
      type: 'booking_status';
      bookings: Array<{
        kode_booking: string;
        status: string;
        total_harga: number;
        metode_pembayaran: string | null;
        nama_bus: string;
        asal_kota: string;
        tujuan_kota: string;
        tanggal_berangkat: string;
        jam_berangkat: string;
        kursi: string;
      }>;
    }
  | {
      type: 'login_required';
      reason: string;
    };

interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
}

interface GeminiFunctionResponse {
  name: string;
  id?: string;
  response: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: GeminiContent;
  }>;
}

interface CustomerProfile {
  nama: string;
  email: string;
  no_hp: string;
}

interface ScheduleDbRow {
  id: number | string;
  tanggal_berangkat: string | Date;
  jam_berangkat: string;
  jam_tiba: string;
  harga: string | number;
  status: string | null;
  status_perjalanan: string | null;
  bus_id: number | string;
  nama_bus: string;
  plat_nomor: string;
  kelas: string;
  kapasitas: number;
  asal_kota: string;
  asal_terminal: string;
  tujuan_kota: string;
  tujuan_terminal: string;
  sisa_kursi: number | string;
}

// ── Deklarasi Tools untuk Google Gemini ────────────────────────────────────────

const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'search_schedules',
        description:
          'Mencari jadwal bus AKAP yang aktif di database GOVIA/BusTix berdasarkan kota asal, kota tujuan, tanggal, atau kelas armada. Gunakan tool ini setiap kali user menanyakan jadwal, rute, harga tiket, atau ingin mulai memesan tiket.',
        parameters: {
          type: 'OBJECT',
          properties: {
            asal_kota: {
              type: 'STRING',
              description: 'Nama kota keberangkatan, misalnya Jakarta, Bandung, Semarang, Solo, Yogyakarta, Surabaya.',
            },
            tujuan_kota: {
              type: 'STRING',
              description: 'Nama kota tujuan, misalnya Surabaya, Yogyakarta, Solo, Jakarta, Malang, Denpasar.',
            },
            tanggal: {
              type: 'STRING',
              description: 'Opsional. Tanggal berangkat format YYYY-MM-DD.',
            },
            kelas: {
              type: 'STRING',
              description: 'Opsional. Kelas bus, misalnya eksekutif, sleeper, bisnis, ekonomi.',
            },
          },
        },
      },
      {
        name: 'get_schedule_seats',
        description:
          'Mengecek denah dan daftar nomor kursi yang masih tersedia secara real-time untuk sebuah schedule_id. Juga menampilkan form interaktif pemilihan kursi & pemesanan langsung di layar chat user.',
        parameters: {
          type: 'OBJECT',
          properties: {
            schedule_id: {
              type: 'STRING',
              description: 'ID jadwal bus (schedule_id) yang dipilih user dari hasil search_schedules.',
            },
          },
          required: ['schedule_id'],
        },
      },
      {
        name: 'create_ticket_booking',
        description:
          'Membuat pesanan tiket bus nyata di database setelah jadwal, nomor kursi, data lengkap setiap penumpang (nama, NIK, no HP/WhatsApp), dan metode pembayaran sudah jelas serta disetujui user.',
        parameters: {
          type: 'OBJECT',
          properties: {
            schedule_id: {
              type: 'STRING',
              description: 'ID jadwal bus yang dipesan.',
            },
            seat_numbers: {
              type: 'ARRAY',
              description: 'Daftar kode kursi yang dipilih (maksimal 4 kursi), contoh: ["1A", "1B"].',
              items: { type: 'STRING' },
            },
            passengers: {
              type: 'ARRAY',
              description: 'Data penumpang sesuai urutan seat_numbers.',
              items: {
                type: 'OBJECT',
                properties: {
                  nama_penumpang: { type: 'STRING', description: 'Nama lengkap penumpang' },
                  no_identitas: { type: 'STRING', description: 'Nomor NIK KTP / identitas penumpang' },
                  no_hp: { type: 'STRING', description: 'Nomor HP / WhatsApp penumpang' },
                },
                required: ['nama_penumpang', 'no_identitas', 'no_hp'],
              },
            },
            metode_pembayaran: {
              type: 'STRING',
              description: 'Salah satu dari: qris, virtual_account, ewallet, atau cash (bayar tunai saat naik). Default: qris.',
            },
          },
          required: ['schedule_id', 'seat_numbers', 'passengers'],
        },
      },
      {
        name: 'check_booking_status',
        description:
          'Mengecek status pemesanan tiket, kode booking, atau daftar riwayat pesanan milik customer yang sedang login.',
        parameters: {
          type: 'OBJECT',
          properties: {
            booking_code: {
              type: 'STRING',
              description: 'Opsional. Kode booking spesifik, misalnya BTX-ABC1234.',
            },
          },
        },
      },
    ],
  },
];

// ── Helper Utilitas ────────────────────────────────────────────────────────────

function normalizeCityName(raw: unknown): string {
  const val = String(raw || '').trim();
  if (!val) return '';
  const mapped = CITY_ALIASES[val.toLowerCase()];
  return mapped || val;
}

function toJakartaDateString(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  } catch {
    return String(value).slice(0, 10);
  }
}

function formatWibNow(): string {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapScheduleRow(row: ScheduleDbRow): ChatScheduleItem {
  return {
    id: String(row.id),
    nama_bus: row.nama_bus,
    plat_nomor: row.plat_nomor,
    kelas: row.kelas,
    kapasitas: Number(row.kapasitas || 0),
    sisa_kursi: Number(row.sisa_kursi || 0),
    tanggal_berangkat: toJakartaDateString(row.tanggal_berangkat),
    jam_berangkat: String(row.jam_berangkat || '').slice(0, 5),
    jam_tiba: String(row.jam_tiba || '').slice(0, 5),
    harga: Number(row.harga || 0),
    asal_kota: row.asal_kota,
    asal_terminal: row.asal_terminal,
    tujuan_kota: row.tujuan_kota,
    tujuan_terminal: row.tujuan_terminal,
    status_perjalanan: row.status_perjalanan || 'terjadwal',
  };
}

function buildSystemPrompt(authProfile: CustomerProfile | null): string {
  const userInfo = authProfile
    ? `Pengguna sedang LOGIN sebagai: Nama="${authProfile.nama}", Email="${authProfile.email}", No.HP="${authProfile.no_hp || '-'}".`
    : 'Pengguna saat ini BELUM LOGIN (mode tamu).';

  return `Kamu adalah "GOVIA AI", asisten virtual pintar berbasis Google Gemini untuk platform pemesanan tiket bus AKAP GOVIA / BusTix Indonesia.
Waktu saat ini: ${formatWibNow()} WIB.
Status akun pengguna: ${userInfo}

Gaya Komunikasi (WAJIB alami seperti Google Gemini AI):
- Jawab dengan bahasa Indonesia yang hangat, natural, luwes, cerdas, dan variatif—jangan kaku, jangan mengulang template kalimat yang sama terus-menerus, dan jangan membatasi diri secara kaku pada 3-4 kalimat jika pengguna butuh penjelasan lengkap.
- Gunakan formatting Markdown ringan (**tebal**, poin-poin rapi) bila membantu keterbacaan.
- Kamu boleh diajak mengobrol santai atau menjawab pertanyaan seputar perjalanan, rekomendasi wisata, kuliner khas kota tujuan, tips mudik/perjalanan jauh, itinerary, maupun pertanyaan umum dengan wawasan luas ala Gemini AI—sambil tetap siap membantu pemesanan tiket bus kapan pun dibutuhkan.

Aturan Ketat Data & Pemesanan Tiket:
- JANGAN PERNAH mengarang jadwal bus, harga, ID jadwal, nomor kursi tersedia, atau kode booking! Selalu panggil tool \`search_schedules\`, \`get_schedule_seats\`, \`check_booking_status\`, atau \`create_ticket_booking\`.
- Saat memandu pengguna memesan tiket lewat chat:
  1. Cari jadwal dulu dengan \`search_schedules\`.
  2. Setelah user memilih bus/rute tertentu (atau menanyakan kursi), panggil \`get_schedule_seats\` untuk ID jadwal tersebut. Kartu pilih kursi & form interaktif otomatis muncul di layar chat user!
  3. Untuk mengeksekusi pemesanan langsung via chat (\`create_ticket_booking\`), kumpulkan: kode kursi (maks 4), Nama Lengkap, NIK/No. Identitas, No. HP/WhatsApp tiap penumpang, dan metode pembayaran (\`qris\`, \`virtual_account\`, \`ewallet\`, atau \`cash\`). Jika user sudah punya datanya di profil (Nama & HP), kamu bisa tawarkan memakai data profil tersebut dan cukup minta NIK serta konfirmasi, atau persilakan user mengisi kartu form interaktif di atas.
  4. Jika \`create_ticket_booking\` mengembalikan \`requires_login: true\`, beri tahu dengan ramah bahwa tombol Masuk/Login sudah muncul di chat.
- Info umum layanan GOVIA: pembayaran mendukung QRIS, Virtual Account (BCA/Mandiri/BRI/BNI), E-Wallet via Midtrans, serta Cash langsung saat naik; fitur Titik Jemput GPS tersedia untuk penjemputan pinggir jalan raya; refund/reschedule dapat diajukan melalui menu Pesanan Saya; bagasi gratis hingga 20 kg.`;
}

function sanitizeHistory(
  history: Array<{ role: 'user' | 'model'; text: string }> | undefined,
  currentMessage: string
): GeminiContent[] {
  const contents: GeminiContent[] = [];

  if (Array.isArray(history)) {
    for (const item of history.slice(-20)) {
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (!text) continue;
      const role: 'user' | 'model' = item.role === 'user' ? 'user' : 'model';

      // Gemini mensyaratkan giliran pertama harus ber-role 'user'
      if (contents.length === 0 && role === 'model') continue;

      const last = contents[contents.length - 1];
      if (last && last.role === role && last.parts[0]?.text) {
        last.parts[0].text = `${last.parts[0].text}\n${text}`;
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }
  }

  const last = contents[contents.length - 1];
  if (last && last.role === 'user' && last.parts[0]?.text) {
    last.parts[0].text = `${last.parts[0].text}\n${currentMessage}`;
  } else {
    contents.push({ role: 'user', parts: [{ text: currentMessage }] });
  }

  return contents;
}

function stripThoughtSignatures(contents: GeminiContent[]): GeminiContent[] {
  return contents.map((turn) => ({
    role: turn.role,
    parts: turn.parts.map((part) => {
      if (turn.role !== 'model' || !part.thoughtSignature) return part;
      const copy: GeminiPart = { ...part };
      delete copy.thoughtSignature;
      return copy;
    }),
  }));
}

function extractReplyText(parts: GeminiPart[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text as string)
    .join('')
    .trim();
}

// ── Eksekutor Tools Database Nyata ─────────────────────────────────────────────

async function execSearchSchedules(
  args: Record<string, unknown>,
  uiCards: ChatUiCard[]
): Promise<Record<string, unknown>> {
  try {
    await releaseExpiredBookings();
  } catch {
    /* abaikan jika DB sibuk */
  }

  const asal = normalizeCityName(args.asal_kota);
  const tujuan = normalizeCityName(args.tujuan_kota);
  const tanggalRaw = String(args.tanggal || '').trim();
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tanggalRaw) ? tanggalRaw : '';
  const kelas = String(args.kelas || '').trim();

  const baseSelect = `
    SELECT
      s.id,
      s.tanggal_berangkat,
      s.jam_berangkat,
      s.jam_tiba,
      s.harga,
      s.status,
      s.status_perjalanan,
      b.id AS bus_id,
      b.nama_bus,
      b.plat_nomor,
      b.kelas,
      b.kapasitas,
      COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
      COALESCE(ca.nama_terminal, r.terminal_asal) AS asal_terminal,
      COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota,
      COALESCE(ct.nama_terminal, r.terminal_tujuan) AS tujuan_terminal,
      GREATEST(0, COALESCE(
        b.kapasitas - (
          SELECT COUNT(*)
          FROM booking_details bd
          WHERE bd.schedule_id = s.id AND bd.aktif = TRUE
        ), b.kapasitas
      ))::int AS sisa_kursi
    FROM schedules s
    JOIN buses b ON s.bus_id = b.id
    JOIN routes r ON s.route_id = r.id
    LEFT JOIN cities ca ON r.asal_id = ca.id
    LEFT JOIN cities ct ON r.tujuan_id = ct.id
    WHERE s.status = 'aktif'
      AND b.status = 'aktif'
      AND COALESCE(LOWER(s.status_perjalanan), 'terjadwal') IN ('terjadwal', 'menunggu')
  `;

  const params: unknown[] = [];
  let sql = baseSelect;
  let idx = 1;

  if (asal) {
    sql += ` AND COALESCE(ca.nama_kota, r.kota_asal) ILIKE $${idx++}`;
    params.push(`%${asal}%`);
  }
  if (tujuan) {
    sql += ` AND COALESCE(ct.nama_kota, r.kota_tujuan) ILIKE $${idx++}`;
    params.push(`%${tujuan}%`);
  }
  if (tanggal) {
    sql += ` AND s.tanggal_berangkat::date = $${idx++}::date`;
    params.push(tanggal);
  }
  if (kelas) {
    sql += ` AND LOWER(b.kelas) = LOWER($${idx++})`;
    params.push(kelas);
  }

  sql += ` ORDER BY s.tanggal_berangkat ASC, s.jam_berangkat ASC LIMIT 10`;

  const res = await query(sql, params);
  const matched = (res.rows as ScheduleDbRow[]).map(mapScheduleRow);

  if (matched.length > 0) {
    const routeTitle =
      asal || tujuan
        ? `Jadwal Bus ${asal || 'Semua Asal'} → ${tujuan || 'Semua Tujuan'}`
        : 'Jadwal Bus Tersedia Saat Ini';
    uiCards.push({
      type: 'schedules',
      title: routeTitle,
      schedules: matched,
    });
    return {
      success: true,
      matched_count: matched.length,
      schedules: matched,
    };
  }

  // Tidak cocok filter spesifik → ambil jadwal aktif lain agar user tetap punya pilihan
  const fallbackRes = await query(
    `${baseSelect} ORDER BY s.tanggal_berangkat ASC, s.jam_berangkat ASC LIMIT 8`
  );
  const alternatives = (fallbackRes.rows as ScheduleDbRow[]).map(mapScheduleRow);

  if (alternatives.length > 0) {
    uiCards.push({
      type: 'schedules',
      title: 'Jadwal Bus Aktif yang Tersedia',
      schedules: alternatives,
    });
  }

  return {
    success: true,
    matched_count: 0,
    schedules: [],
    available_alternatives: alternatives,
    note:
      alternatives.length > 0
        ? 'Tidak ditemukan jadwal persis sesuai filter, namun tersedia alternatif jadwal aktif di available_alternatives.'
        : 'Saat ini belum ada jadwal bus aktif di database.',
  };
}

async function execGetScheduleSeats(
  args: Record<string, unknown>,
  authUser: TokenPayload | null,
  authProfile: CustomerProfile | null,
  uiCards: ChatUiCard[]
): Promise<Record<string, unknown>> {
  const sid = Number(args.schedule_id);
  if (!Number.isInteger(sid) || sid <= 0) {
    return { success: false, message: 'schedule_id harus berupa ID angka yang valid.' };
  }

  try {
    await releaseExpiredBookings();
  } catch {
    /* abaikan */
  }

  const schedRes = await query(
    `SELECT
       s.id, s.bus_id, s.tanggal_berangkat, s.jam_berangkat, s.jam_tiba, s.harga,
       s.status, s.status_perjalanan,
       b.nama_bus, b.plat_nomor, b.kelas, b.kapasitas,
       COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
       COALESCE(ca.nama_terminal, r.terminal_asal) AS asal_terminal,
       COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota,
       COALESCE(ct.nama_terminal, r.terminal_tujuan) AS tujuan_terminal
     FROM schedules s
     JOIN buses b ON s.bus_id = b.id
     JOIN routes r ON s.route_id = r.id
     LEFT JOIN cities ca ON r.asal_id = ca.id
     LEFT JOIN cities ct ON r.tujuan_id = ct.id
     WHERE s.id = $1`,
    [sid]
  );

  if (schedRes.rows.length === 0) {
    return { success: false, message: `Jadwal dengan ID ${sid} tidak ditemukan.` };
  }

  const row = schedRes.rows[0] as ScheduleDbRow;
  const schedStatus = String(row.status || 'aktif').toLowerCase();
  const statusPerjalanan = String(row.status_perjalanan || 'terjadwal').toLowerCase();
  if (schedStatus !== 'aktif' || !['terjadwal', 'menunggu'].includes(statusPerjalanan)) {
    return {
      success: false,
      message: `Jadwal #${sid} tidak dapat dipesan karena statusnya saat ini "${statusPerjalanan}".`,
    };
  }

  const kapasitas = Number(row.kapasitas) || 32;
  const seatsRes = await query(
    `SELECT
       st.id AS seat_id,
       st.nomor_kursi,
       CASE WHEN bd.id IS NOT NULL THEN 'terisi' ELSE 'tersedia' END AS status
     FROM seats st
     LEFT JOIN booking_details bd
       ON st.id = bd.seat_id
      AND bd.schedule_id = $1
      AND bd.aktif = TRUE
     WHERE st.bus_id = $2
     ORDER BY LENGTH(st.nomor_kursi) ASC, st.nomor_kursi ASC
     LIMIT $3`,
    [sid, row.bus_id, kapasitas]
  );

  const activeLocks = getActiveSeatLocks(String(sid));
  const lockedCodes = new Set(activeLocks.map((l) => l.nomor_kursi.toUpperCase()));

  const mergedSeats: ChatSeatItem[] = (
    seatsRes.rows as Array<{ seat_id: string | number; nomor_kursi: string; status: string }>
  ).map((s) => ({
    seat_id: String(s.seat_id),
    nomor_kursi: s.nomor_kursi,
    status: lockedCodes.has(String(s.nomor_kursi).toUpperCase()) || s.status === 'terisi' ? 'terisi' : 'tersedia',
  }));

  const availableSeats = mergedSeats.filter((s) => s.status === 'tersedia').map((s) => s.nomor_kursi);
  const mappedSchedule = mapScheduleRow({ ...row, sisa_kursi: availableSeats.length });

  uiCards.push({
    type: 'seat_picker',
    schedule: mappedSchedule,
    seats: mergedSeats,
    available_seats: availableSeats,
    requires_login: !authUser,
    prefill_user: authProfile,
  });

  return {
    success: true,
    schedule: mappedSchedule,
    total_seats: mergedSeats.length,
    available_count: availableSeats.length,
    available_seats: availableSeats,
    requires_login: !authUser,
  };
}

async function execCreateTicketBooking(
  args: Record<string, unknown>,
  authUser: TokenPayload | null,
  uiCards: ChatUiCard[]
): Promise<Record<string, unknown>> {
  if (!authUser || !authUser.id) {
    uiCards.push({
      type: 'login_required',
      reason: 'Masuk ke akun GOVIA Anda terlebih dahulu untuk menyelesaikan pemesanan tiket.',
    });
    return {
      success: false,
      requires_login: true,
      message: 'Pelanggan belum login. Minta pelanggan klik tombol Masuk / Login di kartu chat.',
    };
  }

  const sid = Number(args.schedule_id);
  if (!Number.isInteger(sid) || sid <= 0) {
    return { success: false, message: 'schedule_id tidak valid.' };
  }

  const rawSeats = Array.isArray(args.seat_numbers)
    ? args.seat_numbers.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
    : typeof args.seat_numbers === 'string'
      ? args.seat_numbers
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : [];

  const uniqueSeats = Array.from(new Set(rawSeats));
  if (uniqueSeats.length === 0) {
    return { success: false, message: 'Minimal pilih 1 nomor kursi.' };
  }
  if (uniqueSeats.length > 4) {
    return { success: false, message: 'Maksimal 4 kursi per satu kali pemesanan.' };
  }

  const rawPassengers = Array.isArray(args.passengers) ? args.passengers : [];
  if (rawPassengers.length !== uniqueSeats.length) {
    return {
      success: false,
      message: `Jumlah data penumpang (${rawPassengers.length}) harus sama dengan jumlah kursi (${uniqueSeats.length}).`,
    };
  }

  const normalizedPassengers = rawPassengers.map((p) => {
    const obj = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    return {
      nama_penumpang: String(obj.nama_penumpang || '').trim(),
      no_identitas: String(obj.no_identitas || '').trim(),
      no_hp: String(obj.no_hp || '').trim(),
    };
  });

  if (normalizedPassengers.some((p) => !p.nama_penumpang || !p.no_identitas || !p.no_hp)) {
    return {
      success: false,
      message: 'Setiap penumpang wajib melengkapi Nama Lengkap, NIK/No. Identitas, dan No. HP/WhatsApp.',
    };
  }

  const methodRaw = String(args.metode_pembayaran || 'qris').trim().toLowerCase();
  const metode = (VALID_PAYMENT_METHODS as readonly string[]).includes(methodRaw) ? methodRaw : 'qris';
  const isCash = metode === 'cash';

  if (isCash) {
    try {
      await query(`ALTER TYPE metode_bayar ADD VALUE IF NOT EXISTS 'cash';`);
    } catch {
      /* abaikan jika sudah ada */
    }
  }

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await releaseExpiredBookings();

    const schedRes = await client.query(
      `SELECT s.id, s.harga, s.status, s.status_perjalanan, s.tanggal_berangkat, s.jam_berangkat,
              b.nama_bus, b.plat_nomor, b.kelas,
              COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
              COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota
       FROM schedules s
       JOIN buses b ON s.bus_id = b.id
       JOIN routes r ON s.route_id = r.id
       LEFT JOIN cities ca ON r.asal_id = ca.id
       LEFT JOIN cities ct ON r.tujuan_id = ct.id
       WHERE s.id = $1`,
      [sid]
    );

    if (schedRes.rows.length === 0) {
      return { success: false, message: 'Jadwal tidak ditemukan.' };
    }

    const sched = schedRes.rows[0] as {
      id: number;
      harga: string | number;
      status: string;
      status_perjalanan: string;
      tanggal_berangkat: string | Date;
      jam_berangkat: string;
      nama_bus: string;
      plat_nomor: string;
      kelas: string;
      asal_kota: string;
      tujuan_kota: string;
    };

    const schedStatus = String(sched.status || 'aktif').toLowerCase();
    const statusPerjalanan = String(sched.status_perjalanan || 'terjadwal').toLowerCase();
    if (schedStatus !== 'aktif' || !['terjadwal', 'menunggu'].includes(statusPerjalanan)) {
      return {
        success: false,
        message: `Jadwal tidak lagi terbuka untuk pemesanan (status: ${statusPerjalanan}).`,
      };
    }

    await client.query('BEGIN');

    const busSeatsRes = await client.query(
      `SELECT st.id, st.nomor_kursi
       FROM seats st
       JOIN schedules s ON s.bus_id = st.bus_id
       WHERE s.id = $1`,
      [sid]
    );
    const busSeats = busSeatsRes.rows as Array<{ id: number | string; nomor_kursi: string }>;

    const matchedSeats = uniqueSeats.map((code) =>
      busSeats.find((s) => String(s.nomor_kursi).toUpperCase() === code)
    );

    const missingIndex = matchedSeats.findIndex((m) => !m);
    if (missingIndex !== -1) {
      await client.query('ROLLBACK');
      return {
        success: false,
        message: `Kursi "${uniqueSeats[missingIndex]}" tidak tersedia pada armada jadwal ini.`,
      };
    }

    const resolvedSeats = matchedSeats.map((m, i) => ({
      seat_id: m!.id,
      nomor_kursi: m!.nomor_kursi,
      ...normalizedPassengers[i],
    }));

    const sortedSeatIds = resolvedSeats.map((s) => Number(s.seat_id)).sort((a, b) => a - b);
    for (const seatIdNum of sortedSeatIds) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`seat:${sid}:${seatIdNum}`]);
    }

    const conflictRes = await client.query(
      `SELECT st.nomor_kursi
       FROM booking_details bd
       JOIN seats st ON st.id = bd.seat_id
       WHERE bd.schedule_id = $1 AND bd.seat_id = ANY($2::bigint[]) AND bd.aktif = TRUE
       LIMIT 1`,
      [sid, sortedSeatIds]
    );

    if (conflictRes.rows.length > 0) {
      await client.query('ROLLBACK');
      const conflictSeat = String((conflictRes.rows[0] as { nomor_kursi: string }).nomor_kursi);
      clearSeatFromAllContenders(String(sid), [conflictSeat]);
      return {
        success: false,
        message: `Maaf, kursi ${conflictSeat} baru saja dipesan oleh penumpang lain. Silakan pilih kursi lain.`,
      };
    }

    const totalHarga = Number(sched.harga) * resolvedSeats.length;
    const kodeBooking = generateBookingCode();
    const bookingStatus = isCash ? 'lunas' : 'menunggu_bayar';
    const expiredAt = isCash ? null : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const bookingRes = await client.query(
      `INSERT INTO bookings (kode_booking, customer_id, schedule_id, total_harga, status, expired_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kode_booking, total_harga, status, expired_at`,
      [kodeBooking, authUser.id, sid, totalHarga, bookingStatus, expiredAt]
    );

    const bookingRow = bookingRes.rows[0] as {
      id: number;
      kode_booking: string;
      total_harga: string | number;
      status: string;
      expired_at: string | null;
    };

    const createdTickets: Array<{ kode_tiket: string; nama_penumpang: string; nomor_kursi: string }> = [];
    for (const item of resolvedSeats) {
      const kodeTiket = generateTicketCode();
      await client.query(
        `INSERT INTO booking_details
          (booking_id, schedule_id, seat_id, nama_penumpang, no_identitas, no_hp, aktif, kode_tiket, status_tiket)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, 'belum_naik')`,
        [bookingRow.id, sid, item.seat_id, item.nama_penumpang, item.no_identitas, item.no_hp, kodeTiket]
      );
      createdTickets.push({
        kode_tiket: kodeTiket,
        nama_penumpang: item.nama_penumpang,
        nomor_kursi: item.nomor_kursi,
      });
    }

    const paymentRef = isCash ? `CASH-DIRECT-${kodeBooking}` : null;
    await client.query(
      `INSERT INTO payments (booking_id, metode, jumlah, status, referensi_gateway)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [bookingRow.id, metode, totalHarga, paymentRef]
    );

    await client.query('COMMIT');
    clearSeatFromAllContenders(
      String(sid),
      createdTickets.map((t) => t.nomor_kursi)
    );

    const bookingSummary = {
      kode_booking: bookingRow.kode_booking,
      total_harga: Number(bookingRow.total_harga),
      status: bookingRow.status,
      is_cash: isCash,
      expired_at: bookingRow.expired_at,
      metode_pembayaran: metode,
      nama_bus: sched.nama_bus,
      plat_nomor: sched.plat_nomor,
      kelas: sched.kelas,
      asal_kota: sched.asal_kota,
      tujuan_kota: sched.tujuan_kota,
      tanggal_berangkat: toJakartaDateString(sched.tanggal_berangkat),
      jam_berangkat: String(sched.jam_berangkat || '').slice(0, 5),
      tickets: createdTickets,
    };

    uiCards.push({
      type: 'booking_created',
      booking: bookingSummary,
    });

    return {
      success: true,
      booking: bookingSummary,
    };
  } catch (err: unknown) {
    try {
      await client?.query('ROLLBACK');
    } catch {
      /* abaikan error rollback */
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Gagal membuat pesanan: ${msg}` };
  } finally {
    client?.release();
  }
}

async function execCheckBookingStatus(
  args: Record<string, unknown>,
  authUser: TokenPayload | null,
  uiCards: ChatUiCard[]
): Promise<Record<string, unknown>> {
  if (!authUser || !authUser.id) {
    uiCards.push({
      type: 'login_required',
      reason: 'Masuk ke akun GOVIA Anda untuk mengecek status & riwayat pemesanan tiket.',
    });
    return {
      success: false,
      requires_login: true,
      message: 'Pelanggan belum login.',
    };
  }

  try {
    await releaseExpiredBookings();
  } catch {
    /* abaikan */
  }

  const bookingCode = String(args.booking_code || '').trim().toUpperCase();
  const params: unknown[] = [authUser.id];
  let whereExtra = '';
  if (bookingCode) {
    params.push(bookingCode);
    whereExtra = ' AND UPPER(bk.kode_booking) = $2';
  }

  const res = await query(
    `SELECT
       bk.kode_booking,
       bk.status,
       bk.total_harga,
       s.tanggal_berangkat,
       s.jam_berangkat,
       bs.nama_bus,
       COALESCE(ca.nama_kota, r.kota_asal) AS asal_kota,
       COALESCE(ct.nama_kota, r.kota_tujuan) AS tujuan_kota,
       (
         SELECT p.metode FROM payments p WHERE p.booking_id = bk.id ORDER BY p.id DESC LIMIT 1
       ) AS metode_pembayaran,
       (
         SELECT STRING_AGG(st.nomor_kursi, ', ' ORDER BY st.nomor_kursi)
         FROM booking_details bd
         JOIN seats st ON st.id = bd.seat_id
         WHERE bd.booking_id = bk.id
       ) AS kursi
     FROM bookings bk
     JOIN schedules s ON bk.schedule_id = s.id
     JOIN buses bs ON s.bus_id = bs.id
     JOIN routes r ON s.route_id = r.id
     LEFT JOIN cities ca ON r.asal_id = ca.id
     LEFT JOIN cities ct ON r.tujuan_id = ct.id
     WHERE bk.customer_id = $1${whereExtra}
     ORDER BY bk.created_at DESC
     LIMIT 5`,
    params
  );

  const list = (
    res.rows as Array<{
      kode_booking: string;
      status: string;
      total_harga: string | number;
      metode_pembayaran: string | null;
      nama_bus: string;
      asal_kota: string;
      tujuan_kota: string;
      tanggal_berangkat: string | Date;
      jam_berangkat: string;
      kursi: string | null;
    }>
  ).map((r) => ({
    kode_booking: r.kode_booking,
    status: r.status,
    total_harga: Number(r.total_harga || 0),
    metode_pembayaran: r.metode_pembayaran,
    nama_bus: r.nama_bus,
    asal_kota: r.asal_kota,
    tujuan_kota: r.tujuan_kota,
    tanggal_berangkat: toJakartaDateString(r.tanggal_berangkat),
    jam_berangkat: String(r.jam_berangkat || '').slice(0, 5),
    kursi: r.kursi || '-',
  }));

  if (list.length > 0) {
    uiCards.push({
      type: 'booking_status',
      bookings: list,
    });
  }

  return {
    success: true,
    total: list.length,
    bookings: list,
  };
}

async function dispatchToolCall(
  fc: GeminiFunctionCall,
  authUser: TokenPayload | null,
  authProfile: CustomerProfile | null,
  uiCards: ChatUiCard[]
): Promise<Record<string, unknown>> {
  const args = fc.args && typeof fc.args === 'object' ? fc.args : {};
  switch (fc.name) {
    case 'search_schedules':
      return execSearchSchedules(args, uiCards);
    case 'get_schedule_seats':
      return execGetScheduleSeats(args, authUser, authProfile, uiCards);
    case 'create_ticket_booking':
      return execCreateTicketBooking(args, authUser, uiCards);
    case 'check_booking_status':
      return execCheckBookingStatus(args, authUser, uiCards);
    default:
      return { success: false, message: `Tool "${fc.name}" tidak dikenal.` };
  }
}

// ── Gemini API Caller dengan Retry & Cross-Model Fallback ──────────────────────

async function callSingleModel(
  model: string,
  apiKey: string,
  systemPrompt: string,
  contents: GeminiContent[]
): Promise<{ content: GeminiContent | null; status: number }> {
  const maxAttempts = 2;
  let lastStatus = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(GEMINI_URL(model, apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          tools: GEMINI_TOOLS,
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 2048,
          },
        }),
      });

      lastStatus = res.status;
      if (res.ok) {
        const data = (await res.json()) as GeminiApiResponse;
        const content = data.candidates?.[0]?.content || null;
        return { content, status: res.status };
      }

      // Error autentikasi/key tidak perlu di-retry
      if (res.status === 401 || res.status === 403) {
        return { content: null, status: res.status };
      }

      // Retry sekali untuk lonjakan sementara 503/429
      if ((res.status === 503 || res.status === 429) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }

      return { content: null, status: res.status };
    } catch {
      lastStatus = 0;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  return { content: null, status: lastStatus };
}

async function generateStepWithFallback(
  candidates: string[],
  preferredModel: string | null,
  apiKey: string,
  systemPrompt: string,
  contents: GeminiContent[]
): Promise<{ content: GeminiContent | null; modelUsed: string | null; lastStatus: number }> {
  const ordered = preferredModel
    ? [preferredModel, ...candidates.filter((m) => m !== preferredModel)]
    : candidates;

  let lastStatus = 0;
  for (const model of ordered) {
    // Saat berpindah ke model berbeda di tengah tool-loop, bersihkan thoughtSignature lama
    const safeContents =
      preferredModel && model !== preferredModel ? stripThoughtSignatures(contents) : contents;

    const { content, status } = await callSingleModel(model, apiKey, systemPrompt, safeContents);
    lastStatus = status;

    if (content?.parts && content.parts.length > 0) {
      return { content, modelUsed: model, lastStatus: status };
    }

    if (status === 401 || status === 403) {
      break;
    }
  }

  return { content: null, modelUsed: null, lastStatus };
}

/** Jawaban fallback darurat apabila seluruh koneksi ke Google Gemini gagal */
function fallbackReply(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('pesan') || lower.includes('tiket') || lower.includes('jadwal') || lower.includes('kursi')) {
    return 'Maaf, koneksi ke Google Gemini sedang tidak stabil. Namun Anda tetap bisa memilih jadwal & memesan tiket melalui kartu jadwal yang ditampilkan atau lewat menu **Cari Tiket**.';
  }
  if (lower.includes('bayar') || lower.includes('midtrans') || lower.includes('qris') || lower.includes('cash')) {
    return 'GOVIA mendukung pembayaran QRIS, Virtual Account (BCA/Mandiri/BRI/BNI), E-Wallet via Midtrans, dan pembayaran Cash langsung saat naik bus.';
  }
  if (lower.includes('reschedule') || lower.includes('batal') || lower.includes('refund')) {
    return 'Pembatalan & pengajuan refund tiket lunas dapat dilakukan melalui menu **Pesanan Saya**. Kursi akan dilepas otomatis setelah diproses.';
  }
  return 'Maaf, koneksi ke server Google Gemini sedang mengalami gangguan sesaat. Silakan kirim ulang pertanyaan Anda beberapa detik lagi.';
}

// ── Handler Utama POST /api/chat ───────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
    };

    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!rawMessage) {
      return NextResponse.json(
        { success: false, message: 'Pesan (message) wajib diisi.' },
        { status: 400 }
      );
    }

    const authUser = authenticateRequest(request);
    let authProfile: CustomerProfile | null = null;
    if (authUser?.id) {
      try {
        const custRes = await query(
          'SELECT nama, email, no_hp FROM customers WHERE id = $1 LIMIT 1',
          [authUser.id]
        );
        const custRow = custRes.rows[0] as { nama?: string; email?: string; no_hp?: string } | undefined;
        authProfile = {
          nama: custRow?.nama || authUser.nama,
          email: custRow?.email || authUser.email,
          no_hp: custRow?.no_hp || '',
        };
      } catch {
        authProfile = { nama: authUser.nama, email: authUser.email, no_hp: '' };
      }
    }

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const uiCards: ChatUiCard[] = [];

    if (!apiKey) {
      return NextResponse.json({
        success: true,
        mode: 'fallback',
        reply: fallbackReply(rawMessage),
        cards: uiCards,
        note: 'GEMINI_API_KEY belum diisi di backend/bustix/.env.',
      });
    }

    const candidates = getModelCandidates();
    const systemPrompt = buildSystemPrompt(authProfile);
    const contents = sanitizeHistory(body.history, rawMessage);

    let activeModel: string | null = null;
    let lastStatus = 0;
    const maxRounds = 4;

    for (let round = 0; round < maxRounds; round++) {
      const step = await generateStepWithFallback(
        candidates,
        activeModel,
        apiKey,
        systemPrompt,
        contents
      );
      lastStatus = step.lastStatus;

      if (!step.content) {
        break;
      }

      activeModel = step.modelUsed;
      const modelContent: GeminiContent = {
        role: 'model',
        parts: step.content.parts,
      };
      contents.push(modelContent);

      const functionCalls = modelContent.parts
        .map((p) => p.functionCall)
        .filter((fc): fc is GeminiFunctionCall => Boolean(fc && fc.name));

      if (functionCalls.length === 0) {
        const replyText = extractReplyText(modelContent.parts);
        if (replyText) {
          return NextResponse.json({
            success: true,
            mode: 'gemini',
            model: activeModel,
            reply: replyText,
            cards: uiCards,
          });
        }
        break;
      }

      // Eksekusi semua tool call yang diminta Gemini dan kembalikan hasilnya
      const responseParts: GeminiPart[] = [];
      for (const fc of functionCalls) {
        const result = await dispatchToolCall(fc, authUser, authProfile, uiCards);
        responseParts.push({
          functionResponse: {
            name: fc.name,
            ...(fc.id ? { id: fc.id } : {}),
            response: result,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });
    }

    console.warn('Gemini Chat fallback triggered. Status terakhir:', lastStatus);
    return NextResponse.json({
      success: true,
      mode: 'fallback',
      reply: fallbackReply(rawMessage),
      cards: uiCards,
      note: `Gemini tidak merespons (status ${lastStatus}).`,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Chat API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal memproses pesan AI.', error: errMessage },
      { status: 500 }
    );
  }
}
