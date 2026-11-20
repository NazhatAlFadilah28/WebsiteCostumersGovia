# 🤖 Panduan Mengaktifkan AI Chatbot BusTix (Google Gemini)

Dokumen ini menjelaskan cara mengambil API Key Gemini dan mengaktifkannya di project BusTix.

---

## 📌 Ringkasan Singkat

| Langkah | Aksi |
|---|---|
| 1 | Ambil API key gratis di Google AI Studio |
| 2 | Tempel key ke `backend/bustix/.env` |
| 3 | Restart backend |
| 4 | Selesai — chatbot otomatis memakai Gemini |

> Jika `GEMINI_API_KEY` **kosong**, chatbot tetap berfungsi memakai **jawaban fallback lokal** (rule-based). Jadi aplikasi tidak akan error walau belum ada key.

---

## 🔑 Langkah 1 — Mengambil API Key Gemini

1. **Buka Google AI Studio**
   - URL: **https://aistudio.google.com/app/apikey**
   - Login dengan akun Google (Gmail biasa, **gratis**).

2. **Buat API Key**
   - Klik tombol **"Create API key"** (atau **"Get API key"**).
   - Pilih project yang ada, atau klik **"Create API key in new project"**.
   - Kunci akan muncul, formatnya seperti: `AIzaSyD...` atau `AQ.Ab8...`.

3. **Salin (Copy)**
   - Klik ikon copy, simpan di tempat aman.
   - ⚠️ **Jangan** bagikan atau commit key ini ke repository publik (GitHub).

### Batas Gratis (Free Tier)
| Model | Limit Gratis (kira-kira) |
|---|---|
| `gemini-3.5-flash` | 15 request/menit • 1 juta token/hari |
| `gemini-3.6-flash` | 10 request/menit |

Cukup untuk keperluan demo, tugas, dan pengembangan.

> **Catatan:** Google rutin memperbarui daftar model. Project ini sudah dilengkapi
> **auto-fallback** — jika model utama sibuk/tidak tersedia, sistem otomatis mencoba
> model lain (`gemini-3.6-flash`, `gemini-flash-latest`, dst). Jadi chatbot tetap jalan.

---

## ⚙️ Langkah 2 — Menempelkan Key ke Project

Buka file **`backend/bustix/.env`**, lalu isi `GEMINI_API_KEY`:

```env
# Google Gemini AI
GEMINI_API_KEY=AIzaSy_ISI_API_KEY_GEMINI_ANDA
GEMINI_MODEL=gemini-3-flash-preview
```

> Ganti dengan key asli Anda. **Tanpa tanda kutip.**

---

## 🔄 Langkah 3 — Restart Backend

```bash
cd "backend/bustix"
npm run dev
```

Environment variable hanya dibaca saat server start, jadi **wajib restart** setelah mengubah `.env`.

---

## ✅ Langkah 4 — Uji Coba

### Cara 1: Lewat aplikasi
1. Jalankan backend (`npm run dev`) dan frontend (`npm run dev`).
2. Buka halaman **"Tanya AI"** di web.
3. Kirim pertanyaan, misal: *"Bagaimana cara memesan kursi?"*
4. Balasan akan berasal dari Gemini (bukan lagi jawaban statis).

### Cara 2: Lewat terminal (PowerShell)
```powershell
$body = @{ message = "Bagaimana cara bayar tiketnya?" } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3000/api/chat' -Method Post -Body $body -ContentType 'application/json' | ConvertTo-Json -Depth 5
```

**Jika berhasil**, respons berisi `"mode": "gemini"`:
```json
{
  "success": true,
  "mode": "gemini",
  "model": "gemini-2.0-flash",
  "reply": "Untuk membayar tiket..."
}
```

**Jika key belum diisi**, respons berisi `"mode": "fallback"`:
```json
{
  "success": true,
  "mode": "fallback",
  "reply": "Pembayaran BusTix diproses via Midtrans...",
  "note": "GEMINI_API_KEY belum diisi..."
}
```

---

## 🧩 Cara Kerja Integrasi di Project

```
Frontend (ChatbotPage.tsx)
        │  chatApi.send({ message, history })
        ▼
Backend (app/api/chat/route.ts)  ← GEMINI_API_KEY dibaca di sini
        │  fetch ke Gemini REST API
        ▼
Google Gemini (generativelanguage.googleapis.com)
        │
        ▼
Balasan AI dikirim balik ke chat
```

**File yang terlibat:**
- `backend/bustix/app/api/chat/route.ts` — endpoint AI + fallback lokal
- `backend/bustix/.env` — tempat menyimpan `GEMINI_API_KEY`
- `frondend/src/services/api.ts` — fungsi `chatApi.send()`
- `frondend/src/pages/ChatbotPage.tsx` — UI chat yang memanggil API

---

## 🛠️ Mengganti Model Gemini

Ubah di `.env`:
```env
GEMINI_MODEL=gemini-2.5-flash
```
Atau model lain yang tersedia (lihat di Google AI Studio).

---

## ❗ Troubleshooting

| Masalah | Penyebab & Solusi |
|---|---|
| Respons selalu `mode: fallback` | `GEMINI_API_KEY` belum diisi / salah. Cek `.env`, lalu **restart** backend. |
| `Gemini error 400` | API key tidak valid. Buat ulang key di AI Studio. |
| `Gemini error 403` | Key dibatasi / project bermasalah. Cek pengaturan key. |
| `Gemini error 429` | Kuota gratis habis (terlalu banyak request). Tunggu sebentar. |
| Chat tidak menjawab | Pastikan backend berjalan di port 3000 dan tidak ada error di terminal. |

---

## 🔒 Tips Keamanan

- Simpan key **hanya** di `.env` (jangan di kode).
- Pastikan `.env` sudah masuk `.gitignore`.
- Untuk produksi, batasi key dengan **HTTP referrer** atau **IP restriction** di Google Cloud Console.
- Jangan pernah menaruh API key di kode frontend — selalu lewat backend (sudah diterapkan di project ini).
