import { useEffect, useRef, useState } from 'react';
import {
  SETTINGS_EVENT,
  type ThemeMode,
  compressImageToDataUrl,
  getCustomerProfile,
  getInitials,
  getSavedTheme,
  saveCustomerProfile,
  setSavedTheme,
} from '../utils/userSettings';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  if (!open) return null;
  return <SettingsModalContent onClose={onClose} />;
}

function SettingsModalContent({ onClose }: { onClose: () => void }) {
  const [initialProfile] = useState(() => getCustomerProfile());
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
  const [nameInput, setNameInput] = useState(() => initialProfile.name);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(() => initialProfile.avatar);
  const [defaultName] = useState(() => initialProfile.defaultName);
  const [email] = useState(() => initialProfile.email);
  const [isLoggedIn] = useState(() => initialProfile.isLoggedIn);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = () => setTheme(getSavedTheme());
    window.addEventListener(SETTINGS_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_EVENT, sync);
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg('');
    setSavedMsg('');
    setBusy(true);
    try {
      const dataUrl = await compressImageToDataUrl(file, 256);
      setAvatarPreview(dataUrl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses foto.');
    } finally {
      setBusy(false);
    }
  };

  const handleSelectTheme = (next: ThemeMode) => {
    setTheme(setSavedTheme(next));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setErrorMsg('Nama tampilan tidak boleh kosong.');
      return;
    }
    setErrorMsg('');
    try {
      saveCustomerProfile({ name: trimmed, avatar: avatarPreview });
      setSavedMsg('Pengaturan berhasil disimpan!');
      setTimeout(() => {
        onClose();
      }, 650);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.');
    }
  };

  const handleReset = () => {
    setNameInput(defaultName);
    setAvatarPreview(null);
    saveCustomerProfile({ name: defaultName, avatar: null });
    setSavedMsg('Profil dikembalikan ke default.');
  };

  return (
    <div
      className="cust-settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Pengaturan Profil dan Tampilan"
    >
      <div className="cust-settings-modal">
        <div className="cust-settings-header">
          <div>
            <h2 className="cust-settings-title">Pengaturan Profil &amp; Tampilan</h2>
            <p className="cust-settings-sub">
              Sesuaikan foto profil, nama tampilan, dan mode terang/gelap sesuai kemauan Anda.
            </p>
          </div>
          <button
            type="button"
            className="cust-settings-close"
            onClick={onClose}
            aria-label="Tutup pengaturan"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        <form onSubmit={handleSave} className="cust-settings-body">
          {/* Foto Profil */}
          <div className="cust-settings-section">
            <label className="cust-settings-label">Foto Profil</label>
            <div className="cust-settings-avatar-row">
              <div className="cust-settings-avatar-preview">
                {avatarPreview ? (
                  <img src={avatarPreview} alt={nameInput || 'Foto Profil'} />
                ) : (
                  <span>{getInitials(nameInput || defaultName)}</span>
                )}
              </div>
              <div className="cust-settings-avatar-controls">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <div className="cust-settings-btn-row">
                  <button
                    type="button"
                    className="cust-settings-upload-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>photo_camera</span>
                    <span>{busy ? 'Memproses...' : 'Pilih Foto'}</span>
                  </button>
                  {avatarPreview && (
                    <button
                      type="button"
                      className="cust-settings-remove-btn"
                      onClick={() => setAvatarPreview(null)}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                      <span>Hapus</span>
                    </button>
                  )}
                </div>
                <span className="cust-settings-hint">
                  JPG, PNG, atau WEBP. Otomatis dipotong rapi &amp; disimpan di browser Anda.
                </span>
              </div>
            </div>
          </div>

          {/* Nama Tampilan */}
          <div className="cust-settings-section">
            <label htmlFor="cust-display-name" className="cust-settings-label">
              Nama Tampilan
            </label>
            <input
              id="cust-display-name"
              type="text"
              className="cust-settings-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Masukkan nama tampilan Anda..."
              maxLength={60}
            />
            <span className="cust-settings-hint">
              {isLoggedIn
                ? `Email akun: ${email || 'Customer GOVIA'}`
                : 'Nama & foto ini tersimpan lokal di browser dan langsung dipakai saat Anda login.'}
            </span>
          </div>

          {/* Mode Tampilan */}
          <div className="cust-settings-section">
            <label className="cust-settings-label">Mode Tampilan</label>
            <div className="cust-settings-theme-grid">
              <button
                type="button"
                data-keep-theme="true"
                className={`cust-settings-theme-card ${theme === 'light' ? 'active' : ''}`}
                onClick={() => handleSelectTheme('light')}
              >
                <span className="cust-settings-theme-icon light">
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>light_mode</span>
                </span>
                <span className="cust-settings-theme-info">
                  <strong>Mode Terang</strong>
                  <small>Cerah &amp; bersih untuk siang hari</small>
                </span>
                {theme === 'light' && (
                  <span className="cust-settings-check">
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                  </span>
                )}
              </button>

              <button
                type="button"
                data-keep-theme="true"
                className={`cust-settings-theme-card ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => handleSelectTheme('dark')}
              >
                <span className="cust-settings-theme-icon dark">
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>dark_mode</span>
                </span>
                <span className="cust-settings-theme-info">
                  <strong>Mode Gelap</strong>
                  <small>Nyaman di mata saat malam hari</small>
                </span>
                {theme === 'dark' && (
                  <span className="cust-settings-check">
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                  </span>
                )}
              </button>
            </div>
          </div>

          {errorMsg && <div className="cust-settings-alert error">{errorMsg}</div>}
          {savedMsg && <div className="cust-settings-alert success">{savedMsg}</div>}

          <div className="cust-settings-footer">
            <button type="button" className="cust-settings-reset-btn" onClick={handleReset}>
              Reset Default
            </button>
            <div className="cust-settings-footer-right">
              <button type="button" className="cust-settings-cancel-btn" onClick={onClose}>
                Batal
              </button>
              <button type="submit" className="cust-settings-save-btn" disabled={busy}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>save</span>
                <span>Simpan</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
