import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

export async function sendEmailCode(to: string, code: string): Promise<{ sent: boolean }> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[DEV MODE] Kode verifikasi untuk ${to}: ${code}`);
    return { sent: false };
  }

  try {
    await transporter.sendMail({
      from: `"Bustix Support" <${process.env.SMTP_USER}>`,
      to,
      subject: 'Kode Verifikasi Login Bustix',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #4f46e5;">Kode Verifikasi Anda</h2>
          <p>Gunakan kode verifikasi berikut untuk masuk ke akun Bustix Anda:</p>
          <div style="background: #f3f4f6; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 5px; text-align: center; border-radius: 8px; margin: 20px 0;">
            ${code}
          </div>
          <p>Kode ini berlaku selama 10 menit. Jangan berikan kode ini kepada siapapun.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (err) {
    console.error('Gagal kirim email:', err);
    throw new Error('Gagal mengirim email verifikasi');
  }
}

export interface TicketEmailPayload {
  to: string;
  nama: string;
  kodeBooking: string;
  kodeTiket: string;
  nomorKursi: string;
  asalKota: string;
  asalTerminal: string;
  tujuanKota: string;
  tujuanTerminal: string;
  tanggalBerangkat: string;
  jamBerangkat: string;
  jamTiba: string;
  namaBus: string;
  kelas: string;
  platNomor: string;
  totalHarga: number | string;
}

/**
 * Kirim E-Ticket resmi lengkap dengan QR code & rincian ke Email Customer
 */
export async function sendTicketEmail(payload: TicketEmailPayload): Promise<{ sent: boolean; message: string }> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[DEV MODE] E-Ticket untuk ${payload.to} (${payload.kodeBooking}) siap dikirim.`);
    return {
      sent: false,
      message: 'SMTP belum dikonfigurasi di backend .env (Gunakan kredensial Gmail App Password).'
    };
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payload.kodeTiket)}`;

  try {
    await transporter.sendMail({
      from: `"GOVIA Transport Ticketing" <${process.env.SMTP_USER}>`,
      to: payload.to,
      subject: `E-Ticket Resmi GOVIA #${payload.kodeBooking} - ${payload.asalKota} ke ${payload.tujuanKota}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          
          <!-- Header Biru -->
          <div style="background: #1B4285; color: #ffffff; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">E-TICKET RESMI PERJALANAN BUS</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; color: #93c5fd;">Platform Agregator Tiket Bus AKAP &amp; Shuttle Terverifikasi</p>
          </div>

          <div style="padding: 24px;">
            <!-- Greeting & Status -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px dashed #e2e8f0; padding-bottom: 16px; margin-bottom: 20px;">
              <div>
                <p style="margin: 0; font-size: 13px; color: #64748b;">Nama Penumpang:</p>
                <h3 style="margin: 2px 0 0 0; font-size: 17px; color: #0f172a;">${payload.nama}</h3>
              </div>
              <div style="text-align: right;">
                <span style="background: #dcfce7; color: #166534; padding: 6px 12px; border-radius: 9999px; font-size: 12px; font-weight: 800; display: inline-block;">
                  LUNAS • SIAP BOARDING
                </span>
              </div>
            </div>

            <!-- Kode Booking Card -->
            <div style="background: #f8faff; border: 1.5px solid #d9e3f6; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="font-size: 12px; color: #64748b;">Kode Booking (PNR):</td>
                  <td style="font-size: 12px; color: #64748b; text-align: right;">Nomor Kursi:</td>
                </tr>
                <tr>
                  <td style="font-size: 18px; font-weight: 900; color: #1B4285; font-family: monospace;">#${payload.kodeBooking}</td>
                  <td style="font-size: 18px; font-weight: 900; color: #f97316; text-align: right;">Kursi ${payload.nomorKursi}</td>
                </tr>
              </table>
            </div>

            <!-- Rute Perjalanan -->
            <div style="margin-bottom: 20px;">
              <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #1B4285;">Rincian Jadwal Armada</h4>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 8px 0; color: #64748b;">Armada Bus</td>
                  <td style="padding: 8px 0; font-weight: 700; color: #0f172a; text-align: right;">${payload.namaBus} (${payload.kelas})</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 8px 0; color: #64748b;">Nomor Polisi</td>
                  <td style="padding: 8px 0; font-weight: 700; color: #0f172a; text-align: right;">${payload.platNomor}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 8px 0; color: #64748b;">Keberangkatan</td>
                  <td style="padding: 8px 0; font-weight: 700; color: #0f172a; text-align: right;">${payload.asalKota} (${payload.asalTerminal})</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 8px 0; color: #64748b;">Tujuan Akhir</td>
                  <td style="padding: 8px 0; font-weight: 700; color: #0f172a; text-align: right;">${payload.tujuanKota} (${payload.tujuanTerminal})</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 8px 0; color: #64748b;">Tanggal &amp; Jam</td>
                  <td style="padding: 8px 0; font-weight: 700; color: #0f172a; text-align: right;">${payload.tanggalBerangkat} • Pkl ${payload.jamBerangkat} WIB</td>
                </tr>
              </table>
            </div>

            <!-- QR Code Boarding Pass -->
            <div style="text-align: center; background: #fafafa; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
              <p style="margin: 0 0 10px 0; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">QR Code Boarding Pass (Scan di Terminal)</p>
              <img src="${qrUrl}" alt="QR Code Tiket" style="width: 170px; height: 170px; display: inline-block; background: #fff; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0;" />
              <p style="margin: 8px 0 0 0; font-size: 13px; font-weight: 800; font-family: monospace; color: #0f172a;">${payload.kodeTiket}</p>
            </div>

            <!-- Catatan Penting -->
            <div style="background: #eff6ff; border-left: 4px solid #1B4285; padding: 12px 14px; border-radius: 0 8px 8px 0; font-size: 12px; color: #1e40af; line-height: 1.5;">
              <strong>Petunjuk Naik Bus:</strong> Tunjukkan email ini atau tunjukkan QR Code di atas langsung kepada kru armada di terminal keberangkatan. Harap hadir minimal 30 menit sebelum jadwal keberangkatan.
            </div>
          </div>

          <!-- Footer Email -->
          <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
            &copy; 2026 GOVIA Indonesia. Hak Cipta Dilindungi Undang-Undang.<br />
            Layanan Bantuan Konsumen 24/7 di Aplikasi GOVIA.
          </div>
        </div>
      `,
    });
    return { sent: true, message: 'E-Ticket berhasil dikirim ke alamat email Anda.' };
  } catch (err) {
    console.error('Gagal kirim tiket email:', err);
    throw new Error('Gagal mengirimkan tiket ke email.');
  }
}
