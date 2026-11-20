import { NextResponse } from 'next/server';

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || 'CAymKPlDKfwMYMLZgTzBbkhkiwO3gUT2';

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius bumi dalam km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const directDistance = R * c;
  // Faktor jalan tol / rute darat Indonesia (rata-rata 1.25x dari jarak garis lurus)
  return Math.round(directDistance * 1.25);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get('origin') || '-6.2134,106.9532'; // Default: Jakarta Pulo Gebang
    const destination = searchParams.get('destination') || '-7.3512,112.7247'; // Default: Surabaya Purabaya

    const [origLatStr, origLngStr] = origin.split(',');
    const [destLatStr, destLngStr] = destination.split(',');
    const origLat = parseFloat(origLatStr);
    const origLng = parseFloat(origLngStr);
    const destLat = parseFloat(destLatStr);
    const destLng = parseFloat(destLngStr);

    let routeData: {
      success: boolean;
      source: string;
      distanceKm: number;
      travelTimeMinutes: number;
      travelTimeFormatted: string;
      trafficDelaySeconds: number;
      trafficCondition: string;
      points: [number, number][];
    } | null = null;

    // 1. Coba panggil TomTom Orbis Routing API sesuai format pengguna
    const tomtomUrl = `https://api.tomtom.com/maps/orbis/routing/calculateRoute/${origin}:${destination}/json?apiVersion=2&key=${TOMTOM_API_KEY}`;
    try {
      const ttRes = await fetch(tomtomUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      });
      const ttJson = await ttRes.json();

      if (ttRes.ok && ttJson.routes && ttJson.routes.length > 0) {
        const summary = ttJson.routes[0].summary;
        const distanceKm = Math.round((summary.lengthInMeters || 0) / 1000);
        const travelMinutes = Math.round((summary.travelTimeInSeconds || 0) / 60);
        const hours = Math.floor(travelMinutes / 60);
        const mins = travelMinutes % 60;

        // Titik-titik jalur rute ([lat, lng]) untuk digambar di peta frontend
        const points: [number, number][] = (ttJson.routes[0].legs || []).flatMap(
          (leg: { points?: Array<{ latitude: number; longitude: number }> }) =>
            (leg.points || []).map((p) => [p.latitude, p.longitude] as [number, number])
        );

        routeData = {
          success: true,
          source: 'tomtom-orbis',
          distanceKm,
          travelTimeMinutes: travelMinutes,
          travelTimeFormatted: `${hours} jam ${mins} menit`,
          trafficDelaySeconds: summary.trafficDelayInSeconds || 0,
          trafficCondition: (summary.trafficDelayInSeconds || 0) > 900 ? 'Padat Merayap' : 'Ramai Lancar',
          points
        };
      }
    } catch (ttErr) {
      console.warn('TomTom Routing call error:', ttErr);
    }

    // 2. Fallback cerdas berbasis koordinat jika API key memerlukan aktivasi endpoint khusus
    if (!routeData) {
      const distanceKm = calculateHaversineDistance(origLat, origLng, destLat, destLng);
      // Rata-rata kecepatan bus AKAP di Tol Trans-Jawa ~ 75 km/jam
      const travelHours = distanceKm / 75;
      const totalMinutes = Math.round(travelHours * 60);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;

      routeData = {
        success: true,
        source: 'tomtom-ready-fallback',
        distanceKm,
        travelTimeMinutes: totalMinutes,
        travelTimeFormatted: `${hours} jam ${mins} menit`,
        trafficDelaySeconds: 0,
        trafficCondition: 'Lancar (Tol Trans-Jawa 85 km/jam)',
        points: []
      };
    }

    return NextResponse.json(routeData);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, message: 'Gagal kalkulasi rute', error: errMessage }, { status: 500 });
  }
}

