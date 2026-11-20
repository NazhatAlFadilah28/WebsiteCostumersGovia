import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';

// Konfigurasi web app GOVIA (Project: govia-64860)
export const firebaseConfig = {
  apiKey: 'AIzaSyCBSiyTgx0Zt3Ys1GgZaGfDprtWnaidFsM',
  authDomain: 'govia-64860.firebaseapp.com',
  projectId: 'govia-64860',
  storageBucket: 'govia-64860.firebasestorage.app',
  messagingSenderId: '469673444925',
  appId: '1:469673444925:web:09ddb727f3782cc089cc54',
  measurementId: 'G-W7324F2XX6',
};

// Konfigurasi Firebase Admin Web (Project: admingovia) agar siaran Admin langsung masuk ke Customer
export const adminFirebaseConfig = {
  apiKey: 'AIzaSyATcSPCw0M5JMHMRo4kxTuHGylkrtbGQsY',
  authDomain: 'admingovia.firebaseapp.com',
  projectId: 'admingovia',
  storageBucket: 'admingovia.firebasestorage.app',
  messagingSenderId: '765684301666',
  appId: '1:765684301666:web:404d74421d3fd9a867f63b',
  measurementId: 'G-LGXQEWQ5RN',
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

const existingPrimary = getApps().find((a) => a.name === '[DEFAULT]');
const app: FirebaseApp = existingPrimary || initializeApp(firebaseConfig);
const db = getFirestore(app);

const existingAdmin = getApps().find((a) => a.name === 'customerAdminGoviaApp');
const adminApp: FirebaseApp =
  existingAdmin || initializeApp(adminFirebaseConfig, 'customerAdminGoviaApp');
const adminDb = getFirestore(adminApp);

const READ_STORAGE_KEY = 'govia_customer_read_notifs';

export interface CustomerNotificationItem {
  id: string;
  title: string;
  message: string;
  tipe: 'info' | 'jadwal' | 'refund' | 'darurat';
  routeOrFleet: string;
  sender: string;
  createdAtIso: string;
  timeLabel: string;
  read: boolean;
}

export function getCustomerReadNotifIds(): string[] {
  try {
    const raw = window.localStorage.getItem(READ_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomerReadNotifIds(ids: string[]): void {
  try {
    window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return 'Baru saja';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 60000) return 'Baru saja';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function normalizeTipe(raw?: string): 'info' | 'jadwal' | 'refund' | 'darurat' {
  const v = String(raw || '').toLowerCase();
  if (v === 'jadwal' || v === 'operasional') return 'jadwal';
  if (v === 'refund' || v === 'keuangan') return 'refund';
  if (v === 'darurat' || v === 'peringatan') return 'darurat';
  return 'info';
}

function isTargetedForCustomer(d: Record<string, any>): boolean {
  const targetStr = String(d.target || 'ALL').toUpperCase();
  if (targetStr === 'ALL' || targetStr.includes('CUSTOMER')) return true;
  if (Array.isArray(d.targets)) {
    return d.targets.some((t: any) => String(t).toLowerCase() === 'customer');
  }
  return true;
}

/**
 * Subscribe real-time ke notifikasi broadcast dari Admin & Superadmin
 * Mendengarkan kedua database Firestore ('admingovia' & 'govia-64860')
 */
export function subscribeCustomerNotifications(
  onUpdate: (items: CustomerNotificationItem[]) => void,
  onNewArrival?: (item: CustomerNotificationItem) => void
): () => void {
  let primaryDocs: CustomerNotificationItem[] = [];
  let adminDocs: CustomerNotificationItem[] = [];
  let backendDocs: CustomerNotificationItem[] = [];
  const seenKeys = new Set<string>();
  let initialized = false;

  const mapDoc = (docSnap: { id: string; data: () => Record<string, unknown> }): CustomerNotificationItem | null => {
    const d = docSnap.data() || {};
    if (!isTargetedForCustomer(d)) return null;

    const createdAtVal = d.createdAt as { toDate?: () => Date } | undefined;
    const iso =
      (typeof d.createdAtIso === 'string' && d.createdAtIso) ||
      (typeof d.created_at === 'string' && d.created_at) ||
      (createdAtVal && typeof createdAtVal.toDate === 'function'
        ? createdAtVal.toDate().toISOString()
        : new Date().toISOString());

    const id = String(docSnap.id);
    const readIds = getCustomerReadNotifIds();

    return {
      id,
      title: String(d.judul || d.title || 'Pengumuman Resmi GOVIA'),
      message: String(d.pesan || d.message || '-'),
      tipe: normalizeTipe(String(d.tipe || d.category || 'info')),
      routeOrFleet: String(d.ruteAtauArmada || d.routeOrFleet || ''),
      sender: String(d.sender || 'Admin Govia'),
      createdAtIso: iso,
      timeLabel: formatRelativeTime(iso),
      read: readIds.includes(id),
    };
  };

  const emitMerged = () => {
    const readIds = getCustomerReadNotifIds();
    const map = new Map<string, CustomerNotificationItem>();
    for (const item of [...backendDocs, ...adminDocs, ...primaryDocs]) {
      const key = `${item.title.trim().toLowerCase()}|${item.message.trim().toLowerCase()}|${item.createdAtIso.slice(0, 16)}`;
      if (!map.has(key)) {
        map.set(key, {
          ...item,
          read: readIds.includes(item.id),
        });
      }
    }

    const merged = Array.from(map.values()).sort((a, b) =>
      b.createdAtIso.localeCompare(a.createdAtIso)
    );

    if (initialized && onNewArrival) {
      for (const item of merged) {
        const key = `${item.title.trim().toLowerCase()}|${item.message.trim().toLowerCase()}|${item.createdAtIso.slice(0, 16)}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          onNewArrival(item);
          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            try {
              new Notification(item.title, {
                body: item.message,
                icon: '/favicon.svg',
              });
            } catch {
              /* ignore */
            }
          }
        }
      }
    } else {
      for (const item of merged) {
        const key = `${item.title.trim().toLowerCase()}|${item.message.trim().toLowerCase()}|${item.createdAtIso.slice(0, 16)}`;
        seenKeys.add(key);
      }
      if (backendDocs.length > 0 || adminDocs.length > 0 || primaryDocs.length > 0) {
        initialized = true;
      }
    }

    onUpdate(merged);
  };

  // Poll shared Supabase notifications via Costumer backend (/api/notifications)
  const fetchBackendNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          category?: string;
          code?: string;
          title?: string;
          message?: string;
          created_at?: string;
        }>;
      };
      const readIds = getCustomerReadNotifIds();
      backendDocs = (json.data || []).map((row) => {
        const iso = row.created_at || new Date().toISOString();
        const codeUpper = String(row.code || '').toUpperCase();
        return {
          id: String(row.id),
          title: String(row.title || 'Pengumuman Resmi GOVIA'),
          message: String(row.message || '-'),
          tipe: normalizeTipe(row.category),
          routeOrFleet: row.code && !['ADMIN-PUSAT', 'SUPERADMIN'].includes(codeUpper) ? row.code : '',
          sender: codeUpper === 'SUPERADMIN' ? 'Superadmin GOVIA' : 'Admin GOVIA',
          createdAtIso: iso,
          timeLabel: formatRelativeTime(iso),
          read: readIds.includes(String(row.id)),
        };
      });
      emitMerged();
      initialized = true;
    } catch {
      /* ignore network errors */
    }
  };

  void fetchBackendNotifications();
  const pollTimer = setInterval(() => {
    void fetchBackendNotifications();
  }, 6000);

  const qAdmin = query(
    collection(adminDb, 'notifications'),
    orderBy('createdAtIso', 'desc'),
    limit(30)
  );
  const unsubAdmin = onSnapshot(
    qAdmin,
    (snap) => {
      adminDocs = snap.docs
        .map(mapDoc)
        .filter((x): x is CustomerNotificationItem => x !== null);
      emitMerged();
      initialized = true;
    },
    () => {}
  );

  const qPrimary = query(
    collection(db, 'notifications'),
    orderBy('createdAtIso', 'desc'),
    limit(30)
  );
  const unsubPrimary = onSnapshot(
    qPrimary,
    (snap) => {
      primaryDocs = snap.docs
        .map(mapDoc)
        .filter((x): x is CustomerNotificationItem => x !== null);
      emitMerged();
      initialized = true;
    },
    () => {}
  );

  return () => {
    clearInterval(pollTimer);
    unsubAdmin();
    unsubPrimary();
  };
}

/** Minta izin notifikasi lalu ambil FCM token. null = gagal/ditolak/ browser tak dukung. */
export async function enableNotifications(): Promise<string | null> {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const supported = await isSupported().catch(() => false);
  if (!supported) return 'browser-notif-granted';

  try {
    const messaging: Messaging = getMessaging(app);
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY || undefined,
      serviceWorkerRegistration: registration,
    });

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title || 'GOVIA';
      const body = payload.notification?.body || payload.data?.body || '';
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.svg' });
      }
    });

    return token || 'browser-notif-granted';
  } catch {
    return 'browser-notif-granted';
  }
}

/** true kalau izin notifikasi sudah granted. */
export function notificationsGranted(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
}
