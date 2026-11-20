import { useState, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Navbar from '../components/Navbar';
import '../Style/jadwal.css';
import logoNavbar from '../assets/LogoNavbar.png';
import { tomtomApi, type TerminalDirectoryItem } from '../services/auth-location';
import { SETTINGS_EVENT, getSavedTheme, type ThemeMode } from '../utils/userSettings';
import rawTerminalsJson from '../data/terminal.json';
import rawBusJson from '../data/bus.json';

const TOMTOM_API_KEY = 'CAymKPlDKfwMYMLZgTzBbkhkiwO3gUT2';

interface JadwalProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

interface RawBusOperator {
  id: number;
  nama_po: string;
  wilayah: string;
  jenis_layanan: string;
  kategori: string;
  status: string;
}

interface TerminalLocation {
  id: number;
  slug: string;
  namaKota: string;
  provinsi: string;
  tipeTerminal: string;
  namaTerminal: string;
  alamat: string;
  jamOperasional: string;
  lat: number;
  lng: number;
  googleMapsUrl: string;
  fasilitas: string[];
  poOperators: string[];
  tomtomVerified?: boolean;
  poiName?: string | null;
}

interface RouteCheckpoint {
  title: string;
  desc: string;
  time: string;
  isRest?: boolean;
  isEst?: boolean;
  isFinal?: boolean;
}

function getLocalOperatorsForRegion(provinsi: string, kota: string): string[] {
  const prov = provinsi.toLowerCase();
  const city = kota.toLowerCase();
  const isJabodetabek =
    prov.includes('jakarta') ||
    city.includes('bogor') ||
    city.includes('depok') ||
    city.includes('tangerang') ||
    city.includes('bekasi');
  const isSumatera =
    prov.includes('sumatera') ||
    prov.includes('aceh') ||
    prov.includes('riau') ||
    prov.includes('jambi') ||
    prov.includes('lampung') ||
    prov.includes('bengkulu');

  return (rawBusJson as RawBusOperator[])
    .filter((op) => {
      const w = op.wilayah.toLowerCase();
      if (w === 'seluruh indonesia') return true;
      if (w === prov) return true;
      if (isJabodetabek && (w === 'jabodetabek' || w === 'dki jakarta')) return true;
      if (isSumatera && w === 'sumatera') return true;
      return false;
    })
    .map((op) => op.nama_po);
}

function mapRawToTerminalLocation(item: TerminalDirectoryItem): TerminalLocation {
  const lat = typeof item.latitude === 'number' ? item.latitude : -6.21345;
  const lng = typeof item.longitude === 'number' ? item.longitude : 106.95325;
  const prov = item.provinsi || 'Indonesia';
  const kota = item.kota_kabupaten || prov;
  return {
    id: item.id,
    slug: `term-${item.id}`,
    namaKota: kota,
    provinsi: prov,
    tipeTerminal: item.tipe_terminal || 'Tipe A',
    namaTerminal: item.nama_terminal,
    alamat: item.alamat || `${item.nama_terminal}, ${kota}, ${prov}`,
    jamOperasional: item.jam_operasional || '24 Jam Nonstop',
    lat,
    lng,
    googleMapsUrl: item.google_maps_url || `https://maps.google.com/?q=${lat},${lng}`,
    fasilitas:
      Array.isArray(item.fasilitas) && item.fasilitas.length > 0
        ? item.fasilitas
        : ['Loket Tiket AKAP Resmi', 'Ruang Tunggu Penumpang', 'Musholla & Toilet', 'Area Parkir'],
    poOperators:
      Array.isArray(item.po_operators) && item.po_operators.length > 0
        ? item.po_operators
        : getLocalOperatorsForRegion(prov, kota),
    poiName: item.poi_name || null,
  };
}

const INITIAL_TERMINAL_LIST: TerminalLocation[] = (rawTerminalsJson as TerminalDirectoryItem[])
  .filter((t) => (t.status || 'aktif').toLowerCase() === 'aktif')
  .map(mapRawToTerminalLocation);

const CITY_ALIASES: Record<string, string[]> = {
  jakarta: ['pulo gebang', 'jakarta timur', 'dki jakarta'],
  surabaya: ['purabaya', 'bungurasih', 'osowilangun', 'sidoarjo'],
  solo: ['tirtonadi', 'surakarta'],
  jogja: ['giwangan', 'yogyakarta'],
  yogyakarta: ['giwangan', 'yogyakarta'],
  bandung: ['leuwipanjang', 'cicaheum', 'bandung'],
  semarang: ['mangkang', 'semarang'],
  bali: ['mengwi', 'ubung', 'denpasar'],
};

function findTerminalInList(route: string, list: TerminalLocation[]): TerminalLocation | undefined {
  const normalized = route.trim().toLowerCase();
  if (!normalized) return undefined;

  // 1. Exact/substring match terhadap nama terminal
  const byName = list.find((t) => normalized.includes(t.namaTerminal.toLowerCase()));
  if (byName) return byName;

  // 2. Match nama terminal tanpa kata "terminal "
  const byShortName = list.find((t) => {
    const shortName = t.namaTerminal.toLowerCase().replace(/^terminal\s+/, '').trim();
    return shortName.length >= 3 && normalized.includes(shortName);
  });
  if (byShortName) return byShortName;

  // 3. Match kota/kabupaten
  const byCity = list.find((t) => normalized.includes(t.namaKota.toLowerCase()));
  if (byCity) return byCity;

  // 4. Match alias kota populer (Jakarta, Surabaya, Solo, Jogja, Bali)
  for (const [alias, targets] of Object.entries(CITY_ALIASES)) {
    if (normalized.includes(alias)) {
      const matched = list.find((t) =>
        targets.some(
          (kw) =>
            t.namaTerminal.toLowerCase().includes(kw) ||
            t.namaKota.toLowerCase().includes(kw) ||
            t.provinsi.toLowerCase().includes(kw)
        )
      );
      if (matched) return matched;
    }
  }

  // 5. Match provinsi
  return list.find((t) => normalized.includes(t.provinsi.toLowerCase()));
}

function getTomTomTileUrl(theme: ThemeMode): string {
  const style = theme === 'dark' ? 'night' : 'main';
  return `https://api.tomtom.com/map/1/tile/basic/${style}/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}&tileSize=256&view=Unified`;
}

function attachTomTomBaseLayer(map: L.Map, theme: ThemeMode): L.TileLayer {
  const tomtomLayer = L.tileLayer(getTomTomTileUrl(theme), {
    maxZoom: 19,
    attribution: '© TomTom Maps',
  });
  let fallbackAdded = false;
  tomtomLayer.on('tileerror', () => {
    if (fallbackAdded) return;
    fallbackAdded = true;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);
  });
  tomtomLayer.addTo(map);
  return tomtomLayer;
}

// Helper tambah menit ke jam "07:00"
function addMinutesToTime(baseTime: string, addMinutes: number): string {
  const [hh, mm] = baseTime.split(':').map(Number);
  const total = ((hh * 60 + mm + Math.round(addMinutes)) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m} WIB`;
}

function buildCheckpoints(
  originRoute: string,
  destRoute: string,
  originTerm: TerminalLocation,
  destTerm: TerminalLocation,
  travelTimeMinutes: number,
  travelTimeFormatted: string
): RouteCheckpoint[] {
  const isWestbound = originTerm.lng > destTerm.lng;
  const totalMins = travelTimeMinutes > 0 ? travelTimeMinutes : 600;
  const baseDepart = '07:00';
  const originLabel = originRoute.includes(' - ')
    ? originRoute.split(' - ').slice(1).join(' - ').trim()
    : originTerm.namaTerminal;
  const destLabel = destRoute.includes(' - ')
    ? destRoute.split(' - ').slice(1).join(' - ').trim()
    : destTerm.namaTerminal;

  return [
    {
      title: originLabel || originTerm.namaTerminal,
      desc: `Titik Keberangkatan Awal (${originTerm.namaKota}, ${originTerm.provinsi}) • Boarding & Validasi Tiket 30 Menit Sebelum Berangkat`,
      time: `${baseDepart} WIB`,
    },
    {
      title: isWestbound
        ? `Gerbang Tol / Jalur Utama ${originTerm.namaKota} (Arah Barat)`
        : `Gerbang Tol / Jalur Utama ${originTerm.namaKota} (Arah Timur)`,
      desc: `Jalur Utama Antarkota Express dari ${originTerm.namaKota} menuju ${destTerm.namaKota}`,
      time: addMinutesToTime(baseDepart, totalMins * 0.15),
      isEst: true,
    },
    {
      title: 'Rest Area / Titik Servis Makan Resmi',
      desc: 'Istirahat 30 Menit • Fasilitas Prasmanan, Musholla, & Toilet Bersih',
      time: addMinutesToTime(baseDepart, totalMins * 0.48),
      isRest: true,
    },
    {
      title: `Simpul Transit & Akses Menuju ${destTerm.namaKota}`,
      desc: `Penurunan Penumpang Area Penyangga menuju ${destTerm.namaTerminal} (${destTerm.provinsi})`,
      time: addMinutesToTime(baseDepart, totalMins * 0.8),
      isEst: true,
    },
    {
      title: destLabel || destTerm.namaTerminal,
      desc: `Kedatangan Akhir di ${destTerm.namaKota}, ${destTerm.provinsi} (~${addMinutesToTime(
        baseDepart,
        totalMins
      )}) • Area Drop-Zone Terminal`,
      time: `Estimasi: ${travelTimeFormatted}`,
      isFinal: true,
    },
  ];
}

export default function Jadwal({ onNavigate }: JadwalProps) {
  // Daftar lengkap 75 terminal dari terminal.json + API /api/terminals
  const [terminals, setTerminals] = useState<TerminalLocation[]>(INITIAL_TERMINAL_LIST);
  const [terminalSearch, setTerminalSearch] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('Semua');
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());

  // State Input Form
  const [userName, setUserName] = useState('');
  const [userNis, setUserNis] = useState('');
  const [currentRoute, setCurrentRoute] = useState('Jakarta Timur - Terminal Pulo Gebang');
  const [destinationRoute, setDestinationRoute] = useState('Sidoarjo - Terminal Purabaya (Bungurasih)');
  const [departureDate, setDepartureDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [busClass, setBusClass] = useState('Eksekutif');

  // Selected Terminal Location untuk direktori + peta TomTom
  const [selectedTerminalId, setSelectedTerminalId] = useState<number>(INITIAL_TERMINAL_LIST[0]?.id || 1);
  const [isResolvingTerminal, setIsResolvingTerminal] = useState(false);
  const [terminalGeoSource, setTerminalGeoSource] = useState<'tomtom-search' | 'terminal-json'>('terminal-json');
  const [showTrafficLayer, setShowTrafficLayer] = useState(false);

  // Titik jalur rute dari TomTom ([lat, lng]) untuk digambar di peta rute utama
  const [routePoints, setRoutePoints] = useState<[number, number][]>([]);

  // Peta Rute Utama (Leaflet + TomTom Maps Tiles)
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeTileRef = useRef<L.TileLayer | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);

  // Peta Denah Lokasi Terminal (Leaflet + TomTom Maps Tiles + Terminal Pin)
  const terminalMapElRef = useRef<HTMLDivElement>(null);
  const terminalMapRef = useRef<L.Map | null>(null);
  const terminalTileRef = useRef<L.TileLayer | null>(null);
  const terminalTrafficRef = useRef<L.TileLayer | null>(null);
  const terminalMarkerLayerRef = useRef<L.LayerGroup | null>(null);
  const resolvedIdsRef = useRef<Set<number>>(new Set());

  // TomTom Routing Real-Time Data
  const [routeStats, setRouteStats] = useState<{
    distanceKm: number;
    travelTimeMinutes: number;
    travelTimeFormatted: string;
    trafficCondition: string;
    source: string;
  }>({
    distanceKm: 785,
    travelTimeMinutes: 630,
    travelTimeFormatted: '10 jam 30 menit',
    trafficCondition: 'Ramai Lancar • Tol Trans-Jawa 85 km/jam',
    source: 'TomTom Routing',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Sinkronisasi tema gelap/terang agar TomTom Maps otomatis berganti style main/night
  useEffect(() => {
    const syncTheme = () => setTheme(getSavedTheme());
    window.addEventListener(SETTINGS_EVENT, syncTheme);
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, syncTheme);
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  // Ambil daftar terminal dari backend API /api/terminals (sumber: app/terminal.json)
  useEffect(() => {
    let cancelled = false;
    tomtomApi
      .getTerminals()
      .then((res) => {
        if (!cancelled && res?.success && Array.isArray(res.terminals) && res.terminals.length > 0) {
          setTerminals(res.terminals.map(mapRawToTerminalLocation));
        }
      })
      .catch(() => {
        // Tetap gunakan fallback INITIAL_TERMINAL_LIST dari data/terminal.json
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Daftar provinsi unik + jumlah terminalnya
  const provinceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    terminals.forEach((t) => {
      counts.set(t.provinsi, (counts.get(t.provinsi) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], 'id'));
  }, [terminals]);

  // Filter terminal berdasarkan pencarian & provinsi
  const filteredTerminals = useMemo(() => {
    const q = terminalSearch.trim().toLowerCase();
    return terminals.filter((t) => {
      if (selectedProvince !== 'Semua' && t.provinsi !== selectedProvince) {
        return false;
      }
      if (!q) return true;
      return (
        t.namaTerminal.toLowerCase().includes(q) ||
        t.namaKota.toLowerCase().includes(q) ||
        t.provinsi.toLowerCase().includes(q) ||
        t.alamat.toLowerCase().includes(q)
      );
    });
  }, [terminals, terminalSearch, selectedProvince]);

  const selectedTerminal = useMemo(() => {
    return terminals.find((t) => t.id === selectedTerminalId) || filteredTerminals[0] || terminals[0];
  }, [terminals, selectedTerminalId, filteredTerminals]);

  // Resolusi titik lokasi terminal secara real-time melalui TomTom Maps Search API
  useEffect(() => {
    if (!selectedTerminal) return;
    if (resolvedIdsRef.current.has(selectedTerminal.id)) {
      setTerminalGeoSource(selectedTerminal.tomtomVerified ? 'tomtom-search' : 'terminal-json');
      return;
    }

    let cancelled = false;
    setIsResolvingTerminal(true);

    const applyResolved = (
      id: number,
      lat: number,
      lng: number,
      alamat: string | undefined,
      source: 'tomtom-search' | 'terminal-json',
      poiName?: string | null
    ) => {
      if (cancelled) return;
      resolvedIdsRef.current.add(id);
      setTerminalGeoSource(source);
      setTerminals((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                lat,
                lng,
                alamat: alamat || item.alamat,
                googleMapsUrl: `https://maps.google.com/?q=${lat},${lng}`,
                tomtomVerified: source === 'tomtom-search',
                poiName: poiName ?? item.poiName,
              }
            : item
        )
      );
    };

    tomtomApi
      .resolveTerminalLocation(selectedTerminal.id)
      .then((res) => {
        if (res?.success && res.terminal) {
          applyResolved(
            selectedTerminal.id,
            res.terminal.latitude,
            res.terminal.longitude,
            res.terminal.alamat,
            res.source,
            res.terminal.poi_name
          );
          return;
        }
        throw new Error('empty');
      })
      .catch(async () => {
        // Fallback langsung ke TomTom Search API dari browser jika backend offline
        try {
          const query = `${selectedTerminal.namaTerminal} ${selectedTerminal.namaKota} ${selectedTerminal.provinsi} Indonesia`;
          const ttUrl = `https://api.tomtom.com/search/2/search/${encodeURIComponent(
            query
          )}.json?key=${TOMTOM_API_KEY}&countrySet=ID&limit=2&language=id-ID`;
          const r = await fetch(ttUrl);
          if (r.ok) {
            const json = await r.json();
            const first = json?.results?.[0];
            if (first?.position) {
              applyResolved(
                selectedTerminal.id,
                Number(first.position.lat.toFixed(6)),
                Number(first.position.lon.toFixed(6)),
                first.address?.freeformAddress || selectedTerminal.alamat,
                'tomtom-search',
                first.poi?.name || null
              );
              return;
            }
          }
        } catch {
          // Gunakan koordinat bawaan terminal.json
        }
        applyResolved(
          selectedTerminal.id,
          selectedTerminal.lat,
          selectedTerminal.lng,
          selectedTerminal.alamat,
          'terminal-json'
        );
      })
      .finally(() => {
        if (!cancelled) setIsResolvingTerminal(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTerminal?.id]);

  const originTermObj = useMemo(
    () => findTerminalInList(currentRoute, terminals) || terminals[0],
    [currentRoute, terminals]
  );
  const destTermObj = useMemo(
    () =>
      findTerminalInList(destinationRoute, terminals) ||
      terminals.find((t) => t.id === 21) ||
      terminals[1] ||
      terminals[0],
    [destinationRoute, terminals]
  );

  const checkpoints = useMemo(
    () =>
      buildCheckpoints(
        currentRoute,
        destinationRoute,
        originTermObj,
        destTermObj,
        routeStats.travelTimeMinutes,
        routeStats.travelTimeFormatted
      ),
    [currentRoute, destinationRoute, originTermObj, destTermObj, routeStats.travelTimeMinutes, routeStats.travelTimeFormatted]
  );

  // Ambil data kalkulasi rute TomTom setiap kali rute asal/tujuan berubah
  useEffect(() => {
    if (!originTermObj || !destTermObj) return;
    const originCoord = `${originTermObj.lat},${originTermObj.lng}`;
    const destCoord = `${destTermObj.lat},${destTermObj.lng}`;

    tomtomApi
      .calculateRoute(originCoord, destCoord)
      .then((res) => {
        if (res && res.distanceKm) {
          setRouteStats({
            distanceKm: res.distanceKm,
            travelTimeMinutes: res.travelTimeMinutes || Math.round((res.distanceKm / 75) * 60),
            travelTimeFormatted: res.travelTimeFormatted,
            trafficCondition: res.trafficCondition,
            source: res.source,
          });
          setRoutePoints(res.points || []);
        }
      })
      .catch((err) => {
        console.warn('TomTom route calc fallback:', err);
      });
  }, [originTermObj.id, originTermObj.lat, originTermObj.lng, destTermObj.id, destTermObj.lat, destTermObj.lng]);

  // Inisialisasi Peta Rute Utama (TomTom Maps Tiles)
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { attributionControl: false }).setView([-6.8, 109.5], 5);
    routeTileRef.current = attachTomTomBaseLayer(map, theme);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      routeTileRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

  // Update TomTom Map Tile style (main/night) saat mode terang/gelap berubah
  useEffect(() => {
    if (mapRef.current && routeTileRef.current) {
      routeTileRef.current.setUrl(getTomTomTileUrl(theme));
    }
    if (terminalMapRef.current && terminalTileRef.current) {
      terminalTileRef.current.setUrl(getTomTomTileUrl(theme));
    }
  }, [theme]);

  // Gambar rute + titik (asal, tujuan, titik henti) pada peta rute utama
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer || !originTermObj || !destTermObj) return;

    layer.clearLayers();

    const start: [number, number] = [originTermObj.lat, originTermObj.lng];
    const end: [number, number] = [destTermObj.lat, destTermObj.lng];
    const line = routePoints.length > 1 ? routePoints : [start, end];

    L.polyline(line, { color: '#2563eb', weight: 4, opacity: 0.9 }).addTo(layer);

    const dot = (color: string) =>
      L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

    L.marker(start, { icon: dot('#16a34a') })
      .bindPopup(`<b>Titik Asal (${originTermObj.namaKota})</b><br>${originTermObj.namaTerminal}`)
      .addTo(layer);
    L.marker(end, { icon: dot('#dc2626') })
      .bindPopup(`<b>Titik Tujuan (${destTermObj.namaKota})</b><br>${destTermObj.namaTerminal}`)
      .addTo(layer);

    const stopDetails = [checkpoints[1], checkpoints[2], checkpoints[3]];
    [0.25, 0.5, 0.75].forEach((fraction, i) => {
      const idx = Math.min(line.length - 1, Math.max(0, Math.floor(line.length * fraction)));
      const [lat, lng] = line[idx];
      const cpInfo = stopDetails[i];
      L.marker([lat, lng], { icon: dot('#f59e0b') })
        .bindPopup(
          `<b>Titik Singgah ${i + 2}: ${cpInfo?.title || 'Rest Area'}</b><br>${cpInfo?.desc || ''}<br><small>${
            cpInfo?.time || ''
          }</small>`
        )
        .addTo(layer);
    });

    map.fitBounds(L.latLngBounds(line.map(([lat, lng]) => L.latLng(lat, lng))), {
      padding: [28, 28],
    });
  }, [originTermObj, destTermObj, routePoints, checkpoints]);

  // Inisialisasi Peta Denah Lokasi Terminal (TomTom Maps Tiles + Pin Lokasi Terminal)
  useEffect(() => {
    if (!terminalMapElRef.current || terminalMapRef.current || !selectedTerminal) return;
    const map = L.map(terminalMapElRef.current, {
      attributionControl: false,
      zoomControl: true,
    }).setView([selectedTerminal.lat, selectedTerminal.lng], 15);

    terminalTileRef.current = attachTomTomBaseLayer(map, theme);
    terminalMarkerLayerRef.current = L.layerGroup().addTo(map);
    terminalMapRef.current = map;

    return () => {
      map.remove();
      terminalMapRef.current = null;
      terminalTileRef.current = null;
      terminalTrafficRef.current = null;
      terminalMarkerLayerRef.current = null;
    };
  }, []);

  // Toggle TomTom Traffic Flow Overlay pada peta denah terminal
  useEffect(() => {
    const map = terminalMapRef.current;
    if (!map) return;

    if (showTrafficLayer) {
      if (!terminalTrafficRef.current) {
        terminalTrafficRef.current = L.tileLayer(
          `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`,
          { maxZoom: 19, opacity: 0.75 }
        ).addTo(map);
      }
    } else if (terminalTrafficRef.current) {
      map.removeLayer(terminalTrafficRef.current);
      terminalTrafficRef.current = null;
    }
  }, [showTrafficLayer]);

  // Update posisi & pin marker pada peta denah terminal setiap kali terminal dipilih / koordinat TomTom ter-resolve
  useEffect(() => {
    const map = terminalMapRef.current;
    const layer = terminalMarkerLayerRef.current;
    if (!map || !layer || !selectedTerminal) return;

    layer.clearLayers();
    const pos: [number, number] = [selectedTerminal.lat, selectedTerminal.lng];

    // Radius jangkauan area terminal (150m)
    L.circle(pos, {
      radius: 140,
      color: '#FA7808',
      fillColor: '#FA7808',
      fillOpacity: 0.14,
      weight: 1.5,
      dashArray: '4 4',
    }).addTo(layer);

    // Pin Lokasi Terminal khusus
    const pinIcon = L.divIcon({
      className: 'jdw-tomtom-pin-wrap',
      html: `
        <div class="jdw-tomtom-pin-pulse"></div>
        <div class="jdw-tomtom-pin-core">
          <span class="material-symbols-outlined" style="font-size:16px;color:#fff;">directions_bus</span>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18],
    });

    const marker = L.marker(pos, { icon: pinIcon })
      .bindPopup(
        `<div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:190px;">
          <div style="font-weight:800;font-size:12.5px;color:#1B4285;margin-bottom:3px;">${selectedTerminal.namaTerminal}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:4px;">${selectedTerminal.namaKota}, ${selectedTerminal.provinsi}</div>
          <div style="font-size:10.5px;color:#64748b;line-height:1.35;">${selectedTerminal.alamat}</div>
          <div style="margin-top:5px;font-size:10px;font-weight:700;color:#FA7808;">📍 ${selectedTerminal.lat.toFixed(5)}, ${selectedTerminal.lng.toFixed(5)}</div>
        </div>`
      )
      .addTo(layer);

    map.flyTo(pos, 15, { duration: 0.65 });
    marker.openPopup();
  }, [selectedTerminal?.id, selectedTerminal?.lat, selectedTerminal?.lng, selectedTerminal?.alamat]);

  const handleRecenterTerminalMap = () => {
    if (!terminalMapRef.current || !selectedTerminal) return;
    terminalMapRef.current.flyTo([selectedTerminal.lat, selectedTerminal.lng], 16, { duration: 0.5 });
  };

  const handleSwapRoute = () => {
    const temp = currentRoute;
    setCurrentRoute(destinationRoute);
    setDestinationRoute(temp);
  };

  const handleSetAsOrigin = (term: TerminalLocation) => {
    setCurrentRoute(`${term.namaKota} - ${term.namaTerminal}`);
    setSuccessToast(`${term.namaTerminal} (${term.namaKota}) dipilih sebagai Titik Asal`);
    setTimeout(() => setSuccessToast(null), 2500);
  };

  const handleSetAsDestination = (term: TerminalLocation) => {
    setDestinationRoute(`${term.namaKota} - ${term.namaTerminal}`);
    setSuccessToast(`${term.namaTerminal} (${term.namaKota}) dipilih sebagai Titik Tujuan`);
    setTimeout(() => setSuccessToast(null), 2500);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = userName.trim();
    const trimmedNik = userNis.trim();
    setIsSubmitting(true);

    try {
      localStorage.setItem(
        'govia_route_filter',
        JSON.stringify({
          asal_kota: originTermObj.namaKota,
          asal_terminal: originTermObj.namaTerminal,
          tujuan_kota: destTermObj.namaKota,
          tujuan_terminal: destTermObj.namaTerminal,
          tanggal_berangkat: departureDate,
          kelas_layanan: busClass,
          nama_penumpang: trimmedName,
          no_identitas: trimmedNik,
        })
      );
    } catch {
      /* ignore */
    }

    if (!trimmedName || !trimmedNik) {
      setIsSubmitting(false);
      onNavigate('search');
      return;
    }

    try {
      const res = await fetch('/api/jadwal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama_penumpang: trimmedName,
          no_identitas: trimmedNik,
          asal_kota: currentRoute,
          tujuan_kota: destinationRoute,
          tanggal_berangkat: departureDate,
          kelas_layanan: busClass,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setSuccessToast('Data perjalanan & penumpang berhasil disimpan ke database!');
        setTimeout(() => {
          onNavigate('search');
        }, 1200);
        return;
      }
    } catch (err) {
      console.warn('Gagal koneksi langsung API jadwal:', err);
    } finally {
      setIsSubmitting(false);
      onNavigate('search');
    }
  };

  return (
    <div className="jdw-page-container">
      {/* ── HEADER NAVBAR ────────────────────────────────────────── */}
      <Navbar onNavigate={onNavigate} />

      {/* Datalist seluruh terminal dari terminal.json untuk autocomplete rute */}
      <datalist id="jdw-terminal-datalist">
        {terminals.map((t) => (
          <option key={t.id} value={`${t.namaKota} - ${t.namaTerminal}`}>
            {t.provinsi}
          </option>
        ))}
      </datalist>

      {/* Floating Success Toast */}
      {successToast && (
        <div
          style={{
            position: 'fixed',
            top: '80px',
            left: '1rem',
            right: '1rem',
            maxWidth: 'calc(100vw - 2rem)',
            marginLeft: 'auto',
            zIndex: 999,
            background: '#1B4285',
            color: '#ffffff',
            padding: '0.875rem 1.25rem',
            borderRadius: '0.75rem',
            boxShadow: '0 8px 24px rgba(0, 40, 105, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            fontSize: '0.85rem',
            fontWeight: 700,
            border: '1.5px solid #22c55e',
            animation: 'fadeIn 0.3s ease',
          }}
        >
          <span className="material-symbols-outlined" style={{ color: '#22c55e', fontSize: '20px' }}>
            check_circle
          </span>
          <span>{successToast}</span>
        </div>
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <main className="jdw-main-content">
        {/* ── 1. Hero Card ─────────────────────────────────────────── */}
        <div className="jdw-hero-card anim-fade-up">
          <div className="jdw-hero-top">
            <div className="jdw-breadcrumbs">
              <span className="cursor-pointer" onClick={() => onNavigate('search')}>
                Beranda
              </span>
              <span className="separator">&rsaquo;</span>
              <span className="active">Jadwal &amp; Rute</span>
            </div>

            <div className="jdw-live-tag">
              <span className="jdw-live-dot"></span>
              <span>Didukung TomTom Maps &amp; Routing Engine Orbis API</span>
            </div>
          </div>

          <div className="jdw-hero-body">
            <div className="jdw-hero-left">
              <span className="jdw-hero-sub-badge">DIREKTORI EKSPLORASI ANTARKOTA • {terminals.length} TERMINAL</span>
              <h1 className="jdw-hero-title">Jadwal &amp; Rute Bus Antarkota</h1>
              <p className="jdw-hero-desc">
                Cari jadwal keberangkatan bus resmi, navigasi rute TomTom Maps, titik henti rest area, dan denah lokasi{' '}
                {terminals.length} terminal bus resmi seluruh Indonesia.
              </p>
            </div>
          </div>
        </div>

        {/* ── 2. Interactive Search & Route Input Form Card ────────── */}
        <div className="jdw-search-card anim-fade-up anim-d2">
          <div className="jdw-user-info-row">
            <div className="jdw-input-box">
              <label className="jdw-input-label origin">
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                  person
                </span>
                <span>Nama Lengkap Penumpang</span>
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Masukkan Nama Lengkap"
                className="jdw-input-field"
              />
            </div>

            <div className="jdw-input-box">
              <label className="jdw-input-label dest">
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                  badge
                </span>
                <span>Nomor Induk Kependudukan (NIK) / Identitas</span>
              </label>
              <input
                type="text"
                value={userNis}
                onChange={(e) => setUserNis(e.target.value)}
                placeholder="Masukkan Nomor KTP / NIK"
                className="jdw-input-field"
              />
            </div>
          </div>

          <form onSubmit={handleSearch}>
            <div className="jdw-form-row">
              <div className="jdw-input-box">
                <label className="jdw-input-label origin">
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                    trip_origin
                  </span>
                  <span>Rute Kamu Sekarang / Kota Asal</span>
                </label>
                <input
                  type="text"
                  list="jdw-terminal-datalist"
                  value={currentRoute}
                  onChange={(e) => setCurrentRoute(e.target.value)}
                  className="jdw-input-field"
                  placeholder="Contoh: Jakarta Timur - Terminal Pulo Gebang"
                />
              </div>

              <button
                type="button"
                className="jdw-swap-btn"
                onClick={handleSwapRoute}
                title="Tukar Rute Asal dan Tujuan"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  swap_horiz
                </span>
              </button>

              <div className="jdw-input-box">
                <label className="jdw-input-label dest">
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                    location_on
                  </span>
                  <span>Rute Tujuan / Terminal Kedatangan</span>
                </label>
                <input
                  type="text"
                  list="jdw-terminal-datalist"
                  value={destinationRoute}
                  onChange={(e) => setDestinationRoute(e.target.value)}
                  className="jdw-input-field"
                  placeholder="Contoh: Sidoarjo - Terminal Purabaya (Bungurasih)"
                />
              </div>

              <div className="jdw-input-box">
                <label className="jdw-input-label">
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                    calendar_today
                  </span>
                  <span>Tanggal Berangkat</span>
                </label>
                <input
                  type="date"
                  value={departureDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="jdw-input-field"
                  style={{ cursor: 'pointer' }}
                />
              </div>

              <div className="jdw-input-box">
                <label className="jdw-input-label">
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                    airline_seat_recline_normal
                  </span>
                  <span>Kelas Layanan</span>
                </label>
                <select
                  value={busClass}
                  onChange={(e) => setBusClass(e.target.value)}
                  className="jdw-input-field"
                  style={{ cursor: 'pointer', background: 'transparent' }}
                >
                  <option value="Eksekutif">Eksekutif</option>
                  <option value="Sleeper Suite">Sleeper Suite</option>
                  <option value="Super Top">Super Top</option>
                  <option value="Bisnis AC">Bisnis AC</option>
                </select>
              </div>
            </div>

            <div className="jdw-search-card-bottom" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#1B4285', fontWeight: 700 }}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#16a34a' }}>
                  explore
                </span>
                <span>
                  TomTom Distance: ~{routeStats.distanceKm} km ({routeStats.travelTimeFormatted})
                </span>
              </div>

              <button type="submit" className="jdw-submit-btn" disabled={isSubmitting}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  {isSubmitting ? 'sync' : 'search'}
                </span>
                <span>{isSubmitting ? 'Menyimpan ke Database...' : 'Cari Jadwal & Rute'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* ── 3. Detail Lokasi Terminal & Titik Singgah Rute ────────── */}
        <div className="jdw-details-card anim-fade-up anim-d3">
          <div className="jdw-details-header">
            <h2 className="jdw-details-title">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                timeline
              </span>
              <span>Lintasan Titik Singgah &amp; Perkiraan Waktu Tempuh</span>
            </h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                className="jdw-time-zone-badge"
                style={{ background: '#ecfdf5', color: '#065f46', padding: '0.2rem 0.5rem', borderRadius: '0.35rem', border: '1px solid #a7f3d0' }}
              >
                Jarak: {routeStats.distanceKm} KM
              </span>
              <span className="jdw-time-zone-badge">Zona Waktu: WIB (UTC+7)</span>
            </div>
          </div>

          <div className="jdw-details-grid">
            <div className="jdw-checkpoints-list">
              {checkpoints.map((cp, index) => (
                <div key={index} className="jdw-checkpoint-item">
                  <div className={`jdw-checkpoint-num-box ${cp.isRest ? 'rest' : ''}`}>{index + 1}</div>
                  <div className="jdw-checkpoint-body">
                    <div className="jdw-checkpoint-info">
                      <h4 className={cp.isRest ? 'highlight-orange' : ''}>{cp.title}</h4>
                      <p>{cp.desc}</p>
                    </div>
                    <span
                      className={`jdw-checkpoint-time-badge ${
                        cp.isRest ? 'orange' : cp.isFinal ? 'final' : cp.isEst ? 'est' : ''
                      }`}
                    >
                      {cp.time}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="jdw-right-details">
              <div className="jdw-map-box">
                <div ref={mapElRef} style={{ width: '100%', height: '100%' }} />
                <div className="jdw-map-overlay-condition" style={{ zIndex: 1000 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#1e293b', fontWeight: 700 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#16a34a' }}>
                      traffic
                    </span>
                    <span>{routeStats.trafficCondition}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', fontSize: '0.62rem', fontWeight: 800 }}>
                    <span style={{ color: '#16a34a' }}>● Asal</span>
                    <span style={{ color: '#dc2626' }}>● Tujuan</span>
                    <span style={{ color: '#f59e0b' }}>● Henti</span>
                  </div>
                </div>
              </div>

              <div className="jdw-facilities-box">
                <div className="jdw-facilities-header-row">
                  <h4 className="jdw-facilities-title">Fasilitas Standar Armada Selama Perjalanan</h4>
                  <span className="jdw-facilities-cap-badge">
                    {busClass} •{' '}
                    {busClass === 'Sleeper Suite'
                      ? '20 Kursi'
                      : busClass === 'Bisnis AC'
                      ? '36 Kursi'
                      : busClass === 'Super Top'
                      ? '30 Kursi'
                      : '32 Kursi'}
                  </span>
                </div>
                <div className="jdw-facilities-grid">
                  <div className="jdw-facility-item">
                    <span className="material-symbols-outlined jdw-facility-icon">ac_unit</span>
                    <div className="jdw-facility-text">
                      <h5>Full AC Dinamis</h5>
                      <p>Suhu sejuk 20-22°C stabil</p>
                    </div>
                  </div>
                  <div className="jdw-facility-item">
                    <span className="material-symbols-outlined jdw-facility-icon">restaurant</span>
                    <div className="jdw-facility-text">
                      <h5>Servis Makan &amp; Snack</h5>
                      <p>1x Prasmanan + air mineral</p>
                    </div>
                  </div>
                  <div className="jdw-facility-item">
                    <span className="material-symbols-outlined jdw-facility-icon">battery_charging_full</span>
                    <div className="jdw-facility-text">
                      <h5>USB Charger Tiap Kursi</h5>
                      <p>Pengisian daya smartphone</p>
                    </div>
                  </div>
                  <div className="jdw-facility-item">
                    <span className="material-symbols-outlined jdw-facility-icon">airline_seat_legroom_extra</span>
                    <div className="jdw-facility-text">
                      <h5>{busClass === 'Sleeper Suite' ? 'Sleeper Capsule 180°' : 'Legrest & Reclining'}</h5>
                      <p>
                        {busClass === 'Sleeper Suite'
                          ? 'Rebahan penuh & AVOD'
                          : 'Sandaran kaki & selimut bersih'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 4. Direktori Lokasi Terminal Resmi (Seluruh terminal.json + TomTom Maps) ── */}
        <div className="jdw-locations-card anim-fade-up anim-d4">
          <div className="jdw-details-header">
            <h2 className="jdw-details-title">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#16a34a' }}>
                pin_drop
              </span>
              <span>Direktori Lokasi Terminal &amp; Pool Keberangkatan Bus Resmi</span>
            </h2>
            <span className="jdw-time-zone-badge">
              {terminals.length} Terminal (terminal.json) • TomTom Maps API
            </span>
          </div>

          {/* Search & Province Filter Bar */}
          <div className="jdw-terminal-filter-bar">
            <div className="jdw-terminal-search-wrap">
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#64748b' }}>
                search
              </span>
              <input
                type="text"
                value={terminalSearch}
                onChange={(e) => setTerminalSearch(e.target.value)}
                placeholder="Cari terminal, kota, atau provinsi (cth: Pulo Gebang, Malang, Medan, Bali)..."
                className="jdw-terminal-search-input"
              />
              {terminalSearch && (
                <button
                  type="button"
                  onClick={() => setTerminalSearch('')}
                  className="jdw-terminal-clear-btn"
                  aria-label="Hapus pencarian"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    close
                  </span>
                </button>
              )}
            </div>

            <div className="jdw-terminal-province-wrap">
              <span className="material-symbols-outlined" style={{ fontSize: '17px', color: '#1B4285' }}>
                public
              </span>
              <select
                value={selectedProvince}
                onChange={(e) => {
                  const prov = e.target.value;
                  setSelectedProvince(prov);
                  const firstMatch = terminals.find((t) => prov === 'Semua' || t.provinsi === prov);
                  if (firstMatch) setSelectedTerminalId(firstMatch.id);
                }}
                className="jdw-terminal-province-select"
                aria-label="Filter Provinsi"
              >
                <option value="Semua">Semua Provinsi ({terminals.length} Terminal)</option>
                {provinceOptions.map(([prov, count]) => (
                  <option key={prov} value={prov}>
                    {prov} ({count})
                  </option>
                ))}
              </select>
            </div>

            <span className="jdw-terminal-count-pill">
              Menampilkan <strong>{filteredTerminals.length}</strong> dari {terminals.length} terminal
            </span>
          </div>

          {/* Terminal Selector Pills (Dari terminal.json) */}
          <div className="jdw-location-tabs jdw-location-tabs-grid">
            {filteredTerminals.length > 0 ? (
              filteredTerminals.map((term) => (
                <button
                  key={term.id}
                  type="button"
                  className={`jdw-location-tab-btn ${selectedTerminal?.id === term.id ? 'active' : ''}`}
                  onClick={() => setSelectedTerminalId(term.id)}
                  title={`${term.namaTerminal} — ${term.namaKota}, ${term.provinsi}`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', flexShrink: 0 }}>
                    location_city
                  </span>
                  <span className="jdw-tab-text-group">
                    <span className="jdw-tab-main">{term.namaTerminal.replace(/^Terminal\s+/i, '')}</span>
                    <span className="jdw-tab-sub">{term.namaKota}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="jdw-terminal-empty">
                Tidak ada terminal yang cocok dengan pencarian &ldquo;{terminalSearch}&rdquo;.
              </div>
            )}
          </div>

          {/* Terminal Detail Card + Denah TomTom Maps Interaktif */}
          {selectedTerminal && (
            <div className="jdw-terminal-card-inner">
              <div className="jdw-terminal-info-side">
                <div className="jdw-terminal-badge-row">
                  <span className="jdw-terminal-badge">
                    {selectedTerminal.namaKota} • {selectedTerminal.provinsi}
                  </span>
                  <span className="jdw-terminal-badge" style={{ background: '#fff7ed', color: '#c2410c', borderColor: '#fed7aa' }}>
                    {selectedTerminal.tipeTerminal}
                  </span>
                  <span className="jdw-terminal-badge hours">
                    <span className="material-symbols-outlined" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '3px' }}>
                      schedule
                    </span>
                    {selectedTerminal.jamOperasional}
                  </span>
                  <span className="jdw-terminal-badge" style={{ background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}>
                    Koordinat: {selectedTerminal.lat.toFixed(5)}, {selectedTerminal.lng.toFixed(5)}
                  </span>
                  <span
                    className="jdw-terminal-badge"
                    style={{
                      background: terminalGeoSource === 'tomtom-search' ? '#ecfdf5' : '#eff6ff',
                      color: terminalGeoSource === 'tomtom-search' ? '#047857' : '#1d4ed8',
                      borderColor: terminalGeoSource === 'tomtom-search' ? '#a7f3d0' : '#bfdbfe',
                    }}
                  >
                    {isResolvingTerminal
                      ? 'Menyelaraskan titik TomTom...'
                      : terminalGeoSource === 'tomtom-search'
                      ? '✓ Titik Lokasi TomTom Maps'
                      : 'Titik Lokasi terminal.json'}
                  </span>
                </div>

                <h3 className="jdw-terminal-name">{selectedTerminal.namaTerminal}</h3>

                <div className="jdw-terminal-address">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#f97316', flexShrink: 0 }}>
                    location_on
                  </span>
                  <span>{selectedTerminal.alamat}</span>
                </div>

                <div>
                  <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.75rem', fontWeight: 800, color: '#334155' }}>
                    Fasilitas di Lokasi Terminal:
                  </h5>
                  <div className="jdw-terminal-chips-list">
                    {selectedTerminal.fasilitas.map((f, i) => (
                      <span key={i} className="jdw-terminal-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '13px', color: '#16a34a' }}>
                          check
                        </span>
                        <span>{f}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {selectedTerminal.poOperators.length > 0 && (
                  <div>
                    <h5 style={{ margin: '0 0 0.45rem 0', fontSize: '0.75rem', fontWeight: 800, color: '#334155' }}>
                      Operator PO Bus Resmi Wilayah {selectedTerminal.provinsi}:
                    </h5>
                    <div className="jdw-terminal-chips-list">
                      {selectedTerminal.poOperators.slice(0, 8).map((po, idx) => (
                        <span
                          key={idx}
                          className="jdw-terminal-chip"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '13px', color: '#FA7808' }}>
                            directions_bus
                          </span>
                          <span>{po}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="jdw-terminal-actions">
                  <button
                    type="button"
                    className="jdw-btn-use-route primary"
                    onClick={() => handleSetAsOrigin(selectedTerminal)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                      trip_origin
                    </span>
                    <span>Jadikan Kota Asal</span>
                  </button>

                  <button
                    type="button"
                    className="jdw-btn-use-route"
                    onClick={() => handleSetAsDestination(selectedTerminal)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                      place
                    </span>
                    <span>Jadikan Kota Tujuan</span>
                  </button>

                  <a
                    href={selectedTerminal.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="jdw-btn-gmaps"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#ea4335' }}>
                      map
                    </span>
                    <span>Buka di Google Maps</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                      open_in_new
                    </span>
                  </a>
                </div>
              </div>

              {/* Peta Denah Lokasi Terminal Interaktif via TomTom Maps API */}
              <div className="jdw-terminal-map-preview jdw-terminal-map-interactive">
                <div ref={terminalMapElRef} style={{ width: '100%', height: '100%' }} />

                <div className="jdw-terminal-map-controls">
                  <button
                    type="button"
                    onClick={handleRecenterTerminalMap}
                    className="jdw-map-ctrl-btn"
                    title="Fokus ke titik lokasi terminal"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                      my_location
                    </span>
                    <span>Fokus Titik</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTrafficLayer((v) => !v)}
                    className={`jdw-map-ctrl-btn ${showTrafficLayer ? 'active' : ''}`}
                    title="Tampilkan arus lalu lintas TomTom Live Traffic"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                      traffic
                    </span>
                    <span>{showTrafficLayer ? 'Traffic ON' : 'Traffic'}</span>
                  </button>
                </div>

                <div className="jdw-terminal-map-badge">
                  © TomTom Maps API • {selectedTerminal.lat.toFixed(4)}, {selectedTerminal.lng.toFixed(4)}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── FOOTER LENGKAP ───────────────────────────────────────── */}
      <footer className="search-footer">
        <div className="search-footer-inner">
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <img src={logoNavbar} alt="GOVIA Transport" style={{ height: '38px', width: 'auto', objectFit: 'contain' }} />
            </div>
            <p className="search-footer-about">
              Platform pemesanan tiket bus &amp; travel antarkota terpercaya di Indonesia. Terhubung dengan 250+ operator bus AKAP dan Shuttle resmi.
            </p>
            <div className="search-footer-badges">
              <div className="search-footer-badge-pill">
                <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#16a34a' }}>
                  verified
                </span>
                <span>100% Tiket Resmi</span>
              </div>
              <div className="search-footer-badge-pill">
                <span className="material-symbols-outlined" style={{ fontSize: '15px', color: '#16a34a' }}>
                  shield
                </span>
                <span>Jaminan Refund</span>
              </div>
            </div>
          </div>

          <div className="search-footer-col">
            <h5>Rute Populer</h5>
            <ul className="search-footer-links">
              <li><a href="#r1">Jakarta → Yogyakarta</a></li>
              <li><a href="#r2">Jakarta → Surabaya</a></li>
              <li><a href="#r3">Bandung → Semarang</a></li>
              <li><a href="#r4">Surabaya → Denpasar</a></li>
              <li><a href="#r5">Medan → Banda Aceh</a></li>
            </ul>
          </div>

          <div className="search-footer-col">
            <h5>Layanan Pelanggan</h5>
            <ul className="search-footer-links">
              <li><a href="#help">Pusat Bantuan</a></li>
              <li><a href="#refund">Cara Pembelian &amp; Refund</a></li>
              <li><a href="#bagasi">Kebijakan Bagasi</a></li>
              <li><a href="#wa">Hubungi CS WhatsApp 24/7</a></li>
              <li><a href="#terms">Syarat &amp; Ketentuan</a></li>
            </ul>
          </div>

          <div className="search-footer-col">
            <h5>Keamanan &amp; Pembayaran</h5>
            <p style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: '0.6rem' }}>
              Transaksi berenkripsi standar industri dan diawasi lembaga berwenang.
            </p>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span className="search-footer-badge-pill">SSL Secure</span>
              <span className="search-footer-badge-pill">QRIS</span>
              <span className="search-footer-badge-pill">Virtual Account</span>
              <span className="search-footer-badge-pill">Kartu Kredit</span>
            </div>
          </div>
        </div>

        <div className="search-footer-bottom">
          <div>© 2026 PT GOVIA Nusantara Digital. Seluruh hak cipta dilindungi.</div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <a href="#privacy" style={{ color: '#94a3b8', textDecoration: 'none' }}>Kebijakan Privasi</a>
            <a href="#terms" style={{ color: '#94a3b8', textDecoration: 'none' }}>Ketentuan Layanan</a>
            <a href="#sitemap" style={{ color: '#94a3b8', textDecoration: 'none' }}>Peta Situs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
