import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Navbar from '../components/Navbar';
import '../Style/pesanan.css';
import logoNavbar from '../assets/LogoNavbar.png';
import { customerApi, bookingApi, refundApi, getStoredUser, type HistoryItem } from '../services/api';

interface PesananProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

type Tab = 'semua' | 'aktif' | 'menunggu' | 'selesai' | 'dibatalkan';

function formatTanggal(t?: string): string {
  if (!t) return '-';
  try {
    return new Date(t).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return t;
  }
}

function formatJam(t?: string): string {
  return t ? String(t).substring(0, 5).replace(':', '.') : '-';
}

function formatRupiah(v: string | number | undefined): string {
  return `Rp ${Number(v || 0).toLocaleString('id-ID')}`;
}

// Kelompokkan status booking ke kategori tab
function statusCategory(status: string): Tab {
  switch (status) {
    case 'lunas':
      return 'aktif';
    case 'menunggu_bayar':
      return 'menunggu';
    case 'selesai':
      return 'selesai';
    case 'kedaluwarsa':
    case 'dibatalkan':
    case 'menunggu_refund':
    case 'refund_selesai':
      return 'dibatalkan';
    default:
      return 'semua';
  }
}

function statusLabel(status: string): { text: string; cls: string } {
  switch (status) {
    case 'lunas':
      return { text: 'Lunas • Siap Boarding', cls: 'confirmed' };
    case 'menunggu_bayar':
      return { text: 'Menunggu Pembayaran', cls: 'waiting' };
    case 'selesai':
      return { text: 'Selesai', cls: 'confirmed' };
    case 'kedaluwarsa':
      return { text: 'Kedaluwarsa', cls: 'waiting' };
    case 'dibatalkan':
      return { text: 'Dibatalkan', cls: 'waiting' };
    case 'menunggu_refund':
      return { text: 'Refund Diproses', cls: 'waiting' };
    case 'refund_selesai':
      return { text: 'Refund Selesai', cls: 'confirmed' };
    default:
      return { text: status, cls: 'class-tag' };
  }
}

export default function Pesanan({ onNavigate }: PesananProps) {
  const [activeTab, setActiveTab] = useState<Tab>('semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [orders, setOrders] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const user = getStoredUser();

  const loadHistory = useCallback(async () => {
    if (!user?.id) {
      setErrorMsg('Silakan login untuk melihat pesanan Anda.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await customerApi.getHistory();
      if (res.success) {
        setOrders(res.history || []);
      }
    } catch (e) {
      setErrorMsg((e as Error).message || 'Gagal memuat riwayat pesanan.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    (async () => { await loadHistory(); })();
  }, [loadHistory]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleCancel = async (bookingCode: string) => {
    if (!confirm(`Batalkan pesanan ${bookingCode}? Kursi akan dilepas.`)) return;
    try {
      await bookingApi.cancel(bookingCode);
      showToast(`Pesanan ${bookingCode} berhasil dibatalkan.`, 'success');
      loadHistory();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  // Cek posisi antrean pembayaran (booking masih menunggu bayar)
  const handleQueue = async (bookingCode: string) => {
    try {
      const res = await bookingApi.queue(bookingCode);
      if (res.posisi_antrean) {
        const menit = Math.floor(res.sisa_detik / 60);
        const detik = res.sisa_detik % 60;
        showToast(`Antrean #${res.posisi_antrean} dari ${res.total_antrean} • Sisa waktu bayar ${menit}:${String(detik).padStart(2, '0')}`, 'info');
      } else {
        showToast(`Status booking: ${res.status}`, 'info');
      }
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  // ── Form Refund ────────────────────────────────────────────────
  const [refundTarget, setRefundTarget] = useState<HistoryItem | null>(null);
  const [refundAlasan, setRefundAlasan] = useState('');
  const [refundCatatan, setRefundCatatan] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

  const openRefund = (o: HistoryItem) => {
    setRefundTarget(o);
    setRefundAlasan('');
    setRefundCatatan('');
  };

  // Estimasi potongan — meniru aturan backend (/api/refund).
  // Tanggal dari API = ISO UTC ("2026-11-09T17:00:00.000Z") sedangkan jam = lokal.
  // Ambil komponen tanggal lokal supaya identik dengan jalur `instanceof Date` di backend.
  function estimasiPotongan(o: HistoryItem): number | null {
    const d = new Date(o.tanggal_berangkat);
    const [hh = '0', mm = '0', ss = '0'] = String(o.jam_berangkat).split(':');
    const berangkat = Number.isNaN(d.getTime())
      ? new Date(`${String(o.tanggal_berangkat).slice(0, 10)}T${o.jam_berangkat}`)
      : new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(hh), Number(mm), Number(ss));
    const jam = (berangkat.getTime() - nowTs) / 3_600_000;
    if (!Number.isFinite(jam) || jam <= 0) return null; // gagal parse / sudah berangkat → tolak
    return jam > 24 ? 10 : 25;
  }

  const submitRefund = async () => {
    if (!refundTarget) return;
    if (estimasiPotongan(refundTarget) === null) {
      showToast('Jadwal sudah berangkat, refund tidak lagi tersedia.', 'error');
      return;
    }
    if (!refundAlasan) {
      showToast('Pilih alasan refund.', 'error');
      return;
    }
    if (refundAlasan === 'Lainnya' && !refundCatatan.trim()) {
      showToast('Tulis keterangan alasan refund.', 'error');
      return;
    }
    const alasan = refundAlasan === 'Lainnya' ? refundCatatan.trim() : refundAlasan;
    setRefundBusy(true);
    try {
      const res = await refundApi.create({ booking_code: refundTarget.kode_booking, alasan });
      setRefundTarget(null);
      showToast(res.message, 'success');
      loadHistory();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setRefundBusy(false);
    }
  };

  // Hitung jumlah per kategori
  const counts = {
    semua: orders.length,
    aktif: orders.filter(o => statusCategory(o.status_booking) === 'aktif').length,
    menunggu: orders.filter(o => statusCategory(o.status_booking) === 'menunggu').length,
    selesai: orders.filter(o => statusCategory(o.status_booking) === 'selesai').length,
    dibatalkan: orders.filter(o => statusCategory(o.status_booking) === 'dibatalkan').length,
  };

  // Filter berdasarkan tab & pencarian
  const filtered = orders.filter((o) => {
    if (activeTab !== 'semua' && statusCategory(o.status_booking) !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const hay = `${o.kode_booking} ${o.nama_bus} ${o.asal_kota} ${o.tujuan_kota}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="ord-page-container">
      <Navbar onNavigate={onNavigate} />

      <main className="ord-main-content">
        {/* Toast */}
        {toast && (
          <div style={{
            background: toast.type === 'success' ? '#dcfce7' : toast.type === 'error' ? '#fee2e2' : '#eff6ff',
            border: `1px solid ${toast.type === 'success' ? '#86efac' : toast.type === 'error' ? '#fecaca' : '#bfdbfe'}`,
            color: toast.type === 'success' ? '#166534' : toast.type === 'error' ? '#991b1b' : '#1e40af',
            padding: '0.75rem 1rem',
            borderRadius: '0.75rem',
            marginBottom: '1rem',
            fontSize: '0.78rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              {toast.type === 'success' ? 'check_circle' : toast.type === 'error' ? 'error' : 'info'}
            </span>
            <span>{toast.message}</span>
          </div>
        )}

        {/* ── Form Refund (modal) — di-portal ke <body> agar position:fixed
            tidak terjebak containing-block oleh animasi fadeInUp container ── */}
        {refundTarget && createPortal(
          <div className="rfd-overlay" onClick={() => !refundBusy && setRefundTarget(null)}>
            <div className="rfd-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="rfd-head">
                <span className="material-symbols-outlined">receipt_long</span>
                <div>
                  <h3>Form Pengajuan Refund</h3>
                  <p>Booking <strong>#{refundTarget.kode_booking}</strong></p>
                </div>
                <button type="button" className="rfd-close" onClick={() => setRefundTarget(null)} disabled={refundBusy} aria-label="Tutup">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="rfd-body">
                {/* Ringkasan perjalanan */}
                <div className="rfd-summary">
                  <div className="rfd-sum-row">
                    <span>Rute</span>
                    <strong>{refundTarget.asal_kota} → {refundTarget.tujuan_kota}</strong>
                  </div>
                  <div className="rfd-sum-row">
                    <span>Berangkat</span>
                    <strong>{formatTanggal(refundTarget.tanggal_berangkat)} • {formatJam(refundTarget.jam_berangkat)}</strong>
                  </div>
                  <div className="rfd-sum-row">
                    <span>Kursi</span>
                    <strong>{refundTarget.nomor_kursi || '-'} ({Number(refundTarget.jumlah_penumpang)} penumpang)</strong>
                  </div>
                  <div className="rfd-sum-row total">
                    <span>Total Dibayar</span>
                    <strong>{formatRupiah(refundTarget.total_harga)}</strong>
                  </div>
                </div>

                {/* Alasan */}
                <label className="rfd-label" htmlFor="rfd-alasan">Alasan Refund <em>*</em></label>
                <select
                  id="rfd-alasan"
                  className="rfd-input"
                  value={refundAlasan}
                  onChange={(e) => setRefundAlasan(e.target.value)}
                  disabled={refundBusy}
                >
                  <option value="">Pilih alasan...</option>
                  <option value="Berubah rencana perjalanan">Berubah rencana perjalanan</option>
                  <option value="Jadwal keberangkatan tidak sesuai">Jadwal keberangkatan tidak sesuai</option>
                  <option value="Tiket terbeli salah rute/jadwal">Tiket terbeli salah rute/jadwal</option>
                  <option value="Penumpang sakit / keadaan darurat">Penumpang sakit / keadaan darurat</option>
                  <option value="Pembayaran dobel">Pembayaran dobel</option>
                  <option value="Lainnya">Lainnya (tulis di keterangan)</option>
                </select>

                {refundAlasan === 'Lainnya' && (
                  <>
                    <label className="rfd-label" htmlFor="rfd-catatan">Keterangan <em>*</em></label>
                    <textarea
                      id="rfd-catatan"
                      className="rfd-input rfd-textarea"
                      rows={3}
                      placeholder="Tulis alasan refund Anda..."
                      value={refundCatatan}
                      onChange={(e) => setRefundCatatan(e.target.value)}
                      disabled={refundBusy}
                    />
                  </>
                )}

                {/* Kebijakan potongan */}
                {(() => {
                  const persen = estimasiPotongan(refundTarget);
                  if (persen === null) {
                    return (
                      <div className="rfd-policy blocked">
                        <span className="material-symbols-outlined">block</span>
                        <span>Jadwal sudah berangkat, refund tidak lagi tersedia.</span>
                      </div>
                    );
                  }
                  const potongan = Math.round((Number(refundTarget.total_harga) * persen) / 100);
                  return (
                    <div className="rfd-policy">
                      <span className="material-symbols-outlined">info</span>
                      <span>
                        Kebijakan refund: potongan <strong>{persen}%</strong> ({formatRupiah(potongan)}),
                        dana kembali <strong>{formatRupiah(Number(refundTarget.total_harga) - potongan)}</strong>.
                        {' '}Diproses maksimal 7 hari kerja.
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="rfd-foot">
                <button type="button" className="rfd-btn-cancel" onClick={() => setRefundTarget(null)} disabled={refundBusy}>
                  Batal
                </button>
                <button
                  type="button"
                  className="rfd-btn-submit"
                  onClick={submitRefund}
                  disabled={refundBusy || !refundAlasan || estimasiPotongan(refundTarget) === null}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    {refundBusy ? 'progress_activity' : 'send'}
                  </span>
                  <span>{refundBusy ? 'Mengirim...' : 'Ajukan Refund'}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="ord-header-section">
          <div className="ord-breadcrumb-title">
            <div className="ord-breadcrumbs">
              <span className="cursor-pointer" onClick={() => onNavigate('search')}>Beranda</span>
              <span className="separator">&rsaquo;</span>
              <span className="cursor-pointer" onClick={() => onNavigate('search')}>Akun Saya</span>
              <span className="separator">&rsaquo;</span>
              <span className="active">Pesanan Saya</span>
            </div>
            <div className="ord-badge-mgmt">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>confirmation_number</span>
              <span>MANAJEMEN PERJALANAN</span>
            </div>
            <h1 className="ord-page-title">Pesanan Tiket Bus Saya</h1>
            <p className="ord-page-desc">
              Kelola e-ticket, pantau status pembayaran, dan akses bukti transaksi pemesanan antarkota Anda.
            </p>
          </div>
          <div className="ord-gps-live-tag">
            <span className="ord-gps-live-dot"></span>
            <span>Sistem Booking Terhubung (Live)</span>
          </div>
        </div>

        {/* ── Search & Filter ──────────────────────────────────────── */}
        <div className="ord-search-bar-row">
          <div className="ord-search-input-box">
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#94a3b8' }}>search</span>
            <input
              type="text"
              placeholder="Cari kode booking, nama PO, atau rute kota..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ord-search-input"
            />
          </div>
          <button type="button" className="ord-refresh-btn" onClick={() => { loadHistory(); showToast('Status pesanan diperbarui.', 'success'); }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>sync</span>
            <span>Refresh Status</span>
          </button>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <div className="ord-status-tabs">
          <button className={`ord-status-tab-btn ${activeTab === 'semua' ? 'active' : ''}`} onClick={() => setActiveTab('semua')}>
            <span>Semua Pesanan</span><span className="ord-tab-count-badge">{counts.semua}</span>
          </button>
          <button className={`ord-status-tab-btn ${activeTab === 'aktif' ? 'active' : ''}`} onClick={() => setActiveTab('aktif')}>
            <span>Tiket Aktif</span><span className="ord-tab-count-badge orange">{counts.aktif}</span>
          </button>
          <button className={`ord-status-tab-btn ${activeTab === 'menunggu' ? 'active' : ''}`} onClick={() => setActiveTab('menunggu')}>
            <span>Menunggu Pembayaran</span><span className="ord-tab-count-badge orange">{counts.menunggu}</span>
          </button>
          <button className={`ord-status-tab-btn ${activeTab === 'selesai' ? 'active' : ''}`} onClick={() => setActiveTab('selesai')}>
            <span>Selesai</span><span className="ord-tab-count-badge green">{counts.selesai}</span>
          </button>
          <button className={`ord-status-tab-btn ${activeTab === 'dibatalkan' ? 'active' : ''}`} onClick={() => setActiveTab('dibatalkan')}>
            <span>Dibatalkan / Refund</span><span className="ord-tab-count-badge">{counts.dibatalkan}</span>
          </button>
        </div>

        {/* ── 2-Column Layout ──────────────────────────────────────── */}
        <div className="ord-grid-layout">
          <div className="ord-cards-col">
            {isLoading && (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '40px', display: 'block', marginBottom: '1rem', color: '#1B4285' }}>sync</span>
                <p style={{ fontWeight: 700 }}>Memuat pesanan Anda...</p>
              </div>
            )}

            {!isLoading && errorMsg && (
              <div style={{ padding: '2rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '1rem', color: '#dc2626', textAlign: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '32px', display: 'block', marginBottom: '0.5rem' }}>error</span>
                <p style={{ fontWeight: 700 }}>{errorMsg}</p>
                {!user?.id && (
                  <button
                    type="button"
                    onClick={() => onNavigate('login')}
                    style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#1B4285', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Login Sekarang
                  </button>
                )}
              </div>
            )}

            {!isLoading && !errorMsg && filtered.length === 0 && (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '40px', display: 'block', marginBottom: '1rem' }}>confirmation_number</span>
                <p style={{ fontWeight: 700 }}>Belum ada pesanan pada kategori ini.</p>
                <button
                  type="button"
                  onClick={() => onNavigate('search')}
                  style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  Cari Tiket Bus
                </button>
              </div>
            )}

            {!isLoading && !errorMsg && filtered.map((o) => {
              const cat = statusCategory(o.status_booking);
              const lbl = statusLabel(o.status_booking);
              const seatList = o.nomor_kursi || '-';
              return (
                <div className="ord-card" key={o.booking_id} style={cat === 'menunggu' ? { border: '1.5px solid #fed7aa' } : {}}>
                  <div className="ord-card-top-row">
                    <div className="ord-status-pills">
                      <span className={`ord-pill-status ${lbl.cls}`}>
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                          {cat === 'aktif' ? 'check_circle' : cat === 'menunggu' ? 'schedule' : 'info'}
                        </span>
                        {lbl.text}
                      </span>
                      <span className="ord-pill-status class-tag" style={{ textTransform: 'capitalize' }}>{o.kelas}</span>
                    </div>
                    <div className="ord-booking-code-box">
                      Kode Booking: <span className="code">#{o.kode_booking}</span>
                    </div>
                  </div>

                  <div className="ord-operator-summary-row">
                    <div className="ord-operator-info">
                      <div className="ord-operator-avatar">
                        <span className="material-symbols-outlined">directions_bus</span>
                      </div>
                      <div>
                        <h3 className="ord-operator-name">{o.nama_bus}</h3>
                        <p className="ord-operator-fleet">
                          {o.plat_nomor} • {Number(o.jumlah_penumpang)} Penumpang (Kursi {seatList})
                        </p>
                      </div>
                    </div>
                    <div className="ord-price-summary-box">
                      <span className="ord-price-label">{cat === 'menunggu' ? 'Total Tagihan' : 'Total Pembayaran'}</span>
                      <div className="ord-price-value" style={cat === 'menunggu' ? { color: '#ea580c' } : {}}>{formatRupiah(o.total_harga)}</div>
                      <span className="ord-payment-badge">
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>{cat === 'aktif' ? 'check_circle' : 'schedule'}</span>
                        {o.status_pembayaran ? `Pembayaran: ${o.status_pembayaran}` : (cat === 'menunggu' ? 'Belum dibayar' : '-')}
                      </span>
                    </div>
                  </div>

                  {/* Route Box */}
                  <div className="ord-route-track-box">
                    <div className="ord-station-left">
                      <span className="ord-date-tag-mini">● {formatTanggal(o.tanggal_berangkat)} {formatJam(o.jam_berangkat)}</span>
                      <h4 className="ord-city-title">{o.asal_kota}</h4>
                      <p className="ord-terminal-desc">{o.asal_terminal}</p>
                    </div>
                    <div className="ord-track-mid-info">
                      <div className="ord-track-duration-pill">
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>schedule</span>
                        <span>{o.status_perjalanan}</span>
                      </div>
                    </div>
                    <div className="ord-station-right">
                      <span className="ord-date-tag-mini">Tiba {formatJam(o.jam_tiba)} ●</span>
                      <h4 className="ord-city-title">{o.tujuan_kota}</h4>
                      <p className="ord-terminal-desc">{o.tujuan_terminal}</p>
                    </div>
                  </div>

                  {/* Info Titik Penjemputan Fleksibel (bila customer memilih naik dari titik penjemputan terdekat) */}
                  {o.pickup && (
                    <div
                      style={{
                        marginTop: '0.65rem',
                        marginBottom: '0.75rem',
                        padding: '0.75rem 1rem',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: '20px',
                            color: '#1B4285',
                            background: '#dbeafe',
                            padding: '0.35rem',
                            borderRadius: '0.5rem',
                          }}
                        >
                          pin_drop
                        </span>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#1B4285', textTransform: 'uppercase' }}>
                              Titik Penjemputan Terdekat ({o.pickup.kategori_lokasi})
                            </span>
                            <span
                              style={{
                                fontSize: '0.65rem',
                                fontWeight: 800,
                                padding: '0.15rem 0.5rem',
                                borderRadius: '999px',
                                background:
                                  o.pickup.status_penjemputan === 'Ditolak'
                                    ? '#fee2e2'
                                    : o.pickup.status_penjemputan === 'Menunggu Konfirmasi'
                                    ? '#fef3c7'
                                    : '#dcfce7',
                                color:
                                  o.pickup.status_penjemputan === 'Ditolak'
                                    ? '#dc2626'
                                    : o.pickup.status_penjemputan === 'Menunggu Konfirmasi'
                                    ? '#d97706'
                                    : '#16a34a',
                              }}
                            >
                              ● {o.pickup.status_penjemputan}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a', marginTop: '0.15rem' }}>
                            {o.pickup.nama_lokasi}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#475569' }}>
                            {o.pickup.alamat_lengkap} • Est. Bus Tiba: <strong>{o.pickup.estimasi_bus_tiba}</strong> • Jarak Rute:{' '}
                            <strong>{o.pickup.jarak_ke_rute_km} KM</strong>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigate('pickup', { bookingCode: o.kode_booking })}
                        style={{
                          padding: '0.45rem 0.85rem',
                          borderRadius: '0.55rem',
                          border: '1px solid #1B4285',
                          background: '#1B4285',
                          color: '#fff',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>my_location</span>
                        <span>Lacak Status Penjemputan</span>
                      </button>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="ord-card-bottom-row">
                    <div className="ord-passenger-seat-info" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>airline_seat_recline_extra</span>
                        <span>Kursi: {seatList}</span>
                      </span>
                      <span>•</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>group</span>
                        <span>{Number(o.jumlah_penumpang)} Penumpang</span>
                      </span>
                    </div>

                    <div className="ord-card-action-btns">
                      {cat === 'menunggu' && (
                        <>
                          <button
                            type="button"
                            className="ord-btn-secondary"
                            onClick={() => handleQueue(o.kode_booking)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>queue</span>
                            <span>Cek Antrean</span>
                          </button>
                          <button
                            type="button"
                            className="ord-btn-secondary"
                            onClick={() => handleCancel(o.kode_booking)}
                            style={{ color: '#dc2626' }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>cancel</span>
                            <span>Batalkan</span>
                          </button>
                          <button
                            type="button"
                            className="ord-btn-pay-now"
                            onClick={() => onNavigate('payment', { bookingCode: o.kode_booking })}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>payment</span>
                            <span>Bayar Sekarang</span>
                          </button>
                        </>
                      )}

                      {cat === 'aktif' && estimasiPotongan(o) !== null && (
                        <button
                          type="button"
                          className="ord-btn-secondary"
                          onClick={() => openRefund(o)}
                          style={{ color: '#dc2626' }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>receipt_long</span>
                          <span>Ajukan Refund</span>
                        </button>
                      )}

                      {(cat === 'aktif' || cat === 'selesai') && (
                        <button
                          type="button"
                          className="ord-btn-navy-ticket"
                          onClick={() => onNavigate('ticket', { bookingCode: o.kode_booking })}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>qr_code</span>
                          <span>Lihat E-Ticket &amp; QR</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="ord-btn-secondary"
                        onClick={() => onNavigate('chatbot')}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>smart_toy</span>
                        <span>Tanya AI</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sidebar */}
          <aside className="ord-sidebar-col">
            <div className="ord-user-profile-card">
              <div className="ord-user-header">
                <div className="ord-user-avatar-badge">
                  <span className="material-symbols-outlined">person</span>
                </div>
                <div>
                  <h4 className="ord-user-name">{user?.nama || 'Tamu'}</h4>
                  <p className="ord-user-level">{user?.email || 'Belum login'}</p>
                </div>
              </div>
              <div className="ord-stats-row">
                <div className="ord-stat-box">
                  <div className="ord-stat-value">{counts.semua}</div>
                  <div className="ord-stat-label">Total Pesanan</div>
                </div>
                <div className="ord-stat-box">
                  <div className="ord-stat-value">{counts.aktif}</div>
                  <div className="ord-stat-label">Tiket Aktif</div>
                </div>
              </div>
            </div>

            <div className="ord-boarding-card">
              <h4 className="ord-boarding-title">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>info</span>
                <span>Cara Boarding Bus</span>
              </h4>
              <p className="ord-boarding-desc">
                Cukup tunjukkan kode QR E-Ticket di layar smartphone Anda kepada petugas loket atau kondektur saat di pintu peron terminal. Tidak wajib cetak tiket kertas!
              </p>
              <div className="ord-boarding-tip">
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>schedule</span>
                <span>Datang minimal 30 menit sebelum jadwal!</span>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <footer className="ord-footer">
        <div className="ord-footer-inner">
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <img src={logoNavbar} alt="GOVIA Transport" style={{ height: '36px', width: 'auto', objectFit: 'contain' }} />
            </div>
            <p className="ord-footer-desc">
              Platform pemesanan tiket bus &amp; travel antarkota terpercaya di Indonesia. Terhubung dengan 250+ operator bus AKAP dan Shuttle resmi.
            </p>
          </div>
          <div className="ord-footer-col">
            <h5>Layanan Pelanggan</h5>
            <ul className="ord-footer-links">
              <li><a href="#help">Pusat Bantuan</a></li>
              <li><a href="#refund">Cara Pembelian &amp; Refund</a></li>
              <li><a href="#bagasi">Kebijakan Bagasi</a></li>
            </ul>
          </div>
        </div>
        <div className="ord-footer-bottom">
          <div>© 2026 PT GOVIA Nusantara Digital. Seluruh hak cipta dilindungi.</div>
        </div>
      </footer>
    </div>
  );
}
