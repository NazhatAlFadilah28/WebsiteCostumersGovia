import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { sendTicketToWhatsApp, waServiceStatus } from '@/lib/wa';

/**
 * POST /api/tickets/send-wa
 *
 * Memerintahkan microservice WhatsApp (Baileys) mengirim E-Ticket
 * ke nomor WhatsApp penumpang.
 *
 * Body: { booking_code: string, no_hp?: string }
 *
 * Alur:
 *   Frontend (tombol "Kirim WhatsApp")
 *        │  ticketsApi.sendWhatsApp({ booking_code })
 *        ▼
 *   Route ini (Next.js)  ── verifikasi login + ambil nomor dari DB
 *        │  POST http://localhost:3002/send-ticket  (header x-api-key)
 *        ▼
 *   wa-service (Baileys)  ── kirim teks + gambar QR ke WhatsApp
 */
export async function POST(request: Request) {
  try {
    // Wajib login agar tidak sembarang orang mengirim tiket
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, message: 'Anda harus login untuk mengirim tiket ke WhatsApp.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { booking_code, no_hp } = body as { booking_code?: string; no_hp?: string };

    if (!booking_code) {
      return NextResponse.json(
        { success: false, message: 'booking_code wajib diisi.' },
        { status: 400 }
      );
    }

    // Cek dulu apakah bot WhatsApp sudah tertaut
    const status = await waServiceStatus();
    if (!status.connected) {
      return NextResponse.json(
        {
          success: false,
          code: 'WA_NOT_CONNECTED',
          message:
            'Bot WhatsApp belum terhubung. Jalankan "npm start" di backend/wa-service lalu scan QR.',
        },
        { status: 503 }
      );
    }

    const hasil = await sendTicketToWhatsApp(booking_code, no_hp);

    if (!hasil.success) {
      return NextResponse.json(hasil, { status: 502 });
    }

    return NextResponse.json({
      ...hasil,
      message: hasil.message || 'E-Ticket berhasil dikirim ke WhatsApp penumpang.',
    });

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Send Ticket to WA Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengirim tiket ke WhatsApp.', error: errMessage },
      { status: 500 }
    );
  }
}

/** GET /api/tickets/send-wa → cek status koneksi bot WhatsApp. */
export async function GET() {
  const status = await waServiceStatus();
  return NextResponse.json({
    success: true,
    wa_service: status,
    hint: status.connected
      ? 'Bot WhatsApp siap menerima perintah.'
      : 'Jalankan backend/wa-service dan scan QR untuk menghubungkan bot.',
  });
}
