/**
 * ============================================================
 * BusTix Real Backend API Service Layer
 * ============================================================
 * Menghubungkan Frontend ke Backend Next.js API Routes di:
 * `Costumer Web/backend/bustix/app/api/*`
 *
 * Semua request otomatis menyertakan JWT token (Authorization: Bearer)
 * yang disimpan di localStorage setelah login/register.
 * ============================================================
 */

const BASE_URL = '/api';

/** Ambil token JWT dari localStorage */
export function getToken(): string | null {
  try {
    return localStorage.getItem('govia_token') || localStorage.getItem('bustix_token');
  } catch {
    return null;
  }
}

/** Ambil data user yang sedang login dari localStorage */
export function getStoredUser(): {
  id: number | string;
  nama: string;
  email: string;
  no_hp?: string;
  role?: string;
  avatar_url?: string | null;
  google_id?: string | null;
} | null {
  try {
    const raw = localStorage.getItem('govia_user') || localStorage.getItem('bustix_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Hapus sesi login */
export function clearSession(): void {
  try {
    localStorage.removeItem('govia_token');
    localStorage.removeItem('govia_user');
    localStorage.removeItem('bustix_token');
    localStorage.removeItem('bustix_user');
  } catch {
    /* ignore */
  }
}

/** Helper Generic Fetch (otomatis menyisipkan Authorization header) */
export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const opts = options || {};

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    credentials: 'include',
    ...opts,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (data as { message?: string }).message || `HTTP Error ${res.status}`;
    const error = new Error(message) as Error & { status?: number; code?: string; payload?: unknown };
    error.status = res.status;
    error.code = (data as { code?: string }).code;
    error.payload = data;
    throw error;
  }

  return data as T;
}

// ── Tipe Respons Umum ────────────────────────────────────────
export interface ApiUser {
  id: number | string;
  nama: string;
  email: string;
  no_hp?: string;
  role: string;
  avatar_url?: string | null;
  google_id?: string | null;
}

export interface ScheduleItem {
  id: string;
  nama_bus: string;
  plat_nomor: string;
  kelas: string;
  kapasitas: number;
  foto_bus?: string | null;
  sisa_kursi: number;
  jam_berangkat: string;
  jam_tiba: string;
  harga: string;
  tanggal_berangkat: string;
  asal_kota: string;
  asal_terminal: string;
  tujuan_kota: string;
  tujuan_terminal: string;
  status?: string;
  status_perjalanan: string;
  lokasi_terakhir?: string | null;
  catatan_operasional?: string | null;
}

export interface ScheduleBookingState {
  isBookable: boolean;
  isDeparted: boolean;
  isArrived: boolean;
  isCancelled: boolean;
  shortBadgeText: string;
  badgeText: string;
  reasonText: string;
}

export function getScheduleBookingState(
  schedule?: {
    status?: string | null;
    status_perjalanan?: string | null;
    catatan_operasional?: string | null;
    lokasi_terakhir?: string | null;
  } | null
): ScheduleBookingState {
  const schedStatus = String(schedule?.status || 'aktif').trim().toLowerCase();
  const statusPerjalanan = String(schedule?.status_perjalanan || 'terjadwal').trim().toLowerCase();

  const isArrived = statusPerjalanan === 'tiba';
  const isCancelled = statusPerjalanan === 'dibatalkan' || schedStatus !== 'aktif';
  const isBookable = schedStatus === 'aktif' && (statusPerjalanan === 'terjadwal' || statusPerjalanan === 'menunggu');

  if (statusPerjalanan === 'berangkat') {
    return {
      isBookable: false,
      isDeparted: true,
      isArrived: false,
      isCancelled: false,
      shortBadgeText: 'Bus Sudah Berangkat',
      badgeText: 'Bus Sudah Berangkat',
      reasonText: 'Bus sudah berangkat dari terminal. Pemesanan tiket untuk jadwal ini sudah ditutup.',
    };
  }

  if (statusPerjalanan === 'dalam_perjalanan') {
    return {
      isBookable: false,
      isDeparted: true,
      isArrived: false,
      isCancelled: false,
      shortBadgeText: 'Bus Sudah Berangkat',
      badgeText: 'Bus Sudah Berangkat • Dalam Perjalanan',
      reasonText: 'Bus sudah berangkat dan sedang dalam perjalanan. Pemesanan tiket untuk jadwal ini sudah ditutup.',
    };
  }

  if (isArrived) {
    return {
      isBookable: false,
      isDeparted: false,
      isArrived: true,
      isCancelled: false,
      shortBadgeText: 'Bus Sudah Tiba',
      badgeText: 'Bus Sudah Tiba',
      reasonText: 'Bus sudah tiba di terminal tujuan. Pemesanan tiket sudah ditutup.',
    };
  }

  if (isCancelled) {
    return {
      isBookable: false,
      isDeparted: false,
      isArrived: false,
      isCancelled: true,
      shortBadgeText: 'Tidak Tersedia',
      badgeText: 'Jadwal Dibatalkan / Nonaktif',
      reasonText: 'Jadwal perjalanan ini dibatalkan atau tidak aktif. Silakan pilih jadwal lain.',
    };
  }

  return {
    isBookable,
    isDeparted: false,
    isArrived: false,
    isCancelled: false,
    shortBadgeText: 'Tersedia',
    badgeText: 'Belum Berangkat (Tersedia)',
    reasonText: '',
  };
}

export interface SeatItem {
  seat_id: string;
  nomor_kursi: string;
  status: 'tersedia' | 'terisi';
}

export interface PassengerInput {
  seat_id?: string | number;
  nomor_kursi?: string;
  nama_penumpang: string;
  no_identitas: string;
  no_hp: string;
}

export interface SeatQueueEntry {
  seat: string;
  contenders: number;
  your_position: number | null;
  is_front_of_queue: boolean;
  is_booked: boolean;
}

export interface SeatQueueResponse {
  success: boolean;
  schedule_id: string;
  total_active_queue: number;
  max_queue_capacity: number;
  booked_seats_count: number;
  per_seat: Record<string, SeatQueueEntry>;
}

// ── 1. AUTH API (`/api/auth/*`) ─────────────────────────────
export const authApi = {
  login: (data: { email: string; password: string }) =>
    fetchApi<{ success: boolean; message: string; token: string; user: ApiUser }>('/auth/login-customer', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  register: (data: { nama: string; email: string; password: string; no_hp: string }) =>
    fetchApi<{ success: boolean; message: string; token: string; user: ApiUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  me: () => fetchApi<{ success: boolean; user: ApiUser }>('/auth/me'),

  logout: () => fetchApi<{ success: boolean; message: string }>('/auth/logout', { method: 'POST' }),
};

// ── 2. JADWAL BUS API (`/api/schedules/*`) ───────────────────
export const schedulesApi = {
  // Cari jadwal bus
  search: (params: { asal_id?: string; tujuan_id?: string; tanggal?: string; kelas?: string; max_harga?: string }) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const query = new URLSearchParams(clean as Record<string, string>).toString();
    return fetchApi<{ success: boolean; total: number; data: ScheduleItem[] }>(`/schedules/search?${query}`);
  },

  // Detail jadwal
  getById: (scheduleId: string) =>
    fetchApi<{ success: boolean; data: ScheduleItem }>(`/schedules/${scheduleId}`),

  // Ambil denah kursi & status terisi
  getSeats: (scheduleId: string) =>
    fetchApi<{
      success: boolean;
      schedule_id: string;
      bus_id: string;
      total_seats: number;
      status?: string;
      status_perjalanan?: string;
      lokasi_terakhir?: string | null;
      catatan_operasional?: string | null;
      seats: SeatItem[];
    }>(
      `/schedules/${scheduleId}/seats`
    ),

  // Bergabung / heartbeat antrean pemilihan kursi (kapasitas 20.000 pemilih simultan)
  joinQueue: (
    scheduleId: string,
    data: { session_id: string; seats: string[]; user_label?: string; action?: 'join' | 'heartbeat' | 'check' }
  ) =>
    fetchApi<SeatQueueResponse>(`/schedules/${scheduleId}/queue`, {
      method: 'POST',
      body: JSON.stringify({ action: data.action || 'join', ...data }),
    }),

  // Cek snapshot antrean kursi saat ini (GET)
  checkQueue: (scheduleId: string, params?: { session_id?: string; seats?: string[] }) => {
    const q = new URLSearchParams();
    if (params?.session_id) q.set('session_id', params.session_id);
    if (params?.seats?.length) q.set('seats', params.seats.join(','));
    const qs = q.toString();
    return fetchApi<SeatQueueResponse>(`/schedules/${scheduleId}/queue${qs ? `?${qs}` : ''}`);
  },

  // Keluar dari antrean pemilihan kursi saat meninggalkan halaman
  leaveQueue: (scheduleId: string, sessionId: string) =>
    fetchApi<{ success: boolean; schedule_id: string; total_active_queue: number; max_queue_capacity: number }>(
      `/schedules/${scheduleId}/queue`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'leave', session_id: sessionId }),
      }
    ),
};

// ── 3. BOOKING / PESANAN API (`/api/booking/*`) ──────────────
export interface PickupPayloadInput {
  tipe_keberangkatan: 'terminal' | 'pickup';
  nama_lokasi?: string;
  kategori_lokasi?: string;
  alamat_lengkap?: string;
  lat?: number;
  lng?: number;
  jarak_ke_rute_km?: number;
  estimasi_bus_tiba?: string;
  status_validasi?: 'valid' | 'perlu_review' | 'terlalu_jauh';
  biaya_tambahan?: number;
  catatan_customer?: string;
  rute_asal?: string;
  rute_tujuan?: string;
  nama_bus?: string;
  plat_nomor?: string;
}

export const bookingApi = {
  // Kunci kursi sementara (Lock Seats). customer_id otomatis diambil dari token di backend.
  lockSeats: (data: {
    schedule_id: string;
    passengers: PassengerInput[];
    metode_pembayaran?: string;
    session_id?: string;
    pickup_info?: PickupPayloadInput;
  }) =>
    fetchApi<{
      success: boolean;
      is_cash?: boolean;
      direct_ticket?: boolean;
      message: string;
      queue_info?: {
        urutan_antrean: number;
        total_antrean_jadwal: number;
        max_queue_capacity?: number;
        mode_kursi: 'RANDOM_SISTEM_PICKUP' | 'PILIHAN_TERMINAL_FCFS';
        assigned_seats: Array<string | null>;
      };
      booking: {
        id: number;
        kode_booking: string;
        total_harga: number;
        status: string;
        expired_at: string | null;
        created_at: string;
        tickets: Array<{ id: number; seat_id: number; nomor_kursi: string | null; nama_penumpang: string; kode_tiket: string }>;
        payment: { id: number; metode: string; jumlah: number; status: string; referensi_gateway?: string | null };
        pickup?: PickupRequestRecord | null;
      };
    }>('/booking/lock-seats', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Ambil data booking via booking code
  getByCode: (bookingCode: string) =>
    fetchApi<{ success: boolean; data: BookingDetail }>(`/booking/${bookingCode}`),

  // Batalkan booking (melepas kursi)
  cancel: (bookingCode: string) =>
    fetchApi<{ success: boolean; message: string }>(`/booking/${bookingCode}`, { method: 'DELETE' }),

  // Cek posisi antrean pembayaran setelah kursi dikunci
  queue: (bookingCode: string) =>
    fetchApi<QueueStatus>(`/booking/${bookingCode}/queue`),
};

export interface QueueStatus {
  success: boolean;
  kode_booking: string;
  status: string;
  posisi_antrean: number | null;
  total_antrean: number;
  expired_at: string | null;
  sisa_detik: number;
}

// ── 3b. REFUND API (`/api/refund/*`) ─────────────────────────
export interface RefundStatus {
  success: boolean;
  booking_status: string;
  refund: {
    id: number;
    alasan: string;
    potongan_persen: string | number;
    potongan_nominal: string | number;
    dana_kembali: string | number;
    status: string;
    catatan_admin: string | null;
    created_at: string;
    waktu_proses: string | null;
  } | null;
}

export const refundApi = {
  // Ajukan refund (booking harus lunas)
  create: (data: { booking_code: string; alasan: string }) =>
    fetchApi<{
      success: boolean;
      message: string;
      refund: {
        id: number;
        booking_id: number;
        alasan: string;
        potongan_persen: string | number;
        potongan_nominal: string | number;
        dana_kembali: string | number;
        status: string;
        created_at: string;
      };
    }>('/refund', { method: 'POST', body: JSON.stringify(data) }),

  // Status refund sebuah booking
  getStatus: (bookingCode: string) => fetchApi<RefundStatus>(`/refund/${bookingCode}`),
};

// ── 4. PEMBAYARAN API (`/api/payments/*`) ────────────────────
export const paymentsApi = {
  // Buat transaksi pembayaran (Midtrans Snap atau fallback simulasi lokal)
  charge: (data: { booking_code: string; metode?: string }) =>
    fetchApi<ChargeResponse>('/payments/charge', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Konfirmasi pembayaran (mode simulasi / manual)
  confirm: (data: { booking_code: string; referensi?: string }) =>
    fetchApi<{ success: boolean; message: string; status: string }>('/payments/confirm', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export interface ChargeResponse {
  success: boolean;
  mode: 'midtrans' | 'simulation';
  message: string;
  booking_code: string;
  total_harga: number;
  token?: string;
  redirect_url?: string;
  va_number?: string;
  qris_string?: string;
  reference?: string;
  note?: string;
}

// ── 5. E-TICKET & BOARDING PASS API (`/api/tickets/*`) ───────
export const ticketsApi = {
  // Ambil detail e-ticket & validasi QR (via kode_booking)
  getByCode: (bookingCode: string) =>
    fetchApi<{ success: boolean; data: TicketData }>(`/tickets/${bookingCode}`),

  // Kirim E-Ticket ke WhatsApp penumpang (via chat bot Baileys)
  sendWhatsApp: (data: { booking_code: string; no_hp?: string }) =>
    fetchApi<{
      success: boolean;
      message: string;
      to?: string;
      kode_booking?: string;
      jumlah_tiket?: number;
      code?: string;
    }>('/tickets/send-wa', { method: 'POST', body: JSON.stringify(data) }),

  // Cek status koneksi bot WhatsApp
  waStatus: () =>
    fetchApi<{ success: boolean; wa_service: { connected: boolean; number: string | null }; hint: string }>(
      '/tickets/send-wa'
    ),

  // Kirim E-Ticket ke Email customer
  sendEmail: (data: { booking_code: string; email_override?: string }) =>
    fetchApi<{ success: boolean; message: string; to: string }>('/tickets/send-email', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export interface BookingDetail {
  id: number;
  kode_booking: string;
  customer_id: number;
  schedule_id: number;
  total_harga: string | number;
  status: string;
  expired_at: string;
  created_at: string;
  customer_nama: string;
  customer_email: string;
  customer_no_hp: string;
  tanggal_berangkat: string;
  jam_berangkat: string;
  jam_tiba: string;
  schedule_status?: string;
  status_perjalanan: string;
  lokasi_terakhir?: string | null;
  catatan_operasional?: string | null;
  nama_bus: string;
  plat_nomor: string;
  kelas: string;
  asal_kota: string;
  asal_terminal: string;
  tujuan_kota: string;
  tujuan_terminal: string;
  passengers: Array<{
    id: number;
    nama_penumpang: string;
    no_identitas: string;
    no_hp: string;
    kode_tiket: string;
    status_tiket: string;
    waktu_scan: string | null;
    nomor_kursi: string;
  }>;
  payment: {
    id: number;
    metode: string;
    jumlah: string | number;
    status: string;
    referensi_gateway: string | null;
    waktu_bayar: string | null;
  } | null;
  pickup?: PickupRequestRecord | null;
}

export interface TicketData {
  ticket_id: number;
  kode_tiket: string;
  nama_penumpang: string;
  no_identitas: string;
  penumpang_no_hp: string;
  status_tiket: string;
  waktu_scan: string | null;
  nomor_kursi: string;
  kode_booking: string;
  status_booking: string;
  schedule_id: number;
  tanggal_berangkat: string;
  jam_berangkat: string;
  jam_tiba: string;
  schedule_status?: string;
  status_perjalanan: string;
  lokasi_terakhir?: string | null;
  catatan_operasional?: string | null;
  nama_bus: string;
  plat_nomor: string;
  kelas: string;
  asal_kota: string;
  asal_terminal: string;
  tujuan_kota: string;
  tujuan_terminal: string;
  metode_pembayaran?: string | null;
  status_pembayaran?: string | null;
  referensi_gateway?: string | null;
  qr_payload: string;
  passengers?: TicketData[];
  pickup?: PickupRequestRecord | null;
}

// ── 6. PROFIL & RIWAYAT CUSTOMER (`/api/customer/*`) ─────────
export interface HistoryItem {
  booking_id: number;
  kode_booking: string;
  total_harga: string | number;
  status_booking: string;
  expired_at: string;
  created_at: string;
  schedule_id: number;
  tanggal_berangkat: string;
  jam_berangkat: string;
  jam_tiba: string;
  schedule_status?: string;
  status_perjalanan: string;
  lokasi_terakhir?: string | null;
  catatan_operasional?: string | null;
  nama_bus: string;
  plat_nomor: string;
  kelas: string;
  asal_kota: string;
  asal_terminal: string;
  tujuan_kota: string;
  tujuan_terminal: string;
  jumlah_penumpang: string | number;
  nomor_kursi: string | null;
  status_pembayaran: string | null;
  metode_pembayaran: string | null;
  pickup?: PickupRequestRecord | null;
}

export const customerApi = {
  getHistory: () =>
    fetchApi<{ success: boolean; total: number; history: HistoryItem[] }>('/customer/history'),
};

// ── 7. AI CHATBOT (`/api/chat`) ──────────────────────────────
export interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

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

export interface ChatSchedulesCard {
  type: 'schedules';
  title: string;
  schedules: ChatScheduleItem[];
}

export interface ChatSeatPickerCard {
  type: 'seat_picker';
  schedule: ChatScheduleItem;
  seats: ChatSeatItem[];
  available_seats: string[];
  requires_login: boolean;
  prefill_user: { nama: string; email: string; no_hp: string } | null;
}

export interface ChatBookingCreatedCard {
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

export interface ChatBookingStatusCard {
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

export interface ChatLoginRequiredCard {
  type: 'login_required';
  reason: string;
}

export type ChatUiCard =
  | ChatSchedulesCard
  | ChatSeatPickerCard
  | ChatBookingCreatedCard
  | ChatBookingStatusCard
  | ChatLoginRequiredCard;

export const chatApi = {
  send: (data: { message: string; history?: ChatHistoryItem[] }) =>
    fetchApi<{
      success: boolean;
      mode: 'gemini' | 'fallback';
      reply: string;
      model?: string;
      cards?: ChatUiCard[];
      note?: string;
    }>('/chat', { method: 'POST', body: JSON.stringify(data) }),
};

// ── 8. JADWAL & TIKET PERJALANAN (`/api/jadwal`) ──────────────
export interface InputJadwalData {
  nama_penumpang: string;
  no_identitas: string;
  asal_kota: string;
  tujuan_kota: string;
  tanggal_berangkat: string;
  kelas_layanan: string;
}

export const jadwalApi = {
  simpan: (data: InputJadwalData) =>
    fetchApi<{ success: boolean; message: string; data: unknown }>(
      '/jadwal',
      { method: 'POST', body: JSON.stringify(data) }
    ),
  ambilSemua: () =>
    fetchApi<{ success: boolean; total: number; data: unknown[] }>('/jadwal'),
};

// ── 9. FITUR TITIK PENJEMPUTAN FLEKSIBEL (`/api/pickup`) ──────
export type PickupStatusType =
  | 'Menunggu Konfirmasi'
  | 'Disetujui'
  | 'Ditolak'
  | 'Bus Menuju Lokasi'
  | 'Bus Telah Tiba'
  | 'Customer Telah Dijemput';

export interface AllowedPickupPointItem {
  id: string;
  nama_lokasi: string;
  kategori: 'SPBU' | 'Minimarket' | 'Rest Area / Exit Tol' | 'Halte / Tempat Umum' | 'Pinggir Jalan Aman';
  kota: string;
  alamat: string;
  lat: number;
  lng: number;
  jarak_rute_km: number;
  estimasi_menit_dari_terminal: number;
  biaya_tambahan: number;
  catatan_keamanan: string;
  aktif: boolean;
  jarak_dari_customer_km?: number;
}

export interface PickupRequestRecord {
  id: string;
  kode_booking: string;
  schedule_id: string;
  customer_id: string | number;
  nama_customer: string;
  no_hp: string;
  tipe_keberangkatan: 'terminal' | 'pickup';
  nama_lokasi: string;
  kategori_lokasi: string;
  alamat_lengkap: string;
  lat: number;
  lng: number;
  jarak_ke_rute_km: number;
  estimasi_bus_tiba: string;
  status_validasi: 'valid' | 'perlu_review' | 'terlalu_jauh';
  status_penjemputan: PickupStatusType;
  biaya_tambahan: number;
  catatan_customer?: string;
  catatan_admin?: string;
  catatan_staf_sopir?: string;
  rute_asal: string;
  rute_tujuan: string;
  nama_bus: string;
  plat_nomor: string;
  nomor_kursi: string;
  created_at: string;
  updated_at: string;
}

export interface PickupValidationResult {
  bisa_dijemput: boolean;
  status_validasi: 'valid' | 'perlu_review' | 'terlalu_jauh';
  jarak_ke_rute_km: number;
  estimasi_menit_dari_terminal: number;
  estimasi_bus_tiba: string;
  rekomendasi_biaya_tambahan: number;
  pesan_validasi: string;
  road_name?: string;
  formatted_address?: string;
  city?: string;
  geocode_source?: string;
  titik_terdekat: AllowedPickupPointItem | null;
  daftar_rekomendasi: AllowedPickupPointItem[];
  koridor_rute: Array<{ name: string; lat: number; lng: number; offsetMins: number }>;
}

export const pickupApi = {
  getPointsAndCorridor: (asalKota = 'Jakarta', tujuanKota = 'Surabaya') =>
    fetchApi<{
      success: boolean;
      points: AllowedPickupPointItem[];
      corridor: Array<{ name: string; lat: number; lng: number; offsetMins: number }>;
    }>(
      `/pickup?mode=points&kota=${encodeURIComponent(asalKota)}&asal_kota=${encodeURIComponent(asalKota)}&tujuan_kota=${encodeURIComponent(tujuanKota)}`
    ),

  validateLocation: (params: {
    lat: number;
    lng: number;
    alamat?: string;
    asal_kota?: string;
    tujuan_kota?: string;
    jam_berangkat?: string;
  }) =>
    fetchApi<{ success: boolean; validation: PickupValidationResult }>('/pickup', {
      method: 'POST',
      body: JSON.stringify({ action: 'validate-location', ...params }),
    }),

  getAllRequests: (params?: { kode_booking?: string; status?: string; kota?: string }) => {
    const q = new URLSearchParams();
    if (params?.kode_booking) q.set('kode_booking', params.kode_booking);
    if (params?.status) q.set('status', params.status);
    if (params?.kota) q.set('kota', params.kota);
    return fetchApi<{
      success: boolean;
      total: number;
      requests: PickupRequestRecord[];
      allowed_points: AllowedPickupPointItem[];
    }>(`/pickup?${q.toString()}`);
  },

  createRequest: (data: Partial<PickupRequestRecord>) =>
    fetchApi<{ success: boolean; message: string; pickup: PickupRequestRecord }>('/pickup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateStatus: (data: {
    id?: string;
    kode_booking?: string;
    status_penjemputan?: PickupStatusType;
    biaya_tambahan?: number;
    catatan_admin?: string;
    catatan_staf_sopir?: string;
    estimasi_bus_tiba?: string;
  }) =>
    fetchApi<{ success: boolean; message: string; pickup: PickupRequestRecord }>('/pickup', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  addAllowedPoint: (data: Omit<AllowedPickupPointItem, 'id' | 'aktif'>) =>
    fetchApi<{ success: boolean; message: string; point: AllowedPickupPointItem; allowed_points: AllowedPickupPointItem[] }>('/pickup', {
      method: 'POST',
      body: JSON.stringify({ action: 'add-allowed-point', ...data }),
    }),

  toggleAllowedPoint: (id: string) =>
    fetchApi<{ success: boolean; message: string; allowed_points: AllowedPickupPointItem[] }>('/pickup', {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle-allowed-point', id }),
    }),

  deleteAllowedPoint: (id: string) =>
    fetchApi<{ success: boolean; message: string; allowed_points: AllowedPickupPointItem[] }>('/pickup', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete-allowed-point', id }),
    }),
};
