import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || 'CAymKPlDKfwMYMLZgTzBbkhkiwO3gUT2';

interface RawTerminal {
  id: number;
  nama_terminal: string;
  kota_kabupaten: string;
  provinsi: string;
  tipe_terminal?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  alamat?: string;
  jam_operasional?: string;
  fasilitas?: string[];
  status?: string;
}

interface RawBusOperator {
  id: number;
  nama_po: string;
  wilayah: string;
  jenis_layanan: string;
  kategori: string;
  status: string;
}

interface TomTomResolvedCacheEntry {
  lat: number;
  lng: number;
  alamat?: string;
  poiName?: string;
  source: 'tomtom-search' | 'terminal-json';
  resolvedAt: number;
}

// Cache hasil geocoding TomTom di memori agar hemat kuota & super cepat
const tomtomGeoCache = new Map<number, TomTomResolvedCacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 jam

async function loadJsonFile<T>(filename: string, fallback: T): Promise<T> {
  try {
    const filePath = path.join(process.cwd(), 'app', filename);
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getOperatorsForTerminal(term: RawTerminal, operators: RawBusOperator[]): string[] {
  const prov = (term.provinsi || '').toLowerCase();
  const kota = (term.kota_kabupaten || '').toLowerCase();
  const isJabodetabek =
    prov.includes('jakarta') ||
    kota.includes('bogor') ||
    kota.includes('depok') ||
    kota.includes('tangerang') ||
    kota.includes('bekasi');
  const isSumatera =
    prov.includes('sumatera') ||
    prov.includes('aceh') ||
    prov.includes('riau') ||
    prov.includes('jambi') ||
    prov.includes('lampung') ||
    prov.includes('bengkulu');

  return operators
    .filter((op) => {
      const w = (op.wilayah || '').toLowerCase();
      if (w === 'seluruh indonesia') return true;
      if (w === prov) return true;
      if (isJabodetabek && (w === 'jabodetabek' || w === 'dki jakarta')) return true;
      if (isSumatera && w === 'sumatera') return true;
      return false;
    })
    .map((op) => op.nama_po);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function resolveTerminalWithTomTom(term: RawTerminal): Promise<TomTomResolvedCacheEntry> {
  const cached = tomtomGeoCache.get(term.id);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return cached;
  }

  const fallbackLat = typeof term.latitude === 'number' ? term.latitude : -6.21345;
  const fallbackLng = typeof term.longitude === 'number' ? term.longitude : 106.95325;

  const query = `${term.nama_terminal} ${term.kota_kabupaten} ${term.provinsi} Indonesia`;
  const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(
    query
  )}.json?key=${TOMTOM_API_KEY}&countrySet=ID&limit=3&language=id-ID`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = await res.json();
      const results: Array<{
        position?: { lat: number; lon: number };
        address?: { freeformAddress?: string };
        poi?: { name?: string };
      }> = Array.isArray(data?.results) ? data.results : [];

      // Pilih hasil TomTom paling akurat & dekat dengan koordinat referensi (jika tersedia)
      const picked =
        results.find((r) => {
          if (!r.position) return false;
          if (typeof term.latitude !== 'number' || typeof term.longitude !== 'number') return true;
          return haversineKm(r.position.lat, r.position.lon, term.latitude, term.longitude) <= 35;
        }) || results.find((r) => r.position);

      if (picked?.position) {
        const entry: TomTomResolvedCacheEntry = {
          lat: Number(picked.position.lat.toFixed(6)),
          lng: Number(picked.position.lon.toFixed(6)),
          alamat: picked.address?.freeformAddress || term.alamat,
          poiName: picked.poi?.name,
          source: 'tomtom-search',
          resolvedAt: Date.now(),
        };
        tomtomGeoCache.set(term.id, entry);
        return entry;
      }
    }
  } catch (err) {
    console.warn(`TomTom Search fallback untuk ${term.nama_terminal}:`, err);
  }

  const fallbackEntry: TomTomResolvedCacheEntry = {
    lat: fallbackLat,
    lng: fallbackLng,
    alamat: term.alamat || `${term.nama_terminal}, ${term.kota_kabupaten}, ${term.provinsi}`,
    source: 'terminal-json',
    resolvedAt: Date.now(),
  };
  tomtomGeoCache.set(term.id, fallbackEntry);
  return fallbackEntry;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const resolveIdParam = searchParams.get('resolveId');
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const provinsiFilter = (searchParams.get('provinsi') || '').trim().toLowerCase();

    const [terminals, operators] = await Promise.all([
      loadJsonFile<RawTerminal[]>('terminal.json', []),
      loadJsonFile<RawBusOperator[]>('bus.json', []),
    ]);

    const activeTerminals = terminals.filter((t) => (t.status || 'aktif').toLowerCase() === 'aktif');

    // Mode 1: Resolusi titik lokasi spesifik via TomTom Maps Search API
    if (resolveIdParam) {
      const targetId = Number(resolveIdParam);
      const found = activeTerminals.find((t) => t.id === targetId);
      if (!found) {
        return NextResponse.json(
          { success: false, message: 'Terminal tidak ditemukan di terminal.json.' },
          { status: 404 }
        );
      }
      const geo = await resolveTerminalWithTomTom(found);
      return NextResponse.json({
        success: true,
        source: geo.source,
        terminal: {
          ...found,
          latitude: geo.lat,
          longitude: geo.lng,
          alamat: geo.alamat || found.alamat || `${found.nama_terminal}, ${found.kota_kabupaten}, ${found.provinsi}`,
          poi_name: geo.poiName || null,
          po_operators: getOperatorsForTerminal(found, operators),
          tomtom_tile_url: `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}&tileSize=256&view=Unified`,
          google_maps_url: `https://maps.google.com/?q=${geo.lat},${geo.lng}`,
        },
      });
    }

    // Mode 2: Daftar lengkap direktori terminal (dengan pencarian & filter provinsi)
    const provinces = Array.from(new Set(activeTerminals.map((t) => t.provinsi))).sort((a, b) =>
      a.localeCompare(b, 'id')
    );

    const filtered = activeTerminals.filter((t) => {
      if (provinsiFilter && provinsiFilter !== 'semua' && t.provinsi.toLowerCase() !== provinsiFilter) {
        return false;
      }
      if (!q) return true;
      return (
        t.nama_terminal.toLowerCase().includes(q) ||
        t.kota_kabupaten.toLowerCase().includes(q) ||
        t.provinsi.toLowerCase().includes(q) ||
        (t.alamat || '').toLowerCase().includes(q)
      );
    });

    const enriched = filtered.map((t) => {
      const cached = tomtomGeoCache.get(t.id);
      const lat = cached?.lat ?? t.latitude ?? -6.21345;
      const lng = cached?.lng ?? t.longitude ?? 106.95325;
      return {
        ...t,
        tipe_terminal: t.tipe_terminal || 'Tipe A',
        latitude: lat,
        longitude: lng,
        alamat: cached?.alamat || t.alamat || `${t.nama_terminal}, ${t.kota_kabupaten}, ${t.provinsi}`,
        jam_operasional: t.jam_operasional || '24 Jam Nonstop',
        fasilitas:
          Array.isArray(t.fasilitas) && t.fasilitas.length > 0
            ? t.fasilitas
            : ['Loket Tiket AKAP Resmi', 'Ruang Tunggu Penumpang', 'Musholla & Toilet', 'Area Parkir'],
        po_operators: getOperatorsForTerminal(t, operators),
        google_maps_url: `https://maps.google.com/?q=${lat},${lng}`,
      };
    });

    return NextResponse.json({
      success: true,
      total: enriched.length,
      total_all: activeTerminals.length,
      provinces,
      terminals: enriched,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: 'Gagal memuat direktori terminal.', error: errMessage },
      { status: 500 }
    );
  }
}

