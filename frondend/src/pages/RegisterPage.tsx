import { useState } from 'react';
import '../Style/login.css';
import Navbar from '../components/Navbar';
import logoLogin from '../assets/LogoLogin.jpg';
import { authOtpApi } from '../services/auth-location';

interface RegisterPageProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

export default function RegisterPage({ onNavigate }: RegisterPageProps) {
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [noHp, setNoHp] = useState('');
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nama || !email || !noHp) {
      setToast({ message: 'Harap isi semua kolom formulir.', type: 'warning' });
      return;
    }
    setIsLoading(true);
    setToast(null);

    try {
      const res = await authOtpApi.requestCode(email, nama, noHp);
      if (res.success) {
        setStep('otp');
        setToast({
          message: res.dev_code
            ? `SMTP belum diatur. Kode verifikasi dev: ${res.dev_code}`
            : 'Kode verifikasi pendaftaran telah dikirim ke email Anda.',
          type: 'success',
        });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Gagal registrasi';
      setToast({ message: errorMsg, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyRegisterOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
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
      setToast({ message: 'Pendaftaran & verifikasi berhasil!', type: 'success' });
      setTimeout(() => onNavigate('jadwal'), 900);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Kode OTP salah';
      setToast({ message: errorMsg, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      <Navbar onNavigate={onNavigate} variant="minimal" ctaLabel="Masuk" ctaTarget="login" />

      <main className="login-main-content">
        <div className="login-card-wrapper">
          <div className="login-card-header">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
              <img src={logoLogin} alt="GOVIA Transport" style={{ height: '5.25rem', width: 'auto', objectFit: 'contain' }} />
            </div>
            <h1 className="login-card-title">Daftar Akun Baru</h1>
            <p className="login-card-subtitle">Verifikasi email otomatis dengan kode keamanan.</p>
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

          {step === 'form' ? (
            <form onSubmit={handleRegister} className="login-form-body">
              <div className="login-field-group">
                <label className="login-field-label">Nama Lengkap *</label>
                <div className="login-input-relative">
                  <span className="material-symbols-outlined login-input-icon">person</span>
                  <input
                    type="text"
                    value={nama}
                    onChange={(e) => setNama(e.target.value)}
                    placeholder="Nama sesuai KTP"
                    required
                    className="login-input-control"
                  />
                </div>
              </div>

              <div className="login-field-group">
                <label className="login-field-label">Email *</label>
                <div className="login-input-relative">
                  <span className="material-symbols-outlined login-input-icon">mail</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@email.com"
                    required
                    className="login-input-control"
                  />
                </div>
              </div>

              <div className="login-field-group">
                <label className="login-field-label">Nomor WhatsApp *</label>
                <div className="login-input-relative">
                  <span className="material-symbols-outlined login-input-icon">phone</span>
                  <input
                    type="text"
                    value={noHp}
                    onChange={(e) => setNoHp(e.target.value)}
                    placeholder="081234567890"
                    required
                    className="login-input-control"
                  />
                </div>
              </div>

              <button type="submit" disabled={isLoading} className="login-submit-btn">
                {isLoading ? 'Memproses...' : 'Daftar & Kirim Kode Verifikasi'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyRegisterOtp} className="login-form-body">
              <div style={{ fontSize: '0.85rem', color: '#4b5563', marginBottom: '0.5rem' }}>
                Masukkan 6 digit kode yang dikirim ke email <b>{email}</b>
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
                {isLoading ? 'Memverifikasi...' : 'Verifikasi Akun'}
              </button>
            </form>
          )}

          <div className="login-card-footer" style={{ marginTop: '1.5rem' }}>
            <p className="login-footer-text">
              Sudah punya akun?{' '}
              <button type="button" onClick={() => onNavigate('login')} className="login-register-link">
                Masuk &gt;
              </button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
