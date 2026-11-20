import { NextResponse } from 'next/server';
import {
  getAllowedPickupPoints,
  addAllowedPickupPoint,
  toggleAllowedPickupPoint,
  deleteAllowedPickupPoint,
  getAllPickupRequests,
  createPickupRequest,
  updatePickupRequest,
  BUS_ROUTE_CORRIDORS,
  addMinutesToJam,
  type PickupStatus,
} from '@/lib/pickup-store';
import { authenticateRequest } from '@/lib/auth';

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || 'CAymKPlDKfwMYMLZgTzBbkhkiwO3gUT2';

interface ReverseRoadInfo {
  road_name: string;
  formatted_address: string;
  city: string;
  near_road: boolean;
  source: 'tomtom' | 'nominatim' | 'gps-fallback';
}

async function resolveRoadFromGps(lat: number, lng: number, fallbackAlamat = ''): Promise<ReverseRoadInfo> {
  // 1. Coba TomTom Reverse Geocode untuk mendeteksi nama jalan raya terdekat dari GPS
  try {
    const ttUrl = `https://api.tomtom.com/search/2/reverseGeocode/${lat},${lng}.json?key=${encodeURIComponent(
      TOMTOM_API_KEY
    )}&returnSpeedLimit=true&returnRoadUse=true&language=id-ID`;
    const ttRes = await fetch(ttUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3500),
    });
    if (ttRes.ok) {
      const ttJson = await ttRes.json();
      const addr = ttJson?.addresses?.[0]?.address;
      if (addr) {
        const roadName = addr.streetName || addr.street || addr.municipalitySubdivision || '';
        const formatted = addr.freeformAddress || [roadName, addr.municipality, addr.countrySubdivision].filter(Boolean).join(', ');
        const city = addr.municipality || addr.countrySecondarySubdivision || '';
        return {
          road_name: roadName || formatted || `Jalan Raya (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          formatted_address: formatted || fallbackAlamat || `Koordinat GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          city,
          near_road: Boolean(roadName || formatted),
          source: 'tomtom',
        };
      }
    }
  } catch {
    /* lanjut ke fallback Nominatim */
  }

  // 2. Fallback OpenStreetMap Nominatim
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const nomRes = await fetch(nomUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GoviaBusTicketing/1.0',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (nomRes.ok) {
      const nomJson = await nomRes.json();
      const a = nomJson?.address || {};
      const roadName = a.road || a.trunk || a.highway || a.suburb || a.village || '';
      const formatted = nomJson?.display_name || '';
      const city = a.city || a.town || a.county || a.state || '';
      if (roadName || formatted) {
        return {
          road_name: roadName || formatted.split(',')[0],
          formatted_address: formatted || fallbackAlamat || `Koordinat GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          city,
          near_road: Boolean(a.road || a.trunk || a.highway || formatted),
          source: 'nominatim',
        };
      }
    }
  } catch {
    /* fallback lokal */
  }

  return {
    road_name: `Pinggir Jalan Raya (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    formatted_address: fallbackAlamat || `Lokasi GPS (${lat.toFixed(5)}, ${lng.toFixed(5)}) — Area Jalan Raya`,
    city: '',
    near_road: true,
    source: 'gps-fallback',
  };
}

async function buildRoadsideValidation(params: {
  lat: number;
  lng: number;
  alamat?: string;
  asalKota?: string;
  tujuanKota?: string;
  jamBerangkat?: string;
}) {
  const roadInfo = await resolveRoadFromGps(params.lat, params.lng, params.alamat || '');
  const combinedText = `${params.alamat || ''} ${roadInfo.road_name} ${roadInfo.formatted_address}`.toLowerCase();
  const isUnsafeKeyword = /jembatan|flyover atas|terowongan|underpass|tikungan tajam|perlintasan rel|tengah laut|samudra/.test(
    combinedText
  );

  const bisaDijemput = !isUnsafeKeyword && roadInfo.near_road;
  const statusValidasi: 'valid' | 'perlu_review' | 'terlalu_jauh' = bisaDijemput ? 'valid' : 'terlalu_jauh';
  const estimasiTiba = addMinutesToJam(params.jamBerangkat || '07:30', 25);

  const pesanValidasi = bisaDijemput
    ? `Titik GPS terhubung dekat jalan raya (${roadInfo.road_name}). Penumpang dapat langsung dijemput di lokasi ini tanpa memilih titik khusus.`
    : 'Titik ini tidak berada di dekat jalan raya yang aman (area terlarang/jembatan/perairan). Geser pin pada peta ke pinggir jalan raya terdekat.';

  return {
    bisa_dijemput: bisaDijemput,
    status_validasi: statusValidasi,
    jarak_ke_rute_km: 0,
    estimasi_menit_dari_terminal: 25,
    estimasi_bus_tiba: estimasiTiba,
    rekomendasi_biaya_tambahan: 0,
    pesan_validasi: pesanValidasi,
    road_name: roadInfo.road_name,
    formatted_address: roadInfo.formatted_address,
    city: roadInfo.city,
    geocode_source: roadInfo.source,
    titik_terdekat: null,
    daftar_rekomendasi: [],
    koridor_rute: BUS_ROUTE_CORRIDORS[`${(params.asalKota || '').toLowerCase()}-${(params.tujuanKota || '').toLowerCase()}`] || [],
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'all';
    const kota = searchParams.get('kota') || undefined;
    const kodeBooking = searchParams.get('kode_booking') || undefined;
    const status = searchParams.get('status') || undefined;
    const asalKota = (searchParams.get('asal_kota') || '').toLowerCase();
    const tujuanKota = (searchParams.get('tujuan_kota') || '').toLowerCase();

    if (mode === 'points') {
      const points = await getAllowedPickupPoints(kota);
      const corridorKey = `${asalKota}-${tujuanKota}`;
      const corridor = BUS_ROUTE_CORRIDORS[corridorKey] || [];
      return NextResponse.json({
        success: true,
        points,
        corridor,
      });
    }

    if (mode === 'validate') {
      const lat = parseFloat(searchParams.get('lat') || '');
      const lng = parseFloat(searchParams.get('lng') || '');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return NextResponse.json({ success: false, message: 'Parameter lat dan lng wajib diisi.' }, { status: 400 });
      }
      const alamat = searchParams.get('alamat') || '';
      const jamBerangkat = searchParams.get('jam_berangkat') || '07:30';

      const result = await buildRoadsideValidation({
        lat,
        lng,
        alamat,
        asalKota,
        tujuanKota,
        jamBerangkat,
      });

      return NextResponse.json({
        success: true,
        validation: result,
      });
    }

    const requests = await getAllPickupRequests({
      kode_booking: kodeBooking,
      status,
    });
    const allowedPoints = await getAllowedPickupPoints(kota);

    return NextResponse.json({
      success: true,
      total: requests.length,
      requests,
      allowed_points: allowedPoints,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: 'Gagal memuat data penjemputan.', error: msg },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request);
    const body = await request.json();
    const { action } = body;

    // 1. Validasi Lokasi GPS Penjemputan (bebas di mana saja asal dekat jalan raya)
    if (action === 'validate-location') {
      if (!Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lng)) || body.lat == null || body.lng == null) {
        return NextResponse.json({ success: false, message: 'lat dan lng wajib diisi.' }, { status: 400 });
      }
      const validation = await buildRoadsideValidation({
        lat: Number(body.lat),
        lng: Number(body.lng),
        alamat: body.alamat || '',
        asalKota: body.asal_kota || '',
        tujuanKota: body.tujuan_kota || '',
        jamBerangkat: body.jam_berangkat || '07:30',
      });
      return NextResponse.json({
        success: true,
        validation,
      });
    }

    // 2. Admin Menambahkan Titik Penjemputan Resmi Baru
    if (action === 'add-allowed-point') {
      if (!body.nama_lokasi || !body.kota || body.lat == null || body.lng == null) {
        return NextResponse.json({ success: false, message: 'nama_lokasi, kota, lat, lng wajib diisi.' }, { status: 400 });
      }
      const newPoint = await addAllowedPickupPoint({
        nama_lokasi: String(body.nama_lokasi),
        kategori: body.kategori || 'Pinggir Jalan Aman',
        kota: String(body.kota),
        alamat: body.alamat || '-',
        lat: Number(body.lat),
        lng: Number(body.lng),
        jarak_rute_km: Number(body.jarak_rute_km || 0),
        estimasi_menit_dari_terminal: Number(body.estimasi_menit_dari_terminal || 0),
        biaya_tambahan: Number(body.biaya_tambahan || 0),
        catatan_keamanan: body.catatan_keamanan || '',
        aktif: true,
      });

      return NextResponse.json({
        success: true,
        message: 'Titik penjemputan resmi berhasil ditambahkan.',
        point: newPoint,
        allowed_points: await getAllowedPickupPoints(),
      });
    }

    if (action === 'toggle-allowed-point') {
      const pt = await toggleAllowedPickupPoint(body.id);
      return NextResponse.json({
        success: true,
        message: 'Status titik penjemputan diperbarui.',
        point: pt,
        allowed_points: await getAllowedPickupPoints(),
      });
    }

    if (action === 'delete-allowed-point') {
      await deleteAllowedPickupPoint(body.id);
      return NextResponse.json({
        success: true,
        message: 'Titik penjemputan dihapus.',
        allowed_points: await getAllowedPickupPoints(),
      });
    }

    // 4. Customer Membuat Permintaan Penjemputan Baru
    if (!auth) {
      return NextResponse.json({ success: false, message: 'Anda harus login.' }, { status: 401 });
    }
    if (!body.kode_booking || !body.schedule_id || body.lat == null || body.lng == null) {
      return NextResponse.json({ success: false, message: 'kode_booking, schedule_id, lat, lng wajib diisi.' }, { status: 400 });
    }
    const created = await createPickupRequest({
      kode_booking: String(body.kode_booking),
      schedule_id: String(body.schedule_id),
      customer_id: auth.id,
      nama_customer: body.nama_customer || auth.nama || '-',
      no_hp: body.no_hp || '-',
      tipe_keberangkatan: body.tipe_keberangkatan || 'pickup',
      nama_lokasi: body.nama_lokasi || 'Titik Penjemputan Jalan Raya (GPS)',
      kategori_lokasi: body.kategori_lokasi || 'Pinggir Jalan Raya (GPS)',
      alamat_lengkap: body.alamat_lengkap || '-',
      lat: Number(body.lat),
      lng: Number(body.lng),
      jarak_ke_rute_km: Number(body.jarak_ke_rute_km || 0),
      estimasi_bus_tiba: body.estimasi_bus_tiba || '-',
      status_validasi: body.status_validasi || 'valid',
      status_penjemputan: (body.status_penjemputan as PickupStatus) || 'Disetujui',
      biaya_tambahan: Number(body.biaya_tambahan || 0),
      catatan_customer: body.catatan_customer || '',
      catatan_admin: body.catatan_admin || 'Lokasi penjemputan GPS pinggir jalan raya.',
      catatan_staf_sopir: body.catatan_staf_sopir || '',
      rute_asal: body.rute_asal || '-',
      rute_tujuan: body.rute_tujuan || '-',
      nama_bus: body.nama_bus || '-',
      plat_nomor: body.plat_nomor || '-',
      nomor_kursi: body.nomor_kursi || '-',
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Permintaan titik penjemputan berhasil disimpan.',
        pickup: created,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: 'Gagal menyimpan permintaan penjemputan.', error: msg },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const {
      id,
      kode_booking,
      status_penjemputan,
      biaya_tambahan,
      catatan_admin,
      catatan_staf_sopir,
      estimasi_bus_tiba,
    } = body;

    const targetId = id || kode_booking;
    if (!targetId) {
      return NextResponse.json(
        { success: false, message: 'ID penjemputan atau kode_booking wajib diisi.' },
        { status: 400 }
      );
    }

    const updated = await updatePickupRequest(targetId, {
      status_penjemputan,
      biaya_tambahan,
      catatan_admin,
      catatan_staf_sopir,
      estimasi_bus_tiba,
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, message: 'Data penjemputan tidak ditemukan.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Status penjemputan berhasil diperbarui menjadi "${updated.status_penjemputan}".`,
      pickup: updated,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: 'Gagal memperbarui status penjemputan.', error: msg },
      { status: 500 }
    );
  }
}
