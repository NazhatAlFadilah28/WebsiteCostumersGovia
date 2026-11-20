import React, { useState, useEffect, useCallback, useRef } from 'react';
import Navbar from '../components/Navbar';
import '../Style/seats.css';
import {
  schedulesApi,
  bookingApi,
  getStoredUser,
  getToken,
  getScheduleBookingState,
  type SeatItem,
  type ScheduleItem,
  type SeatQueueEntry,
} from '../services/api';

interface Seat {
  seat_id: string;
  nomor_kursi: string;
  status: 'tersedia' | 'terisi';
}

interface SeatsPageProps {
  scheduleId?: string;
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

export default function SeatsPage({ scheduleId = '1', onNavigate }: SeatsPageProps) {
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [sameAsBooker, setSameAsBooker] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'midtrans' | 'cash'>('midtrans');

  // ID sesi unik untuk antrean pemilihan kursi (kapasitas hingga 20.000 pemilih simultan)
  const queueSessionIdRef = useRef<string>('');
  const getQueueSessionId = useCallback(() => {
    if (!queueSessionIdRef.current) {
      queueSessionIdRef.current = `sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return queueSessionIdRef.current;
  }, []);

  // Ambil data user & filter rute dari localStorage sekali saat inisialisasi
  const readStoredUser = () => getStoredUser();
  const readStoredRoute = () => {
    try {
      const raw = localStorage.getItem('govia_route_filter');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.nama_penumpang?.trim().toLowerCase() === 'budi pratama') {
        parsed.nama_penumpang = '';
      }
      if (parsed?.no_identitas?.trim() === '202410982') {
        parsed.no_identitas = '';
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const [fullName, setFullName] = useState(() => readStoredUser()?.nama || readStoredRoute()?.nama_penumpang || '');
  const [nikNumber, setNikNumber] = useState(() => readStoredRoute()?.no_identitas || '');
  const [phone, setPhone] = useState(() => readStoredUser()?.no_hp || '');

  const [dbSeats, setDbSeats] = useState<Seat[]>([]);
  const [scheduleDetail, setScheduleDetail] = useState<ScheduleItem | null>(null);
  const [farePerSeat, setFarePerSeat] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── State Sistem Pengecekan Antrean Kursi Real-Time (Kapasitas 20.000 Pemilih) ──
  const [queueTotalActive, setQueueTotalActive] = useState<number>(0);
  const [queueMaxCapacity, setQueueMaxCapacity] = useState<number>(20000);
  const [queueBookedCount, setQueueBookedCount] = useState<number>(0);
  const [queuePerSeat, setQueuePerSeat] = useState<Record<string, SeatQueueEntry>>({});
  const [isCheckingQueue, setIsCheckingQueue] = useState<boolean>(false);
  const [queueAlertInfo, setQueueAlertInfo] = useState<string | null>(null);

  const isAuthenticated = Boolean(getToken() && getStoredUser()?.id);

  // Fetch kursi & jadwal dari backend
  const fetchSeats = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [seatData, schedData] = await Promise.all([
        schedulesApi.getSeats(scheduleId),
        schedulesApi.getById(scheduleId),
      ]);

      if (seatData.success) {
        const loadedSeats = (seatData.seats || []) as SeatItem[] as Seat[];
        setDbSeats(loadedSeats);
        const occupied = loadedSeats.filter((s) => s.status === 'terisi').length;
        setQueueBookedCount(occupied);
      }
      if (schedData.success && schedData.data) {
        setScheduleDetail(schedData.data);
        setFarePerSeat(parseInt(String(schedData.data.harga)) || 0);
      } else if (seatData.success && seatData.status_perjalanan) {
        setScheduleDetail((prev) =>
          prev
            ? {
                ...prev,
                status: seatData.status ?? prev.status,
                status_perjalanan: seatData.status_perjalanan || prev.status_perjalanan,
                lokasi_terakhir: seatData.lokasi_terakhir ?? prev.lokasi_terakhir,
                catatan_operasional: seatData.catatan_operasional ?? prev.catatan_operasional,
              }
            : prev
        );
      }
    } catch {
      if (!silent) setErrorMsg('Gagal memuat data kursi dari server.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [scheduleId]);

  // Sinkronisasi antrean pemilihan kursi (terpisah dari kursi yang sudah terbooking)
  const syncSeatQueue = useCallback(
    async (seatsList: string[], action: 'join' | 'heartbeat' | 'check' = 'join', showSpinner = false) => {
      if (showSpinner) setIsCheckingQueue(true);
      try {
        const user = getStoredUser();
        const res = await schedulesApi.joinQueue(scheduleId, {
          session_id: getQueueSessionId(),
          seats: seatsList,
          user_label: fullName || user?.nama || 'Customer',
          action: seatsList.length > 0 ? action : 'join',
        });
        if (res.success) {
          setQueueTotalActive(res.total_active_queue);
          setQueueMaxCapacity(res.max_queue_capacity || 20000);
          setQueueBookedCount(res.booked_seats_count);
          setQueuePerSeat(res.per_seat || {});

          // Jika salah satu kursi yang dipilih tiba-tiba sudah dibooking orang lain, beri peringatan & refresh denah
          const newlyBooked = seatsList.filter((code) => res.per_seat?.[code]?.is_booked);
          if (newlyBooked.length > 0) {
            setSelectedSeats((prev) => prev.filter((c) => !newlyBooked.includes(c)));
            setErrorMsg(
              `Pemeriksaan Antrean: Kursi ${newlyBooked.join(', ')} baru saja dimenangkan oleh pemesan lebih awal. Silakan pilih kursi lain.`
            );
            void fetchSeats(true);
          }
        }
        return res;
      } catch (err: unknown) {
        const e = err as Error & { status?: number };
        if (e.status === 429) {
          setErrorMsg(e.message || 'Antrean pemilihan kursi mencapai kapasitas maksimal 20.000 orang.');
        }
        return null;
      } finally {
        if (showSpinner) setIsCheckingQueue(false);
      }
    },
    [scheduleId, fullName, fetchSeats, getQueueSessionId]
  );

  // Muat kursi awal & polling berkala
  useEffect(() => {
    (async () => {
      await fetchSeats();
    })();
    const interval = setInterval(() => {
      void fetchSeats(true);
    }, 15000);
    const onFocus = () => {
      void fetchSeats(true);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchSeats]);

  // Sinkronkan setiap perubahan kursi terpilih ke antrean server + heartbeat tiap 5 detik
  useEffect(() => {
    const initTimer = setTimeout(() => {
      void syncSeatQueue(selectedSeats, 'join', false);
    }, 0);
    const heartbeat = setInterval(() => {
      void syncSeatQueue(selectedSeats, selectedSeats.length > 0 ? 'heartbeat' : 'check', false);
    }, 5000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(heartbeat);
    };
  }, [selectedSeats, syncSeatQueue]);

  // Lepaskan slot antrean saat meninggalkan halaman atau ganti jadwal
  useEffect(() => {
    const sid = getQueueSessionId();
    return () => {
      void schedulesApi.leaveQueue(scheduleId, sid).catch(() => {});
    };
  }, [scheduleId, getQueueSessionId]);

  const occupiedSeats = dbSeats.filter((s) => s.status === 'terisi').map((s) => s.nomor_kursi);
  const allSeatCodes = dbSeats.map((s) => s.nomor_kursi);
  const busCapacity = scheduleDetail?.kapasitas || dbSeats.length || 32;
  const availableCount = dbSeats.filter((s) => s.status === 'tersedia').length;
  const busClassRaw = scheduleDetail?.kelas || 'eksekutif';
  const busClassLabel = busClassRaw.charAt(0).toUpperCase() + busClassRaw.slice(1);
  const bookingState = scheduleDetail ? getScheduleBookingState(scheduleDetail) : null;
  const isBookingClosed = Boolean(bookingState && !bookingState.isBookable);
  const sortedRowNumbers = Array.from(new Set(allSeatCodes.map((c) => c.replace(/[A-D]/g, '')))).sort(
    (a, b) => Number(a) - Number(b)
  );

  const formatTanggalIndo = (iso?: string) => {
    if (!iso) return 'Jadwal Aktif';
    try {
      return new Date(iso).toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const formatJam = (jam?: string) => (jam ? jam.substring(0, 5).replace(':', '.') : '-');

  const toggleSeat = (seatCode: string) => {
    if (isBookingClosed) {
      setErrorMsg(bookingState?.reasonText || 'Bus sudah berangkat. Pemesanan tiket untuk jadwal ini telah ditutup.');
      return;
    }
    if (occupiedSeats.includes(seatCode)) return;
    setErrorMsg(null);
    if (selectedSeats.includes(seatCode)) {
      setSelectedSeats(selectedSeats.filter((s) => s !== seatCode));
    } else {
      if (selectedSeats.length >= 4) {
        alert('Maksimal 4 kursi per pemesanan.');
        return;
      }
      setSelectedSeats([...selectedSeats, seatCode]);
    }
  };

  const handleCheckQueueNow = async () => {
    setErrorMsg(null);
    await fetchSeats(true);
    const snap = await syncSeatQueue(selectedSeats, selectedSeats.length > 0 ? 'heartbeat' : 'check', true);
    if (snap?.success) {
      const seatSummary = selectedSeats
        .map((code) => {
          const info = snap.per_seat?.[code];
          if (!info) return `${code}: Siap`;
          if (info.is_booked) return `${code}: Sudah Terbooking`;
          return `${code}: Antrean #${info.your_position ?? 1} dari ${info.contenders} pemilih`;
        })
        .join(' • ');

      setQueueAlertInfo(
        selectedSeats.length > 0
          ? `Antrean diperbarui (${snap.total_active_queue.toLocaleString('id-ID')} / ${snap.max_queue_capacity.toLocaleString('id-ID')} pemilih aktif) — ${seatSummary}`
          : `Antrean aktif saat ini: ${snap.total_active_queue.toLocaleString('id-ID')} / ${snap.max_queue_capacity.toLocaleString('id-ID')} pemilih • ${snap.booked_seats_count} kursi sudah terbooking.`
      );
    }
  };

  const effectiveSeatCount = Math.max(1, selectedSeats.length);
  const totalAmount = effectiveSeatCount * farePerSeat;

  const handleProceedPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isBookingClosed) {
      setErrorMsg(bookingState?.reasonText || 'Bus sudah berangkat. Anda tidak dapat memesan tiket lagi untuk jadwal ini.');
      return;
    }

    if (selectedSeats.length === 0) {
      setErrorMsg('Silakan pilih minimal 1 kursi pada denah kabin terlebih dahulu.');
      return;
    }
    if (!fullName.trim() || !nikNumber.trim() || !phone.trim()) {
      setErrorMsg('Harap lengkapi data penumpang (Nama, NIK, No HP).');
      return;
    }

    const user = readStoredUser();
    const token = getToken();
    if (!user?.id || !token) {
      setErrorMsg(
        paymentMethod === 'cash'
          ? 'Pembayaran Cash (tunai langsung) mewajibkan Login / Auth terlebih dahulu.'
          : 'Anda harus login terlebih dahulu untuk melakukan pemesanan.'
      );
      onNavigate('login');
      return;
    }

    setIsSubmitting(true);

    try {
      // ── LANGKAH 1: PEMERIKSAAN ANTREAN REAL-TIME (20.000 KAPASITAS) SEBELUM LOCK KURSI ──
      const [latestSeatCheck, queueCheck] = await Promise.all([
        schedulesApi.getSeats(scheduleId),
        syncSeatQueue(selectedSeats, 'heartbeat', false),
      ]);

      let freshSeats = dbSeats;
      if (latestSeatCheck.success && latestSeatCheck.seats) {
        freshSeats = latestSeatCheck.seats as Seat[];
        setDbSeats(freshSeats);
        const freshOccupied = freshSeats.filter((s) => s.status === 'terisi').map((s) => s.nomor_kursi);
        setQueueBookedCount(freshOccupied.length);

        const takenSeat = selectedSeats.find(
          (code) => freshOccupied.includes(code) || queueCheck?.per_seat?.[code]?.is_booked
        );
        if (takenSeat) {
          setSelectedSeats((prev) => prev.filter((c) => !freshOccupied.includes(c)));
          setErrorMsg(
            `Pemeriksaan Antrean: Maaf, Kursi ${takenSeat} baru saja dimenangkan oleh pemesan yang lebih dulu dalam antrean! Silakan pilih kursi lain yang masih tersedia.`
          );
          setIsSubmitting(false);
          return;
        }
      }

      const passengers = selectedSeats.map((seatCode) => {
        const seatObj = freshSeats.find((s) => s.nomor_kursi === seatCode);
        return {
          seat_id: (seatObj?.seat_id as string) || '1',
          nomor_kursi: seatCode,
          nama_penumpang: fullName.trim(),
          no_identitas: nikNumber.trim(),
          no_hp: phone.trim(),
        };
      });

      const res = await bookingApi.lockSeats({
        schedule_id: scheduleId,
        passengers,
        metode_pembayaran: paymentMethod === 'cash' ? 'cash' : 'qris',
        session_id: getQueueSessionId(),
        pickup_info: { tipe_keberangkatan: 'terminal' },
      });

      const bookingCode = res.booking?.kode_booking;
      if (!bookingCode) {
        throw new Error('Kode booking tidak diterima dari server.');
      }

      // Jika Cash → langsung buka E-Ticket; jika Midtrans → ke halaman pembayaran Midtrans
      if (res.direct_ticket || res.is_cash) {
        onNavigate('ticket', { bookingCode, scheduleId });
      } else {
        onNavigate('payment', { bookingCode, scheduleId });
      }
    } catch (err: unknown) {
      const e = err as Error & { code?: string; status?: number };
      if (e.status === 401 || e.code === 'UNAUTHORIZED') {
        setErrorMsg(e.message || 'Sesi login Anda tidak valid. Silakan login terlebih dahulu.');
        onNavigate('login');
      } else if (e.code === 'SEAT_TAKEN' || /sudah dipesan|ditahan|dimenangkan/i.test(e.message)) {
        setErrorMsg(e.message);
        setSelectedSeats([]);
        void fetchSeats(true);
      } else {
        setErrorMsg(e.message || 'Terjadi kesalahan saat memesan.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="seat-page-container">
      {/* ── HEADER NAVBAR ────────────────────────────────────────── */}
      <Navbar onNavigate={onNavigate} />

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <main className="seat-main-content">
        {isBookingClosed && bookingState && (
          <div
            style={{
              background: '#fef2f2',
              border: '1.5px solid #fca5a5',
              color: '#991b1b',
              padding: '1rem 1.25rem',
              borderRadius: '0.85rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '26px', color: '#dc2626' }}>
                departure_board
              </span>
              <div>
                <div style={{ fontWeight: 900, fontSize: '0.95rem' }}>{bookingState.badgeText}</div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  {bookingState.reasonText}
                  {scheduleDetail?.lokasi_terakhir ? ` • Lokasi terkini: ${scheduleDetail.lokasi_terakhir}` : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('search')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.6rem',
                border: 'none',
                background: '#b91c1c',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              Pilih Jadwal Bus Lain
            </button>
          </div>
        )}

        {errorMsg && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}

        {/* Breadcrumb & Step Progress Bar */}
        <div className="seat-header-section">
          <div className="seat-breadcrumb-title">
            <div className="seat-breadcrumbs">
              <span className="cursor-pointer" onClick={() => onNavigate('search')}>Beranda</span>
              <span className="separator">&rsaquo;</span>
              <span className="cursor-pointer" onClick={() => onNavigate('search')}>Jadwal Bus</span>
              <span className="separator">&rsaquo;</span>
              <span className="active">Pilih Kursi &amp; Data Penumpang</span>
            </div>
            <h1 className="seat-page-title">Pilih Kursi Terminal &amp; Identitas Penumpang</h1>
          </div>

          {/* Stepper Status Horizontal */}
          <div className="seat-stepper-container">
            <div className="seat-step-item completed">
              <span className="seat-step-num" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
              </span>
              <span>1. Jadwal</span>
            </div>
            <div className="seat-step-divider"></div>
            <div className="seat-step-item active">
              <span className="seat-step-num">2</span>
              <span>Pilih Kursi</span>
            </div>
            <div className="seat-step-divider"></div>
            <div className="seat-step-item">
              <span className="seat-step-num">3</span>
              <span>Bayar</span>
            </div>
            <div className="seat-step-divider"></div>
            <div className="seat-step-item">
              <span className="seat-step-num">4</span>
              <span>E-Ticket</span>
            </div>
          </div>
        </div>

        {/* ── 2-COLUMN GRID ────────────────────────────────────────── */}
        <div className="seat-grid-layout">
          {/* ════════ LEFT COLUMN: BUS CABIN & REAL-TIME 20.000 QUEUE ════════ */}
          <div className="seat-left-col">
            {/* Card Denah Bus */}
            <div className="seat-card">
              <div className="seat-card-header-row">
                <div>
                  <span className="seat-badge-sub">
                    {busClassLabel.toUpperCase()} • KAPASITAS {busCapacity} KURSI
                  </span>
                  <h2 className="seat-card-title">
                    Denah Kabin {scheduleDetail?.nama_bus || 'Armada Bus'}
                  </h2>
                </div>
                <div className="seat-deck-tag">
                  <span className="seat-deck-dot"></span>
                  <span>
                    Tersedia {availableCount} / {busCapacity} Kursi
                  </span>
                </div>
              </div>

              {/* Status Keterangan Kursi */}
              <div className="seat-legend-bar">
                <div className="seat-legend-item">
                  <div className="seat-legend-box available"></div>
                  <span>Tersedia ({availableCount})</span>
                </div>
                <div className="seat-legend-item">
                  <div className="seat-legend-box selected" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>check</span>
                  </div>
                  <span>Dipilih ({selectedSeats.join(', ') || '-'})</span>
                </div>
                <div className="seat-legend-item">
                  <div className="seat-legend-box occupied"></div>
                  <span>Sudah Terbooking ({occupiedSeats.length})</span>
                </div>
              </div>

              {/* Banner Pemeriksaan Antrean Real-Time (Kapasitas 20.000 Pemilih Bersamaan) */}
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '0.85rem',
                  background: '#eff6ff',
                  border: '1.5px solid #bfdbfe',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.55rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800, fontSize: '0.78rem', color: '#1B4285' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>groups</span>
                    <span>PEMERIKSAAN ANTREAN PEMILIH KURSI (KAPASITAS {queueMaxCapacity.toLocaleString('id-ID')} ORANG)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCheckQueueNow}
                    disabled={isCheckingQueue}
                    style={{
                      padding: '0.32rem 0.75rem',
                      borderRadius: '0.5rem',
                      border: '1px solid #93c5fd',
                      background: '#ffffff',
                      color: '#1B4285',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      cursor: isCheckingQueue ? 'wait' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>sync</span>
                    <span>{isCheckingQueue ? 'Memeriksa...' : 'Cek Antrean Sekarang'}</span>
                  </button>
                </div>

                {/* 3 Metrik Terpisah: Antrean Pemilih Aktif vs Kursi Sudah Terbooking vs Sisa */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ background: '#ffffff', border: '1px solid #dbeafe', borderRadius: '0.6rem', padding: '0.5rem 0.65rem' }}>
                    <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      Sedang Memilih (Antrean)
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#1d4ed8' }}>
                      {queueTotalActive.toLocaleString('id-ID')}{' '}
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b' }}>
                        / {queueMaxCapacity.toLocaleString('id-ID')} orang
                      </span>
                    </div>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #dbeafe', borderRadius: '0.6rem', padding: '0.5rem 0.65rem' }}>
                    <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      Sudah Terbooking (Terkunci)
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#0f172a' }}>
                      {queueBookedCount}{' '}
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b' }}>
                        / {busCapacity} kursi
                      </span>
                    </div>
                  </div>
                  <div style={{ background: '#ffffff', border: '1px solid #dbeafe', borderRadius: '0.6rem', padding: '0.5rem 0.65rem' }}>
                    <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      Kursi Masih Kosong
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#15803d' }}>
                      {availableCount} kursi
                    </div>
                  </div>
                </div>

                <p style={{ margin: 0, fontSize: '0.71rem', color: '#475569', lineHeight: 1.45 }}>
                  Saat hingga <b>20.000 orang</b> memilih kursi yang sama secara bersamaan, antrean dicatat real-time dan dikunci ketat di database (<i>First-Come First-Served</i>) sehingga hanya 1 pemenang per kursi yang berhasil booking.
                </p>

                {/* Status Antrean Per Kursi yang Dipilih User */}
                {selectedSeats.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', paddingTop: '0.35rem', borderTop: '1px dashed #93c5fd' }}>
                    {selectedSeats.map((code) => {
                      const qInfo = queuePerSeat[code];
                      const pos = qInfo?.your_position ?? 1;
                      const contenders = qInfo?.contenders ?? 1;
                      const isBookedNow = Boolean(qInfo?.is_booked);
                      const isFront = !isBookedNow && pos === 1;

                      return (
                        <div
                          key={code}
                          style={{
                            fontSize: '0.69rem',
                            fontWeight: 800,
                            padding: '0.28rem 0.6rem',
                            borderRadius: '0.45rem',
                            background: isBookedNow ? '#fee2e2' : isFront ? '#dcfce7' : '#fff7ed',
                            color: isBookedNow ? '#991b1b' : isFront ? '#166534' : '#c2410c',
                            border: `1px solid ${isBookedNow ? '#fca5a5' : isFront ? '#86efac' : '#fdba74'}`,
                          }}
                        >
                          {isBookedNow
                            ? `Kursi ${code}: Sudah Terbooking!`
                            : `Kursi ${code}: Posisi Antrean #${pos} dari ${contenders} pemilih${isFront ? ' (Terdepan)' : ' (Diperebutkan!)'}`}
                        </div>
                      );
                    })}
                  </div>
                )}

                {queueAlertInfo && (
                  <div style={{ fontSize: '0.71rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '0.35rem 0.65rem', borderRadius: '0.45rem' }}>
                    ✓ {queueAlertInfo}
                  </div>
                )}
              </div>

              {/* Denah Interior Kabin */}
              <div className="seat-bus-cabin">
                {/* Header Depan: Sopir & Pintu */}
                <div className="seat-cabin-front-banner">
                  <div className="seat-driver-info">
                    <div className="seat-steering-icon">
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                        airline_seat_recline_extra
                      </span>
                    </div>
                    <div className="seat-driver-text">
                      <h4>Kabin Pengemudi ({scheduleDetail?.plat_nomor || 'AKAP'})</h4>
                      <p>Rute: {scheduleDetail?.asal_kota || 'Jakarta'} &rarr; {scheduleDetail?.tujuan_kota || 'Surabaya'}</p>
                    </div>
                  </div>
                  <div className="seat-door-tag">
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>door_front</span>
                    <span>Pintu Depan</span>
                  </div>
                </div>

                {/* Column Headers */}
                <div className="seat-cols-header">
                  <span>Jendela (A)</span>
                  <span>Lorong (B)</span>
                  <span>GANG</span>
                  <span>Lorong (C)</span>
                  <span>Jendela (D)</span>
                </div>

                {/* Loading state kursi */}
                {isLoading && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '32px', display: 'block', marginBottom: '0.5rem', color: '#1B4285' }}>sync</span>
                    <p>Memuat denah kursi sesuai kapasitas bus...</p>
                  </div>
                )}

                {/* Matrix Kursi dari Database Sesuai Kapasitas Bus */}
                {!isLoading && (
                  <div className="seat-matrix-list">
                    {sortedRowNumbers.map((rowNum) => {
                      const seatA = `${rowNum}A`;
                      const seatB = `${rowNum}B`;
                      const seatC = `${rowNum}C`;
                      const seatD = `${rowNum}D`;

                      const renderSeatCell = (seatId: string) => {
                        if (!allSeatCodes.includes(seatId)) {
                          return (
                            <div
                              key={seatId}
                              style={{
                                height: '2.75rem',
                                borderRadius: '0.65rem',
                                border: '1.5px dashed #cbd5e1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.68rem',
                                color: '#94a3b8',
                                fontWeight: 700,
                                background: 'rgba(255,255,255,0.35)',
                              }}
                              title="Tidak termasuk kapasitas kursi bus ini"
                            >
                              —
                            </div>
                          );
                        }
                        const isOcc = occupiedSeats.includes(seatId);
                        const isSel = selectedSeats.includes(seatId);
                        const qInfo = queuePerSeat[seatId];
                        const contendersCount = qInfo?.contenders || 0;
                        const hasOtherContenders = !isOcc && (isSel ? contendersCount > 1 : contendersCount > 0);

                        const cls = isOcc
                          ? 'seat-btn status-occupied'
                          : isSel
                          ? 'seat-btn status-selected'
                          : 'seat-btn status-available';

                        return (
                          <button
                            key={seatId}
                            type="button"
                            onClick={() => toggleSeat(seatId)}
                            disabled={isBookingClosed || isOcc}
                            className={cls}
                            title={
                              isOcc
                                ? `Kursi ${seatId} sudah terbooking`
                                : hasOtherContenders
                                ? `Kursi ${seatId} sedang dilihat/dipilih ${contendersCount} orang dalam antrean`
                                : `Pilih Kursi ${seatId}`
                            }
                            style={{
                              position: 'relative',
                              ...(isBookingClosed ? { opacity: 0.55, cursor: 'not-allowed' } : {}),
                            }}
                          >
                            {seatId}
                            {hasOtherContenders && (
                              <span
                                style={{
                                  position: 'absolute',
                                  top: '3px',
                                  right: '3px',
                                  fontSize: '0.54rem',
                                  fontWeight: 900,
                                  lineHeight: 1,
                                  padding: '2px 4px',
                                  borderRadius: '9999px',
                                  background: '#f97316',
                                  color: '#ffffff',
                                }}
                              >
                                {contendersCount}
                              </span>
                            )}
                          </button>
                        );
                      };

                      return (
                        <div key={rowNum} className="seat-row-item">
                          {renderSeatCell(seatA)}
                          {renderSeatCell(seatB)}
                          <div className="seat-gang-label"><span className="material-symbols-outlined" style={{ fontSize: '14px' }}>expand_less</span></div>
                          {renderSeatCell(seatC)}
                          {renderSeatCell(seatD)}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Footer Belakang: Toilet & Pintu Darurat */}
                <div className="seat-cabin-rear-banner">
                  <div className="seat-toilet-info">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#1B4285' }}>
                      wc
                    </span>
                    <div>
                      <h5>Toilet Higienis</h5>
                      <p>Khusus BAB/BAK Berjalan</p>
                    </div>
                  </div>
                  <div className="seat-emergency-door-tag">
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>emergency</span>
                    <span>Total Kapasitas: {busCapacity} Kursi</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Selected Seat Description Card */}
            {selectedSeats.length > 0 && (
              <div className="seat-selected-highlight-card">
                <div className="seat-highlight-left">
                  <div className="seat-highlight-badge">{selectedSeats.join(', ')}</div>
                  <div className="seat-highlight-info">
                    <h4>Kursi Pilihan Anda: {selectedSeats.join(', ')}</h4>
                    <p>
                      Antrean Terpantau Real-Time (Kapasitas {queueMaxCapacity.toLocaleString('id-ID')} Pemilih) • {scheduleDetail?.nama_bus || 'Bus Resmi'}
                    </p>
                  </div>
                </div>
                <span className="seat-highlight-status">Siap Dikunci</span>
              </div>
            )}

            {/* Fasilitas Standar Armada */}
            <div className="seat-amenities-section">
              <div className="seat-amenities-header">
                <h3 className="seat-amenities-title">Fasilitas Standar Armada {busClassLabel}</h3>
                <span className="seat-amenities-badge">Kapasitas {busCapacity} Kursi • Termasuk Gratis</span>
              </div>

              <div className="seat-amenities-grid">
                <div className="seat-amenity-card">
                  <div className="seat-amenity-icon-box">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>restaurant</span>
                  </div>
                  <h5>Snack &amp; Servis Makan</h5>
                  <p>Air mineral 600ml, roti premium, dan 1x prasmanan di Rest Area lintasan.</p>
                </div>

                <div className="seat-amenity-card">
                  <div className="seat-amenity-icon-box">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>usb</span>
                  </div>
                  <h5>USB Port Charger</h5>
                  <p>Port pengisian daya 2.4A terdedikasi di setiap kursi ({busCapacity} titik).</p>
                </div>

                <div className="seat-amenity-card">
                  <div className="seat-amenity-icon-box">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>bed</span>
                  </div>
                  <h5>Selimut &amp; Bantal</h5>
                  <p>Dicuci bersih dan tersegel higienis untuk kenyamanan perjalanan jauh Anda.</p>
                </div>
              </div>

              {/* Banner Foto Armada dari Admin */}
              <div className="seat-bus-banner-container">
                {scheduleDetail?.foto_bus?.trim() ? (
                  <img
                    src={scheduleDetail.foto_bus.trim()}
                    alt={scheduleDetail.nama_bus ? `Foto Armada ${scheduleDetail.nama_bus}` : 'Foto Armada Bus'}
                    className="seat-bus-banner-img"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  className="seat-bus-banner-placeholder"
                  style={{ display: scheduleDetail?.foto_bus?.trim() ? 'none' : 'flex' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '28px', opacity: 0.75 }}>directions_bus</span>
                  <span>Foto armada belum diunggah oleh admin</span>
                </div>
                <div className="seat-bus-banner-overlay">
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>airline_seat_recline_extra</span>
                  <span>
                    {scheduleDetail?.nama_bus ? `${scheduleDetail.nama_bus} • ` : ''}
                    {busClassRaw === 'sleeper'
                      ? `Sleeper Suite Capsule 180° • Kapasitas ${busCapacity} Kursi`
                      : `Reclining Seats + Legrest Empuk • Kapasitas ${busCapacity} Kursi`}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ════════ RIGHT COLUMN: TRIP INFO, PASSENGER DATA, PAYMENT & SUBMIT ════════ */}
          <div className="seat-right-col">
            {/* 1. Trip Detail Card */}
            <div className="seat-trip-card">
              <div className="seat-trip-header">
                <div>
                  <div className="seat-trip-category">
                    PERJALANAN ANTARKOTA ({(scheduleDetail?.asal_kota || 'JAKARTA').toUpperCase()} &rarr; {(scheduleDetail?.tujuan_kota || 'SURABAYA').toUpperCase()})
                  </div>
                  <h3 className="seat-bus-operator-name">
                    {scheduleDetail?.nama_bus || 'Armada Bus Resmi'}
                  </h3>
                  <p className="seat-bus-fleet-code">
                    Plat: {scheduleDetail?.plat_nomor || '-'} • Kapasitas {busCapacity} Kursi (Sisa {availableCount})
                  </p>
                </div>
                <span className="seat-class-badge">{busClassLabel}</span>
              </div>

              {isBookingClosed && bookingState && (
                <div
                  style={{
                    marginBottom: '0.75rem',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '0.6rem',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>block</span>
                  <span>{bookingState.badgeText} — Pemesanan Tiket Ditutup</span>
                </div>
              )}

              <div className="seat-date-badge">
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#f97316' }}>
                  calendar_month
                </span>
                <span>
                  {formatTanggalIndo(scheduleDetail?.tanggal_berangkat)} • {formatJam(scheduleDetail?.jam_berangkat)} - {formatJam(scheduleDetail?.jam_tiba)} WIB
                </span>
              </div>

              <div className="seat-timeline-route">
                <div className="seat-timeline-stop">
                  <span className="seat-timeline-dot"></span>
                  <h6>
                    {scheduleDetail?.asal_terminal || 'Terminal Keberangkatan'}, {scheduleDetail?.asal_kota || '-'} ({formatJam(scheduleDetail?.jam_berangkat)} WIB)
                  </h6>
                </div>
                <div className="seat-timeline-stop">
                  <span className="seat-timeline-dot dest"></span>
                  <h6>
                    {scheduleDetail?.tujuan_terminal || 'Terminal Tujuan'}, {scheduleDetail?.tujuan_kota || '-'} ({formatJam(scheduleDetail?.jam_tiba)} WIB)
                  </h6>
                </div>
              </div>
            </div>

            {/* 1B. Informasi Arah ke Halaman Titik Jemput Khusus */}
            <div
              style={{
                background: '#fff7ed',
                border: '1.5px solid #fed7aa',
                borderRadius: '1rem',
                padding: '0.95rem 1.05rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#c2410c', fontWeight: 800, fontSize: '0.8rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>pin_drop</span>
                <span>Ingin Dijemput di Pinggir Jalan Raya (Titik Jemput)?</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.73rem', color: '#7c2d12', lineHeight: 1.45 }}>
                Pemesanan <b>Tiket Titik Jemput</b> kini tersedia langsung di halaman <b>Titik Jemput</b> — terhubung GPS &amp; Maps tanpa perlu pilih kursi terlebih dahulu, bisa bayar via <b>Midtrans</b> atau <b>Cash langsung</b>.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('pickup', { scheduleId })}
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.48rem 0.9rem',
                  borderRadius: '0.6rem',
                  border: 'none',
                  background: '#f97316',
                  color: '#ffffff',
                  fontSize: '0.73rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>my_location</span>
                <span>Pesan di Halaman Titik Jemput</span>
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>arrow_forward</span>
              </button>
            </div>

            {/* 2. Passenger Identity Form Card */}
            <div className="seat-passenger-form-card">
              <div className="seat-form-header">
                <h3 className="seat-form-title">
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#1B4285' }}>
                    badge
                  </span>
                  <span>Data Diri Penumpang</span>
                </h3>
                <span className="seat-form-seat-tag">Kursi: {selectedSeats.join(', ') || '-'}</span>
              </div>

              <div className="seat-checkbox-row">
                <input
                  type="checkbox"
                  id="sameBooker"
                  checked={sameAsBooker}
                  onChange={(e) => setSameAsBooker(e.target.checked)}
                  className="accent-[#f97316] w-4 h-4"
                />
                <label htmlFor="sameBooker">Data Penumpang sama dengan Pemesan</label>
              </div>

              <div className="seat-form-group">
                <div className="seat-label-row">
                  <label className="seat-label">Nama Lengkap (Sesuai KTP)</label>
                  <span className="seat-label-required">*Wajib</span>
                </div>
                <div className="seat-input-wrapper">
                  <span className="material-symbols-outlined seat-input-icon">person</span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="seat-input"
                    placeholder="Nama Lengkap Penumpang"
                  />
                </div>
              </div>

              <div className="seat-form-group">
                <div className="seat-label-row">
                  <label className="seat-label">Nomor KTP / NIK (16 Digit)</label>
                  <span className="seat-label-verified">
                    <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>check_circle</span>
                    Terverifikasi Dukcapil
                  </span>
                </div>
                <div className="seat-input-wrapper">
                  <span className="material-symbols-outlined seat-input-icon">credit_card</span>
                  <input
                    type="text"
                    value={nikNumber}
                    onChange={(e) => setNikNumber(e.target.value)}
                    className="seat-input"
                    placeholder="Masukkan 16 digit NIK sesuai KTP"
                    maxLength={16}
                  />
                  <span className="material-symbols-outlined seat-input-right-check">check_circle</span>
                </div>
                <div className="seat-input-hint">NIK divalidasi otomatis untuk asuransi manifes perjalanan.</div>
              </div>

              <div className="seat-form-group">
                <div className="seat-label-row">
                  <label className="seat-label">Nomor WhatsApp Aktif</label>
                  <span className="seat-input-hint" style={{ marginTop: 0 }}>Untuk e-ticket &amp; info gate</span>
                </div>
                <div className="seat-input-wrapper">
                  <span className="material-symbols-outlined seat-input-icon">call</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="seat-input"
                    placeholder="081234567890"
                  />
                </div>
              </div>
            </div>

            {/* 3. Transaction Breakdown, Metode Pembayaran & Submit Card */}
            <div className="seat-fare-card">
              <h3 className="seat-fare-title">Metode Pembayaran &amp; Rincian Tarif</h3>

              {/* Pilihan Metode Pembayaran: Midtrans vs Cash */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', marginBottom: '0.9rem' }}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('midtrans')}
                  style={{
                    padding: '0.65rem 0.7rem',
                    borderRadius: '0.7rem',
                    border: paymentMethod === 'midtrans' ? '2px solid #1B4285' : '1.5px solid #cbd5e1',
                    background: paymentMethod === 'midtrans' ? '#eff6ff' : '#ffffff',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 800, fontSize: '0.75rem', color: '#1B4285' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>credit_score</span>
                    <span>Midtrans</span>
                  </div>
                  <div style={{ fontSize: '0.64rem', color: '#64748b', marginTop: '0.15rem' }}>
                    QRIS, Virtual Account, E-Wallet
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  style={{
                    padding: '0.65rem 0.7rem',
                    borderRadius: '0.7rem',
                    border: paymentMethod === 'cash' ? '2px solid #16a34a' : '1.5px solid #cbd5e1',
                    background: paymentMethod === 'cash' ? '#ecfdf5' : '#ffffff',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 800, fontSize: '0.75rem', color: '#15803d' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>payments</span>
                    <span>Cash Langsung</span>
                  </div>
                  <div style={{ fontSize: '0.64rem', color: '#64748b', marginTop: '0.15rem' }}>
                    Bayar tunai saat naik (Wajib Login)
                  </div>
                </button>
              </div>

              {paymentMethod === 'cash' && !isAuthenticated && (
                <div
                  style={{
                    marginBottom: '0.85rem',
                    padding: '0.65rem 0.8rem',
                    borderRadius: '0.65rem',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    color: '#92400e',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>Pembayaran Cash mewajibkan Login / Auth terlebih dahulu.</span>
                  <button
                    type="button"
                    onClick={() => onNavigate('login')}
                    style={{
                      padding: '0.32rem 0.7rem',
                      borderRadius: '0.45rem',
                      border: 'none',
                      background: '#1B4285',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: '0.68rem',
                      cursor: 'pointer',
                    }}
                  >
                    Login Sekarang
                  </button>
                </div>
              )}

              <div className="seat-fare-breakdown">
                <div className="seat-fare-line">
                  <span>Tarif Tiket Armada ({selectedSeats.length} Kursi: {selectedSeats.join(', ') || '-'})</span>
                  <span className="price">Rp {totalAmount.toLocaleString('id-ID')}</span>
                </div>
                <div className="seat-fare-line">
                  <span>
                    Asuransi Jasa Raharja <span className="seat-free-badge">GRATIS</span>
                  </span>
                  <div>
                    <span className="price struck">Rp 5.000</span>
                  </div>
                </div>
                <div className="seat-fare-line">
                  <span>Biaya Layanan &amp; Administrasi</span>
                  <span className="price free">Rp 0 (Bebas Biaya)</span>
                </div>
              </div>

              {/* Total Box */}
              <div className="seat-fare-total-box">
                <div className="seat-total-left">
                  <span>Total Pembayaran Bersih</span>
                  <div className="seat-total-price">Rp {totalAmount.toLocaleString('id-ID')}</div>
                </div>
                <div className="seat-total-right">
                  <span>{paymentMethod === 'cash' ? 'Bayar Tunai Langsung' : 'Instan Konfirmasi'}</span>
                  <small>{paymentMethod === 'cash' ? 'E-Ticket Terbit Langsung' : 'Metode Midtrans (QRIS / VA)'}</small>
                </div>
              </div>

              {/* Submit CTA */}
              <button
                type="button"
                onClick={handleProceedPayment}
                disabled={isSubmitting || isBookingClosed || (paymentMethod === 'cash' && !isAuthenticated)}
                className="seat-submit-btn"
                style={
                  isBookingClosed || (paymentMethod === 'cash' && !isAuthenticated)
                    ? { background: '#94a3b8', boxShadow: 'none', opacity: 0.85, cursor: 'not-allowed' }
                    : isSubmitting
                    ? { opacity: 0.7, cursor: 'not-allowed' }
                    : paymentMethod === 'cash'
                    ? { background: '#16a34a' }
                    : {}
                }
              >
                <span>
                  {isBookingClosed
                    ? `${bookingState?.shortBadgeText || 'Bus Sudah Berangkat'} - Tidak Bisa Memesan`
                    : paymentMethod === 'cash' && !isAuthenticated
                    ? 'Login Terlebih Dahulu untuk Bayar Cash'
                    : isSubmitting
                    ? 'Memeriksa Antrean & Membuat Tiket...'
                    : paymentMethod === 'cash'
                    ? 'Buat Tiket Sekarang (Bayar Cash)'
                    : 'Lanjut ke Pembayaran Midtrans'}
                </span>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  {isBookingClosed ? 'block' : paymentMethod === 'cash' ? 'confirmation_number' : 'arrow_forward'}
                </span>
              </button>

              <div className="seat-guarantee-note">
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#16a34a' }}>
                  verified_user
                </span>
                <span>Antrean 20.000 Pemilih Terlindungi • Jaminan Kursi 100% Valid</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
