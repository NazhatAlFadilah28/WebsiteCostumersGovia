import { useState, useEffect } from 'react';
import '../Style/ladingpage.css';
import logoNavbar from '../assets/LogoNavbar.png';
import heroBusVideo from '../assets/animasi bus.mp4';

interface LandingPageProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    id?: string | number;
    nama: string;
    email?: string;
    avatar_url?: string | null;
  } | null>(() => {
    try {
      const raw = localStorage.getItem('govia_user') || localStorage.getItem('bustix_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Sinkronisasi sesi user + foto Google dari localStorage & /api/auth/me
  useEffect(() => {
    const syncUser = () => {
      try {
        const raw = localStorage.getItem('govia_user') || localStorage.getItem('bustix_user');
        setCurrentUser(raw ? JSON.parse(raw) : null);
        setAvatarFailed(false);
      } catch {
        setCurrentUser(null);
      }
    };
    window.addEventListener('storage', syncUser);

    const token = localStorage.getItem('govia_token') || localStorage.getItem('bustix_token');
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (res?.success && res.user) {
            setCurrentUser((prev) => {
              const merged = { ...(prev || {}), ...res.user, avatar_url: res.user.avatar_url || prev?.avatar_url || null };
              try {
                localStorage.setItem('govia_user', JSON.stringify(merged));
                localStorage.setItem('bustix_user', JSON.stringify(merged));
              } catch { /* ignore */ }
              return merged;
            });
          }
        })
        .catch(() => { });
    }

    return () => window.removeEventListener('storage', syncUser);
  }, []);

  // Navbar scroll listener
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => { });
    } catch { /* ignore */ }
    localStorage.removeItem('govia_token');
    localStorage.removeItem('govia_user');
    localStorage.removeItem('bustix_token');
    localStorage.removeItem('bustix_user');
    setCurrentUser(null);
    setMobileOpen(false);
    onNavigate('login');
  };

  return (
    <div className="lp-root">

      {/* ── 1. HEADER NAVBAR (Putih Bersih & Modern) ── */}
      <header className={`lp-navbar ${scrolled ? 'scrolled' : ''}`}>
        <div className="lp-navbar-inner">
          {/* Logo Brand */}
          <div className="lp-brand-area" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <img src={logoNavbar} alt="GOVIA Bus Ticketing" className="lp-nav-logo" />
          </div>

          {/* Navigasi Utama (Desktop) */}
          <nav className="lp-nav-links">
            <button className="lp-nav-link active" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <span className="material-symbols-outlined lp-icon">home</span>
              Beranda
            </button>
            <button className="lp-nav-link" onClick={() => onNavigate('jadwal')}>
              <span className="material-symbols-outlined lp-icon">route</span>
              Jadwal &amp; Rute
            </button>
            <button className="lp-nav-link" onClick={() => onNavigate('search')}>
              <span className="material-symbols-outlined lp-icon">directions_bus</span>
              Cek Bus
            </button>
            <button className="lp-nav-link" onClick={() => onNavigate('pickup')}>
              <span className="material-symbols-outlined lp-icon">pin_drop</span>
              Titik Jemput
            </button>
            <button className="lp-nav-link" onClick={() => onNavigate('chatbot')}>
              <span className="material-symbols-outlined lp-icon">smart_toy</span>
              Tanya AI
            </button>
          </nav>

          {/* Tombol Aksi: Masuk & Daftar Akun / Akun Saya & Logout */}
          <div className="lp-nav-actions">
            {currentUser ? (
              <div className="lp-user-logged">
                <div className="lp-user-badge" title={`Login sebagai: ${currentUser.nama}`}>
                  {currentUser.avatar_url && !avatarFailed ? (
                    <img
                      src={currentUser.avatar_url}
                      alt={currentUser.nama}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '1.5px solid #cbd5e1',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#1B4285' }}>account_circle</span>
                  )}
                  <span className="lp-user-name">{currentUser.nama}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="lp-btn-logout"
                  title="Keluar dari akun Anda"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
                  <span>Keluar</span>
                </button>
              </div>
            ) : (
              <>
                <button className="lp-btn-ghost-login" onClick={() => onNavigate('login')}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>login</span>
                  Masuk
                </button>
                <button
                  className="lp-btn-primary-register"
                  onClick={() => onNavigate('register')}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>person_add</span>
                  Daftar Akun
                </button>
              </>
            )}
          </div>

          {/* Mobile Hamburger Toggle */}
          <button
            className="lp-mobile-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>
              {mobileOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileOpen && (
          <div className="lp-mobile-dropdown">
            {currentUser && (
              <div className="lp-mobile-user-card">
                {currentUser.avatar_url && !avatarFailed ? (
                  <img
                    src={currentUser.avatar_url}
                    alt={currentUser.nama}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '1.5px solid #cbd5e1',
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <span className="material-symbols-outlined" style={{ fontSize: '26px', color: '#1B4285' }}>account_circle</span>
                )}
                <div className="lp-mobile-user-info">
                  <div className="lp-mobile-user-name">{currentUser.nama}</div>
                  <div className="lp-mobile-user-sub">{currentUser.email || 'Customer GOVIA'}</div>
                </div>
              </div>
            )}

            <button
              className="lp-mobile-item"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setMobileOpen(false);
              }}
            >
              <span className="material-symbols-outlined lp-icon">home</span>
              Beranda
            </button>
            <button
              className="lp-mobile-item"
              onClick={() => {
                onNavigate('jadwal');
                setMobileOpen(false);
              }}
            >
              <span className="material-symbols-outlined lp-icon">route</span>
              Jadwal &amp; Rute
            </button>
            <button
              className="lp-mobile-item"
              onClick={() => {
                onNavigate('search');
                setMobileOpen(false);
              }}
            >
              <span className="material-symbols-outlined lp-icon">directions_bus</span>
              Cek Bus
            </button>
            <button
              className="lp-mobile-item"
              onClick={() => {
                onNavigate('pickup');
                setMobileOpen(false);
              }}
            >
              <span className="material-symbols-outlined lp-icon">pin_drop</span>
              Titik Jemput
            </button>
            <button
              className="lp-mobile-item"
              onClick={() => {
                onNavigate('chatbot');
                setMobileOpen(false);
              }}
            >
              <span className="material-symbols-outlined lp-icon">smart_toy</span>
              Tanya AI
            </button>
            <div className="lp-mobile-divider" />
            <div className="lp-mobile-actions">
              {currentUser ? (
                <button
                  className="lp-btn-logout"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={handleLogout}
                >
                  <span className="material-symbols-outlined">logout</span>
                  Keluar (Log Out)
                </button>
              ) : (
                <>
                  <button
                    className="lp-btn-ghost-login"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => {
                      onNavigate('login');
                      setMobileOpen(false);
                    }}
                  >
                    <span className="material-symbols-outlined">login</span>
                    Masuk
                  </button>
                  <button
                    className="lp-btn-primary-register"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => {
                      onNavigate('register');
                      setMobileOpen(false);
                    }}
                  >
                    <span className="material-symbols-outlined">person_add</span>
                    Daftar Akun
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ── 2. HERO SECTION ────────────────────────────────────────── */}
      <section className="lp-hero">
        {/* Video Background */}
        <video
          className="lp-hero-video"
          src={heroBusVideo}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
        <div className="lp-hero-overlay" />

        <div className="lp-hero-container">

          {/* Headline & Value Proposition */}
          <div className="lp-hero-intro lp-animate">
            <h1 className="lp-hero-title">
              Pemesanan Tiket Bus Antarkota <br />
              <span className="lp-text-gradient">Langsung dari Jadwal Resmi Operator.</span>
            </h1>

            <p className="lp-hero-desc">
              Cek jadwal keberangkatan, pilih kursi secara langsung sesuai denah bus, bayar lewat Midtrans,
              dan terima e-ticket digital beserta notifikasi WhatsApp atau email.
            </p>

            {/* Tombol CTA Alur Customer */}
            <div className="lp-hero-cta-group">
              <button className="lp-btn-hero-primary" onClick={() => onNavigate('register')}>
                <span className="material-symbols-outlined">person_add</span>
                Daftar Akun
              </button>
              <button className="lp-btn-hero-secondary" onClick={() => onNavigate('jadwal')}>
                <span className="material-symbols-outlined">route</span>
                Lihat Jadwal &amp; Rute
              </button>
              <button className="lp-btn-hero-outline" onClick={() => onNavigate('login')}>
                <span className="material-symbols-outlined">login</span>
                Masuk
              </button>
            </div>
          </div>

        </div>

        {/* ── 3. SOROTAN LAYANAN UTAMA ───────────────────────────────── */}
        <div className="lp-stats-bar">
          <div className="lp-stats-inner">
            <div className="lp-stat-card">
              <div className="lp-stat-icon-wrapper bg-blue-subtle">
                <span className="material-symbols-outlined">directions_bus</span>
              </div>
              <div className="lp-stat-info">
                <div className="lp-stat-number">Jadwal Langsung</div>
                <div className="lp-stat-desc">Sinkron dari database operator bus</div>
              </div>
            </div>

            <div className="lp-stat-card">
              <div className="lp-stat-icon-wrapper bg-orange-subtle">
                <span className="material-symbols-outlined">event_seat</span>
              </div>
              <div className="lp-stat-info">
                <div className="lp-stat-number">Denah Kursi</div>
                <div className="lp-stat-desc">Pilih kursi kosong tanpa bentrok</div>
              </div>
            </div>

            <div className="lp-stat-card">
              <div className="lp-stat-icon-wrapper bg-yellow-subtle">
                <span className="material-symbols-outlined">qr_code_2</span>
              </div>
              <div className="lp-stat-info">
                <div className="lp-stat-number">E-Ticket Digital</div>
                <div className="lp-stat-desc">Kode boarding langsung terbit</div>
              </div>
            </div>

            <div className="lp-stat-card">
              <div className="lp-stat-icon-wrapper bg-green-subtle">
                <span className="material-symbols-outlined">support_agent</span>
              </div>
              <div className="lp-stat-info">
                <div className="lp-stat-number">Asisten Rute</div>
                <div className="lp-stat-desc">Panduan jadwal dan pengajuan refund</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. PAYMENT CHANNELS STRIP ──────────────────────────────── */}
      <section className="lp-payment-strip">
        <div className="lp-payment-inner">
          <span className="lp-payment-title">Metode Pembayaran Resmi:</span>
          <div className="lp-payment-badges">
            <span className="lp-pay-pill">QRIS Semua Bank</span>
            <span className="lp-pay-pill">GoPay</span>
            <span className="lp-pay-pill">OVO</span>
            <span className="lp-pay-pill">ShopeePay</span>
            <span className="lp-pay-pill">BCA Virtual Account</span>
            <span className="lp-pay-pill">Mandiri Livin</span>
            <span className="lp-pay-pill">BNI / BRI VA</span>
            <span className="lp-pay-pill">Indomaret &amp; Alfamart</span>
          </div>
        </div>
      </section>

      {/* ── 5. FITUR & KEUNGGULAN GOVIA ───────────────────────────── */}
      <section className="lp-section lp-features-section">
        <div className="lp-section-container">
          <div className="lp-section-header-center">
            <h2 className="lp-section-title">
              Alur Pemesanan Tiket di <span>GOVIA</span>
            </h2>
            <p className="lp-section-sub">
              Dari pemilihan jadwal, penguncian kursi, hingga validasi e-ticket di terminal dalam satu alur terpadu
            </p>
          </div>

          <div className="lp-features-box">
            <div className="lp-features-grid">

              <div className="lp-feature-item">
                <div className="lp-feat-icon bg-orange">
                  <span className="material-symbols-outlined">airline_seat_recline_extra</span>
                </div>
                <h4 className="lp-feat-title">Pilih Kursi Sesuai Denah</h4>
                <p className="lp-feat-desc">
                  Lihat ketersediaan kursi bus secara langsung dan kunci nomor kursi pilihan Anda sebelum pembayaran.
                </p>
              </div>

              <div className="lp-feature-item">
                <div className="lp-feat-icon bg-blue">
                  <span className="material-symbols-outlined">price_check</span>
                </div>
                <h4 className="lp-feat-title">Tarif Transparan</h4>
                <p className="lp-feat-desc">
                  Harga tiket mengikuti jadwal yang ditetapkan operator bus tanpa biaya tambahan tersembunyi.
                </p>
              </div>

              <div className="lp-feature-item">
                <div className="lp-feat-icon bg-green">
                  <span className="material-symbols-outlined">qr_code_2</span>
                </div>
                <h4 className="lp-feat-title">Boarding dengan E-Ticket</h4>
                <p className="lp-feat-desc">
                  Tunjukkan kode e-ticket digital Anda kepada petugas gate terminal saat waktu keberangkatan.
                </p>
              </div>

              <div className="lp-feature-item">
                <div className="lp-feat-icon bg-purple">
                  <span className="material-symbols-outlined">chat</span>
                </div>
                <h4 className="lp-feat-title">Bantuan Rute &amp; Refund</h4>
                <p className="lp-feat-desc">
                  Perlu informasi rute perjalanan atau mengajukan pengembalian dana? Ajukan langsung lewat halaman pesanan atau pusat bantuan.
                </p>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* ── 6. CALL TO ACTION BANNER ─────────────────────────────── */}
      <section className="lp-section lp-cta-section">
        <div className="lp-section-container">
          <div className="lp-cta-card">
            <div className="lp-cta-content">
              <h2 className="lp-cta-heading">
                Siap Memesan Tiket Perjalanan?
              </h2>
              <p className="lp-cta-text">
                Buat akun penumpang atau lihat jadwal keberangkatan bus yang tersedia sekarang.
              </p>
              <div className="lp-cta-buttons">
                <button className="lp-btn-cta-primary" onClick={() => onNavigate('register')}>
                  <span className="material-symbols-outlined">person_add</span>
                  Daftar Akun
                </button>
                <button className="lp-btn-cta-secondary" onClick={() => onNavigate('jadwal')}>
                  <span className="material-symbols-outlined">route</span>
                  Lihat Jadwal Bus
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. FOOTER ────────────────────────────────────────────── */}
      <footer className="lp-footer anim-fade-up">
        <div className="lp-footer-container">
          <div className="lp-footer-top-grid">

            {/* Brand Info */}
            <div className="lp-footer-brand-col">
              <div className="lp-footer-logo-row">
                <img src={logoNavbar} alt="GOVIA" className="lp-footer-logo-img" />
              </div>
              <p className="lp-footer-desc">
                Platform pemesanan tiket bus antarkota yang menghubungkan penumpang dengan jadwal, armada, dan petugas terminal secara terintegrasi.
              </p>

              <div className="lp-footer-trust-badges">
                <div className="lp-trust-badge">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#16a34a' }}>check_circle</span>
                  <span>E-Ticket Digital</span>
                </div>
                <div className="lp-trust-badge">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#1B4285' }}>verified_user</span>
                  <span>Dukungan Refund</span>
                </div>
              </div>

              {/* Pembayaran */}
              <div className="lp-footer-security-section">
                <div className="lp-footer-subhead">Metode Pembayaran</div>
                <p className="lp-footer-subdesc">Mendukung QRIS, Virtual Account, dan dompet digital melalui Midtrans.</p>
                <div className="lp-footer-pay-pills">
                  <span className="lp-pay-pill">QRIS</span>
                  <span className="lp-pay-pill">Virtual Account</span>
                  <span className="lp-pay-pill">E-Wallet</span>
                </div>
              </div>
            </div>

            {/* Kolom Rute */}
            <div className="lp-footer-col">
              <div className="lp-footer-head">Rute Populer</div>
              <ul className="lp-footer-menu">
                <li><span onClick={() => onNavigate('search')}>Jakarta → Yogyakarta</span></li>
                <li><span onClick={() => onNavigate('search')}>Jakarta → Surabaya</span></li>
                <li><span onClick={() => onNavigate('search')}>Bandung → Yogyakarta</span></li>
                <li><span onClick={() => onNavigate('search')}>Semarang → Jakarta</span></li>
              </ul>
            </div>

            {/* Kolom Layanan Pelanggan */}
            <div className="lp-footer-col">
              <div className="lp-footer-head">Layanan Pelanggan</div>
              <ul className="lp-footer-menu">
                <li><span onClick={() => onNavigate('chatbot')}>Pusat Bantuan</span></li>
                <li><span onClick={() => onNavigate('jadwal')}>Cek Jadwal &amp; Rute</span></li>
                <li><span onClick={() => onNavigate('pesanan')}>Riwayat Pesanan &amp; Refund</span></li>
              </ul>
            </div>

          </div>

          <div className="lp-footer-bottom-bar">
            <div className="lp-footer-copyright">
              © 2026 PT GOVIA Nusantara Digital. Seluruh hak cipta dilindungi.
            </div>
            <div className="lp-footer-bottom-links">
              <span>Kebijakan Privasi</span>
              <span>Ketentuan Layanan</span>
              <span>Peta Situs</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
