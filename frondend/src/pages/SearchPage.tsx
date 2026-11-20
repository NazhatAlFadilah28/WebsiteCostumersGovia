import { useState, useEffect, useCallback } from 'react';
import Navbar from '../components/Navbar';
import '../Style/search.css';
import logoNavbar from '../assets/LogoNavbar.png';
import { getScheduleBookingState } from '../services/api';

interface Schedule {
  id: string;
  nama_bus: string;
  plat_nomor: string;
  kelas: string;
  kapasitas: number;
  sisa_kursi: number;
  jam_berangkat: string;
  jam_tiba: string;
  harga: string;
  tanggal_berangkat: string;
  asal_kota: string;
  asal_terminal: string;
  tujuan_kota: string;
  tujuan_terminal: string;
  status?: string;
  status_perjalanan: string;
  lokasi_terakhir?: string | null;
  catatan_operasional?: string | null;
}

interface SearchPageProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

const CITY_TERMINALS: Array<{ kota: string; terminal: string; desc: string }> = [
  { kota: 'Jakarta', terminal: 'Terminal Terpadu Pulo Gebang', desc: 'Akses mudah via koridor 11 TransJakarta dan area drop-off tol terpadu.' },
  { kota: 'Surabaya', terminal: 'Terminal Purabaya (Bungurasih)', desc: 'Terminal tipe A terbesar Jawa Timur dengan akses langsung Tol Waru-Juanda.' },
  { kota: 'Yogyakarta', terminal: 'Terminal Giwangan', desc: 'Terintegrasi dengan koridor Trans Jogja dan jalur lingkar selatan.' },
  { kota: 'Semarang', terminal: 'Terminal Terpadu Mangkang', desc: 'Akses cepat Gerbang Tol Kaliwungu & jalur utama Pantura Jawa Tengah.' },
  { kota: 'Solo', terminal: 'Terminal Tirtonadi', desc: 'Terhubung Skybridge langsung ke Stasiun Solo Balapan & Tol Ngemplak.' },
  { kota: 'Bandung', terminal: 'Terminal Leuwipanjang', desc: 'Akses langsung Tol Pasir Koja - Purbaleunyi & Trans Metro Bandung.' },
];

export default function SearchPage({ onNavigate }: SearchPageProps) {
  const [activeDateTab, setActiveDateTab] = useState<'all' | 'today' | 'tomorrow' | 'lusa'>('all');
  const [filterClass, setFilterClass] = useState<'ALL' | 'EKSEKUTIF' | 'SLEEPER' | 'BISNIS' | 'EKONOMI'>('ALL');
  const [maxPrice, setMaxPrice] = useState(2000000);
  const [searchBus, setSearchBus] = useState('');
  const [sortBy, setSortBy] = useState('Paling Populer');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter arah kota asal & kota tujuan (kosong = tampilkan semua rute aktif dari database)
  const [selectedOriginCity, setSelectedOriginCity] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('govia_route_filter') || '{}');
      return saved.asal_kota || '';
    } catch {
      return '';
    }
  });
  const [selectedOriginTerminal, setSelectedOriginTerminal] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('govia_route_filter') || '{}');
      return saved.asal_terminal || '';
    } catch {
      return '';
    }
  });
  const [selectedDestCity, setSelectedDestCity] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('govia_route_filter') || '{}');
      return saved.tujuan_kota || '';
    } catch {
      return '';
    }
  });
  const [selectedDestTerminal, setSelectedDestTerminal] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('govia_route_filter') || '{}');
      return saved.tujuan_terminal || '';
    } catch {
      return '';
    }
  });

  const matchedOrigin = CITY_TERMINALS.find(
    (c) => c.kota.toLowerCase() === selectedOriginCity.toLowerCase()
  );
  const matchedDest = CITY_TERMINALS.find(
    (c) => c.kota.toLowerCase() === selectedDestCity.toLowerCase()
  );
  const isShowingAllRoutes = !selectedOriginCity && !selectedDestCity && !selectedOriginTerminal && !selectedDestTerminal;

  const originMeta = {
    kota: selectedOriginCity || matchedOrigin?.kota || 'Semua Kota',
    terminal:
      selectedOriginTerminal ||
      matchedOrigin?.terminal ||
      (selectedOriginCity ? `Terminal ${selectedOriginCity}` : 'Semua Terminal Asal'),
    desc:
      matchedOrigin?.desc ||
      `Titik keberangkatan resmi bus AKAP wilayah ${selectedOriginCity || 'Indonesia'}.`,
  };
  const destMeta = {
    kota: selectedDestCity || matchedDest?.kota || 'Semua Kota',
    terminal:
      selectedDestTerminal ||
      matchedDest?.terminal ||
      (selectedDestCity ? `Terminal ${selectedDestCity}` : 'Semua Terminal Tujuan'),
    desc:
      matchedDest?.desc ||
      `Titik kedatangan resmi bus AKAP wilayah ${selectedDestCity || 'Indonesia'}.`,
  };

  const [selectedOperators, setSelectedOperators] = useState<Record<string, boolean>>({});
  const toggleOperator = (busName: string) => {
    setSelectedOperators((prev) => ({
      ...prev,
      [busName]: prev[busName] === false ? true : false,
    }));
  };

  // Format jam dari "07:30:00" → "07.30"
  const formatJam = (jam: string) => jam?.substring(0, 5).replace(':', '.') || '-';

  // Format tanggal lokal (ISO dari backend disimpan UTC, bisa geser 1 hari)
  const parseLokal = (iso: string) => {
    const d = new Date(iso);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };

  const labelHari = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  };

  // Kelompokkan jadwal: today / tomorrow / lusa (dibandingkan tanggal lokal)
  const tanggalTab = (iso: string): 'today' | 'tomorrow' | 'lusa' | null => {
    const target = parseLokal(iso).getTime();
    const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
    const besok = new Date(hariIni); besok.setDate(besok.getDate() + 1);
    const lusa = new Date(hariIni); lusa.setDate(lusa.getDate() + 2);
    if (target === hariIni.getTime()) return 'today';
    if (target === besok.getTime()) return 'tomorrow';
    if (target === lusa.getTime()) return 'lusa';
    return null;
  };

  // Format harga
  const formatHarga = (harga: string) =>
    `Rp ${parseInt(harga).toLocaleString('id-ID')}`;

  // Hitung durasi perjalanan
  const hitungDurasi = (mulai: string, selesai: string) => {
    const [jm, mm] = mulai.split(':').map(Number);
    const [js, ms] = selesai.split(':').map(Number);
    let total = (js * 60 + ms) - (jm * 60 + mm);
    if (total < 0) total += 24 * 60;
    return `${Math.floor(total / 60)}j ${total % 60}m`;
  };

  // Filter jadwal berdasarkan filterClass, maxPrice, & nama bus dari database
  const filteredSchedules = schedules.filter((s) => {
    if (filterClass !== 'ALL' && s.kelas.toLowerCase() !== filterClass.toLowerCase()) return false;
    if (parseInt(s.harga) > maxPrice) return false;
    if (activeDateTab !== 'all' && tanggalTab(s.tanggal_berangkat) !== activeDateTab) return false;
    if (selectedOperators[s.nama_bus] === false) return false;
    if (searchBus.trim()) {
      const q = searchBus.toLowerCase();
      if (
        !s.nama_bus.toLowerCase().includes(q) &&
        !s.plat_nomor.toLowerCase().includes(q) &&
        !s.asal_kota.toLowerCase().includes(q) &&
        !s.tujuan_kota.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const uniqueBusOperators = Array.from(
    new Map(schedules.map((s) => [s.nama_bus, { nama_bus: s.nama_bus, kapasitas: s.kapasitas }])).values()
  );

  // Sort jadwal
  const sortedSchedules = [...filteredSchedules].sort((a, b) => {
    if (sortBy === 'Harga Termurah') return parseInt(a.harga) - parseInt(b.harga);
    if (sortBy === 'Keberangkatan Paling Awal') return a.jam_berangkat.localeCompare(b.jam_berangkat);
    return Number(b.sisa_kursi) - Number(a.sisa_kursi);
  });

  // Fetch jadwal dari backend berdasarkan arah kota asal & kota tujuan
  const fetchSchedules = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setErrorMsg(null);
    try {
      const token = localStorage.getItem('govia_token') || localStorage.getItem('bustix_token');
      const params = new URLSearchParams();
      if (selectedOriginCity) params.set('asal_kota', selectedOriginCity);
      if (selectedDestCity) params.set('tujuan_kota', selectedDestCity);

      const res = await fetch(`/api/schedules/search?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setSchedules(data.data || []);
      } else if (!silent) {
        setErrorMsg(data.message || 'Gagal memuat jadwal. Anda harus login terlebih dahulu.');
      }
    } catch {
      if (!silent) {
        setErrorMsg('Tidak dapat terhubung ke server backend. Pastikan backend sudah berjalan.');
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [selectedOriginCity, selectedDestCity]);

  useEffect(() => {
    const initTimer = setTimeout(() => { void fetchSchedules(); }, 0);
    const interval = setInterval(() => { void fetchSchedules(true); }, 20000);
    const onFocus = () => { void fetchSchedules(true); };
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchSchedules]);

  return (
    <div className="search-page-container">
      {/* ── SHARED NAVBAR ────────────────────────────────────────── */}
      <Navbar onNavigate={onNavigate} />

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <main className="search-main-content">


        {/* ── Hero Banner Rute Utama Sesuai Arah Kota Asal → Tujuan ─── */}
        <div className="search-hero-banner">
          <div className="search-hero-left">
            <div className="search-hero-tagline">
              <span className="search-tag-lintas">RUTE ANTARKOTA</span>
            </div>
            <h1 className="search-hero-title">
              {isShowingAllRoutes ? (
                <span>Semua Rute &amp; Terminal Antarkota</span>
              ) : (
                <>
                  <span>{originMeta.terminal}</span>
                  <span className="arrow">&rarr;</span>
                  <span>{destMeta.terminal}</span>
                </>
              )}
            </h1>
            <p className="search-hero-desc">
              {isShowingAllRoutes
                ? 'Menampilkan seluruh armada bus resmi berlisensi AKAP yang tersedia sesuai kapasitas bus masing-masing.'
                : `Menampilkan armada bus resmi berlisensi AKAP rute langsung dari ${originMeta.kota} menuju ${destMeta.kota} sesuai kapasitas bus masing-masing.`}
            </p>
          </div>
        </div>

        {/* ── Filter Tanggal & Filter Tipe Kelas Bus ──────────────── */}
        <div className="search-filter-tabs-bar">
          <div className="search-date-tabs">
            <button
              className={`search-date-btn ${activeDateTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveDateTab('all')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>date_range</span>
              Semua Tanggal
            </button>
            <button
              className={`search-date-btn ${activeDateTab === 'today' ? 'active' : ''}`}
              onClick={() => setActiveDateTab('today')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>today</span>
              Hari Ini ({labelHari(0)})
            </button>
            <button
              className={`search-date-btn ${activeDateTab === 'tomorrow' ? 'active' : ''}`}
              onClick={() => setActiveDateTab('tomorrow')}
            >
              Besok ({labelHari(1)})
            </button>
            <button
              className={`search-date-btn ${activeDateTab === 'lusa' ? 'active' : ''}`}
              onClick={() => setActiveDateTab('lusa')}
            >
              Lusa ({labelHari(2)})
            </button>
            <button className="search-calendar-btn">
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>calendar_month</span>
              Kalender Tarif Termurah
            </button>
          </div>

          <div className="search-class-pills">
            <button
              className={`search-class-pill ${filterClass === 'ALL' ? 'active' : ''}`}
              onClick={() => setFilterClass('ALL')}
            >
              Semua Bus ({schedules.length})
            </button>
            <button
              className={`search-class-pill ${filterClass === 'EKSEKUTIF' ? 'active' : ''}`}
              onClick={() => setFilterClass('EKSEKUTIF')}
            >
              Eksekutif
            </button>
            <button
              className={`search-class-pill ${filterClass === 'SLEEPER' ? 'active' : ''}`}
              onClick={() => setFilterClass('SLEEPER')}
            >
              Sleeper Suite
            </button>
            <button
              className={`search-class-pill ${filterClass === 'BISNIS' ? 'active' : ''}`}
              onClick={() => setFilterClass('BISNIS')}
            >
              Bisnis AC
            </button>
            <button
              className={`search-class-pill ${filterClass === 'EKONOMI' ? 'active' : ''}`}
              onClick={() => setFilterClass('EKONOMI')}
            >
              Ekonomi
            </button>
          </div>
        </div>

        {/* ── 2-Kolom Layout: Sidebar Filter & List Tiket ──────────── */}
        <div className="search-grid-layout">
          {/* ════════ LEFT SIDEBAR ════════ */}
          <aside className="search-sidebar">
            {/* Filter Card */}
            <div className="search-sidebar-card">
              <div className="search-sidebar-header">
                <h3 className="search-sidebar-title">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>tune</span>
                  Filter Hasil
                </h3>
                <button
                  className="search-sidebar-reset"
                  onClick={() => {
                    setSelectedOriginCity('');
                    setSelectedOriginTerminal('');
                    setSelectedDestCity('');
                    setSelectedDestTerminal('');
                    setMaxPrice(2000000);
                    setSearchBus('');
                    setSelectedOperators({});
                    setFilterClass('ALL');
                    setActiveDateTab('all');
                    localStorage.removeItem('govia_route_filter');
                  }}
                >
                  Reset
                </button>
              </div>

              {/* Cari Nama Bus */}
              <div className="search-filter-section">
                <span className="search-filter-label">Cari Armada / Plat Nomor</span>
                <input
                  type="text"
                  placeholder="Misal: Haryanto / B 7812..."
                  value={searchBus}
                  onChange={(e) => setSearchBus(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
                />
              </div>

              {/* Slider Harga */}
              <div className="search-filter-section">
                <span className="search-filter-label">Rentang Harga Tiket</span>
                <div className="search-price-range-labels">
                  <span>Rp 100.000</span>
                  <span style={{ color: '#f97316', fontWeight: 800 }}>
                    Rp {maxPrice.toLocaleString('id-ID')}
                  </span>
                </div>
                <input
                  type="range"
                  min={100000}
                  max={2000000}
                  step={25000}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  className="search-price-range-slider"
                />
                <div className="search-price-max-note">
                  Maksimal: Rp {maxPrice.toLocaleString('id-ID')}/penumpang
                </div>
              </div>

              {/* Operator Checkbox (Dinamis dari Database) */}
              <div className="search-filter-section">
                <span className="search-filter-label">Armada Bus Tersedia</span>
                <div className="search-checkbox-group">
                  {uniqueBusOperators.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>Belum ada armada di hasil pencarian.</div>
                  ) : (
                    uniqueBusOperators.map((op) => (
                      <label key={op.nama_bus} className="search-checkbox-item">
                        <div className="search-checkbox-left">
                          <input
                            type="checkbox"
                            checked={selectedOperators[op.nama_bus] !== false}
                            onChange={() => toggleOperator(op.nama_bus)}
                          />
                          <span>{op.nama_bus}</span>
                        </div>
                        <span className="search-checkbox-count">{op.kapasitas} kursi</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Titik Keberangkatan & Tujuan Box */}
              <div className="search-filter-section">
                <span className="search-filter-label">Titik Keberangkatan (Asal)</span>
                <div className="search-origin-info-box" style={{ marginBottom: '0.65rem' }}>
                  <h5 className="search-origin-title">
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>trip_origin</span>
                    {originMeta.terminal}, {originMeta.kota}
                  </h5>
                  <p className="search-origin-desc">{originMeta.desc}</p>
                </div>

                <span className="search-filter-label">Titik Kedatangan (Tujuan)</span>
                <div className="search-origin-info-box">
                  <h5 className="search-origin-title">
                    <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#f97316' }}>location_on</span>
                    {destMeta.terminal}, {destMeta.kota}
                  </h5>
                  <p className="search-origin-desc">{destMeta.desc}</p>
                </div>
              </div>
            </div>

          </aside>

          {/* ════════ RIGHT CONTENT: BUS SCHEDULES ════════ */}
          <section className="search-results-col">
            {/* Results Title & Sorter */}
            <div className="search-results-header">
              <div className="search-results-count">
                Pilihan Jadwal Bus{' '}
                <span>
                  {isLoading ? 'Memuat...' : `${sortedSchedules.length} Ditemukan`}
                </span>
              </div>
              <div className="search-sort-dropdown">
                <span>Urutkan:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="search-sort-select"
                >
                  <option>Paling Populer</option>
                  <option>Harga Termurah</option>
                  <option>Keberangkatan Paling Awal</option>
                </select>
              </div>
            </div>

            {/* ── State: Loading ─────────────────────────── */}
            {isLoading && (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                <span className="material-symbols-outlined anim-spin" style={{ fontSize: '40px', display: 'block', marginBottom: '1rem', color: '#1B4285' }}>sync</span>
                <p style={{ fontWeight: 700 }}>Memuat Jadwal Bus dari Server...</p>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem' }}>
                  {[0,1,2,3,4].map(i => (
                    <div key={i} className="skeleton" style={{ width: '100%', height: '120px', borderRadius: '0.75rem', animationDelay: `${i * 0.12}s` }} />
                  ))}
                </div>
              </div>
            )}

            {/* ── State: Error / Perlu Login ─────────────── */}
            {!isLoading && errorMsg && (
              <div style={{
                padding: '2.5rem 1.5rem',
                background: errorMsg.toLowerCase().includes('login') ? '#f0f4ff' : '#fef2f2',
                border: errorMsg.toLowerCase().includes('login') ? '1.5px solid #d9e3f6' : '1px solid #fecaca',
                borderRadius: '1rem',
                color: errorMsg.toLowerCase().includes('login') ? '#1B4285' : '#dc2626',
                textAlign: 'center',
                boxShadow: '0 4px 16px rgba(27,66,133,0.06)'
              }}>
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '40px',
                    display: 'block',
                    marginBottom: '0.5rem',
                    color: errorMsg.toLowerCase().includes('login') ? '#1B4285' : '#dc2626'
                  }}
                >
                  {errorMsg.toLowerCase().includes('login') ? 'lock' : 'wifi_off'}
                </span>
                <p style={{ fontWeight: 800, fontSize: '1.0625rem', marginBottom: '0.5rem' }}>
                  {errorMsg.toLowerCase().includes('login') ? 'Akses Fitur Terkunci (Perlu Login)' : 'Gagal Memuat Data'}
                </p>
                <p style={{ fontWeight: 600, color: '#475569', fontSize: '0.9375rem', marginBottom: '1.25rem', maxWidth: '440px', margin: '0 auto 1.25rem' }}>
                  {errorMsg}
                </p>
                {errorMsg.toLowerCase().includes('login') && (
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => onNavigate('login')}
                      style={{
                        background: 'linear-gradient(135deg, #1B4285 0%, #0f2a55 100%)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '0.625rem 1.5rem',
                        borderRadius: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.375rem'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>login</span>
                      Masuk Akun Sekarang
                    </button>
                    <button
                      onClick={() => onNavigate('register')}
                      style={{
                        background: 'linear-gradient(135deg, #FA7808 0%, #e06200 100%)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '0.625rem 1.5rem',
                        borderRadius: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.375rem'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>person_add</span>
                      Daftar Akun Baru
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── State: Kosong ──────────────────────────── */}
            {!isLoading && !errorMsg && sortedSchedules.length === 0 && (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '40px', display: 'block', marginBottom: '1rem' }}>search_off</span>
                <p style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
                  Tidak ada jadwal bus untuk filter rute/tanggal ini.
                </p>
                {(selectedOriginCity || selectedDestCity || filterClass !== 'ALL' || activeDateTab !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOriginCity('');
                      setSelectedOriginTerminal('');
                      setSelectedDestCity('');
                      setSelectedDestTerminal('');
                      setFilterClass('ALL');
                      setActiveDateTab('all');
                      setMaxPrice(2000000);
                      setSearchBus('');
                      setSelectedOperators({});
                      localStorage.removeItem('govia_route_filter');
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#1B4285',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer'
                    }}
                  >
                    Tampilkan Semua Rute &amp; Jadwal
                  </button>
                )}
              </div>
            )}

            {/* ── Render Kartu Bus dari Database ────────── */}
            {!isLoading && !errorMsg && sortedSchedules.map((sched, idx) => {
              const isSleeper = sched.kelas === 'sleeper';
              const bookingState = getScheduleBookingState(sched);
              const isFullSeats = Number(sched.sisa_kursi) <= 0;
              const isClosed = !bookingState.isBookable || isFullSeats;
              const delayClass = ['anim-d1','anim-d2','anim-d3','anim-d4','anim-d5','anim-d6','anim-d7','anim-d8'][idx % 8];
              return (
                <div
                  key={sched.id}
                  className={`search-bus-card ${isClosed ? 'closed' : ''} anim-fade-up ${delayClass}`}
                  style={
                    !bookingState.isBookable
                      ? { border: '1.5px solid #fca5a5' }
                      : isSleeper
                      ? { border: '1.5px solid #f97316' }
                      : {}
                  }
                >
                  {isSleeper && (
                    <div className="search-bus-highlight-header">
                      <div className="search-bus-highlight-left">
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>airline_seat_flat</span>
                        <span>Kelas Sleeper (Kursi Rebahan Penuh)</span>
                      </div>
                      <span className="search-bus-highlight-badge">SLEEPER</span>
                    </div>
                  )}

                  <div className="search-bus-body">
                    <div className="search-bus-info-left">
                      <div className="search-bus-meta-row" style={{ flexWrap: 'wrap' }}>
                        <span className={`search-bus-class-badge ${isSleeper ? 'sleeper' : sched.kelas === 'bisnis' ? 'bisnis' : ''}`}>
                          {sched.kelas.charAt(0).toUpperCase() + sched.kelas.slice(1)}
                        </span>
                        {!bookingState.isBookable ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              background: '#fef2f2',
                              color: '#b91c1c',
                              border: '1px solid #fecaca',
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              padding: '0.2rem 0.6rem',
                              borderRadius: '9999px',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>departure_board</span>
                            <span>{bookingState.badgeText}</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              padding: '0.2rem 0.55rem',
                              borderRadius: '9999px',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>check_circle</span>
                            <span>Tersedia</span>
                          </span>
                        )}
                      </div>

                      {!bookingState.isBookable && (
                        <div
                          style={{
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '0.65rem',
                            padding: '0.55rem 0.75rem',
                            color: '#991b1b',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.45rem',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>
                            block
                          </span>
                          <div>
                            <div>{bookingState.reasonText}</div>
                            {(sched.lokasi_terakhir || sched.catatan_operasional) && (
                              <div style={{ fontSize: '0.66rem', fontWeight: 600, color: '#7f1d1d', marginTop: '0.15rem' }}>
                                {sched.lokasi_terakhir ? `Lokasi terkini: ${sched.lokasi_terakhir}` : ''}
                                {sched.lokasi_terakhir && sched.catatan_operasional ? ' • ' : ''}
                                {sched.catatan_operasional || ''}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="search-bus-operator-block">
                        <div className="search-bus-avatar" style={isSleeper ? { background: '#7c2d12' } : {}}>
                          <span className="material-symbols-outlined">{isSleeper ? 'hotel' : 'directions_bus'}</span>
                        </div>
                        <div className="search-bus-operator-text">
                          <h4 className="search-bus-operator-name">{sched.nama_bus}</h4>
                          <p className="search-bus-route-subtitle">
                            {sched.plat_nomor} · {sched.asal_kota} → {sched.tujuan_kota} · Kapasitas {sched.kapasitas} Kursi
                          </p>
                        </div>
                      </div>

                      {/* Timeline */}
                      <div className="search-bus-timeline-track">
                        <div className="search-bus-timeline-line"></div>
                        <div className="search-bus-point">
                          <div className="search-bus-point-dot"></div>
                          <h5>{formatJam(sched.jam_berangkat)}</h5>
                          <p>{sched.asal_terminal}</p>
                        </div>
                        <div className="search-bus-track-middle">
                          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>timer</span>
                          <span>{hitungDurasi(sched.jam_berangkat, sched.jam_tiba)}</span>
                        </div>
                        <div className="search-bus-point">
                          <div className="search-bus-point-dot dest"></div>
                          <h5>{formatJam(sched.jam_tiba)}</h5>
                          <p>{sched.tujuan_terminal}</p>
                        </div>
                      </div>

                      {/* Amenities */}
                      <div className="search-bus-amenities-row">
                        <div className="search-bus-amenity-chip">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#1B4285' }}>ac_unit</span>
                          <span>AC</span>
                        </div>
                        <div className="search-bus-amenity-chip">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#1B4285' }}>airline_seat_recline_extra</span>
                          <span>Reclining</span>
                        </div>
                        <div className="search-bus-amenity-chip">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#1B4285' }}>usb</span>
                          <span>USB</span>
                        </div>
                        {isSleeper && (
                          <div className="search-bus-amenity-chip">
                            <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#1B4285' }}>bed</span>
                            <span>Selimut</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Pricing & Button */}
                    <div className="search-bus-pricing-col">
                      <span className="search-bus-price-note">Harga mulai</span>
                      <div>
                        <span className="search-bus-price-amount" style={isSleeper ? { color: '#1B4285' } : {}}>
                          {formatHarga(sched.harga)}
                        </span>
                        <span className="search-bus-price-per">/kursi</span>
                      </div>
                      {!bookingState.isBookable ? (
                        <div className="search-bus-closed-box" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}>
                          <span>{bookingState.shortBadgeText}</span>
                          <span style={{ fontSize: '0.64rem', fontWeight: 600 }}>Pemesanan tiket ditutup</span>
                        </div>
                      ) : (
                        <div className="search-bus-seat-warning" style={Number(sched.sisa_kursi) <= 5 ? { color: '#dc2626' } : {}}>
                          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>event_seat</span>
                          <span>
                            {isFullSeats
                              ? 'Kursi Habis'
                              : `Tersisa ${sched.sisa_kursi} dari ${sched.kapasitas} Kursi${Number(sched.sisa_kursi) <= 5 ? '!' : ''}`}
                          </span>
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={isClosed}
                        onClick={() => {
                          if (!isClosed) onNavigate('seats', { scheduleId: sched.id });
                        }}
                        className="search-bus-select-btn"
                        style={
                          isClosed
                            ? {
                                background: '#cbd5e1',
                                color: '#475569',
                                boxShadow: 'none',
                                cursor: 'not-allowed',
                                transform: 'none',
                              }
                            : {}
                        }
                      >
                        <span>
                          {!bookingState.isBookable
                            ? bookingState.shortBadgeText
                            : isFullSeats
                            ? 'Kursi Penuh'
                            : 'Pilih Kursi'}
                        </span>
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                          {!bookingState.isBookable ? 'block' : 'airline_seat_recline_normal'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

          </section>
        </div>
      </main>



      {/* ── FOOTER LENGKAP GOVIA ─────────────────────────────────── */}
      <footer className="search-footer">
        <div className="search-footer-inner">
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <img src={logoNavbar} alt="GOVIA Transport" style={{ height: '38px', width: 'auto', objectFit: 'contain' }} />
            </div>
            <p className="search-footer-about">
              Layanan pemesanan tiket bus antarkota GOVIA. Jadwal dan ketersediaan kursi diperbarui langsung dari database operator.
            </p>
            <div className="search-footer-badges">
              <div className="search-footer-badge-pill">
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#1B4285' }}>lock</span>
                <span>Pembayaran Terintegrasi Midtrans</span>
              </div>
              <div className="search-footer-badge-pill">
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#FA7808' }}>confirmation_number</span>
                <span>E-Ticket Digital</span>
              </div>
            </div>
          </div>

          <div className="search-footer-col">
            <h5>Navigasi</h5>
            <ul className="search-footer-links">
              <li><a href="#jadwal" onClick={(e) => { e.preventDefault(); onNavigate('jadwal'); }}>Jadwal &amp; Rute</a></li>
              <li><a href="#pesanan" onClick={(e) => { e.preventDefault(); onNavigate('pesanan'); }}>Pesanan Saya</a></li>
              <li><a href="#chatbot" onClick={(e) => { e.preventDefault(); onNavigate('chatbot'); }}>Pusat Bantuan</a></li>
            </ul>
          </div>

          <div className="search-footer-col">
            <h5>Rute Tersedia</h5>
            <ul className="search-footer-links">
              <li><a href="#r1" onClick={(e) => { e.preventDefault(); setSelectedOriginCity('Jakarta'); setSelectedDestCity('Surabaya'); }}>Jakarta - Surabaya</a></li>
              <li><a href="#r2" onClick={(e) => { e.preventDefault(); setSelectedOriginCity('Bandung'); setSelectedDestCity('Yogyakarta'); }}>Bandung - Yogyakarta</a></li>
              <li><a href="#r3" onClick={(e) => { e.preventDefault(); setSelectedOriginCity('Jakarta'); setSelectedDestCity('Malang'); }}>Jakarta - Malang</a></li>
              <li><a href="#r4" onClick={(e) => { e.preventDefault(); setSelectedOriginCity('Semarang'); setSelectedDestCity('Jakarta'); }}>Semarang - Jakarta</a></li>
            </ul>
          </div>
        </div>

        <div className="search-footer-bottom">
          <div>© 2026 GOVIA. Seluruh hak cipta dilindungi.</div>
        </div>
      </footer>
    </div>
  );
}
