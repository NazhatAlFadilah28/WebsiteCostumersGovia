import React, { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Navbar from '../components/Navbar';
import '../Style/pickup.css';
import {
  pickupApi,
  schedulesApi,
  bookingApi,
  getStoredUser,
  getToken,
  getScheduleBookingState,
  type PickupRequestRecord,
  type PickupStatusType,
  type PickupValidationResult,
  type ScheduleItem,
} from '../services/api';

interface PickupPageProps {
  scheduleId?: string;
  bookingCode?: string;
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

const ALL_STATUSES: PickupStatusType[] = [
  'Menunggu Konfirmasi',
  'Disetujui',
  'Ditolak',
  'Bus Menuju Lokasi',
  'Bus Telah Tiba',
  'Customer Telah Dijemput',
];

function statusBadgeStyle(status: PickupStatusType): { bg: string; color: string; border: string; icon: string } {
  switch (status) {
    case 'Menunggu Konfirmasi':
      return { bg: '#fffbeb', color: '#b45309', border: '#fde68a', icon: 'schedule' };
    case 'Disetujui':
      return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', icon: 'verified' };
    case 'Ditolak':
      return { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', icon: 'cancel' };
    case 'Bus Menuju Lokasi':
      return { bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd', icon: 'directions_bus' };
    case 'Bus Telah Tiba':
      return { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', icon: 'pin_drop' };
    case 'Customer Telah Dijemput':
      return { bg: '#ecfdf5', color: '#15803d', border: '#a7f3d0', icon: 'check_circle' };
    default:
      return { bg: '#f8fafc', color: '#475569', border: '#e2e8f0', icon: 'info' };
  }
}

function formatJam(jam?: string): string {
  return jam ? String(jam).substring(0, 5).replace(':', '.') : '-';
}

function formatTanggalSingkat(iso?: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function PickupPage({ scheduleId: initialScheduleId = '', bookingCode: initialBookingCode = '', onNavigate }: PickupPageProps) {
  const [activeTab, setActiveTab] = useState<'order' | 'track'>(() => (initialBookingCode ? 'track' : 'order'));

  // ── State Pemesanan Tiket Titik Jemput Langsung (GPS & Maps, Tanpa Pilih Kursi) ──
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState<boolean>(true);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(initialScheduleId || '');
  const [passengerCount, setPassengerCount] = useState<number>(1);
  const [paymentMethod, setPaymentMethod] = useState<'midtrans' | 'cash'>('midtrans');

  const storedUser = getStoredUser();
  const isAuthenticated = Boolean(getToken() && storedUser?.id);

  const [fullName, setFullName] = useState<string>(() => storedUser?.nama || '');
  const [nikNumber, setNikNumber] = useState<string>('');
  const [phone, setPhone] = useState<string>(() => storedUser?.no_hp || '');
  const [pickupNote, setPickupNote] = useState<string>('');

  // GPS & Maps Koordinat Jalan Raya (default Jakarta, otomatis pindah ke GPS user saat izin aktif)
  const [pickupLat, setPickupLat] = useState<number>(-6.2088);
  const [pickupLng, setPickupLng] = useState<number>(106.8456);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsStatusText, setGpsStatusText] = useState<string>('Mendeteksi lokasi GPS Anda...');
  const [isLocatingGps, setIsLocatingGps] = useState<boolean>(false);
  const [roadLabel, setRoadLabel] = useState<string>('Pinggir Jalan Raya (Menunggu GPS)');
  const [roadAddress, setRoadAddress] = useState<string>('');
  const [hasManualAddress, setHasManualAddress] = useState<boolean>(false);
  const [validation, setValidation] = useState<PickupValidationResult | null>(null);
  const [isValidatingLoc, setIsValidatingLoc] = useState<boolean>(false);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Refs untuk Peta GPS Pemesanan
  const bookingMapElRef = useRef<HTMLDivElement>(null);
  const bookingMapRef = useRef<L.Map | null>(null);
  const bookingMarkerRef = useRef<L.Marker | null>(null);
  const bookingAccuracyCircleRef = useRef<L.Circle | null>(null);

  // ── State Pelacakan Daftar Titik Penjemputan ──
  const [requests, setRequests] = useState<PickupRequestRecord[]>([]);
  const [selectedReq, setSelectedReq] = useState<PickupRequestRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('SEMUA');
  const [searchBooking, setSearchBooking] = useState<string>(initialBookingCode || '');
  const [isLoadingReqs, setIsLoadingReqs] = useState<boolean>(true);

  const trackMapElRef = useRef<HTMLDivElement>(null);
  const trackMapRef = useRef<L.Map | null>(null);
  const trackLayerRef = useRef<L.LayerGroup | null>(null);

  // ── 1. Muat Daftar Jadwal Bus Aktif ──
  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      const res = await schedulesApi.search({});
      if (res.success && Array.isArray(res.data)) {
        setSchedules(res.data);
        setSelectedScheduleId((prev) => {
          if (prev && res.data.some((s) => String(s.id) === String(prev))) return String(prev);
          const firstBookable = res.data.find(
            (s) => getScheduleBookingState(s).isBookable && Number(s.sisa_kursi) > 0
          );
          return firstBookable ? String(firstBookable.id) : res.data[0] ? String(res.data[0].id) : '';
        });
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingSchedules(false);
    }
  }, []);

  // ── 2. Muat Daftar Permintaan Penjemputan Aktif ──
  const loadRequests = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingReqs(true);
    try {
      const res = await pickupApi.getAllRequests();
      if (res.success) {
        const list = res.requests || [];
        setRequests(list);
        setSelectedReq((prev) => {
          if (initialBookingCode) {
            const match = list.find((r) => r.kode_booking.toLowerCase() === initialBookingCode.toLowerCase());
            if (match) return match;
          }
          return prev ? list.find((r) => r.id === prev.id) || list[0] || null : list[0] || null;
        });
      }
    } catch {
      /* ignore */
    } finally {
      if (!silent) setIsLoadingReqs(false);
    }
  }, [initialBookingCode]);

  useEffect(() => {
    const initTimer = setTimeout(() => {
      void loadSchedules();
      void loadRequests();
    }, 0);
    const timer = setInterval(() => {
      void loadRequests(true);
    }, 15000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [loadSchedules, loadRequests]);

  const activeSchedule = schedules.find((s) => String(s.id) === String(selectedScheduleId)) || null;
  const activeScheduleState = activeSchedule ? getScheduleBookingState(activeSchedule) : null;
  const isScheduleBookable = Boolean(
    activeSchedule && activeScheduleState?.isBookable && Number(activeSchedule.sisa_kursi) > 0
  );

  // ── 3. Deteksi GPS Live dari Browser & Sinkronkan Langsung ke Peta ──
  const detectLiveGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatusText('Browser tidak mendukung GPS. Klik atau geser pin di peta ke pinggir jalan raya.');
      return;
    }
    setIsLocatingGps(true);
    setGpsStatusText('Mencari sinyal GPS presisi tinggi...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const acc = Math.round(pos.coords.accuracy || 25);
        setPickupLat(lat);
        setPickupLng(lng);
        setGpsAccuracy(acc);
        setHasManualAddress(false);
        setGpsStatusText(`GPS Terhubung • Akurasi ±${acc} m`);
        setIsLocatingGps(false);
        if (bookingMapRef.current) {
          bookingMapRef.current.flyTo([lat, lng], 16, { duration: 0.9 });
        }
      },
      () => {
        setGpsStatusText('Izin GPS belum aktif — klik atau geser pin oranye di peta ke pinggir jalan raya Anda.');
        setIsLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
    );
  }, []);

  // Otomatis deteksi GPS saat halaman dibuka
  useEffect(() => {
    const gpsTimer = setTimeout(() => {
      detectLiveGps();
    }, 0);
    return () => clearTimeout(gpsTimer);
  }, [detectLiveGps]);

  // ── 4. Validasi & Reverse-Geocode Nama Jalan Raya Terdekat Otomatis saat Koordinat Berubah ──
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsValidatingLoc(true);
      try {
        const res = await pickupApi.validateLocation({
          lat: pickupLat,
          lng: pickupLng,
          alamat: hasManualAddress ? roadAddress : '',
          asal_kota: activeSchedule?.asal_kota || '',
          tujuan_kota: activeSchedule?.tujuan_kota || '',
          jam_berangkat: activeSchedule?.jam_berangkat || '07:30',
        });
        if (!cancelled && res.success && res.validation) {
          setValidation(res.validation);
          if (!hasManualAddress) {
            if (res.validation.road_name) {
              setRoadLabel(res.validation.road_name);
            }
            if (res.validation.formatted_address) {
              setRoadAddress(res.validation.formatted_address);
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsValidatingLoc(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickupLat, pickupLng, activeSchedule?.asal_kota, activeSchedule?.tujuan_kota, activeSchedule?.jam_berangkat, hasManualAddress, roadAddress]);

  // ── 5. Inisialisasi & Sinkronisasi Peta GPS Interaktif (Tab Pemesanan) ──
  useEffect(() => {
    if (activeTab !== 'order') {
      if (bookingMapRef.current) {
        bookingMapRef.current.remove();
        bookingMapRef.current = null;
        bookingMarkerRef.current = null;
        bookingAccuracyCircleRef.current = null;
      }
      return;
    }

    if (!bookingMapElRef.current) return;

    if (!bookingMapRef.current) {
      const map = L.map(bookingMapElRef.current, { attributionControl: false }).setView([pickupLat, pickupLng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      const pinIcon = L.divIcon({
        className: '',
        html: `<div style="width:26px;height:26px;border-radius:50%;background:#f97316;border:3.5px solid #fff;box-shadow:0 4px 12px rgba(249,115,22,0.55);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:900">★</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const marker = L.marker([pickupLat, pickupLng], { icon: pinIcon, draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        setPickupLat(Number(pos.lat.toFixed(6)));
        setPickupLng(Number(pos.lng.toFixed(6)));
        setGpsAccuracy(null);
        setHasManualAddress(false);
        setGpsStatusText('Pin digeser manual di peta (terhubung ke koordinat jalan raya)');
      });

      map.on('click', (ev: L.LeafletMouseEvent) => {
        const lat = Number(ev.latlng.lat.toFixed(6));
        const lng = Number(ev.latlng.lng.toFixed(6));
        setPickupLat(lat);
        setPickupLng(lng);
        setGpsAccuracy(null);
        setHasManualAddress(false);
        setGpsStatusText('Titik dipilih dari peta (terhubung ke koordinat jalan raya)');
      });

      bookingMapRef.current = map;
      bookingMarkerRef.current = marker;
    }

    const map = bookingMapRef.current;
    const marker = bookingMarkerRef.current;
    if (!map || !marker) return;

    marker.setLatLng([pickupLat, pickupLng]);
    marker
      .bindPopup(
        `<b>Titik Jemput Jalan Raya Anda</b><br>${roadLabel || 'Pinggir Jalan Raya'}<br><small>${pickupLat.toFixed(5)}, ${pickupLng.toFixed(5)}</small>`
      );

    if (bookingAccuracyCircleRef.current) {
      map.removeLayer(bookingAccuracyCircleRef.current);
      bookingAccuracyCircleRef.current = null;
    }
    if (gpsAccuracy && gpsAccuracy > 0) {
      bookingAccuracyCircleRef.current = L.circle([pickupLat, pickupLng], {
        radius: Math.min(gpsAccuracy, 300),
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.14,
        weight: 1.5,
      }).addTo(map);
    }

    map.panTo([pickupLat, pickupLng], { animate: true });
  }, [activeTab, pickupLat, pickupLng, gpsAccuracy, roadLabel]);

  // ── 6. Inisialisasi & Update Peta Pelacakan (Tab Pantau Status) ──
  useEffect(() => {
    if (activeTab !== 'track') {
      if (trackMapRef.current) {
        trackMapRef.current.remove();
        trackMapRef.current = null;
        trackLayerRef.current = null;
      }
      return;
    }

    if (!trackMapElRef.current) return;
    if (!trackMapRef.current) {
      const map = L.map(trackMapElRef.current, { attributionControl: false }).setView([-6.2562, 107.0185], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);
      trackLayerRef.current = L.layerGroup().addTo(map);
      trackMapRef.current = map;
    }

    const map = trackMapRef.current;
    const layer = trackLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    requests.forEach((req) => {
      const isSelected = selectedReq?.id === req.id;
      const color = req.status_penjemputan === 'Ditolak' ? '#dc2626' : isSelected ? '#f97316' : '#1B4285';
      const size = isSelected ? 22 : 16;
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900">${isSelected ? '★' : ''}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([req.lat, req.lng], { icon })
        .bindPopup(
          `<b>${req.nama_customer} (#${req.kode_booking})</b><br>${req.nama_lokasi}<br><small>Status: <b>${req.status_penjemputan}</b> • Est: ${req.estimasi_bus_tiba}</small>`
        )
        .addTo(layer);

      if (isSelected) {
        marker.openPopup();
        map.setView([req.lat, req.lng], 14);
      }
    });
  }, [activeTab, requests, selectedReq]);

  // ── 7. Submit Pemesanan Tiket Titik Jemput Langsung (Tanpa Pilih Kursi) ──
  const farePerPerson = parseInt(String(activeSchedule?.harga || '0'), 10) || 0;
  const totalAmount = farePerPerson * passengerCount;

  const handleSubmitPickupBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!activeSchedule) {
      setFormError('Silakan pilih jadwal bus aktif terlebih dahulu.');
      return;
    }
    if (!isScheduleBookable) {
      setFormError(
        activeScheduleState?.reasonText || 'Jadwal bus ini sudah berangkat atau kursinya habis. Pilih jadwal lain.'
      );
      return;
    }
    if (Number(activeSchedule.sisa_kursi) < passengerCount) {
      setFormError(`Sisa kursi pada jadwal ini hanya ${activeSchedule.sisa_kursi}, tidak cukup untuk ${passengerCount} penumpang.`);
      return;
    }
    if (validation && !validation.bisa_dijemput) {
      setFormError(validation.pesan_validasi || 'Geser pin peta ke pinggir jalan raya yang aman.');
      return;
    }
    if (!fullName.trim() || !nikNumber.trim() || !phone.trim()) {
      setFormError('Harap lengkapi Nama Lengkap, NIK, dan Nomor WhatsApp penumpang.');
      return;
    }

    // Validasi autentikasi WAJIB (khususnya saat memilih pembayaran Cash, dan untuk booking tiket)
    if (!isAuthenticated) {
      setFormError(
        paymentMethod === 'cash'
          ? 'Pembayaran Cash (tunai langsung) mewajibkan Login / Auth terlebih dahulu. Silakan login sekarang.'
          : 'Silakan login terlebih dahulu untuk membuat tiket titik jemput.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // Penumpang titik jemput TIDAK perlu memilih seat_id — backend otomatis menetapkan kursi kosong secara acak
      const passengers = Array.from({ length: passengerCount }, () => ({
        nama_penumpang: fullName.trim(),
        no_identitas: nikNumber.trim(),
        no_hp: phone.trim(),
      }));

      const res = await bookingApi.lockSeats({
        schedule_id: String(activeSchedule.id),
        metode_pembayaran: paymentMethod === 'cash' ? 'cash' : 'qris',
        passengers,
        pickup_info: {
          tipe_keberangkatan: 'pickup',
          nama_lokasi: roadLabel.trim() || validation?.road_name || `Pinggir Jalan Raya (${pickupLat.toFixed(4)}, ${pickupLng.toFixed(4)})`,
          kategori_lokasi: 'Pinggir Jalan Raya (GPS)',
          alamat_lengkap: roadAddress.trim() || validation?.formatted_address || `Koordinat GPS ${pickupLat.toFixed(5)}, ${pickupLng.toFixed(5)}`,
          lat: pickupLat,
          lng: pickupLng,
          jarak_ke_rute_km: validation?.jarak_ke_rute_km ?? 0,
          estimasi_bus_tiba: validation?.estimasi_bus_tiba || `${formatJam(activeSchedule.jam_berangkat)} WIB`,
          status_validasi: 'valid',
          biaya_tambahan: 0,
          catatan_customer: pickupNote.trim(),
          rute_asal: activeSchedule.asal_kota,
          rute_tujuan: activeSchedule.tujuan_kota,
          nama_bus: activeSchedule.nama_bus,
          plat_nomor: activeSchedule.plat_nomor,
        },
      });

      const bookingCode = res.booking?.kode_booking;
      if (!bookingCode) {
        throw new Error('Kode booking tidak diterima dari server.');
      }

      setFormSuccess(res.message);
      void loadRequests(true);

      // Cash -> langsung terbit E-Ticket (TicketPage); Midtrans -> lanjut ke halaman pembayaran Midtrans (PaymentPage)
      if (res.direct_ticket || res.is_cash) {
        onNavigate('ticket', { bookingCode, scheduleId: String(activeSchedule.id) });
      } else {
        onNavigate('payment', { bookingCode, scheduleId: String(activeSchedule.id) });
      }
    } catch (err: unknown) {
      const e = err as Error & { status?: number; code?: string };
      if (e.status === 401 || e.code === 'UNAUTHORIZED') {
        setFormError(e.message || 'Wajib Login / Auth terlebih dahulu untuk melanjutkan pemesanan.');
      } else {
        setFormError(e.message || 'Gagal membuat tiket titik jemput.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter daftar request di tab pelacakan
  const filteredRequests = requests.filter((r) => {
    if (statusFilter !== 'SEMUA' && r.status_penjemputan !== statusFilter) return false;
    if (searchBooking.trim()) {
      const q = searchBooking.toLowerCase();
      const hay = `${r.kode_booking} ${r.nama_customer} ${r.nama_lokasi} ${r.rute_asal} ${r.rute_tujuan}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const currentStepIndex = selectedReq ? ALL_STATUSES.indexOf(selectedReq.status_penjemputan) : 0;

  return (
    <div className="pkp-page-container">
      <Navbar onNavigate={onNavigate} />

      <main className="pkp-main-content">
        {/* ── Hero Banner + Mode Switcher (Pesan Langsung vs Pantau Status) ── */}
        <div className="pkp-hero-card">
          <div className="pkp-hero-left">
            <div className="pkp-hero-badges">
              <span className="pkp-badge-orange">TITIK JEMPUT PINGGIR JALAN RAYA (GPS)</span>
              <span className="pkp-badge-glass">TANPA PILIH KURSI • MIDTRANS &amp; CASH</span>
            </div>
            <h1 className="pkp-hero-title">Pesan Tiket Titik Jemput Langsung</h1>
            <p className="pkp-hero-desc">
              Terhubung langsung ke GPS &amp; Maps — bisa naik di mana saja di pinggir jalan raya tanpa memilih titik khusus dan tanpa memilih kursi terlebih dahulu. Bayar mudah via Midtrans atau Cash langsung saat naik (wajib login).
            </p>
          </div>

          <div className="pkp-role-switcher">
            <button
              type="button"
              onClick={() => setActiveTab('order')}
              className={`pkp-role-btn ${activeTab === 'order' ? 'active' : ''}`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add_location_alt</span>
              <span>Pesan Tiket Jemput</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('track')}
              className={`pkp-role-btn ${activeTab === 'track' ? 'active' : ''}`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>pin_drop</span>
              <span>Pantau Penjemputan ({requests.length})</span>
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            TAB 1: FORM PESAN TIKET TITIK JEMPUT LANGSUNG (GPS + MAPS + BAYAR)
            ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'order' && (
          <form onSubmit={handleSubmitPickupBooking} className="pkp-main-grid">
            {/* KOLOM KIRI: GPS LIVE + PETA INTERAKTIF PINGGIR JALAN RAYA */}
            <div className="pkp-list-col">
              <div className="pkp-section-card">
                <div className="pkp-card-head">
                  <h3>
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#f97316' }}>my_location</span>
                    <span>1. Lokasi GPS &amp; Peta Jalan Raya</span>
                  </h3>
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={detectLiveGps}
                      disabled={isLocatingGps}
                      className="pkp-btn-primary"
                      style={{ background: '#f97316', padding: '0.38rem 0.75rem', fontSize: '0.7rem' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                        {isLocatingGps ? 'sync' : 'my_location'}
                      </span>
                      <span>{isLocatingGps ? 'Mendeteksi GPS...' : 'Deteksi GPS Saya'}</span>
                    </button>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${pickupLat},${pickupLng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pkp-gmaps-nav-btn"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>map</span>
                      <span>Buka Google Maps</span>
                    </a>
                  </div>
                </div>

                {/* Status GPS Live */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.4rem',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.6rem',
                    background: gpsAccuracy ? '#ecfdf5' : '#eff6ff',
                    border: `1px solid ${gpsAccuracy ? '#a7f3d0' : '#bfdbfe'}`,
                    color: gpsAccuracy ? '#166534' : '#1e40af',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    marginBottom: '0.65rem',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                      {gpsAccuracy ? 'gps_fixed' : 'touch_app'}
                    </span>
                    {gpsStatusText}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>
                    {pickupLat.toFixed(5)}, {pickupLng.toFixed(5)}
                  </span>
                </div>

                {/* Peta Interaktif Terhubung GPS (Klik / Geser Pin di Mana Saja di Pinggir Jalan Raya) */}
                <div
                  ref={bookingMapElRef}
                  className="pkp-map-canvas"
                  style={{ height: '300px', borderRadius: '0.85rem' }}
                />

                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.45rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
                  <span>💡 Klik di peta atau geser pin oranye (★) ke pinggir jalan raya terdekat Anda.</span>
                  <span>Biaya Jemput: <b style={{ color: '#16a34a' }}>GRATIS (Rp 0)</b></span>
                </div>

                {/* Hasil Deteksi Jalan Raya (TomTom / OpenStreetMap Reverse Geocode) */}
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem 0.85rem',
                    borderRadius: '0.75rem',
                    background: validation?.bisa_dijemput === false ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${validation?.bisa_dijemput === false ? '#fecaca' : '#bbf7d0'}`,
                    color: validation?.bisa_dijemput === false ? '#991b1b' : '#166534',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 800, fontSize: '0.76rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                      {isValidatingLoc ? 'sync' : validation?.bisa_dijemput === false ? 'warning' : 'verified'}
                    </span>
                    <span>
                      {isValidatingLoc
                        ? 'Mendeteksi nama jalan raya terdekat dari GPS...'
                        : validation?.bisa_dijemput === false
                        ? 'Titik di area tidak aman — geser pin ke pinggir jalan raya'
                        : `Terdeteksi Jalan Raya: ${validation?.road_name || roadLabel}`}
                    </span>
                  </div>
                  <p style={{ margin: '0.28rem 0 0', fontSize: '0.7rem', lineHeight: 1.4, opacity: 0.92 }}>
                    {validation?.pesan_validasi ||
                      'Anda dapat langsung dijemput di pinggir jalan raya mana saja sesuai pin GPS tanpa harus ke SPBU/Minimarket tertentu.'}
                  </p>
                </div>

                {/* Detail Lokasi Jalan Raya (Otomatis Terisi dari GPS, Bisa Diedit Patokannya) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.85rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                      Nama Jalan Raya / Patokan Terdekat (Otomatis dari GPS)
                    </label>
                    <input
                      type="text"
                      className="pkp-input"
                      value={roadLabel}
                      onChange={(e) => {
                        setHasManualAddress(true);
                        setRoadLabel(e.target.value);
                      }}
                      placeholder="Contoh: Jl. Raya Kalimalang / Depan Gerbang Perumahan"
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                      Alamat Lengkap Pinggir Jalan
                    </label>
                    <input
                      type="text"
                      className="pkp-input"
                      value={roadAddress}
                      onChange={(e) => {
                        setHasManualAddress(true);
                        setRoadAddress(e.target.value);
                      }}
                      placeholder="Alamat otomatis dari koordinat GPS"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                      Catatan untuk Sopir (Opsional)
                    </label>
                    <input
                      type="text"
                      className="pkp-input"
                      value={pickupNote}
                      onChange={(e) => setPickupNote(e.target.value)}
                      placeholder="Contoh: Saya memakai jaket biru menunggu di seberang halte"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* KOLOM KANAN: JADWAL BUS, DATA PENUMPANG (TANPA PILIH KURSI), & BAYAR MIDTRANS / CASH */}
            <div className="pkp-detail-col">
              {/* Alert Error / Sukses */}
              {formError && (
                <div className="pkp-toast error" style={{ marginBottom: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>error</span>
                  <span>{formError}</span>
                </div>
              )}
              {formSuccess && (
                <div className="pkp-toast" style={{ marginBottom: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>check_circle</span>
                  <span>{formSuccess}</span>
                </div>
              )}

              {/* Card 2: Pilih Jadwal & Jumlah Penumpang (Tanpa Pilih Kursi) */}
              <div className="pkp-section-card">
                <div className="pkp-card-head">
                  <h3>
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#1B4285' }}>directions_bus</span>
                    <span>2. Pilih Jadwal Bus &amp; Jumlah Penumpang</span>
                  </h3>
                  <span className="pkp-mini-tag orange">KURSI OTOMATIS (TANPA PILIH KURSI)</span>
                </div>

                {loadingSchedules ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.78rem' }}>
                    Memuat jadwal bus aktif...
                  </div>
                ) : schedules.length === 0 ? (
                  <div style={{ padding: '1rem', background: '#fef2f2', borderRadius: '0.65rem', color: '#991b1b', fontSize: '0.76rem', fontWeight: 700 }}>
                    Belum ada jadwal bus aktif saat ini.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.3rem' }}>
                        Jadwal &amp; Rute Bus
                      </label>
                      <select
                        className="pkp-input"
                        value={selectedScheduleId}
                        onChange={(e) => setSelectedScheduleId(e.target.value)}
                        style={{ cursor: 'pointer', fontWeight: 700 }}
                      >
                        {schedules.map((s) => {
                          const st = getScheduleBookingState(s);
                          const disabledOpt = !st.isBookable || Number(s.sisa_kursi) <= 0;
                          return (
                            <option key={s.id} value={s.id} disabled={disabledOpt}>
                              {s.asal_kota} → {s.tujuan_kota} | {s.nama_bus} ({formatTanggalSingkat(s.tanggal_berangkat)} {formatJam(s.jam_berangkat)} WIB) — Rp{' '}
                              {(parseInt(String(s.harga), 10) || 0).toLocaleString('id-ID')}{' '}
                              {disabledOpt ? `[${!st.isBookable ? st.shortBadgeText : 'Penuh'}]` : `[Sisa ${s.sisa_kursi} kursi]`}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {activeSchedule && !isScheduleBookable && (
                      <div style={{ padding: '0.6rem 0.75rem', borderRadius: '0.6rem', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.72rem', fontWeight: 800 }}>
                        ⚠ {activeScheduleState?.badgeText || 'Jadwal tidak tersedia'} — Silakan pilih jadwal bus lain yang belum berangkat.
                      </div>
                    )}

                    {/* Jumlah Penumpang (Kursi Acak Sistem, Tanpa Pilih Denah Kursi) */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.35rem' }}>
                        Jumlah Penumpang (Nomor Kursi Ditetapkan Otomatis oleh Sistem)
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.45rem' }}>
                        {[1, 2, 3, 4].map((num) => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => setPassengerCount(num)}
                            style={{
                              padding: '0.5rem',
                              borderRadius: '0.55rem',
                              border: passengerCount === num ? '2px solid #f97316' : '1px solid #cbd5e1',
                              background: passengerCount === num ? '#fff7ed' : '#ffffff',
                              color: passengerCount === num ? '#c2410c' : '#334155',
                              fontWeight: 800,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                            }}
                          >
                            {num} Orang
                          </button>
                        ))}
                      </div>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.68rem', color: '#64748b' }}>
                        ✓ Anda langsung mendapatkan nomor kursi resmi saat tiket diterbitkan tanpa perlu memilih kursi terlebih dahulu.
                      </p>
                    </div>

                    {/* Data Penumpang */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                          Nama Lengkap Penumpang *
                        </label>
                        <input
                          type="text"
                          className="pkp-input"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Sesuai KTP"
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                          NIK / No. Identitas *
                        </label>
                        <input
                          type="text"
                          className="pkp-input"
                          value={nikNumber}
                          onChange={(e) => setNikNumber(e.target.value)}
                          placeholder="16 digit NIK"
                          maxLength={16}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                          Nomor WhatsApp Aktif *
                        </label>
                        <input
                          type="tel"
                          className="pkp-input"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="081234567890"
                          required
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 3: Metode Pembayaran (Midtrans vs Cash Wajib Auth) & Buat Tiket Langsung */}
              <div className="pkp-section-card">
                <div className="pkp-card-head">
                  <h3>
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#16a34a' }}>payments</span>
                    <span>3. Metode Pembayaran &amp; Buat Tiket</span>
                  </h3>
                  <span style={{ fontSize: '0.9rem', fontWeight: 900, color: '#1B4285' }}>
                    Rp {totalAmount.toLocaleString('id-ID')}
                  </span>
                </div>

                {/* Pilihan Metode Bayar: Midtrans vs Cash */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.85rem' }}>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('midtrans')}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '0.75rem',
                      border: paymentMethod === 'midtrans' ? '2px solid #1B4285' : '1.5px solid #cbd5e1',
                      background: paymentMethod === 'midtrans' ? '#eff6ff' : '#ffffff',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 900, fontSize: '0.8rem', color: '#1B4285' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>credit_score</span>
                      <span>Midtrans</span>
                    </div>
                    <div style={{ fontSize: '0.66rem', color: '#475569', marginTop: '0.2rem', lineHeight: 1.35 }}>
                      Bayar instan lewat QRIS, Virtual Account, atau E-Wallet.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '0.75rem',
                      border: paymentMethod === 'cash' ? '2px solid #16a34a' : '1.5px solid #cbd5e1',
                      background: paymentMethod === 'cash' ? '#ecfdf5' : '#ffffff',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 900, fontSize: '0.8rem', color: '#15803d' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>local_atm</span>
                      <span>Cash Langsung</span>
                    </div>
                    <div style={{ fontSize: '0.66rem', color: '#475569', marginTop: '0.2rem', lineHeight: 1.35 }}>
                      Bayar tunai langsung saat naik bus • <b>Wajib Login / Auth</b>.
                    </div>
                  </button>
                </div>

                {/* Peringatan Autentikasi Wajib (Khususnya untuk Cash / Belum Login) */}
                {!isAuthenticated && (
                  <div
                    style={{
                      padding: '0.75rem 0.9rem',
                      borderRadius: '0.75rem',
                      background: paymentMethod === 'cash' ? '#fef3c7' : '#eff6ff',
                      border: `1.5px solid ${paymentMethod === 'cash' ? '#f59e0b' : '#93c5fd'}`,
                      color: paymentMethod === 'cash' ? '#92400e' : '#1e3a8a',
                      marginBottom: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.6rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.74rem', fontWeight: 800 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>lock_person</span>
                      <span>
                        {paymentMethod === 'cash'
                          ? 'Pembayaran Cash mewajibkan Login / Auth (Google / Email) terlebih dahulu!'
                          : 'Silakan Login terlebih dahulu untuk menerbitkan E-Ticket Anda.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('login')}
                      className="pkp-btn-primary"
                      style={{ background: '#1B4285', padding: '0.45rem 0.9rem', fontSize: '0.72rem' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>login</span>
                      <span>Login Sekarang</span>
                    </button>
                  </div>
                )}

                {/* Ringkasan Harga */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.7rem',
                    padding: '0.7rem 0.85rem',
                    marginBottom: '0.85rem',
                    fontSize: '0.74rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#475569' }}>Tarif ({passengerCount} penumpang × Rp {farePerPerson.toLocaleString('id-ID')})</span>
                    <strong>Rp {totalAmount.toLocaleString('id-ID')}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#475569' }}>Layanan Penjemputan Pinggir Jalan Raya (GPS)</span>
                    <strong style={{ color: '#16a34a' }}>GRATIS (Rp 0)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: '0.35rem' }}>
                    <span style={{ fontWeight: 800, color: '#0f172a' }}>Total Pembayaran</span>
                    <strong style={{ color: '#1B4285', fontSize: '0.9rem' }}>Rp {totalAmount.toLocaleString('id-ID')}</strong>
                  </div>
                </div>

                {/* Tombol Buat Tiket Langsung */}
                <button
                  type="submit"
                  disabled={isSubmitting || !isScheduleBookable || !isAuthenticated}
                  className="pkp-btn-primary"
                  style={{
                    width: '100%',
                    padding: '0.82rem 1rem',
                    fontSize: '0.82rem',
                    borderRadius: '0.75rem',
                    background:
                      !isScheduleBookable || !isAuthenticated
                        ? '#94a3b8'
                        : paymentMethod === 'cash'
                        ? '#16a34a'
                        : '#1B4285',
                    cursor: !isScheduleBookable || !isAuthenticated || isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                    {paymentMethod === 'cash' ? 'confirmation_number' : 'payments'}
                  </span>
                  <span>
                    {!isAuthenticated
                      ? paymentMethod === 'cash'
                        ? 'Login Terlebih Dahulu untuk Bayar Cash'
                        : 'Login Terlebih Dahulu untuk Pesan Tiket'
                      : !isScheduleBookable
                      ? 'Jadwal Tidak Tersedia / Bus Sudah Berangkat'
                      : isSubmitting
                      ? 'Menerbitkan Tiket Titik Jemput...'
                      : paymentMethod === 'cash'
                      ? 'Buat E-Ticket Sekarang (Bayar Cash saat Naik)'
                      : 'Buat Tiket & Bayar via Midtrans'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB 2: PANTAU STATUS PENJEMPUTAN AKTIF
            ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'track' && (
          <>
            <div className="pkp-toolbar-card">
              <div className="pkp-search-box">
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#64748b' }}>search</span>
                <input
                  type="text"
                  value={searchBooking}
                  onChange={(e) => setSearchBooking(e.target.value)}
                  placeholder="Cari kode booking, nama customer, atau nama jalan penjemputan..."
                />
              </div>

              <div className="pkp-status-pills">
                <button
                  type="button"
                  onClick={() => setStatusFilter('SEMUA')}
                  className={`pkp-filter-pill ${statusFilter === 'SEMUA' ? 'active' : ''}`}
                >
                  Semua ({requests.length})
                </button>
                {ALL_STATUSES.map((st) => {
                  const count = requests.filter((r) => r.status_penjemputan === st).length;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`pkp-filter-pill ${statusFilter === st ? 'active' : ''}`}
                    >
                      {st} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pkp-main-grid">
              {/* KOLOM KIRI: Daftar Penumpang yang Akan Dijemput */}
              <div className="pkp-list-col">
                <div className="pkp-section-card">
                  <div className="pkp-card-head">
                    <h3>
                      <span className="material-symbols-outlined" style={{ fontSize: '19px', color: '#1B4285' }}>
                        format_list_bulleted
                      </span>
                      <span>Daftar Titik Penjemputan</span>
                    </h3>
                    <button type="button" onClick={() => void loadRequests()} className="pkp-refresh-mini">
                      <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>sync</span>
                      <span>Refresh</span>
                    </button>
                  </div>

                  {isLoadingReqs ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
                      Memuat data penjemputan...
                    </div>
                  ) : filteredRequests.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                      <p style={{ fontWeight: 700, margin: '0 0 0.75rem 0' }}>Tidak ada data penjemputan pada filter ini.</p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('order')}
                        className="pkp-btn-primary"
                      >
                        Pesan Tiket Titik Jemput Sekarang
                      </button>
                    </div>
                  ) : (
                    <div className="pkp-req-list">
                      {filteredRequests.map((item) => {
                        const badge = statusBadgeStyle(item.status_penjemputan);
                        const isSelected = selectedReq?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            onClick={() => setSelectedReq(item)}
                            className={`pkp-req-item ${isSelected ? 'selected' : ''}`}
                          >
                            <div className="pkp-req-top">
                              <span className="pkp-booking-tag">#{item.kode_booking}</span>
                              <span
                                className="pkp-status-badge"
                                style={{
                                  background: badge.bg,
                                  color: badge.color,
                                  borderColor: badge.border,
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>{badge.icon}</span>
                                <span>{item.status_penjemputan}</span>
                              </span>
                            </div>

                            <h4 className="pkp-req-loc-title">{item.nama_lokasi}</h4>
                            <p className="pkp-req-address">{item.alamat_lengkap}</p>

                            <div className="pkp-req-meta-row">
                              <span>
                                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>person</span>
                                {item.nama_customer} (Kursi {item.nomor_kursi})
                              </span>
                              <span>
                                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>schedule</span>
                                Est. Tiba: <b>{item.estimasi_bus_tiba}</b>
                              </span>
                            </div>

                            <div className="pkp-req-route-bar">
                              <span>{item.nama_bus} ({item.plat_nomor})</span>
                              <strong>{item.rute_asal} &rarr; {item.rute_tujuan}</strong>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* KOLOM KANAN: Peta Lokasi & Detail */}
              <div className="pkp-detail-col">
                <div className="pkp-section-card">
                  <div className="pkp-card-head">
                    <h3>
                      <span className="material-symbols-outlined" style={{ fontSize: '19px', color: '#f97316' }}>map</span>
                      <span>Peta Koordinat GPS Penjemputan</span>
                    </h3>
                    {selectedReq && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${selectedReq.lat},${selectedReq.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pkp-gmaps-nav-btn"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>navigation</span>
                        <span>Navigasi Google Maps</span>
                      </a>
                    )}
                  </div>

                  <div ref={trackMapElRef} className="pkp-map-canvas" />

                  {selectedReq && (
                    <div className="pkp-coord-bar">
                      <span>
                        Koordinat GPS: <b>{selectedReq.lat.toFixed(5)}, {selectedReq.lng.toFixed(5)}</b>
                      </span>
                      <span>
                        Biaya Jemput: <b>{selectedReq.biaya_tambahan > 0 ? `Rp ${selectedReq.biaya_tambahan.toLocaleString('id-ID')}` : 'Gratis (Rp 0)'}</b>
                      </span>
                    </div>
                  )}
                </div>

                {selectedReq && (
                  <div className="pkp-section-card">
                    <div className="pkp-card-head">
                      <div>
                        <span className="pkp-sub-kicker">DETAIL PENJEMPUTAN #{selectedReq.kode_booking}</span>
                        <h3 style={{ marginTop: '0.15rem' }}>{selectedReq.nama_lokasi}</h3>
                      </div>
                      <span
                        className="pkp-status-badge"
                        style={{
                          background: statusBadgeStyle(selectedReq.status_penjemputan).bg,
                          color: statusBadgeStyle(selectedReq.status_penjemputan).color,
                          borderColor: statusBadgeStyle(selectedReq.status_penjemputan).border,
                        }}
                      >
                        {selectedReq.status_penjemputan}
                      </span>
                    </div>

                    <div className="pkp-stepper-track">
                      {ALL_STATUSES.filter((s) => s !== 'Ditolak' || selectedReq.status_penjemputan === 'Ditolak').map((st, idx) => {
                        const isDone =
                          selectedReq.status_penjemputan === 'Ditolak'
                            ? st === 'Ditolak'
                            : ALL_STATUSES.indexOf(st) <= currentStepIndex;
                        const isCurrent = selectedReq.status_penjemputan === st;
                        return (
                          <div key={st} className={`pkp-step-box ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
                            <div className="pkp-step-circle">{idx + 1}</div>
                            <span>{st}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pkp-info-grid">
                      <div className="pkp-info-cell">
                        <span className="lbl">Nama Customer &amp; Kursi Otomatis</span>
                        <strong>{selectedReq.nama_customer} (Kursi {selectedReq.nomor_kursi})</strong>
                        <small>WhatsApp: {selectedReq.no_hp}</small>
                      </div>
                      <div className="pkp-info-cell">
                        <span className="lbl">Armada &amp; Rute</span>
                        <strong>{selectedReq.nama_bus}</strong>
                        <small>{selectedReq.plat_nomor} • {selectedReq.rute_asal} &rarr; {selectedReq.rute_tujuan}</small>
                      </div>
                      <div className="pkp-info-cell">
                        <span className="lbl">Estimasi Bus Tiba di Titik</span>
                        <strong style={{ color: '#f97316' }}>{selectedReq.estimasi_bus_tiba}</strong>
                        <small>{selectedReq.kategori_lokasi}</small>
                      </div>
                      <div className="pkp-info-cell">
                        <span className="lbl">Catatan Customer</span>
                        <strong>{selectedReq.catatan_customer || 'Tidak ada catatan khusus'}</strong>
                        <small>{selectedReq.alamat_lengkap}</small>
                      </div>
                    </div>

                    <div className="pkp-role-action-box">
                      <h4>
                        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#1B4285' }}>info</span>
                        <span>Panduan Penjemputan Pinggir Jalan Raya</span>
                      </h4>
                      <p style={{ fontSize: '0.74rem', color: '#475569', margin: '0 0 0.75rem 0', lineHeight: 1.45 }}>
                        Harap sudah menunggu di <b>{selectedReq.nama_lokasi}</b> minimal <b>15 menit sebelum {selectedReq.estimasi_bus_tiba}</b> di pinggir jalan raya yang mudah terlihat oleh pengemudi bus.
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                        <button
                          type="button"
                          onClick={() => onNavigate('ticket', { bookingCode: selectedReq.kode_booking })}
                          className="pkp-btn-primary"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>qr_code</span>
                          <span>Buka E-Ticket &amp; QR Boarding</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('order')}
                          className="pkp-btn-outline"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add_location_alt</span>
                          <span>Pesan Titik Jemput Baru</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
