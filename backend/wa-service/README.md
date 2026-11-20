# 📱 BusTix WhatsApp Chat Bot (Baileys)

Chat Bot WhatsApp **dua arah** untuk mengirim **E-Ticket** dan menjawab pertanyaan
pelanggan. Dibuat dengan **Baileys** (unofficial WhatsApp Web) sebagai microservice
terpisah, sehingga **backend BusTix tidak perlu diubah arsitekturnya**.

---

## 🧭 Arsitektur

```
                 ┌──────────────────────────────┐
                 │   Frontend (Vite :5174)      │
                 │   tombol "Kirim WhatsApp"    │
                 └──────────────┬───────────────┘
                                │ POST /api/tickets/send-wa
                                ▼
                 ┌──────────────────────────────┐
                 │  Backend Next.js (:3000)     │
                 │  app/api/tickets/send-wa     │  ← verifikasi JWT login
                 │  lib/wa.ts                   │
                 └───────┬──────────────┬───────┘
        x-api-key        │              │  POST /api/chat (AI Gemini)
                         ▼              │
        ┌─────────────────────────────────────┐
        │  WA SERVICE (Node :3002)            │
        │  backend/wa-service/index.js        │
        │  • Baileys socket (scan QR)         │
        │  • HTTP API: /send-ticket           │
        │  • Chat bot dua arah (messages.upsert)
        └──────────────┬──────────────────────┘
                       ▼
              WhatsApp (HP penumpang)
```

---

## 📂 File yang Terlibat

| File | Peran |
|---|---|
| `backend/wa-service/index.js` | Microservice WhatsApp: koneksi Baileys + HTTP API + handler chat masuk |
| `backend/wa-service/.env` | Konfigurasi (port, API key, URL backend, folder sesi) |
| `backend/bustix/lib/wa.ts` | Helper backend memanggil WA service |
| `backend/bustix/app/api/tickets/send-wa/route.ts` | Endpoint `POST/GET /api/tickets/send-wa` |
| `backend/bustix/app/api/tickets/by-phone/[phone]/route.ts` | Cari tiket terbaru via nomor HP (untuk bot) |
| `backend/bustix/app/api/payments/confirm/route.ts` | Auto-kirim tiket setelah bayar (simulasi) |
| `backend/bustix/app/api/payments/webhook/route.ts` | Auto-kirim tiket setelah bayar (Midtrans) |
| `frondend/src/services/api.ts` | `ticketsApi.sendWhatsApp()` & `waStatus()` |
| `frondend/src/pages/TicketPage.tsx` | Tombol "Kirim WhatsApp & Email" yang berfungsi |

---

## 🚀 Cara Menjalankan (3 Terminal)

### 1️⃣ Terminal 1 — Backend BusTix
```powershell
cd "backend/bustix"
npm run dev          # http://localhost:3000
```

### 2️⃣ Terminal 2 — WA Service (Baileys)
```powershell
cd "backend/wa-service"
npm install          # sekali saja
npm start            # http://localhost:3002
```

Saat pertama kali dijalankan, **QR Code** akan muncul di terminal:

```
════════════════════════════════════════════════
  SCAN QR BERIKUT DENGAN WHATSAPP DI HP ANDA
  (WhatsApp → Perangkat Tertaut → Tautkan Perangkat)
════════════════════════════════════════════════
```

Scan dengan WhatsApp di HP (gunakan **nomor bot** yang akan mengirim tiket).
Jika berhasil, terminal menampilkan:
```
✅ WhatsApp TERHUBUNG sebagai 62812xxxxxxx
```

> QR juga bisa dibuka di browser: **http://localhost:3002/qr** — halaman ini
> menampilkan QR yang bisa langsung di-scan dari layar (auto-refresh ±20 detik).
> Sesi disimpan di folder `auth_info/` — **tidak perlu scan ulang** selama folder itu ada.

### 3️⃣ Terminal 3 — Frontend
```powershell
cd "frondend"
npm run dev          # http://localhost:5174
```

---

## 🎫 Cara Kerja Pengiriman Tiket

### A. Lewat tombol di web
1. Buka halaman **E-Ticket** (`TicketPage`).
2. Klik tombol **"Kirim WhatsApp"**.
3. Jika bot aktif → tiket dikirim otomatis. Jika belum → WhatsApp terbuka
   dengan teks tiket siap kirim (mode manual `wa.me`).

### B. Otomatis setelah pembayaran lunas
Set `WA_AUTO_SEND_TICKET=true` di `backend/bustix/.env`.
Begitu pembayaran terkonfirmasi (simulasi atau webhook Midtrans), E-Ticket
langsung dikirim ke nomor WA penumpang tanpa perlu klik apa pun.

### C. Lewat chat bot (dua arah)
Kirim pesan ke nomor bot dari WA penumpang:

| Pesan masuk | Balasan bot |
|---|---|
| `halo` / `menu` | Menu bantuan |
| `TIKET BTX-ABC1234` | E-Ticket + gambar QR boarding dikirim |
| `kirim tiket saya` | Bot cari tiket via nomor WA pengirim, lalu kirim |
| `bagaimana cara refund?` | Dijawab AI BusTix (`/api/chat`, Gemini) |
| `berapa bagasi gratis?` | Dijawab AI BusTix |

---

## 🔌 Referensi API WA Service

Semua endpoint (kecuali `/health` & `/qr`) butuh header `x-api-key`.

| Method | Endpoint | Body | Fungsi |
|---|---|---|---|
| GET | `/health` | – | Status koneksi (`connected`, `number`) |
| GET | `/qr` | – | **Halaman QR yang bisa di-scan dari browser** (auto-refresh) |
| GET | `/qr-json` | – | Ambil string QR dalam format JSON |
| POST | `/send-ticket` | `{ booking_code, no_hp? }` | Kirim E-Ticket + QR |
| POST | `/send-message` | `{ to, message }` | Kirim pesan teks bebas |
| GET | `/status` | – | Info nomor bot |

Contoh manual (PowerShell):
```powershell
$h = @{ 'x-api-key' = 'bustix-wa-secret-key' }
$b = @{ booking_code = 'BTX-ABC1234' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3002/send-ticket' -Method Post -Headers $h -Body $b -ContentType 'application/json'
```

---

## ⚙️ Konfigurasi Penting

### `backend/wa-service/.env`
```env
WA_PORT=3002
WA_API_KEY=bustix-wa-secret-key       # harus sama dgn backend
BACKEND_URL=http://localhost:3000
WA_AUTH_DIR=./auth_info
WA_BOT_NAME=BusTix Assistant
WA_AUTO_REPLY=true                    # false = matikan balasan otomatis
```

### `backend/bustix/.env`
```env
WA_SERVICE_URL=http://localhost:3002
WA_SERVICE_API_KEY=bustix-wa-secret-key
WA_AUTO_SEND_TICKET=true
```

> ⚠️ `WA_API_KEY` dan `WA_SERVICE_API_KEY` **harus sama**.

---

## 🛠️ Troubleshooting

| Masalah | Solusi |
|---|---|
| **`503` di console browser saat klik tombol** | Bot WhatsApp belum tertaut. Frontend sekarang otomatis pakai `wa.me` (manual). Agar otomatis: jalankan `backend/wa-service` + scan QR di `http://localhost:3002/qr`. |
| QR tidak muncul di terminal | Tunggu 5–10 detik. Buka **http://localhost:3002/qr** (halaman QR siap scan). |
| Bot terputus terus | Cek koneksi internet. Hapus folder `auth_info/` lalu `npm start` untuk scan QR ulang. |
| Tiket tidak terkirim otomatis | Pastikan nomor penumpang aktif di WhatsApp & format `08xxx`. Cek log WA service. |
| `401 API key tidak valid` | `WA_API_KEY` ≠ `WA_SERVICE_API_KEY`. Samakan nilainya. |
| Bot tidak menjawab chat | `WA_AUTO_REPLY=false`? Pastikan `true`. |
| AI balas "mode fallback" | `GEMINI_API_KEY` belum diisi (lihat `PANDUAN_AI_GEMINI.md`). |

---

## 🔁 Dua Mode Pengiriman (Otomatis vs Manual)

Tombol **"Kirim WhatsApp"** di halaman E-Ticket bekerja dalam 2 mode, dipilih
otomatis berdasarkan status bot:

| Kondisi | Label tombol | Yang terjadi |
|---|---|---|
| Bot WA aktif (`connected: true`) | **Kirim WhatsApp (Bot)** | Server kirim tiket otomatis ke nomor penumpang |
| Bot WA belum aktif | **Kirim WhatsApp** | Browser buka `wa.me/<nomor>` + teks tiket siap kirim |

Status bot dicek **sekali saat halaman E-Ticket dibuka** lewat
`GET /api/tickets/send-wa` (endpoint ini selalu membalas `200`, sehingga
**tidak memunculkan error 503 di console**).

> 💡 Karena tombol memutuskan secara sinkron di dalam event klik, `window.open`
> untuk mode manual **tidak akan diblokir popup blocker**.

---

## ⚠️ Catatan Penting

- Baileys adalah library **unofficial** (bukan API resmi Meta). Untuk **produksi
  skala besar**, pertimbangkan **WhatsApp Cloud API** resmi agar tidak berisiko
  pemblokiran nomor.
- Jangan commit folder `auth_info/` (sudah masuk `.gitignore`) — berisi kredensial login.
- Jalankan bot pada nomor khusus, bukan nomor pribadi penting.
