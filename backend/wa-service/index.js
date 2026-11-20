/**
 * ============================================================================
 *  BUSTIX WHATSAPP CHAT BOT  (Baileys / whatsapp-web unofficial)
 * ============================================================================
 *  Microservice ini bertugas:
 *    1. Menghubungkan nomor WhatsApp (scan QR sekali, sesi disimpan di folder).
 *    2. Menyediakan HTTP API agar backend BusTix bisa memerintahkan pengiriman
 *       E-Ticket ke nomor WhatsApp penumpang.
 *    3. Menjadi CHAT BOT DUA ARAH: menanggapi pesan masuk dari penumpang
 *       (kirim tiket, cek pesanan, atau tanya AI BusTix).
 *
 *  Jalankan:  npm install  →  npm start
 *  Scan QR yang muncul di terminal dengan WhatsApp di HP Anda.
 * ============================================================================
 */

import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

dotenv.config();

// ── Konfigurasi dari .env ────────────────────────────────────────────────────
const PORT = Number(process.env.WA_PORT || 3002);
const API_KEY = process.env.WA_API_KEY || 'bustix-wa-secret-key';
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH_DIR = process.env.WA_AUTH_DIR || './auth_info';
const BOT_NAME = process.env.WA_BOT_NAME || 'BusTix Assistant';
const AUTO_REPLY = String(process.env.WA_AUTO_REPLY || 'true') === 'true';

const logger = pino({ level: 'warn' }); // naikkan ke 'info' bila ingin log detail

// ── State global koneksi ─────────────────────────────────────────────────────
let sock = null;                 // socket Baileys aktif
let isConnected = false;         // true setelah pairing berhasil
let qrString = null;             // QR terakhir (bisa dibaca lewat GET /qr)
let meNumber = null;             // nomor WA bot (mis. 62812xxxx)

// Riwayat chat per-pengirim (in-memory, cukup untuk konteks AI)
/** @type {Map<string, Array<{role:'user'|'model', text:string}>>} */
const chatHistory = new Map();
const MAX_HISTORY = 8;

/* ============================================================================
 *  BAGIAN 1 — UTILITAS
 * ========================================================================== */

/**
 * Ubah berbagai format nomor HP menjadi JID WhatsApp.
 *   "0812-3456-7890"  → "6281234567890@s.whatsapp.net"
 *   "81234567890"     → "6281234567890@s.whatsapp.net"
 *   "+62 812 3456"    → "6281234567890@s.whatsapp.net"
 */
function phoneToJid(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  else if (digits.startsWith('8')) digits = '62' + digits;
  return `${digits}@s.whatsapp.net`;
}

/** Ambil nomor (tanpa @s.whatsapp.net) dari sebuah JID. */
function jidToPhone(jid) {
  return String(jid || '').split('@')[0];
}

/** Ambil teks dari berbagai bentuk pesan Baileys. */
function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim();
}

/** Panggil API backend BusTix. */
async function backendFetch(pathname, options = {}) {
  const res = await fetch(`${BACKEND_URL}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/** Format rupiah sederhana. */
function rupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

/** Format tanggal Indonesia. */
function tanggalID(t) {
  if (!t) return '-';
  try {
    return new Date(t).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return String(t);
  }
}

/* ============================================================================
 *  BAGIAN 2 — SUSUN TEKS E-TICKET UNTUK WHATSAPP
 * ========================================================================== */

/**
 * Ubah data tiket dari backend menjadi pesan WhatsApp yang rapi.
 * Data berasal dari GET /api/tickets/{kode}
 */
function formatTicketMessage(t) {
  const lunas = t.status_booking === 'lunas';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(t.kode_tiket)}`;

  return [
    `*🎫 E-TICKET RESMI BUSTIX*`,
    `_Tiket Elektronik AKAP — sah tanpa stempel fisik_`,
    ``,
    `*Kode Booking:* ${t.kode_booking}`,
    `*Kode Tiket:* ${t.kode_tiket}`,
    `*Status:* ${lunas ? '✅ LUNAS' : '⏳ BELUM DIBAYAR'}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*PENUMPANG*`,
    `Nama    : ${t.nama_penumpang}`,
    `Identitas: ${t.no_identitas}`,
    `Kursi   : *${t.nomor_kursi}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*PERJALANAN*`,
    `${t.asal_kota} (${t.asal_terminal})`,
    `   ⬇️`,
    `${t.tujuan_kota} (${t.tujuan_terminal})`,
    ``,
    `Tanggal : ${tanggalID(t.tanggal_berangkat)}`,
    `Berangkat: ${String(t.jam_berangkat).substring(0, 5)} WIB`,
    `Tiba    : ${String(t.jam_tiba).substring(0, 5)} WIB`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*ARMADA*`,
    `${t.nama_bus} (${t.plat_nomor})`,
    `Kelas   : ${t.kelas}`,
    ``,
    `*QR CODE BOARDING:*`,
    qrUrl,
    ``,
    lunas
      ? `Tunjukkan QR Code di atas ke kondektur saat naik bus.`
      : `Selesaikan pembayaran agar tiket aktif. Balas *BAYAR* untuk info pembayaran.`,
    ``,
    `Hadir minimal 30 menit sebelum keberangkatan. Terima kasih 🙏`,
    `— ${BOT_NAME}`,
  ].join('\n');
}

/** Susun daftar semua tiket bila 1 booking berisi beberapa penumpang. */
function formatTicketListMessage(t) {
  const list = t.passengers || [];
  if (list.length <= 1) return formatTicketMessage(t);
  return [
    `*🎫 E-TICKET BUSTIX — KODE BOOKING ${t.kode_booking}*`,
    `Total ${list.length} penumpang.`,
    ``,
    ...list.map((p, i) =>
      `${i + 1}. *${p.nama_penumpang}* — Kursi ${p.nomor_kursi}\n   Kode: ${p.kode_tiket}`
    ),
    ``,
    `Rute: ${t.asal_kota} → ${t.tujuan_kota}`,
    `Berangkat: ${tanggalID(t.tanggal_berangkat)} ${String(t.jam_berangkat).substring(0, 5)} WIB`,
    `Bus: ${t.nama_bus} (${t.plat_nomor})`,
    ``,
    `Balas dengan *kode tiket* di atas untuk QR boarding masing-masing.`,
  ].join('\n');
}

/* ============================================================================
 *  BAGIAN 3 — PENGIRIMAN PESAN
 * ========================================================================== */

/** Pastikan koneksi siap sebelum mengirim. */
function ensureReady() {
  if (!sock || !isConnected) {
    const e = new Error('WhatsApp bot belum terhubung. Scan QR terlebih dahulu.');
    e.status = 503;
    throw e;
  }
}

/** Kirim pesan teks. `to` bisa nomor HP apa pun formatnya. */
async function sendText(to, text) {
  ensureReady();
  const jid = to.includes('@') ? jidNormalizedUser(to) : phoneToJid(to);
  if (!jid) throw new Error(`Nomor tujuan tidak valid: ${to}`);
  return sock.sendMessage(jid, { text });
}

/** Kirim gambar (mis. QR Code tiket) dari URL. */
async function sendImage(to, url, caption = '') {
  ensureReady();
  const jid = to.includes('@') ? jidNormalizedUser(to) : phoneToJid(to);
  if (!jid) throw new Error(`Nomor tujuan tidak valid: ${to}`);
  return sock.sendMessage(jid, { image: { url }, caption });
}

/** Kirim dokumen (mis. PDF) dari URL atau Buffer. */
async function sendDocument(to, { url, buffer, mimetype, fileName }) {
  ensureReady();
  const jid = to.includes('@') ? jidNormalizedUser(to) : phoneToJid(to);
  if (!jid) throw new Error(`Nomor tujuan tidak valid: ${to}`);
  return sock.sendMessage(jid, {
    document: buffer || { url },
    mimetype: mimetype || 'application/pdf',
    fileName: fileName || 'E-Ticket-BusTix.pdf',
  });
}

/**
 * Alur lengkap: ambil tiket dari backend lalu kirim ke WhatsApp.
 * @param {string} kode  kode_booking atau kode_tiket
 * @param {string} [nomor] nomor WA tujuan; bila kosong pakai no_hp penumpang
 */
async function kirimTiketKeWA(kode, nomor) {
  const res = await backendFetch(`/api/tickets/${encodeURIComponent(kode)}`);
  if (!res.success) throw new Error(res.message || 'Tiket tidak ditemukan.');

  const t = res.data;
  const tujuan = nomor || t.penumpang_no_hp;
  if (!tujuan) throw new Error('Nomor WhatsApp tujuan tidak tersedia.');

  // 1) Pesan ringkasan tiket
  await sendText(tujuan, formatTicketListMessage(t));

  // 2) Kirim gambar QR boarding untuk tiap penumpang
  const list = (t.passengers && t.passengers.length ? t.passengers : [t]);
  for (const p of list) {
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(p.kode_tiket)}`;
    await sendImage(tujuan, qr, `QR Boarding — ${p.nama_penumpang} (Kursi ${p.nomor_kursi})`);
  }

  return { to: jidToPhone(phoneToJid(tujuan)), kode_booking: t.kode_booking, jumlah_tiket: list.length };
}

/* ============================================================================
 *  BAGIAN 4 — CHAT BOT DUA ARAH (handler pesan masuk)
 * ========================================================================== */

const SAPAAN = /^(halo|hai|hi|hello|assalam|pagi|siang|sore|malam|test|tes)\b/i;
const KODE_BOOKING = /\b(BTX-[A-Z0-9]{5,10})\b/i;
const KODE_TIKET = /\b(TKT-[A-Z0-9]{5,12})\b/i;

/** Ambil tiket terbaru milik pengirim berdasarkan nomor HP-nya. */
async function cariTiketTerbaru(nomor) {
  // Backend tidak menyediakan pencarian publik by no_hp, jadi kita pakai
  // endpoint riwayat bila ada token; sebagai fallback, minta kode booking.
  try {
    const res = await backendFetch(`/api/tickets/by-phone/${encodeURIComponent(nomor)}`);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

/**
 * Tentukan balasan untuk satu pesan masuk.
 * Return array of "actions", masing-masing: { type:'text'|'image'|'ticket', ... }
 */
async function handleIncoming(jid, text) {
  const nomor = jidToPhone(jid);
  const lower = text.toLowerCase();

  // Simpan riwayat untuk konteks AI
  const history = chatHistory.get(jid) || [];

  // ── 1. Perintah MENU / HELP / SAPAAN ───────────────────────────────────
  if (!text || SAPAAN.test(text) || /^(menu|help|bantuan|start|\/start)$/i.test(text)) {
    return [{
      type: 'text',
      text: [
        `Halo! Saya *${BOT_NAME}* 🤖`,
        `Asisten WhatsApp resmi BusTix. Saya bisa membantu:`,
        ``,
        `1️⃣ Kirim E-Ticket → ketik *TIKET <kode booking>*`,
        `   contoh: TIKET BTX-ABC1234`,
        `2️⃣ Cek status pesanan → kirim kode booking Anda`,
        `3️⃣ Tanya apa saja → ketik pertanyaan (jadwal, bagasi, refund, dll)`,
        ``,
        `Ketik angka/nomor menu atau langsung tanyakan kebutuhan Anda.`,
      ].join('\n'),
    }];
  }

  // ── 2. Permintaan kirim tiket: "TIKET BTX-XXX" atau hanya kode booking ──
  const mKode = text.match(KODE_BOOKING) || text.match(KODE_TIKET);
  const mintaTiket = /tiket|eticket|e-ticket|kirim|pesanan saya/i.test(lower);

  if (mKode || (mintaTiket && !mKode)) {
    if (mKode) {
      try {
        const hasil = await kirimTiketKeWA(mKode[1], nomor);
        return [{
          type: 'text',
          text: `✅ E-Ticket untuk booking *${hasil.kode_booking}* (${hasil.jumlah_tiket} tiket) sudah dikirim di atas. Terima kasih!`,
        }];
      } catch (e) {
        return [{
          type: 'text',
          text: `❌ Maaf, tiket dengan kode *${mKode[1]}* tidak ditemukan.\nPastikan kode booking benar (contoh: BTX-ABC1234).`,
        }];
      }
    }

    // Tidak menyertakan kode → coba cari otomatis dari nomor HP
    const tiket = await cariTiketTerbaru(nomor);
    if (tiket?.kode_booking) {
      await kirimTiketKeWA(tiket.kode_booking, nomor);
      return [{ type: 'text', text: `✅ E-Ticket terbaru Anda sudah dikirim.` }];
    }
    return [{
      type: 'text',
      text: `Untuk mengirim E-Ticket, balas dengan kode booking Anda.\nContoh: *TIKET BTX-ABC1234*\n\nKode booking ada di email/SMS konfirmasi pemesanan Anda.`,
    }];
  }

  // ── 3. Selain itu → tanya AI BusTix (endpoint /api/chat) ────────────────
  try {
    const res = await backendFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, history }),
    });

    const reply = res.reply || 'Maaf, saya belum bisa menjawab itu.';

    // simpan riwayat
    history.push({ role: 'user', text });
    history.push({ role: 'model', text: reply });
    chatHistory.set(jid, history.slice(-MAX_HISTORY));

    return [{ type: 'text', text: reply }];
  } catch {
    return [{
      type: 'text',
      text: `Maaf, layanan asisten sedang sibuk. Silakan coba lagi sebentar lagi.\n\nKetik *MENU* untuk melihat bantuan.`,
    }];
  }
}

/* ============================================================================
 *  BAGIAN 5 — KONEKSI BAILEYS
 * ========================================================================== */

async function startWhatsApp() {
  fs.mkdirSync(path.resolve(AUTH_DIR), { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false, // kita render QR sendiri via qrcode-terminal
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: true,
    syncFullHistory: false,
  });

  // Simpan kredensial setiap berubah
  sock.ev.on('creds.update', saveCreds);

  // ── Perubahan status koneksi ─────────────────────────────────────────
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrString = qr;
      console.log('\n════════════════════════════════════════════════');
      console.log('  SCAN QR BERIKUT DENGAN WHATSAPP DI HP ANDA');
      console.log('  (WhatsApp → Perangkat Tertaut → Tautkan Perangkat)');
      console.log('════════════════════════════════════════════════\n');
      qrcode.generate(qr, { small: true });
      console.log('\nQR juga bisa diakses via browser: http://localhost:' + PORT + '/qr\n');
    }

    if (connection === 'open') {
      isConnected = true;
      qrString = null;
      meNumber = jidToPhone(sock.user?.id || '');
      console.log(`\n✅ WhatsApp TERHUBUNG sebagai ${meNumber}\n`);
    }

    if (connection === 'close') {
      isConnected = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`⚠️  Koneksi WhatsApp terputus (code ${code}).`, loggedOut ? 'Sesi logout — scan QR ulang.' : 'Mencoba menyambung ulang...');

      if (loggedOut) {
        // Hapus sesi agar bisa scan QR baru
        try { fs.rmSync(path.resolve(AUTH_DIR), { recursive: true, force: true }); } catch { /* ignore */ }
      } else {
        setTimeout(() => startWhatsApp().catch((e) => console.error('Gagal reconnect:', e.message)), 3000);
      }
    }
  });

  // ── Pesan masuk → chatbot dua arah ───────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    if (!AUTO_REPLY) return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        // Abaikan status broadcast
        if (!jid || jid === 'status@broadcast') continue;

        const text = extractText(msg.message);
        if (!text) continue;

        console.log(`📩 Pesan masuk dari ${jidToPhone(jid)}: ${text}`);

        const actions = await handleIncoming(jid, text);

        for (const action of actions) {
          if (action.type === 'text') await sock.sendMessage(jid, { text: action.text });
          else if (action.type === 'image') await sock.sendMessage(jid, { image: { url: action.url }, caption: action.caption });
        }
      } catch (e) {
        console.error('Error memproses pesan masuk:', e.message);
      }
    }
  });
}

/* ============================================================================
 *  BAGIAN 6 — HTTP API (dipakai backend BusTix untuk memerintahkan kirim)
 * ========================================================================== */

const app = express();
app.use(express.json({ limit: '5mb' }));

// Middleware autentikasi sederhana via header x-api-key
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/qr' || req.path === '/qr-json') return next(); // endpoint publik
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, message: 'API key tidak valid.' });
  }
  next();
});

// Status koneksi
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'bustix-wa-service',
    connected: isConnected,
    number: meNumber,
    auto_reply: AUTO_REPLY,
  });
});

// Tampilkan QR dalam bentuk JSON (untuk integrasi)
app.get('/qr-json', (req, res) => {
  if (isConnected) return res.json({ success: true, connected: true, number: meNumber });
  if (!qrString) return res.json({ success: false, message: 'QR belum tersedia. Tunggu beberapa detik.' });
  res.json({ success: true, connected: false, qr: qrString });
});

// Halaman QR yang bisa di-scan langsung dari browser
app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send(`<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:3rem">
      <h2 style="color:#16a34a">✅ WhatsApp sudah terhubung</h2>
      <p>Nomor bot: <b>${meNumber}</b></p></body></html>`);
  }
  if (!qrString) {
    return res.send(`<!doctype html><html><head><meta http-equiv="refresh" content="3"></head>
      <body style="font-family:sans-serif;text-align:center;padding:3rem">
      <h2>⏳ Menunggu QR dibuat...</h2><p>Halaman akan menyegarkan otomatis.</p></body></html>`);
  }
  try {
    const dataUrl = await QRCode.toDataURL(qrString, { width: 320, margin: 1 });
    res.send(`<!doctype html><html><head><meta http-equiv="refresh" content="20"></head>
      <body style="font-family:sans-serif;text-align:center;padding:2rem;background:#f8fafc">
      <h2 style="color:#002869">Scan QR dengan WhatsApp</h2>
      <p style="color:#64748b">WhatsApp → <b>Perangkat Tertaut</b> → <b>Tautkan Perangkat</b></p>
      <img src="${dataUrl}" alt="QR WhatsApp" style="border:12px solid #fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15)"/>
      <p style="color:#94a3b8;font-size:.85rem">QR berlaku ±20 detik, halaman menyegarkan otomatis.</p>
      </body></html>`);
  } catch (e) {
    res.status(500).send('Gagal membuat QR: ' + e.message);
  }
});

// Kirim E-Ticket ke WhatsApp penumpang
app.post('/send-ticket', async (req, res) => {
  try {
    const { booking_code, kode, no_hp } = req.body || {};
    const kodeFinal = booking_code || kode;
    if (!kodeFinal) {
      return res.status(400).json({ success: false, message: 'booking_code wajib diisi.' });
    }
    const hasil = await kirimTiketKeWA(kodeFinal, no_hp);
    res.json({ success: true, message: 'E-Ticket berhasil dikirim ke WhatsApp.', ...hasil });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message || 'Gagal mengirim tiket.' });
  }
});

// Kirim pesan bebas (untuk notifikasi/reminder)
app.post('/send-message', async (req, res) => {
  try {
    const { to, message } = req.body || {};
    if (!to || !message) {
      return res.status(400).json({ success: false, message: 'Parameter "to" dan "message" wajib diisi.' });
    }
    await sendText(to, message);
    res.json({ success: true, message: 'Pesan terkirim.' });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message || 'Gagal mengirim pesan.' });
  }
});

// Info nomor bot
app.get('/status', (req, res) => {
  res.json({ success: true, connected: isConnected, number: meNumber });
});

/* ============================================================================
 *  START
 * ========================================================================== */

app.listen(PORT, () => {
  console.log(`\n🚀 WA Service berjalan di http://localhost:${PORT}`);
  console.log(`   Backend BusTix : ${BACKEND_URL}`);
  console.log(`   Auto reply     : ${AUTO_REPLY ? 'AKTIF' : 'MATI'}\n`);
});

startWhatsApp().catch((e) => {
  console.error('Gagal memulai WhatsApp:', e);
  process.exit(1);
});

// Tangani error tak terduga agar service tidak mati diam-diam
process.on('uncaughtException', (e) => console.error('uncaughtException:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
