import { useEffect, useRef, useState } from 'react';
import { authOtpApi } from '../services/auth-location';

interface GoogleCallbackProps {
  onNavigate: (page: string) => void;
}

/**
 * Menangani callback OAuth 2.0 dari Google (/auth/google/callback?code=...&state=...).
 */
export default function GoogleCallback({ onNavigate }: GoogleCallbackProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Memproses login dengan Akun Google...');
  const processedRef = useRef(false);

  const clearGoogleOAuthStorage = () => {
    sessionStorage.removeItem('google_oauth_state');
    sessionStorage.removeItem('google_redirect_uri');
    sessionStorage.removeItem('google_oauth_pending');
    localStorage.removeItem('google_oauth_state');
    localStorage.removeItem('google_redirect_uri');
  };

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    const processCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const error = urlParams.get('error');
        const errorDescription = urlParams.get('error_description');

        if (error) {
          clearGoogleOAuthStorage();
          setStatus('error');
          setMessage(`Login Google dibatalkan atau gagal: ${errorDescription || error}`);
          return;
        }

        if (!code) {
          clearGoogleOAuthStorage();
          setStatus('error');
          setMessage('Kode otorisasi Google tidak ditemukan pada URL callback.');
          return;
        }

        const storedRedirectUri =
          sessionStorage.getItem('google_redirect_uri') ||
          localStorage.getItem('google_redirect_uri') ||
          `${window.location.origin}/auth/google/callback`;

        const res = await authOtpApi.googleOAuth({
          code,
          redirect_uri: storedRedirectUri,
        });

        clearGoogleOAuthStorage();

        if (res.token) {
          localStorage.setItem('govia_token', res.token);
          localStorage.setItem('bustix_token', res.token);
        }
        if (res.user) {
          localStorage.setItem('govia_user', JSON.stringify(res.user));
          localStorage.setItem('bustix_user', JSON.stringify(res.user));
        }
        window.dispatchEvent(new Event('storage'));

        setStatus('success');
        setMessage(`Login Google berhasil! Selamat datang, ${res.user?.nama || res.user?.email || 'Customer'}`);

        setTimeout(() => {
          window.history.replaceState({}, document.title, '/');
          onNavigate('jadwal');
        }, 1000);
      } catch (err: unknown) {
        clearGoogleOAuthStorage();
        const errorMsg = err instanceof Error ? err.message : 'Gagal memproses login Google.';
        setStatus('error');
        setMessage(errorMsg);
      }
    };

    void processCallback();
  }, [onNavigate]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f2a55, #1B4285)',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '1.25rem',
          padding: '2.5rem',
          maxWidth: '420px',
          width: '90%',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: status === 'error' ? '#fee2e2' : status === 'success' ? '#d1fae5' : '#eff6ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem auto',
          }}
        >
          {status === 'loading' && (
            <svg
              style={{ width: '32px', height: '32px', animation: 'spin 1s linear infinite' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1B4285"
              strokeWidth="2"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          )}
          {status === 'success' && (
            <svg style={{ width: '32px', height: '32px' }} viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {status === 'error' && (
            <svg style={{ width: '32px', height: '32px' }} viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#111827', marginBottom: '0.75rem' }}>
          {status === 'loading' ? 'Memproses Login Google...' : status === 'success' ? 'Login Berhasil!' : 'Login Gagal'}
        </h2>

        <p style={{ fontSize: '0.875rem', color: status === 'error' ? '#dc2626' : '#6b7280', lineHeight: 1.6 }}>
          {message}
        </p>

        {status === 'error' && (
          <button
            type="button"
            onClick={() => {
              window.history.replaceState({}, document.title, '/');
              onNavigate('login');
            }}
            style={{
              marginTop: '1.5rem',
              padding: '0.75rem 2rem',
              borderRadius: '0.75rem',
              background: '#1B4285',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.875rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Kembali ke Halaman Login
          </button>
        )}

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}

