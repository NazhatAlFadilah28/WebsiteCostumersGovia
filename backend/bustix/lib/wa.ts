/**
 * ============================================================
 *  Helper WhatsApp Service (Baileys)
 * ============================================================
 *  Backend BusTix TIDAK berkomunikasi langsung ke WhatsApp.
 *  Ia memanggil microservice `backend/wa-service` melalui HTTP.
 *
 *  Konfigurasi di backend/bustix/.env:
 *    WA_SERVICE_URL=http://localhost:3002
 *    WA_SERVICE_API_KEY=bustix-wa-secret-key
 * ============================================================
 */

const WA_URL = (process.env.WA_SERVICE_URL || 'http://localhost:3002').replace(/\/$/, '');
const WA_KEY = process.env.WA_SERVICE_API_KEY || 'bustix-wa-secret-key';

export interface WaSendResult {
  success: boolean;
  message: string;
  to?: string;
  kode_booking?: string;
  jumlah_tiket?: number;
}

/** Cek apakah WA service sedang aktif & nomor sudah tertaut. */
export async function waServiceStatus(): Promise<{ connected: boolean; number: string | null }> {
  try {
    const res = await fetch(`${WA_URL}/health`, { cache: 'no-store' });
    const data = await res.json();
    return { connected: !!data.connected, number: data.number ?? null };
  } catch {
    return { connected: false, number: null };
  }
}

/**
 * Perintahkan WA service mengirim E-Ticket ke nomor WhatsApp penumpang.
 * @param bookingCode kode_booking (atau kode_tiket)
 * @param noHp opsional — override nomor tujuan
 */
export async function sendTicketToWhatsApp(
  bookingCode: string,
  noHp?: string
): Promise<WaSendResult> {
  try {
    const res = await fetch(`${WA_URL}/send-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': WA_KEY },
      body: JSON.stringify({ booking_code: bookingCode, no_hp: noHp }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        message: data?.message || `WA service error (${res.status}). Pastikan bot WhatsApp aktif.`,
      };
    }

    return data as WaSendResult;
  } catch {
    return {
      success: false,
      message: 'Tidak dapat menghubungi layanan WhatsApp. Pastikan wa-service berjalan (npm start di backend/wa-service).',
    };
  }
}

/** Kirim pesan teks bebas (notifikasi/reminder) via WA service. */
export async function sendWhatsAppMessage(to: string, message: string): Promise<WaSendResult> {
  try {
    const res = await fetch(`${WA_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': WA_KEY },
      body: JSON.stringify({ to, message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, message: data?.message || `WA service error (${res.status}).` };
    return data as WaSendResult;
  } catch {
    return { success: false, message: 'Tidak dapat menghubungi layanan WhatsApp.' };
  }
}
