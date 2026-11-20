import { fetchApi } from './api';

export interface AuthUser {
  id: string | number;
  nama: string;
  email: string;
  no_hp?: string;
  google_id?: string | null;
  avatar_url?: string | null;
  role?: string;
}

interface AuthResponse {
  success: boolean;
  message: string;
  token: string;
  user: AuthUser;
}

export const authOtpApi = {
  requestCode: (email: string, nama?: string, no_hp?: string) =>
    fetchApi<{ success: boolean; message: string; dev_code?: string }>('/auth/otp-login', {
      method: 'POST',
      body: JSON.stringify({ action: 'request-code', email, nama, no_hp }),
    }),

  verifyCode: (email: string, code: string) =>
    fetchApi<AuthResponse>('/auth/otp-login', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify-code', email, code }),
    }),

  getGoogleAuthUrl: (redirectUri?: string) =>
    fetchApi<{
      success: boolean;
      client_id: string;
      auth_url: string;
      state: string;
      redirect_uri?: string;
    }>(
      `/auth/google${redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : ''}`
    ),

  googleOAuth: (data: { code?: string; redirect_uri?: string; credential?: string }) =>
    fetchApi<AuthResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  roleLogin: (data: { role: 'customer' | 'admin' | 'staf'; email?: string; password?: string; nama?: string }) =>
    fetchApi<AuthResponse>('/auth/otp-login', {
      method: 'POST',
      body: JSON.stringify({ action: 'role-login', ...data }),
    }),
};

export interface TerminalDirectoryItem {
  id: number;
  nama_terminal: string;
  kota_kabupaten: string;
  provinsi: string;
  tipe_terminal?: string | null;
  latitude: number;
  longitude: number;
  alamat?: string;
  jam_operasional?: string;
  fasilitas?: string[];
  po_operators?: string[];
  google_maps_url?: string;
  poi_name?: string | null;
  status?: string;
}

export const tomtomApi = {
  calculateRoute: (origin: string, destination: string) =>
    fetchApi<{
      success: boolean;
      source: string;
      distanceKm: number;
      travelTimeMinutes: number;
      travelTimeFormatted: string;
      trafficDelaySeconds: number;
      trafficCondition: string;
      points?: [number, number][];
    }>(`/routing?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`),

  getTerminals: (params?: { q?: string; provinsi?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.provinsi) sp.set('provinsi', params.provinsi);
    const qs = sp.toString();
    return fetchApi<{
      success: boolean;
      total: number;
      total_all: number;
      provinces: string[];
      terminals: TerminalDirectoryItem[];
    }>(`/terminals${qs ? `?${qs}` : ''}`);
  },

  resolveTerminalLocation: (id: number) =>
    fetchApi<{
      success: boolean;
      source: 'tomtom-search' | 'terminal-json';
      terminal: TerminalDirectoryItem;
    }>(`/terminals?resolveId=${encodeURIComponent(String(id))}`),
};
