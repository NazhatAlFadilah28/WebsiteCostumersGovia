export const THEME_KEY = 'govia_customer_theme';
export const PROFILE_KEY = 'govia_customer_profile';
export const SETTINGS_EVENT = 'govia-customer-settings-change';
export const OPEN_SETTINGS_EVENT = 'govia-open-customer-settings';

export type ThemeMode = 'light' | 'dark';

export interface CustomerUser {
  id?: string | number;
  nama: string;
  name?: string;
  email?: string;
  role?: string;
  avatar_url?: string | null;
}

export interface CustomerProfileState {
  isLoggedIn: boolean;
  user: CustomerUser | null;
  name: string;
  avatar: string | null;
  email: string;
  role: string;
  defaultName: string;
}

export function getSavedTheme(): ThemeMode {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: ThemeMode): ThemeMode {
  const normalized: ThemeMode = theme === 'dark' ? 'dark' : 'light';
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', normalized);
    document.documentElement.classList.toggle('dark', normalized === 'dark');
    document.documentElement.style.colorScheme = normalized;
  }
  return normalized;
}

export function setSavedTheme(theme: ThemeMode): ThemeMode {
  const normalized = applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, normalized);
  } catch {
    // ignore storage errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { theme: normalized } }));
  }
  return normalized;
}

export function toggleSavedTheme(): ThemeMode {
  return setSavedTheme(getSavedTheme() === 'dark' ? 'light' : 'dark');
}

export function openCustomerSettings(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
  }
}

export function getCustomerProfile(): CustomerProfileState {
  let baseUser: CustomerUser | null;
  let custom: { name?: string; avatar?: string | null } | null;

  try {
    const rawUser = localStorage.getItem('govia_user') || localStorage.getItem('bustix_user');
    baseUser = rawUser ? JSON.parse(rawUser) : null;
  } catch {
    baseUser = null;
  }

  try {
    const rawCustom = localStorage.getItem(PROFILE_KEY);
    custom = rawCustom ? JSON.parse(rawCustom) : null;
  } catch {
    custom = null;
  }

  const defaultName = baseUser?.nama || baseUser?.name || 'Penumpang';
  const name = custom?.name && custom.name.trim() ? custom.name.trim() : defaultName;
  const avatar = custom && 'avatar' in custom ? (custom.avatar ?? null) : (baseUser?.avatar_url ?? null);

  const mergedUser: CustomerUser | null = baseUser
    ? {
        ...baseUser,
        nama: name,
        name,
        avatar_url: avatar,
      }
    : null;

  return {
    isLoggedIn: Boolean(baseUser),
    user: mergedUser,
    name,
    avatar,
    email: baseUser?.email || '',
    role: baseUser?.role || 'customer',
    defaultName,
  };
}

export function saveCustomerProfile({
  name,
  avatar,
}: {
  name: string;
  avatar: string | null;
}): CustomerProfileState {
  const cleanName = String(name || '').trim();
  const payload = {
    name: cleanName,
    avatar: avatar || null,
  };

  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(payload));

    const updateKey = (key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const updated = {
        ...parsed,
        nama: cleanName || parsed.nama,
        name: cleanName || parsed.name,
        avatar_url: payload.avatar,
      };
      localStorage.setItem(key, JSON.stringify(updated));
    };

    updateKey('govia_user');
    updateKey('bustix_user');
  } catch {
    throw new Error('Gagal menyimpan pengaturan ke browser. Coba pilih foto yang lebih kecil.');
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: payload }));
  }

  return getCustomerProfile();
}

export function mergeAuthMeUser(apiUser: CustomerUser): CustomerProfileState {
  let prev: Partial<CustomerUser>;
  let custom: { name?: string; avatar?: string | null } | null;
  try {
    const raw = localStorage.getItem('govia_user') || localStorage.getItem('bustix_user');
    prev = raw ? JSON.parse(raw) : {};
  } catch {
    prev = {};
  }
  try {
    const rawCustom = localStorage.getItem(PROFILE_KEY);
    custom = rawCustom ? JSON.parse(rawCustom) : null;
  } catch {
    custom = null;
  }

  const finalName = custom?.name && custom.name.trim() ? custom.name.trim() : (apiUser.nama || prev.nama || 'Penumpang');
  const finalAvatar =
    custom && 'avatar' in custom
      ? (custom.avatar ?? null)
      : (apiUser.avatar_url || prev.avatar_url || null);

  const merged: CustomerUser = {
    ...prev,
    ...apiUser,
    nama: finalName,
    name: finalName,
    avatar_url: finalAvatar,
  };

  try {
    localStorage.setItem('govia_user', JSON.stringify(merged));
    localStorage.setItem('bustix_user', JSON.stringify(merged));
  } catch {
    // ignore storage errors
  }

  return getCustomerProfile();
}

export function getInitials(name: string): string {
  const parts = String(name || 'GV').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0] || 'GV').slice(0, 2).toUpperCase();
}

export function compressImageToDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('File harus berupa gambar (JPG, PNG, WEBP).'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('Ukuran file maksimal 10MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Gambar tidak valid atau rusak.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
