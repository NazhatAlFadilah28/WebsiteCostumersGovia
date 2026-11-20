import { useState } from 'react';
import '../Style/login.css';
import Navbar from '../components/Navbar';
import logoLogin from '../assets/LogoLogin.jpg';
import { authOtpApi } from '../services/auth-location';

interface LoginPageProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

export default function LoginPage({ onNavigate }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'input-email' | 'input-otp'>('input-email');
  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setToast({ message: 'Harap isi alamat email Anda.', type: 'warning' });
      return;
    }
    setIsLoading(true);
    setToast(null);

    try {
      const res = await authOtpApi.requestCode(email);
      if (res.success) {
        setStep('input-otp');
        setToast({
          message: res.dev_code
            ? `SMTP belum diatur. Kode verifikasi dev: ${res.dev_code}`
            : 'Kode verifikasi 6 digit telah dikirim ke email Anda.',
          type: 'success',
        });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Gagal mengirim kode verifikasi';
      setToast({ message: errorMsg, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode) {
      setToast({ message: 'Harap masukkan kode verifikasi.', type: 'warning' });
      return;
    }
    setIsLoading(true);
    setToast(null);

    try {
      const res = await authOtpApi.verifyCode(email, otpCode);
      if (res.token) {
        localStorage.setItem('govia_token', res.token);
        localStorage.setItem('bustix_token', res.token);
      }
      if (res.user) {
        localStorage.setItem('govia_user', JSON.stringify(res.user));
        localStorage.setItem('bustix_user', JSON.stringify(res.user));
      }
      window.dispatchEvent(new Event('storage'));

      setToast({ message: 'Login berhasil! Mengalihkan...', type: 'success' });
      setTimeout(() => {
        onNavigate('jadwal');
      }, 900);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Kode OTP salah';
      setToast({ message: errorMsg, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setToast({ message: 'Mengarahkan ke halaman login Google...', type: 'warning' });
    try {
      const redirectUri = `${window.location.origin}/auth/google/callback`;
      const res = await authOtpApi.getGoogleAuthUrl(redirectUri);
      if (res.state) {
        sessionStorage.setItem('google_oauth_state', res.state);
        localStorage.setItem('google_oauth_state', res.state);
      }
      sessionStorage.setItem('google_redirect_uri', res.redirect_uri || redirectUri);
      localStorage.setItem('google_redirect_uri', res.redirect_uri || redirectUri);
      sessionStorage.setItem('google_oauth_pending', '1');

      if (res.auth_url) {
        window.location.href = res.auth_url;
        return;
      }
      throw new Error('URL otorisasi Google tidak tersedia.');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Gagal membuka login Google.';
      setToast({ message: errorMsg, type: 'error' });
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      <Navbar onNavigate={onNavigate} variant="minimal" ctaLabel="Daftar Akun" ctaTarget="register" />

      <main className="login-main-content">
        <div className="login-card-wrapper">
          <div className="login-card-header">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
              <img src={logoLogin} alt="GOVIA Transport" style={{ height: '5.25rem', width: 'auto', objectFit: 'contain' }} />
            </div>
            <h1 className="login-card-title">Masuk / Autentikasi Customer</h1>
            <p className="login-card-subtitle">
              Login instan dengan Akun Google atau Kode Verifikasi Email (OTP).
            </p>
          </div>

          {toast && (
            <div
              style={{
                padding: '0.875rem 1rem',
                borderRadius: '0.75rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                backgroundColor: toast.type === 'success' ? '#ecfdf5' : toast.type === 'warning' ? '#fffbeb' : '#fef2f2',
                color: toast.type === 'success' ? '#065f46' : toast.type === 'warning' ? '#92400e' : '#b91c1c',
                border: `1px solid ${toast.type === 'success' ? '#a7f3d0' : toast.type === 'warning' ? '#fde68a' : '#fecaca'}`,
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                {toast.type === 'success' ? 'check_circle' : toast.type === 'warning' ? 'warning' : 'error'}
              </span>
              <span>{toast.message}</span>
            </div>
          )}

          {/* Tombol Google Login */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="login-google-btn"
            style={{ marginBottom: '1rem' }}
          >
            <svg style={{ width: '1.25rem', height: '1.25rem', flexShrink: 0 }} viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
              />
              <path
                fill="#34A853"
                d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09z"
              />
              <path
                fill="#EA4335"
                d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
              />
            </svg>
            <span>{isLoading ? 'Menghubungkan ke Google...' : 'Masuk dengan Google'}</span>
          </button>

          <div className="login-divider-box">
            <div className="login-divider-line"></div>
            <span className="login-divider-text">atau kirim Kode Verifikasi ke Email</span>
          </div>

          {step === 'input-email' ? (
            <form onSubmit={handleRequestOtp} className="login-form-body">
              <div className="login-field-group">
                <label className="login-field-label">Alamat Email Customer *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@email.com"
                  required
                  className="login-input-control"
                />
              </div>
              <button type="submit" disabled={isLoading} className="login-submit-btn">
                {isLoading ? 'Mengirim...' : 'Kirim Kode Verifikasi ke Email'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="login-form-body">
              <div style={{ fontSize: '0.85rem', color: '#4b5563', marginBottom: '0.5rem' }}>
                Masukkan 6 digit kode yang dikirim ke email <b>{email}</b> (Cek terminal backend untuk melihat kodenya).
              </div>
              <div className="login-field-group">
                <label className="login-field-label">Kode Verifikasi (OTP) *</label>
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="123456"
                  required
                  className="login-input-control"
                  style={{ letterSpacing: '4px', fontWeight: 'bold', textAlign: 'center' }}
                />
              </div>
              <button type="submit" disabled={isLoading} className="login-submit-btn">
                {isLoading ? 'Memverifikasi...' : 'Verifikasi & Masuk'}
              </button>
              <button
                type="button"
                onClick={() => setStep('input-email')}
                style={{ background: 'none', border: 'none', color: '#1B4285', fontSize: '0.75rem', cursor: 'pointer', marginTop: '0.5rem' }}
              >
                &larr; Ganti Email
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
