import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './Style/darkmode.css'

/**
 * Penanganan Back-Forward Cache (bfcache) — khusus mode development.
 *
 * Saat pengguna menavigasi (mis. menekan tombol "Back" setelah dialihkan ke
 * Midtrans), browser dapat menyimpan halaman ke bfcache dan menutup koneksi
 * WebSocket milik Vite HMR. Akibatnya muncul pesan:
 *   "WebSocket connection to 'ws://...' failed: Page entered Back-Forward Cache."
 *
 * Handler ini memuat ulang halaman hanya ketika halaman dikembalikan dari
 * bfcache (event.persisted === true) di mode development, sehingga:
 *   1. Koneksi HMR tersambung kembali (hot reload normal lagi).
 *   2. Data selalu diambil segar dari API (mis. status pembayaran terbaru).
 *
 * Di mode production handler ini tidak dijalankan, sehingga bfcache tetap
 * optimal dan tidak ada WebSocket sama sekali.
 */
if (import.meta.env.DEV) {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      window.location.reload()
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
