import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import '../Style/payment.css';
import logoNavbar from '../assets/LogoNavbar.png';
import {
  bookingApi,
  paymentsApi,
  getScheduleBookingState,
  type BookingDetail,
  type ChargeResponse,
  type QueueStatus,
} from '../services/api';

interface PaymentPageProps {
  bookingCode?: string;
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

interface MidtransSnap {
  pay: (
    token: string,
    callbacks?: {
      onSuccess?: () => void;
      onPending?: () => void;
      onError?: () => void;
      onClose?: () => void;
    }
  ) => void;
}

type WindowWithSnap = Window & { snap?: MidtransSnap };

function formatRupiah(v: string | number | undefined): string {
  const n = Number(v || 0);
  return `Rp ${n.toLocaleString('id-ID')}`;
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

export default function PaymentPage({ bookingCode = '', onNavigate }: PaymentPageProps) {
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [charge, setCharge] = useState<ChargeResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [statusState, setStatusState] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [queue, setQueue] = useState<QueueStatus | null>(null);

  const loadBooking = useCallback(async (silent = false) => {
    if (!bookingCode) {
      setErrorMsg('Kode booking tidak ditemukan. Silakan ulangi proses pemesanan.');
      setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    try {
      const res = await bookingApi.getByCode(bookingCode);
      if (res.success) {
        setBooking(res.data);
        if (res.data.status === 'lunas') setIsPaid(true);
        // Hitung sisa waktu dari expired_at
        if (res.data.expired_at) {
          const diff = Math.floor((new Date(res.data.expired_at).getTime() - Date.now()) / 1000);
          setTimeLeft(diff > 0 ? diff : 0);
        }
      } else {
        setErrorMsg('Booking tidak ditemukan.');
      }
    } catch (e) {
      setErrorMsg((e as Error).message || 'Gagal memuat data booking.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [bookingCode]);

  useEffect(() => {
    (async () => { await loadBooking(); })();
  }, [loadBooking]);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Cek posisi antrean pembayaran setelah kursi dikunci
  useEffect(() => {
    if (!bookingCode) return;
    let cancelled = false;
    const fetchQueue = async () => {
      try {
        const res = await bookingApi.queue(bookingCode);
        if (!cancelled) setQueue(res);
      } catch { /* diamkan error queue */ }
    };
    fetchQueue();
    const timer = setInterval(fetchQueue, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [bookingCode]);

  // Polling status pembayaran (untuk mendeteksi pembayaran Midtrans yang masuk)
  useEffect(() => {
    if (isPaid || !bookingCode) return;
    const poll = setInterval(async () => {
      try {
        const res = await bookingApi.getByCode(bookingCode);
        if (res.success && res.data.status === 'lunas') {
          setIsPaid(true);
          setStatusState({ message: 'Pembayaran terverifikasi! E-Ticket sedang disiapkan...', type: 'success' });
          setTimeout(() => onNavigate('ticket', { bookingCode }), 1500);
        }
      } catch { /* diamkan error polling */ }
    }, 5000);
    return () => clearInterval(poll);
  }, [isPaid, bookingCode, onNavigate]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  // ── Buat transaksi pembayaran via Midtrans Snap / Tampilkan QR Langsung ──────────────
  const handlePayMidtrans = async () => {
    if (!booking) return;
    setIsProcessing(true);
    setStatusState(null);
    try {
      const res = await paymentsApi.charge({
        booking_code: booking.kode_booking,
        metode: 'qris',
      });
      setCharge(res);

      // 1. Jika ada Snap JS pop-up terpasang di window
      const win = window as unknown as WindowWithSnap;
      if (res.token && win.snap) {
        win.snap.pay(res.token, {
          onSuccess: () => {
            setIsPaid(true);
            setStatusState({ message: 'Pembayaran berhasil! Mengalihkan ke E-Ticket...', type: 'success' });
            setTimeout(() => onNavigate('ticket', { bookingCode: booking.kode_booking }), 1200);
          },
          onPending: () => {
            setStatusState({ message: 'Menunggu penyelesaian pembayaran QRIS...', type: 'info' });
          },
          onError: () => {
            setStatusState({ message: 'Pembayaran gagal atau dibatalkan.', type: 'error' });
          },
          onClose: () => {
            setStatusState({ message: 'Popup pembayaran ditutup. Anda juga bisa scan QR di layar.', type: 'info' });
          }
        });
      } else if (res.mode === 'simulation' || !res.redirect_url) {
        setStatusState({ message: 'QRIS Pembayaran telah dibuat! Silakan scan langsung QR di bawah.', type: 'info' });
      } else if (res.redirect_url) {
        // Jika mode redirect dan popup tidak aktif
        setStatusState({ message: 'QRIS siap! Anda juga dapat membuka halaman pembayaran Midtrans jika diperlukan.', type: 'info' });
      }
    } catch (e) {
      setStatusState({ message: (e as Error).message || 'Gagal memproses pembayaran.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Konfirmasi pembayaran manual / simulasi jika user sudah bayar ────
  const handleConfirmPayment = async () => {
    if (!booking) return;
    setIsProcessing(true);
    setStatusState(null);
    try {
      const res = await paymentsApi.confirm({
        booking_code: booking.kode_booking,
        referensi: charge?.reference,
      });
      if (res.success) {
        setIsPaid(true);
        setStatusState({ message: 'Pembayaran berhasil! Mengalihkan ke E-Ticket...', type: 'success' });
        setTimeout(() => onNavigate('ticket', { bookingCode: booking.kode_booking }), 1200);
      }
    } catch (e) {
      setStatusState({ message: (e as Error).message || 'Gagal mengonfirmasi pembayaran.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const totalHarga = booking?.total_harga;
  const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    charge?.qris_string || `https://app.sandbox.midtrans.com/snap/v2/vtweb/${charge?.token || booking?.kode_booking}`
  )}`;

  return (
    <div className="pay-page-container">
      <Navbar onNavigate={onNavigate} />

      <main className="pay-main-content">
        {/* ── Top Security Tag & Temporary Seat Status ─────────────── */}
        <div className="pay-top-info-row">
          <div className="pay-security-tag">
            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>lock</span>
            <span>Sesi Checkout Aman #{bookingCode || '-'}</span>
          </div>
          <div className="pay-seat-reserve-note">
            ● Kursi {booking?.passengers?.map(p => p.nomor_kursi).join(', ') || '-'} Dicadangkan Sementara
          </div>
        </div>

        {/* ── 4-Step Stepper Progress Bar ─────────────────────────── */}
        <div className="pay-stepper-bar">
          <div className="pay-step-node completed">
            <div className="pay-step-badge">
              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>check</span>
            </div>
            <div className="pay-step-text"><span>LANGKAH 1</span><h5>Jadwal Bus</h5></div>
          </div>
          <div className="pay-step-node completed">
            <div className="pay-step-badge">
              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>check</span>
            </div>
            <div className="pay-step-text"><span>LANGKAH 2</span><h5>Pilih Kursi</h5></div>
          </div>
          <div className="pay-step-node active">
            <div className="pay-step-badge">3</div>
            <div className="pay-step-text"><span>AKTIF • BAYAR</span><h5>Kasir Digital</h5></div>
          </div>
          <div className="pay-step-node">
            <div className="pay-step-badge">4</div>
            <div className="pay-step-text"><span>LANGKAH 4</span><h5>E-Ticket</h5></div>
          </div>
        </div>

        {/* ── Countdown Timer Banner ───────────────────────────────── */}
        {!isPaid && timeLeft > 0 && (
          <div className="pay-timer-banner">
            <div className="pay-timer-left">
              <div className="pay-timer-icon-box">
                <span className="material-symbols-outlined">timer</span>
              </div>
              <div className="pay-timer-text">
                <h4>
                  Selesaikan Pembayaran Sebelum Waktu Habis
                  <span className="tag">Terkunci</span>
                </h4>
                <p>
                  Kursi <b>{booking?.passengers?.map(p => p.nomor_kursi).join(', ') || '-'}</b> dilindungi hingga timer berakhir.
                </p>
              </div>
            </div>
            <div className="pay-timer-digits">
              <div className="pay-digit-box">
                <span className="num">{minutes.toString().padStart(2, '0')}</span>
                <span className="lbl">Menit</span>
              </div>
              <span className="pay-digit-colon">:</span>
              <div className="pay-digit-box">
                <span className="num">{seconds.toString().padStart(2, '0')}</span>
                <span className="lbl">Detik</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Posisi Antrean Pembayaran & Status Pemenang Kursi ──────────────────────────── */}
        {booking && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem',
            padding: '0.75rem 1rem', borderRadius: '0.75rem', marginBottom: '1rem',
            background: booking.pickup ? '#fff7ed' : '#eff6ff',
            border: `1px solid ${booking.pickup ? '#fed7aa' : '#bfdbfe'}`,
            color: booking.pickup ? '#9a3412' : '#1e40af',
            fontSize: '0.78rem', fontWeight: 700,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                {booking.pickup ? 'casino' : 'emoji_events'}
              </span>
              <span>
                {booking.pickup ? (
                  <>
                    <b>Tiket Titik Jemput ({booking.pickup.nama_lokasi})</b> • Kursi Ditetapkan Random oleh Sistem:{' '}
                    <b>{booking.passengers?.map(p => p.nomor_kursi).join(', ') || booking.pickup.nomor_kursi}</b>
                  </>
                ) : (
                  <>
                    <b>Pemenang Antrean Kursi ({booking.passengers?.map(p => p.nomor_kursi).join(', ') || '-'})</b> • Anda pemesan pertama yang berhasil mengunci kursi ini!
                  </>
                )}
              </span>
            </div>
            {queue && queue.posisi_antrean !== null && (
              <span style={{ background: '#ffffff', padding: '0.2rem 0.6rem', borderRadius: '999px', border: '1px solid #cbd5e1', fontSize: '0.72rem' }}>
                Urutan Antrean Booking: <b>#{queue.posisi_antrean}</b> dari {queue.total_antrean}
              </span>
            )}
          </div>
        )}

        {/* ── State: Loading / Error ───────────────────────────────── */}
        {isLoading && (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '40px', display: 'block', marginBottom: '1rem', color: '#1B4285' }}>sync</span>
            <p style={{ fontWeight: 700 }}>Memuat data booking...</p>
          </div>
        )}

        {!isLoading && errorMsg && (
          <div style={{ padding: '2rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '1rem', color: '#dc2626', textAlign: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '32px', display: 'block', marginBottom: '0.5rem' }}>error</span>
            <p style={{ fontWeight: 700 }}>{errorMsg}</p>
            <button
              type="button"
              onClick={() => onNavigate('search')}
              style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#1B4285', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Kembali Cari Tiket
            </button>
          </div>
        )}

        {!isLoading && !errorMsg && booking && (
          <>
            {/* ── Status Message Toast ─────────────────────────────── */}
            {statusState && (
              <div style={{
                padding: '0.85rem 1rem',
                borderRadius: '0.75rem',
                marginBottom: '1rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                background: statusState.type === 'success' ? '#dcfce7' : statusState.type === 'error' ? '#fee2e2' : '#eff6ff',
                color: statusState.type === 'success' ? '#166534' : statusState.type === 'error' ? '#991b1b' : '#1e40af',
                border: `1px solid ${statusState.type === 'success' ? '#86efac' : statusState.type === 'error' ? '#fecaca' : '#bfdbfe'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  {statusState.type === 'success' ? 'check_circle' : statusState.type === 'error' ? 'error' : 'info'}
                </span>
                <span>{statusState.message}</span>
              </div>
            )}

            {/* ── Banner Bus Sudah Berangkat (Pembayaran Ditutup) ── */}
            {!isPaid && booking && (() => {
              const schedState = getScheduleBookingState({
                status: booking.schedule_status,
                status_perjalanan: booking.status_perjalanan,
                catatan_operasional: booking.catatan_operasional,
                lokasi_terakhir: booking.lokasi_terakhir,
              });
              if (schedState.isBookable) return null;
              return (
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    background: '#fef2f2',
                    border: '1.5px solid #fca5a5',
                    borderRadius: '0.75rem',
                    marginBottom: '1rem',
                    color: '#991b1b',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="material-symbols-outlined">departure_board</span>
                  <div>
                    <div style={{ fontWeight: 900 }}>{schedState.badgeText}</div>
                    <div style={{ fontSize: '0.78rem' }}>{schedState.reasonText}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('search')}
                    style={{
                      marginLeft: 'auto',
                      padding: '0.45rem 0.9rem',
                      background: '#b91c1c',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '0.5rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Cari Jadwal Lain
                  </button>
                </div>
              );
            })()}

            {/* ── Banner Lunas ─────────────────────────────────────── */}
            {isPaid && (
              <div style={{ padding: '1rem 1.25rem', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '0.75rem', marginBottom: '1rem', color: '#166534', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-outlined">verified</span>
                <span>Pembayaran sudah LUNAS. E-Ticket Anda telah diterbitkan.</span>
                <button
                  type="button"
                  onClick={() => onNavigate('ticket', { bookingCode: booking.kode_booking })}
                  style={{ marginLeft: 'auto', padding: '0.4rem 0.9rem', background: '#166534', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  Lihat E-Ticket
                </button>
              </div>
            )}

            {/* ── 2-Column Main Layout ─────────────────────────────── */}
            <div className="pay-grid-layout">
              {/* ════════ LEFT COLUMN: PEMBAYARAN MIDTRANS ════════ */}
              <div className="pay-methods-col">
                <div className="pay-section-header">
                  <div>
                    <span className="pay-sub-label">PEMBAYARAN RESMI</span>
                    <h2 className="pay-title-main">Konfirmasi &amp; Pembayaran</h2>
                  </div>
                  <div className="pay-auto-verif-badge">
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>flash_on</span>
                    <span>Verifikasi Otomatis</span>
                  </div>
                </div>

                <div className="pay-midtrans-info-card" style={{
                  background: '#ffffff',
                  borderRadius: '1.25rem',
                  border: '1.5px solid #d9e3f6',
                  padding: '1.5rem',
                  boxShadow: '0 4px 18px -2px rgba(0, 40, 105, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1.25rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                      width: '3.25rem',
                      height: '3.25rem',
                      borderRadius: '0.85rem',
                      background: '#1B4285',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.75rem',
                      flexShrink: 0
                    }}>
                      <span className="material-symbols-outlined">qr_code_scanner</span>
                    </div>
                    <div>
                      <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem', fontWeight: 800, color: '#1B4285' }}>
                        QRIS / Gateway Midtrans Langsung
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>
                        Scan QRIS langsung dengan aplikasi e-wallet (GoPay, OVO, ShopeePay, Dana) atau Mobile Banking apa saja.
                      </p>
                    </div>
                  </div>

                  {/* ── Kotak QR Code Langsung di Aplikasi ── */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#f8faff',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '1rem',
                    padding: '1.25rem 1rem',
                    textAlign: 'center'
                  }}>
                    <div style={{
                      background: '#ffffff',
                      padding: '0.75rem',
                      borderRadius: '0.75rem',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                      marginBottom: '0.75rem'
                    }}>
                      <img
                        src={qrImage}
                        alt="QR Pembayaran"
                        style={{ width: '190px', height: '190px', display: 'block', objectFit: 'contain' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#16a34a', fontWeight: 800, fontSize: '0.75rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>verified</span>
                      <span>QRIS Standar Nasional Terverifikasi</span>
                    </div>
                    <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.68rem', color: '#64748b' }}>
                      Bisa di-scan dari BCA, Mandiri, BRI, GoPay, OVO, DANA, ShopeePay, LinkAja dll.
                    </p>
                  </div>

                  <div style={{
                    background: '#f8faff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.85rem',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: '#475569' }}>
                      <span>Nomor Booking:</span>
                      <strong style={{ color: '#1B4285', fontFamily: 'monospace', fontSize: '0.9rem' }}>#{booking.kode_booking}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: '#475569' }}>
                      <span>Jumlah Penumpang:</span>
                      <strong style={{ color: '#0f172a' }}>{booking.passengers?.length || 1} Kursi ({booking.passengers?.map(p => p.nomor_kursi).join(', ') || '-'})</strong>
                    </div>
                    <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>Total Tagihan:</span>
                      <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#1B4285' }}>{formatRupiah(totalHarga)}</span>
                    </div>
                  </div>
                </div>

                {/* Big Action Buttons */}
                <div className="pay-action-btn-row">
                  {(() => {
                    const schedClosed =
                      !isPaid &&
                      Boolean(
                        booking &&
                          !getScheduleBookingState({
                            status: booking.schedule_status,
                            status_perjalanan: booking.status_perjalanan,
                          }).isBookable
                      );
                    return (
                      <>
                        {!isPaid && !charge && (
                          <button
                            type="button"
                            className="pay-submit-big-btn"
                            onClick={handlePayMidtrans}
                            disabled={isProcessing || timeLeft === 0 || schedClosed}
                            style={{
                              opacity: isProcessing || timeLeft === 0 || schedClosed ? 0.6 : 1,
                              cursor: schedClosed ? 'not-allowed' : undefined,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                              {schedClosed ? 'block' : 'payments'}
                            </span>
                            <span>
                              {schedClosed
                                ? 'Bus Sudah Berangkat • Pembayaran Ditutup'
                                : isProcessing
                                ? 'Memuat Midtrans...'
                                : `Buka Popup Midtrans (${formatRupiah(totalHarga)})`}
                            </span>
                          </button>
                        )}

                        {!isPaid && charge && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <button
                              type="button"
                              className="pay-submit-big-btn"
                              onClick={handleConfirmPayment}
                              disabled={isProcessing || schedClosed}
                              style={{
                                opacity: isProcessing || schedClosed ? 0.6 : 1,
                                background: schedClosed ? '#94a3b8' : '#16a34a',
                                cursor: schedClosed ? 'not-allowed' : undefined,
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                                {schedClosed ? 'block' : 'check_circle'}
                              </span>
                              <span>
                                {schedClosed
                                  ? 'Bus Sudah Berangkat • Pembayaran Ditutup'
                                  : isProcessing
                                  ? 'Memverifikasi...'
                                  : 'Saya Sudah Membayar (Verifikasi)'}
                              </span>
                            </button>

                      {charge.redirect_url && (
                        <button
                          type="button"
                          onClick={() => {
                            const win = window as unknown as WindowWithSnap;
                            if (charge.token && win.snap) {
                              win.snap.pay(charge.token);
                            } else {
                              window.open(charge.redirect_url, '_blank');
                            }
                          }}
                          style={{
                            padding: '0.65rem',
                            borderRadius: '0.65rem',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#1B4285',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer'
                          }}
                        >
                          Buka Pilihan Pembayaran Lain di Midtrans ↗
                        </button>
                      )}
                    </div>
                  )}
                  </>
                    );
                  })()}

                  {timeLeft === 0 && !isPaid && (
                    <div style={{
                      color: '#dc2626',
                      fontWeight: 800,
                      fontSize: '0.78rem',
                      textAlign: 'center',
                      marginTop: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>timer_off</span>
                      <span>Waktu pembayaran habis. Silakan pesan ulang.</span>
                    </div>
                  )}

                  <div className="pay-security-note-bottom">
                    <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#16a34a' }}>lock</span>
                    <span>Transaksi diproteksi Midtrans Gateway &amp; Enkripsi Bank-Grade 256-Bit</span>
                  </div>
                </div>
              </div>

              {/* ════════ RIGHT COLUMN: DETAIL PEMESANAN & INVOICE ════════ */}
              <div className="pay-invoice-col">
                <div className="pay-invoice-card">
                  <div className="pay-invoice-header">
                    <div>
                      <span className="pay-inv-code-title">KODE BOOKING RESMI</span>
                      <div className="pay-inv-code-val">#{booking.kode_booking}</div>
                    </div>
                    <div className="pay-inv-status-tag">
                      <span>{isPaid ? 'Lunas' : booking.status === 'kedaluwarsa' ? 'Kedaluwarsa' : 'Menunggu Bayar'}</span>
                      <small>Sistem Agregator AKAP</small>
                    </div>
                  </div>

                  <div className="pay-invoice-body">
                    {/* Operator Block */}
                    <div className="pay-operator-box">
                      <div className="pay-operator-img-box">
                        <span className="material-symbols-outlined">directions_bus</span>
                      </div>
                      <div>
                        <div className="pay-operator-title-row">
                          <h4>{booking.nama_bus}</h4>
                          <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#16a34a' }}>check_circle</span>
                        </div>
                        <div className="pay-operator-sub">Kelas: {booking.kelas} • Plat {booking.plat_nomor}</div>
                        <div className="pay-seat-badge-pill">
                          <span>Kursi No. {booking.passengers?.map(p => p.nomor_kursi).join(', ') || '-'}</span>
                          <span>•</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>group</span>
                            <span>{booking.passengers?.length || 0} Penumpang</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Timeline Route */}
                    <div className="pay-route-timeline">
                      <div className="pay-timeline-stop">
                        <span className="dot"></span>
                        <h5>{booking.asal_kota} – {booking.asal_terminal}</h5>
                        <p>{formatTanggal(booking.tanggal_berangkat)} • Berangkat {formatJam(booking.jam_berangkat)}</p>
                      </div>
                      <div className="pay-timeline-stop">
                        <span className="dot dest"></span>
                        <h5>{booking.tujuan_kota} – {booking.tujuan_terminal}</h5>
                        <p>Tiba {formatJam(booking.jam_tiba)}</p>
                      </div>
                    </div>

                    {/* Rincian Pembayaran */}
                    <div className="pay-breakdown-section">
                      <h5>Rincian Pembayaran (Invoice)</h5>
                      <div className="pay-breakdown-list">
                        {booking.passengers?.map((p, i) => (
                          <div className="pay-breakdown-item" key={p.id || i}>
                            <span>Tiket Kursi {p.nomor_kursi} ({p.nama_penumpang})</span>
                            <span className="val">
                              {formatRupiah(Number(totalHarga) / (booking.passengers.length || 1))}
                            </span>
                          </div>
                        ))}
                        <div className="pay-breakdown-item">
                          <span>Biaya Layanan &amp; Reservasi Kursi</span>
                          <span className="val free">Rp 0 (GRATIS)</span>
                        </div>
                      </div>
                    </div>

                    {/* Total Box */}
                    <div className="pay-total-card-box">
                      <div className="pay-total-left">
                        <span>TOTAL TAGIHAN BERSIH</span>
                        <small>Sudah Termasuk Pajak &amp; PPN</small>
                      </div>
                      <div className="pay-total-amount-val">{formatRupiah(totalHarga)}</div>
                    </div>

                    {/* Info Pemesan */}
                    <div className="pay-sah-note">
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#16a34a', flexShrink: 0 }}>verified</span>
                      <div>
                        <b>Pemesan: {booking.customer_nama}</b>
                        <br />
                        {booking.customer_email} • {booking.customer_no_hp}
                      </div>
                    </div>

                    {/* Helpdesk */}
                    <div className="pay-helpdesk-pill">
                      <div className="pay-helpdesk-left">
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>support_agent</span>
                        <div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 800 }}>Kendala Transfer?</div>
                          <div style={{ fontSize: '0.62rem', color: '#64748b' }}>Hubungi Tim Helpdesk GOVIA</div>
                        </div>
                      </div>
                      <button type="button" className="pay-helpdesk-btn" onClick={() => onNavigate('chatbot')}>
                        WhatsApp CS
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="search-footer">
        <div className="search-footer-inner">
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <img src={logoNavbar} alt="GOVIA Transport" style={{ height: '38px', width: 'auto', objectFit: 'contain' }} />
            </div>
            <p className="search-footer-about">
              Platform agregator pemesanan tiket bus AKAP online terlengkap dan terpercaya di Indonesia. Terhubung dengan 200+ armada otobus terverifikasi di seluruh Nusantara.
            </p>
            <div className="search-footer-badges">
              <div className="search-footer-badge-pill">
                <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#16a34a' }}>verified</span>
                <span>256-bit SSL Enkripsi Aman</span>
              </div>
              <div className="search-footer-badge-pill">
                <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#FA7808' }}>verified</span>
                <span>Midtrans Payment Verified</span>
              </div>
            </div>
          </div>

          <div className="search-footer-col">
            <h5>Info Perusahaan</h5>
            <ul className="search-footer-links">
              <li><a href="#about">Tentang GOVIA</a></li>
              <li><a href="#mitra">Mitra PO Bus</a></li>
              <li><a href="#faq">Pusat Bantuan &amp; FAQ</a></li>
              <li><a href="#terms">Syarat &amp; Ketentuan</a></li>
              <li><a href="#privacy">Kebijakan Privasi</a></li>
            </ul>
          </div>

          <div className="search-footer-col">
            <h5>Rute Populer AKAP</h5>
            <ul className="search-footer-links">
              <li><a href="#r1">Jakarta – Surabaya</a></li>
              <li><a href="#r2">Jakarta – Yogyakarta</a></li>
              <li><a href="#r3">Bandung – Semarang</a></li>
              <li><a href="#r4">Surabaya – Denpasar</a></li>
              <li><a href="#r5">Medan – Padang</a></li>
            </ul>
          </div>
        </div>

        <div className="search-footer-bottom">
          <div>© 2026 GOVIA Indonesia. Hak Cipta Dilindungi Undang-Undang.</div>
          <div>Layanan Konsumen Ditjen PKTN Kemenperag RI: 0853-1111-1010</div>
        </div>
      </footer>
    </div>
  );
}
