import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import '../Style/ticket.css';
import logoNavbar from '../assets/LogoNavbar.png';
import { ticketsApi, type TicketData } from '../services/api';

interface TicketPageProps {
  bookingCode?: string;
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

function formatTanggal(t?: string): string {
  if (!t) return '-';
  try {
    return new Date(t).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return t;
  }
}

function formatJam(t?: string): string {
  return t ? String(t).substring(0, 5).replace(':', '.') : '-';
}

export function TicketPage({ bookingCode = '', onNavigate }: TicketPageProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  // Status bot WhatsApp (dicek saat halaman dimuat, agar tombol bisa
  // memutuskan langsung tanpa `await` yang memicu popup blocker)
  const [waBotConnected, setWaBotConnected] = useState<boolean | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const loadTicket = useCallback(async () => {
    if (!bookingCode) {
      setErrorMsg('Kode booking tidak ditemukan.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await ticketsApi.getByCode(bookingCode);
      if (res.success) {
        setTicket(res.data);
      } else {
        setErrorMsg('Tiket tidak ditemukan.');
      }
    } catch (e) {
      setErrorMsg((e as Error).message || 'Gagal memuat tiket.');
    } finally {
      setIsLoading(false);
    }
  }, [bookingCode]);

  useEffect(() => {
    (async () => { await loadTicket(); })();
  }, [loadTicket]);

  // Cek koneksi bot WhatsApp sekali saat halaman dibuka (tidak pernah throw,
  // sehingga tidak memunculkan error di console browser).
  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const res = await ticketsApi.waStatus();
        if (aktif) setWaBotConnected(!!res.wa_service?.connected);
      } catch {
        if (aktif) setWaBotConnected(false);
      }
    })();
    return () => { aktif = false; };
  }, []);

  const isPaid = ticket?.status_booking === 'lunas';
  const isCashPayment = String(ticket?.metode_pembayaran || '').toLowerCase() === 'cash';
  const qrImage = ticket
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(ticket.kode_tiket)}`
    : '';

  // ── Normalisasi nomor HP → format internasional 62xxxx ──
  const normalizePhone = (hp?: string): string => {
    let d = String(hp || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
    return d;
  };

  // ── Susun teks tiket untuk dibagikan lewat WhatsApp ──
  const buildTicketWaText = (t: TicketData): string =>
    [
      '*E-TICKET RESMI GOVIA*',
      `Kode Booking : ${t.kode_booking}`,
      `Kode Tiket   : ${t.kode_tiket}`,
      `Nama         : ${t.nama_penumpang}`,
      `Kursi        : ${t.nomor_kursi}`,
      `Rute         : ${t.asal_kota} - ${t.tujuan_kota}`,
      `Tanggal      : ${formatTanggal(t.tanggal_berangkat)}`,
      `Berangkat    : ${formatJam(t.jam_berangkat)} WIB`,
      `Bus          : ${t.nama_bus} (${t.plat_nomor})`,
      `Status       : ${
        String(t.metode_pembayaran || '').toLowerCase() === 'cash'
          ? 'BAYAR CASH (TUNAI LANGSUNG SAAT NAIK)'
          : t.status_booking === 'lunas'
          ? 'LUNAS (MIDTRANS)'
          : 'BELUM BAYAR'
      }`,
      '',
      `QR Boarding: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(t.kode_tiket)}`,
    ].join('\n');

  // ── Fallback: buka WhatsApp manual (wa.me) bila bot belum aktif ──
  const openWaMeFallback = (t: TicketData) => {
    const target = normalizePhone(t.penumpang_no_hp);
    const url = `https://wa.me/${target}?text=${encodeURIComponent(buildTicketWaText(t))}`;
    window.open(url, '_blank');
  };

  // ── Kirim E-Ticket ke WhatsApp penumpang via chat bot Baileys ──
  const handleKirimWhatsApp = async () => {
    if (!ticket || isSendingWa) return;

    // Bila bot belum terdeteksi aktif → buka WhatsApp manual LANGSUNG di dalam
    // event klik (sinkron) supaya tidak diblokir popup blocker browser.
    if (waBotConnected !== true) {
      openWaMeFallback(ticket);
      showToast('Membuka WhatsApp untuk kirim tiket manual.');
      return;
    }

    // Bot aktif → kirim otomatis dari server (tanpa popup)
    setIsSendingWa(true);
    try {
      const res = await ticketsApi.sendWhatsApp({ booking_code: ticket.kode_booking });
      if (res.success) {
        showToast(`Tiket terkirim via Bot WA ke ${res.to || ticket.penumpang_no_hp}`);
      } else {
        showToast(res.message);
      }
    } catch {
      showToast('Gagal kirim otomatis, membuka WhatsApp manual.');
      openWaMeFallback(ticket);
    } finally {
      setIsSendingWa(false);
    }
  };

  // ── Kirim E-Ticket ke Email Penumpang ──
  const handleKirimEmail = async () => {
    if (!ticket || isSendingEmail) return;
    setIsSendingEmail(true);
    try {
      const res = await ticketsApi.sendEmail({ booking_code: ticket.kode_booking });
      if (res.success) {
        showToast(res.message);
      } else {
        showToast(res.message || 'Gagal mengirim email tiket.');
      }
    } catch (e) {
      showToast((e as Error).message || 'Gagal memproses pengiriman email.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  // ── Unduh / Cetak Kartu QR "SCAN SAAT NAIK ARMADA" ──
  const handlePrintQr = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    if (!ticket) return;
    showToast('Menyiapkan PDF Kartu QR Boarding...');
    const prevTitle = document.title;
    document.title = `E-Ticket-QR-${ticket.kode_tiket}`;
    setTimeout(() => {
      window.print();
      document.title = prevTitle;
    }, 150);
  };

  return (
    <div className="tkt-page-container">
      <Navbar onNavigate={onNavigate} />

      <main className="tkt-main-content">
        {toastMessage && (
          <div className="tkt-toast-banner" style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '0.75rem 1rem', borderRadius: '0.75rem', marginBottom: '1rem', fontSize: '0.75rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{toastMessage}</span>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
          </div>
        )}

        {/* ── State: Loading ──────────────────────────────────────── */}
        {isLoading && (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '40px', display: 'block', marginBottom: '1rem', color: '#1B4285' }}>sync</span>
            <p style={{ fontWeight: 700 }}>Memuat E-Ticket...</p>
          </div>
        )}

        {/* ── State: Error ────────────────────────────────────────── */}
        {!isLoading && errorMsg && (
          <div style={{ padding: '2rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '1rem', color: '#dc2626', textAlign: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '32px', display: 'block', marginBottom: '0.5rem' }}>error</span>
            <p style={{ fontWeight: 700 }}>{errorMsg}</p>
            <button
              type="button"
              onClick={() => onNavigate('pesanan')}
              style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#1B4285', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Lihat Pesanan Saya
            </button>
          </div>
        )}

        {!isLoading && !errorMsg && ticket && (
          <>
            {/* ── Top Alert Banner ─────────────────────────────────── */}
            <div className="tkt-success-banner" style={!isPaid ? { background: '#fff7ed', borderColor: '#fed7aa' } : {}}>
              <div className="tkt-success-left">
                <div className="tkt-success-icon-box" style={!isPaid ? { background: '#f97316' } : {}}>
                  <span className="material-symbols-outlined">{isPaid ? 'verified' : 'schedule'}</span>
                </div>
                <div className="tkt-success-text">
                  <h3>
                    <span>
                      {isCashPayment
                        ? 'E-Ticket Aktif — Bayar Cash (Tunai Langsung)'
                        : isPaid
                        ? 'Pembayaran Sukses (Lunas)'
                        : 'Menunggu Pembayaran'}
                    </span>
                    <span className="tkt-midtrans-tag">
                      {isCashPayment ? 'BAYAR CASH SAAT NAIK' : isPaid ? 'MIDTRANS VERIFIED' : 'BELUM DIBAYAR'}
                    </span>
                  </h3>
                  <p>
                    {isCashPayment
                      ? `E-Ticket & Boarding Pass aktif (${ticket.kode_tiket}). Silakan bayar tunai (Cash) langsung ke kondektur/sopir saat naik bus.`
                      : isPaid
                      ? `E-Ticket & Boarding Pass siap digunakan. Kode tiket ${ticket.kode_tiket} terverifikasi otomatis.`
                      : 'E-Ticket akan aktif setelah pembayaran Anda terverifikasi.'}
                  </p>
                </div>
              </div>

              <div className="tkt-top-actions">
                <button type="button" className="tkt-btn-unduh-pdf" onClick={handleDownloadPdf}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>download</span>
                  <span>Unduh E-Ticket (PDF)</span>
                </button>
                <button
                  type="button"
                  className="tkt-btn-share-wa"
                  onClick={handleKirimWhatsApp}
                  disabled={isSendingWa}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#25D366',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.65rem 1.15rem',
                    borderRadius: '0.65rem',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(37, 211, 102, 0.25)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chat</span>
                  <span>{isSendingWa ? 'Mengirim Tiket...' : waBotConnected ? 'Kirim ke WhatsApp via Bot' : 'Kirim Tiket ke WhatsApp'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleKirimEmail}
                  disabled={isSendingEmail}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#1B4285',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.65rem 1.15rem',
                    borderRadius: '0.65rem',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(27, 66, 133, 0.25)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>mail</span>
                  <span>{isSendingEmail ? 'Mengirim Email...' : 'Kirim Tiket ke Email'}</span>
                </button>
                <button type="button" className="tkt-btn-print-mini" onClick={handlePrintQr} title="Cetak Tiket">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>print</span>
                </button>
              </div>
            </div>

            {/* ── 2-Column Main Layout ─────────────────────────────── */}
            <div className="tkt-grid-layout">
              {/* ════════ LEFT COLUMN: BOARDING PASS ════════ */}
              <div className="tkt-left-col">
                <div className="tkt-pass-card">
                  <div className="tkt-pass-header">
                    <div className="tkt-pass-header-left">
                      <div className="tkt-pass-header-title">
                        <h4>TIKET RESMI ELEKTRONIK AKAP • GOVIA</h4>
                        <h3>BOARDING PASS RESMI GOVIA</h3>
                      </div>
                    </div>
                    <div className="tkt-pass-header-pnr">
                      <span>KODE BOOKING (PNR)</span>
                      <h3>
                        <span>{ticket.kode_booking}</span>
                        <span className="dot"></span>
                      </h3>
                    </div>
                  </div>

                  {/* Metadata Grid */}
                  <div className="tkt-pass-meta-grid">
                    <div className="tkt-meta-col">
                      <span className="lbl">Nomor Polisi Armada</span>
                      <h4>{ticket.plat_nomor}</h4>
                      <p>{ticket.nama_bus}</p>
                    </div>
                    <div className="tkt-meta-col">
                      <span className="lbl">Kelas Armada</span>
                      <h4 style={{ textTransform: 'capitalize' }}>{ticket.kelas}</h4>
                      <p>{ticket.asal_terminal}</p>
                    </div>
                    <div className="tkt-meta-col">
                      <span className="lbl">Nomor Kursi</span>
                      <h4>{ticket.nomor_kursi}</h4>
                      <p>Kursi Terkonfirmasi</p>
                    </div>
                    <div className="tkt-meta-col">
                      <span className="lbl">Status Boarding</span>
                      <div className="tkt-status-boarding-tag">
                        <span>{ticket.status_tiket === 'sudah_naik' ? '● Sudah Naik' : '● Siap Boarding'}</span>
                      </div>
                      <p>{ticket.status_tiket === 'sudah_naik' ? 'Sudah Naik' : 'Belum Naik'}</p>
                    </div>
                  </div>

                  {/* Route & Timeline */}
                  <div className="tkt-pass-route-row">
                    <div className="tkt-pass-route-track">
                      <div className="tkt-route-origin">
                        <span className="tkt-route-tag-lbl">KEBERANGKATAN</span>
                        <h4 className="tkt-route-city">{ticket.asal_kota}</h4>
                        <p className="tkt-route-terminal">{ticket.asal_terminal}</p>
                        <span className="tkt-route-date">{formatTanggal(ticket.tanggal_berangkat)} • {formatJam(ticket.jam_berangkat)}</span>
                      </div>
                      <div className="tkt-route-mid-info">
                        <span className="tkt-highway-tag">
                          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>route</span>
                          <span>Rute AKAP</span>
                        </span>
                        <div className="tkt-route-line-dots">
                          <div className="tkt-dot-point"></div>
                          <div className="tkt-line-bar"></div>
                          <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#1B4285' }}>directions_bus</span>
                          <div className="tkt-line-bar"></div>
                          <div className="tkt-dot-point dest"></div>
                        </div>
                        <span className="tkt-est-duration">Tiba {formatJam(ticket.jam_tiba)}</span>
                      </div>
                      <div className="tkt-route-dest">
                        <span className="tkt-route-tag-lbl">KEDATANGAN</span>
                        <h4 className="tkt-route-city">{ticket.tujuan_kota}</h4>
                        <p className="tkt-route-terminal">{ticket.tujuan_terminal}</p>
                        <span className="tkt-route-date">{formatTanggal(ticket.tanggal_berangkat)}</span>
                      </div>
                    </div>

                    {/* Detail Titik Penjemputan Fleksibel pada E-Ticket jika ada */}
                    {ticket.pickup && (
                      <div
                        style={{
                          marginTop: '0.9rem',
                          padding: '0.85rem 1rem',
                          background: '#f0f9ff',
                          border: '1.5px dashed #38bdf8',
                          borderRadius: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '0.75rem',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span
                              style={{
                                fontSize: '0.66rem',
                                fontWeight: 800,
                                background: '#0284c7',
                                color: '#ffffff',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '0.35rem',
                              }}
                            >
                              NAIK DARI TITIK PENJEMPUTAN TERDEKAT
                            </span>
                            <span
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                color: ticket.pickup.status_penjemputan === 'Ditolak' ? '#dc2626' : '#0369a1',
                              }}
                            >
                              Status: {ticket.pickup.status_penjemputan}
                            </span>
                          </div>
                          <h5 style={{ margin: '0.3rem 0 0.15rem', fontSize: '0.86rem', fontWeight: 800, color: '#0f172a' }}>
                            {ticket.pickup.nama_lokasi} ({ticket.pickup.kategori_lokasi})
                          </h5>
                          <p style={{ margin: 0, fontSize: '0.73rem', color: '#334155' }}>
                            {ticket.pickup.alamat_lengkap} • Koordinat: {ticket.pickup.lat.toFixed(4)}, {ticket.pickup.lng.toFixed(4)}
                          </p>
                          <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: '#0369a1', fontWeight: 700 }}>
                            Estimasi Bus Tiba di Lokasi: {ticket.pickup.estimasi_bus_tiba} • Jarak ke Jalur Bus: {ticket.pickup.jarak_ke_rute_km} KM
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigate('pickup', { bookingCode: ticket.kode_booking })}
                          style={{
                            padding: '0.45rem 0.85rem',
                            borderRadius: '0.5rem',
                            border: 'none',
                            background: '#0284c7',
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>pin_drop</span>
                          <span>Pantau Penjemputan</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Passenger & QR Code Block */}
                  <div className="tkt-pass-qr-row">
                    <div className="tkt-passenger-info-left">
                      <div className="tkt-passenger-header">
                        <div className="tkt-passenger-avatar-box">
                          {ticket.nama_penumpang.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <div className="tkt-passenger-name-text">
                          <span>NAMA PENUMPANG RESMI</span>
                          <h4>{ticket.nama_penumpang}</h4>
                          <p>NIK: {ticket.no_identitas}</p>
                        </div>
                      </div>

                      <div className="tkt-passenger-details-grid">
                        <div className="tkt-detail-item">
                          <span className="lbl">OPERATOR BUS</span>
                          <h5>{ticket.nama_bus}</h5>
                        </div>
                        <div className="tkt-detail-item">
                          <span className="lbl">KELAS ARMADA</span>
                          <h5 style={{ textTransform: 'capitalize' }}>{ticket.kelas}</h5>
                        </div>
                        <div className="tkt-detail-item">
                          <span className="lbl">NO. HP PENUMPANG</span>
                          <h5>{ticket.penumpang_no_hp}</h5>
                        </div>
                        <div className="tkt-detail-item">
                          <span className="lbl">STATUS PEMBAYARAN</span>
                          <h5 style={{ color: isCashPayment ? '#15803d' : isPaid ? '#16a34a' : '#f97316' }}>
                            {isCashPayment ? 'BAYAR CASH (SAAT NAIK)' : isPaid ? 'LUNAS (MIDTRANS)' : 'BELUM BAYAR'}
                          </h5>
                        </div>
                      </div>

                      <div className="tkt-system-id" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '13px', color: '#64748b' }}>lock</span>
                        <span>ID Tiket Sistem: <span className="code">{ticket.kode_tiket}</span></span>
                      </div>
                    </div>

                    <div className="tkt-pass-qr-box">
                      <div className="tkt-qr-scan-title">SCAN SAAT NAIK ARMADA</div>
                      <img src={qrImage} alt="Boarding QR Code" className="tkt-qr-img" />
                      <div className="tkt-qr-code-txt">{ticket.kode_tiket}</div>
                      <div className="tkt-qr-instruction-txt">
                        Tunjukkan kode ini langsung ke kondektur armada
                      </div>
                    </div>
                  </div>

                  {/* Barcode Footer */}
                  <div className="tkt-pass-barcode-footer">
                    <div className="tkt-barcode-lines">
                      {[2, 4, 1, 3, 6, 2, 5, 3, 1, 4, 2, 7, 3, 1, 5, 2, 4, 6, 2, 3].map((w, i) => (
                        <span key={i} style={{ width: `${w}px` }}></span>
                      ))}
                    </div>
                    <div className="tkt-barcode-text">GOVIA - {ticket.kode_booking} - {ticket.nomor_kursi}</div>
                    <div className="tkt-pass-validation-row">
                      <div>Dicetak secara digital oleh sistem GOVIA terhubung Kemenhub RI</div>
                      <div>Validitas: {isPaid ? 'Terkonfirmasi 100%' : 'Menunggu Pembayaran'}</div>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#16a34a' }}>check_circle</span>
                  <span>Tiket ini sah tanpa stempel fisik loket konvensional.</span>
                </div>
                <div className="tkt-bottom-action-buttons">
                  <button type="button" className="tkt-btn-action-pill" onClick={handleDownloadPdf}>
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>download</span>
                    <span>Unduh E-Ticket (PDF)</span>
                  </button>
                  <button type="button" className="tkt-btn-action-outline" onClick={handleKirimWhatsApp} disabled={isSendingWa}>
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>mail</span>
                    <span>{isSendingWa ? 'Mengirim...' : waBotConnected ? 'Kirim ke WhatsApp (Bot)' : 'Kirim ke WhatsApp'}</span>
                  </button>
                  <button type="button" className="tkt-btn-action-outline" onClick={handlePrintQr}>
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>print</span>
                    <span>Cetak Tiket</span>
                  </button>
                </div>
              </div>

              {/* ════════ RIGHT COLUMN ════════ */}
              <div className="tkt-right-col">
                {!isPaid && (
                  <div className="tkt-rules-card" style={{ background: '#fff7ed', borderColor: '#fed7aa' }}>
                    <div className="tkt-rules-header">
                      <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#f97316' }}>info</span>
                      <span>Pembayaran Belum Selesai</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#9a3412', marginBottom: '0.75rem' }}>
                      Selesaikan pembayaran untuk mengaktifkan E-Ticket ini.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate('payment', { bookingCode: ticket.kode_booking })}
                      style={{ width: '100%', padding: '0.6rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: 800, cursor: 'pointer' }}
                    >
                      Bayar Sekarang
                    </button>
                  </div>
                )}

                {/* Ketentuan Boarding */}
                <div className="tkt-rules-card">
                  <div className="tkt-rules-header">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#f97316' }}>confirmation_number</span>
                    <span>Ketentuan Boarding Bus</span>
                  </div>
                  <div className="tkt-rules-list">
                    <div className="tkt-rule-item">
                      <div className="tkt-rule-num">1</div>
                      <div className="tkt-rule-text">
                        <h5>Tiba Lebih Awal</h5>
                        <p>Hadir selambatnya <b>30 menit sebelum keberangkatan</b> di {ticket.asal_terminal}.</p>
                      </div>
                    </div>
                    <div className="tkt-rule-item">
                      <div className="tkt-rule-num">2</div>
                      <div className="tkt-rule-text">
                        <h5>Scan Langsung (Tanpa Antre)</h5>
                        <p>Tunjukkan QR Code langsung ke staf armada <b>tanpa perlu menukar fisik</b> di loket tiket.</p>
                      </div>
                    </div>
                    <div className="tkt-rule-item">
                      <div className="tkt-rule-num">3</div>
                      <div className="tkt-rule-text">
                        <h5>Bebas Bagasi 20 kg</h5>
                        <p>Gratis bagasi 1 koper/tas ransel maks. <b>20 kg</b>. Barang berlebih dikenakan tarif khusus.</p>
                      </div>
                    </div>
                    <div className="tkt-rule-item">
                      <div className="tkt-rule-num">4</div>
                      <div className="tkt-rule-text">
                        <h5>Identitas Resmi</h5>
                        <p>Pastikan nama pada boarding pass cocok dengan kartu identitas (KTP/SIM/Paspor) asli.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="search-footer">
        <div className="search-footer-inner">
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <img src={logoNavbar} alt="GOVIA" style={{ height: '38px', width: 'auto', objectFit: 'contain' }} />
            </div>
            <p className="search-footer-about">
              Layanan pemesanan tiket bus antarkota GOVIA dengan e-tiket digital.
            </p>
          </div>

          <div className="search-footer-col">
            <h5>Navigasi</h5>
            <ul className="search-footer-links">
              <li><a href="/">Beranda</a></li>
              <li><a href="/search">Cari Jadwal Bus</a></li>
              <li><a href="/tiket">Tiket Saya</a></li>
            </ul>
          </div>

          <div className="search-footer-col">
            <h5>Panduan Boarding</h5>
            <ul className="search-footer-links">
              <li>Tunjukkan kode booking (PNR) kepada petugas</li>
              <li>Datang di titik keberangkatan sesuai jadwal</li>
            </ul>
          </div>
        </div>

        <div className="search-footer-bottom">
          <div>© 2026 GOVIA.</div>
          <div>Halaman E-Tiket Penumpang</div>
        </div>
      </footer>
    </div>
  );
}
