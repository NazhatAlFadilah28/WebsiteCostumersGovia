import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import {
  SETTINGS_EVENT,
  getCustomerProfile,
  getInitials,
  openCustomerSettings,
} from '../utils/userSettings';

interface DashboardProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [greeting] = useState(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Selamat Pagi';
    if (h < 17) return 'Selamat Siang';
    return 'Selamat Malam';
  });

  const [profile, setProfile] = useState(() => getCustomerProfile());

  useEffect(() => {
    const sync = () => setProfile(getCustomerProfile());
    window.addEventListener(SETTINGS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const userName = profile.name;

  const quickActions = [
    { icon: 'search', label: 'Cek Bus & Jadwal', desc: 'Cari tiket bus tercepat', page: 'search', color: '#1B4285' },
    { icon: 'confirmation_number', label: 'Pesanan Saya', desc: 'Lihat riwayat tiket', page: 'pesanan', color: '#FA7808' },
    { icon: 'route', label: 'Jadwal & Rute', desc: 'Cek jadwal bus terkini', page: 'jadwal', color: '#10b981' },
    { icon: 'smart_toy', label: 'Tanya AI', desc: 'Bantuan 24/7 via chatbot', page: 'chatbot', color: '#8b5cf6' },
  ];

  const popularRoutes = [
    { from: 'Jakarta', to: 'Surabaya', price: 'Rp 185.000', duration: '12 Jam' },
    { from: 'Bandung', to: 'Yogyakarta', price: 'Rp 120.000', duration: '8 Jam' },
    { from: 'Jakarta', to: 'Solo', price: 'Rp 160.000', duration: '10 Jam' },
  ];

  const handleLogout = () => {
    try {
      localStorage.removeItem('govia_user');
      localStorage.removeItem('bustix_user');
      localStorage.removeItem('govia_token');
      localStorage.removeItem('bustix_token');
    } catch { /* ignore */ }
    onNavigate('landing');
  };

  return (
    <div style={{ background: 'transparent', minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Navbar */}
      <Navbar onNavigate={onNavigate} variant="full" ctaLabel="Keluar" ctaTarget="landing" />

      {/* Main Content */}
      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Welcome Banner */}
        <div style={{
          background: 'linear-gradient(135deg, #1B4285 0%, #0f2a55 100%)',
          borderRadius: '1.5rem',
          padding: '2.5rem',
          marginBottom: '2rem',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: '-60px', right: '-60px',
            width: '280px', height: '280px', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(250,120,8,0.15) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: '-40px', left: '30%',
            width: '200px', height: '200px', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <div
                onClick={openCustomerSettings}
                title="Klik untuk ubah foto profil & nama"
                style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: 'rgba(255,255,255,0.16)', border: '2px solid rgba(255,255,255,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '1.125rem', fontWeight: 800,
                  overflow: 'hidden', cursor: 'pointer', flexShrink: 0,
                }}
              >
                {profile.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={userName}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  getInitials(userName)
                )}
              </div>
              <div>
                <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.68)', marginBottom: '0.15rem', fontWeight: 500 }}>
                  {greeting},
                </p>
                <h1 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 900, color: '#fff', margin: 0 }}>
                  {userName}
                </h1>
              </div>
            </div>
            <p style={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.75)', marginBottom: '1.75rem', maxWidth: '500px', lineHeight: 1.6 }}>
              Selamat datang kembali di GOVIA! Mau pergi ke mana hari ini?
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => onNavigate('search')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.875rem 1.75rem', borderRadius: '0.875rem',
                  background: 'linear-gradient(135deg, #FA7808 0%, #ff8c1a 100%)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontSize: '0.9375rem', fontWeight: 800,
                  boxShadow: '0 6px 20px rgba(250,120,8,0.4)',
                  transition: 'all 0.2s ease',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>search</span>
                Cari Tiket Bus
              </button>
              <button
                type="button"
                onClick={openCustomerSettings}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.875rem 1.25rem', borderRadius: '0.875rem',
                  background: 'rgba(255,255,255,0.14)',
                  color: '#fff', border: '1px solid rgba(255,255,255,0.28)', cursor: 'pointer',
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontSize: '0.875rem', fontWeight: 700,
                  transition: 'all 0.2s ease',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>tune</span>
                Pengaturan Profil &amp; Tema
              </button>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0d1b2e', marginBottom: '1rem' }}>
          Akses Cepat
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2.5rem',
        }}>
          {quickActions.map(action => (
            <button
              key={action.page}
              onClick={() => onNavigate(action.page)}
              style={{
                background: '#fff',
                borderRadius: '1.25rem',
                padding: '1.5rem',
                border: '1.5px solid #e2e8f7',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.22s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 10px 28px rgba(27,66,133,0.1)';
                (e.currentTarget as HTMLElement).style.borderColor = action.color;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = '';
                (e.currentTarget as HTMLElement).style.boxShadow = '';
                (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f7';
              }}
            >
              <div style={{
                width: '52px', height: '52px', borderRadius: '14px',
                background: `${action.color}18`,
                border: `1.5px solid ${action.color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: action.color, flexShrink: 0,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>{action.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0d1b2e', marginBottom: '0.25rem' }}>
                  {action.label}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>
                  {action.desc}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Popular Routes + Recent Activity Side by Side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          {/* Popular Routes */}
          <div style={{ background: '#fff', borderRadius: '1.25rem', padding: '1.75rem', border: '1.5px solid #e2e8f7' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0d1b2e' }}>Rute Populer</h3>
              <button
                onClick={() => onNavigate('search')}
                style={{
                  fontSize: '0.75rem', fontWeight: 700, color: '#1B4285',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  display: 'inline-flex', alignItems: 'center', gap: '4px'
                }}
              >
                <span>Lihat Semua</span>
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>arrow_forward</span>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {popularRoutes.map((r, i) => (
                <div
                  key={i}
                  onClick={() => onNavigate('search')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.875rem', borderRadius: '0.875rem',
                    background: '#f5f7ff', cursor: 'pointer', transition: 'all 0.18s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#eff4ff'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#f5f7ff'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '10px',
                      background: 'linear-gradient(135deg, #1B4285 0%, #2d5aa0 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#fff' }}>directions_bus</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#0d1b2e' }}>
                        {r.from} &rarr; {r.to}
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: '#6b7280', fontWeight: 500, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>schedule</span>
                        <span>{r.duration}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: '0.875rem', color: '#1B4285' }}>{r.price}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Akun & Logout */}
          <div style={{ background: '#fff', borderRadius: '1.25rem', padding: '1.75rem', border: '1.5px solid #e2e8f7' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0d1b2e', marginBottom: '1.25rem' }}>Akun Saya</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {/* User Info */}
              <div
                onClick={openCustomerSettings}
                title="Klik untuk ubah foto profil, nama, & tema"
                style={{
                  display: 'flex', alignItems: 'center', gap: '1rem',
                  padding: '1rem', background: '#f5f7ff', borderRadius: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1B4285 0%, #FA7808 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 800, fontSize: '1.125rem', flexShrink: 0,
                  overflow: 'hidden',
                }}>
                  {profile.avatar ? (
                    <img
                      src={profile.avatar}
                      alt={userName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    getInitials(userName)
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0d1b2e' }}>{userName}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500, marginTop: '2px' }}>
                    {profile.email || 'Pengguna GOVIA'}
                  </div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#64748b' }}>edit</span>
              </div>

              <button
                type="button"
                onClick={openCustomerSettings}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.875rem',
                  padding: '0.875rem 1rem', borderRadius: '0.875rem',
                  background: 'transparent', border: '1.5px solid #e2e8f7',
                  cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif",
                  transition: 'all 0.18s ease', textAlign: 'left',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#FA7808' }}>settings</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#374151' }}>Pengaturan Profil &amp; Mode Gelap/Terang</span>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#b0bac8', marginLeft: 'auto' }}>chevron_right</span>
              </button>

              {[
                { icon: 'confirmation_number', label: 'Riwayat Pesanan', page: 'pesanan' },
                { icon: 'support_agent', label: 'Tanya CS / AI', page: 'chatbot' },
              ].map(item => (
                <button
                  key={item.page}
                  onClick={() => onNavigate(item.page)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.875rem',
                    padding: '0.875rem 1rem', borderRadius: '0.875rem',
                    background: 'transparent', border: '1.5px solid #e2e8f7',
                    cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif",
                    transition: 'all 0.18s ease', textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#1B4285';
                    (e.currentTarget as HTMLElement).style.background = '#f5f7ff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f7';
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#1B4285' }}>{item.icon}</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#374151' }}>{item.label}</span>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#b0bac8', marginLeft: 'auto' }}>chevron_right</span>
                </button>
              ))}

              <button
                onClick={handleLogout}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.875rem',
                  padding: '0.875rem 1rem', borderRadius: '0.875rem',
                  background: '#fff5f5', border: '1.5px solid #fecaca',
                  cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif",
                  transition: 'all 0.18s ease', textAlign: 'left',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#ef4444' }}>logout</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#ef4444' }}>Keluar dari Akun</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
