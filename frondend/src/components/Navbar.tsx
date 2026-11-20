import { useState, useEffect, useRef } from 'react';
import '../Style/navbar.css';
import logoNavbar from '../assets/LogoNavbar.png';
import {
  type CustomerNotificationItem,
  enableNotifications,
  getCustomerReadNotifIds,
  notificationsGranted,
  saveCustomerReadNotifIds,
  subscribeCustomerNotifications,
} from '../lib/firebase';
import {
  SETTINGS_EVENT,
  type ThemeMode,
  getCustomerProfile,
  getInitials,
  getSavedTheme,
  mergeAuthMeUser,
  openCustomerSettings,
  toggleSavedTheme,
} from '../utils/userSettings';

interface NavbarProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
  /** 'full' = menu navigasi lengkap, 'minimal' = hanya logo + tombol CTA */
  variant?: 'full' | 'minimal';
  /** Label tombol CTA utama */
  ctaLabel?: string;
  /** Halaman tujuan tombol CTA utama */
  ctaTarget?: string;
}

export default function Navbar({
  onNavigate,
  variant = 'full',
  ctaLabel = 'Masuk / Daftar',
  ctaTarget = 'login',
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState(() => getCustomerProfile());
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [notifOn, setNotifOn] = useState(() => notificationsGranted());
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<CustomerNotificationItem[]>([]);
  const [liveToast, setLiveToast] = useState<CustomerNotificationItem | null>(null);
  const notifWrapRef = useRef<HTMLDivElement>(null);
  const user = profile.user;

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Subscribe real-time ke koleksi 'notifications' dari Admin & Superadmin
  useEffect(() => {
    const unsub = subscribeCustomerNotifications(
      (items) => {
        setNotifications(items);
      },
      (incoming) => {
        setLiveToast(incoming);
        setTimeout(() => {
          setLiveToast((curr) => (curr?.id === incoming.id ? null : curr));
        }, 6500);
      }
    );
    return () => unsub();
  }, []);

  // Tutup dropdown notifikasi saat klik di luar
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (notifWrapRef.current && !notifWrapRef.current.contains(e.target as Node)) {
        setNotifDrawerOpen(false);
      }
    };
    if (notifDrawerOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [notifDrawerOpen]);

  const handleMarkRead = (id: string) => {
    const saved = getCustomerReadNotifIds();
    if (!saved.includes(id)) {
      saveCustomerReadNotifIds([...saved, id]);
    }
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read: true } : item))
    );
  };

  const handleMarkAllRead = () => {
    const allIds = notifications.map((n) => n.id);
    const saved = getCustomerReadNotifIds();
    saveCustomerReadNotifIds(Array.from(new Set([...saved, ...allIds])));
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
  };

  // Aktifkan notifikasi push (FCM) — simpan token untuk dikirim ke backend
  const handleEnableNotif = async () => {
    try {
      const token = await enableNotifications();
      if (token) {
        localStorage.setItem('govia_fcm_token', token);
        setNotifOn(true);
      } else {
        alert('Izin notifikasi ditolak atau browser tidak mendukung.');
      }
    } catch (e) {
      alert(`Gagal mengaktifkan notifikasi: ${(e as Error).message}`);
    }
  };

  // Load user & settings from localStorage
  useEffect(() => {
    const loadUser = () => {
      setProfile(getCustomerProfile());
      setTheme(getSavedTheme());
      setAvatarFailed(false);
    };

    loadUser();
    const token = localStorage.getItem('govia_token') || localStorage.getItem('bustix_token');
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (res?.success && res.user) {
            setProfile(mergeAuthMeUser(res.user));
            setAvatarFailed(false);
          }
        })
        .catch(() => {});
    }
    window.addEventListener('storage', loadUser);
    window.addEventListener(SETTINGS_EVENT, loadUser);
    return () => {
      window.removeEventListener('storage', loadUser);
      window.removeEventListener(SETTINGS_EVENT, loadUser);
    };
  }, []);

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) setMobileOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const navigateAndClose = (page: string) => {
    onNavigate(page);
    setMobileOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } catch { /* ignore */ }
    localStorage.removeItem('govia_token');
    localStorage.removeItem('govia_user');
    localStorage.removeItem('bustix_token');
    localStorage.removeItem('bustix_user');
    setProfile(getCustomerProfile());
    setMobileOpen(false);
    onNavigate('login');
  };

  return (
    <header className="nav-header">
      <div className="nav-inner">

        {/* ── Brand Logo (Only Logo Image) ────────────────────── */}
        <div className="nav-brand" onClick={() => navigateAndClose('landing')} title="Kembali ke Landing Page">
          <img
            src={logoNavbar}
            alt="GOVIA Transport"
            className="nav-brand-logo-img"
          />
        </div>

        {/* ── Center Nav Menu (desktop only, full variant) ─────── */}
        {variant === 'full' && (
          <nav className="nav-menu">
            <button onClick={() => onNavigate('landing')} className="nav-menu-item">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>home</span>
              Beranda
            </button>
            <button onClick={() => onNavigate('jadwal')} className="nav-menu-item">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>route</span>
              Jadwal &amp; Rute
            </button>
            <button onClick={() => onNavigate('search')} className="nav-menu-item">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>directions_bus</span>
              Cek Bus
            </button>
            <button onClick={() => onNavigate('pesanan')} className="nav-menu-item">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>confirmation_number</span>
              Pesanan Saya
            </button>
            <button onClick={() => onNavigate('pickup')} className="nav-menu-item">
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#f97316' }}>pin_drop</span>
              <span>Titik Jemput</span>
            </button>
            <button onClick={() => onNavigate('chatbot')} className="nav-menu-item">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>smart_toy</span>
              <span>Tanya AI</span>
              <span className="nav-badge">CS 24/7</span>
            </button>
          </nav>
        )}

        {/* ── Right Desktop Account / CTA Button ──────────────── */}
        <div className="nav-actions">
          <button
            type="button"
            onClick={() => setTheme(toggleSavedTheme())}
            className="nav-icon-circle-btn"
            title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
            aria-label={theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              {theme === 'dark' ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <button
            type="button"
            onClick={openCustomerSettings}
            className="nav-icon-circle-btn"
            title="Pengaturan Profil & Tampilan"
            aria-label="Pengaturan"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>settings</span>
          </button>
          {/* ── Notification Bell & Real-time Broadcast Popover ── */}
          <div ref={notifWrapRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setNotifDrawerOpen((prev) => !prev)}
              className={`nav-fcm-btn ${unreadCount > 0 || notifOn ? 'on' : ''}`}
              title={`Notifikasi & Pengumuman (${unreadCount} belum dibaca)`}
              aria-label="Notifikasi"
              style={{ position: 'relative' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                {unreadCount > 0 ? 'notifications_active' : 'notifications'}
              </span>
              {unreadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    minWidth: '17px',
                    height: '17px',
                    padding: '0 4px',
                    borderRadius: '999px',
                    backgroundColor: '#ea580c',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid #ffffff',
                    lineHeight: 1,
                  }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifDrawerOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 10px)',
                  right: 0,
                  width: '360px',
                  maxWidth: 'calc(100vw - 24px)',
                  backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
                  border: `1px solid ${theme === 'dark' ? '#1e293b' : '#e2e8f0'}`,
                  borderRadius: '12px',
                  boxShadow: '0 16px 36px -8px rgba(15, 23, 42, 0.22)',
                  zIndex: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '12px 14px',
                    borderBottom: `1px solid ${theme === 'dark' ? '#1e293b' : '#e2e8f0'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    backgroundColor: theme === 'dark' ? '#1e293b' : '#f8fafc',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        color: theme === 'dark' ? '#f8fafc' : '#0f172a',
                      }}
                    >
                      Notifikasi &amp; Pengumuman Admin
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: theme === 'dark' ? '#94a3b8' : '#64748b',
                      }}
                    >
                      {unreadCount > 0
                        ? `${unreadCount} pesan baru belum dibaca`
                        : 'Semua informasi telah dibaca'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {!notifOn && (
                      <button
                        type="button"
                        onClick={handleEnableNotif}
                        style={{
                          padding: '4px 8px',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#ffffff',
                          color: '#0f2552',
                          cursor: 'pointer',
                        }}
                      >
                        Push On
                      </button>
                    )}
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllRead}
                        style={{
                          padding: '4px 8px',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: '#0f2552',
                          color: '#ffffff',
                          cursor: 'pointer',
                        }}
                      >
                        Baca Semua
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <div
                      style={{
                        padding: '28px 16px',
                        textAlign: 'center',
                        fontSize: '12px',
                        color: '#64748b',
                      }}
                    >
                      Belum ada siaran notifikasi dari Admin.
                    </div>
                  ) : (
                    notifications.map((item) => {
                      const badgeMeta =
                        item.tipe === 'darurat'
                          ? { bg: '#fef2f2', color: '#dc2626', label: 'DARURAT' }
                          : item.tipe === 'jadwal'
                          ? { bg: '#fff7ed', color: '#ea580c', label: 'JADWAL' }
                          : item.tipe === 'refund'
                          ? { bg: '#ecfdf5', color: '#059669', label: 'REFUND' }
                          : { bg: '#eff6ff', color: '#1d4ed8', label: 'INFO' };

                      return (
                        <div
                          key={item.id}
                          onClick={() => handleMarkRead(item.id)}
                          style={{
                            padding: '11px 14px',
                            borderBottom: `1px solid ${theme === 'dark' ? '#1e293b' : '#f1f5f9'}`,
                            backgroundColor: item.read
                              ? 'transparent'
                              : theme === 'dark'
                              ? 'rgba(30, 58, 138, 0.22)'
                              : '#f8fafc',
                            borderLeft: item.read ? '3px solid transparent' : '3px solid #ea580c',
                            cursor: 'pointer',
                            transition: 'background-color 0.14s ease',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '6px',
                              marginBottom: '4px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 800,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: badgeMeta.bg,
                                  color: badgeMeta.color,
                                }}
                              >
                                {badgeMeta.label}
                              </span>
                              {item.routeOrFleet && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    color: theme === 'dark' ? '#cbd5e1' : '#475569',
                                  }}
                                >
                                  {item.routeOrFleet}
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                              {item.timeLabel}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '12.5px',
                              fontWeight: 700,
                              color: theme === 'dark' ? '#f8fafc' : '#0f172a',
                              marginBottom: '2px',
                            }}
                          >
                            {item.title}
                          </div>
                          <div
                            style={{
                              fontSize: '11.5px',
                              color: theme === 'dark' ? '#94a3b8' : '#475569',
                              lineHeight: 1.4,
                            }}
                          >
                            {item.message}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          {user ? (
            <div className="nav-user-logged">
              <div
                className="nav-user-profile clickable"
                onClick={openCustomerSettings}
                title={`Klik untuk ubah profil & tema — ${user.nama} (${user.email || ''})`}
              >
                <div className="nav-user-avatar" style={{ overflow: 'hidden', padding: 0 }}>
                  {user.avatar_url && !avatarFailed ? (
                    <img
                      src={user.avatar_url}
                      alt={user.nama}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    />
                  ) : (
                    <span style={{ fontSize: '11px', fontWeight: 800 }}>{getInitials(user.nama)}</span>
                  )}
                </div>
                <div className="nav-user-info">
                  <span className="nav-user-name">{user.nama}</span>
                  <span className="nav-user-role">
                    {user.role === 'admin' ? 'Admin' : user.role === 'staf' ? 'Staf Lapangan' : 'Customer'}
                  </span>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="nav-logout-btn"
                title="Keluar dari akun Anda"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
                <span>Keluar</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => onNavigate(ctaTarget)}
              className="nav-cta-btn"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>login</span>
              {ctaLabel}
            </button>
          )}
        </div>

        {/* ── Mobile Hamburger Toggle (semua variant) ─────────── */}
        <button
          className="nav-mobile-toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
            {mobileOpen ? 'close' : 'menu'}
          </span>
        </button>
      </div>

      {/* ── Mobile Menu Overlay Backdrop ──────────────────────── */}
      {mobileOpen && (
        <div className="nav-mobile-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Mobile Dropdown Menu ──────────────────────────────── */}
      <div className={`nav-mobile-menu ${mobileOpen ? 'open' : ''}`}>
        {/* User profile card in mobile menu if logged in */}
        {user && (
          <div
            className="nav-mobile-user-card clickable"
            onClick={() => {
              setMobileOpen(false);
              openCustomerSettings();
            }}
            title="Klik untuk ubah foto profil & nama"
          >
            <div className="nav-mobile-user-avatar" style={{ overflow: 'hidden', padding: 0 }}>
              {user.avatar_url && !avatarFailed ? (
                <img
                  src={user.avatar_url}
                  alt={user.nama}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                />
              ) : (
                <span style={{ fontSize: '13px', fontWeight: 800 }}>{getInitials(user.nama)}</span>
              )}
            </div>
            <div className="nav-mobile-user-details" style={{ flex: 1 }}>
              <div className="nav-mobile-user-name">{user.nama}</div>
              <div className="nav-mobile-user-email">{user.email || 'Akun Customer GOVIA'}</div>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--nav-text-muted)' }}>
              edit
            </span>
          </div>
        )}

        {/* Nav Links (selalu tampil di mobile menu) */}
        <button onClick={() => navigateAndClose('landing')} className="nav-mobile-menu-item">
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>home</span>
          Beranda (Landing Page)
        </button>
        <button onClick={() => navigateAndClose('jadwal')} className="nav-mobile-menu-item">
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>route</span>
          Jadwal &amp; Rute
        </button>
        <button onClick={() => navigateAndClose('search')} className="nav-mobile-menu-item">
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>directions_bus</span>
          Cek Bus &amp; Jadwal
        </button>
        <button onClick={() => navigateAndClose('pesanan')} className="nav-mobile-menu-item">
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>confirmation_number</span>
          Pesanan Saya
        </button>
        <button onClick={() => navigateAndClose('pickup')} className="nav-mobile-menu-item">
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#f97316' }}>pin_drop</span>
          Titik Jemput (Customer / Admin / Staf)
        </button>
        <button onClick={() => navigateAndClose('chatbot')} className="nav-mobile-menu-item">
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>smart_toy</span>
          Tanya AI — CS 24/7
        </button>

        {/* Divider */}
        <div className="nav-mobile-divider" />

        {/* Pengaturan Profil & Mode Gelap/Terang */}
        <button
          type="button"
          onClick={() => setTheme(toggleSavedTheme())}
          className="nav-mobile-menu-item"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
            {theme === 'dark' ? 'light_mode' : 'dark_mode'}
          </span>
          {theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            openCustomerSettings();
          }}
          className="nav-mobile-menu-item"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>settings</span>
          Pengaturan Profil &amp; Tampilan
        </button>

        {/* Aktifkan notifikasi push */}
        {user && (
          <button onClick={handleEnableNotif} className="nav-mobile-menu-item">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              {notifOn ? 'notifications_active' : 'notifications'}
            </span>
            {notifOn ? 'Notifikasi Aktif' : 'Aktifkan Notifikasi'}
          </button>
        )}

        {/* CTA / Logout Button in Mobile */}
        {user ? (
          <button onClick={handleLogout} className="nav-mobile-logout-btn">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>logout</span>
            Keluar (Log Out)
          </button>
        ) : (
          <button onClick={() => navigateAndClose(ctaTarget)} className="nav-mobile-cta">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>login</span>
            {ctaLabel}
          </button>
        )}
      </div>

      {/* ── Live Broadcast Toast Notification (Muncul Otomatis saat Admin Mengirim Siaran) ── */}
      {liveToast && (
        <div
          onClick={() => {
            handleMarkRead(liveToast.id);
            setNotifDrawerOpen(true);
            setLiveToast(null);
          }}
          style={{
            position: 'fixed',
            top: '72px',
            right: '18px',
            zIndex: 1200,
            width: '340px',
            maxWidth: 'calc(100vw - 36px)',
            backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
            border: `1px solid ${theme === 'dark' ? '#1e293b' : '#cbd5e1'}`,
            borderLeft: '4px solid #ea580c',
            borderRadius: '10px',
            padding: '12px 14px',
            boxShadow: '0 14px 32px -6px rgba(15, 23, 42, 0.25)',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#ea580c', letterSpacing: '0.05em' }}>
              PENGUMUMAN ADMIN GOVIA
            </span>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>Baru saja</span>
          </div>
          <div style={{ fontSize: '13px', fontWeight: 800, color: theme === 'dark' ? '#f8fafc' : '#0f172a', marginBottom: '2px' }}>
            {liveToast.title}
          </div>
          <div style={{ fontSize: '11.5px', color: theme === 'dark' ? '#94a3b8' : '#475569', lineHeight: 1.4 }}>
            {liveToast.message}
          </div>
        </div>
      )}
    </header>
  );
}
