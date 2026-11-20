import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { releaseExpiredBookings } from '@/lib/booking';
import {
  MAX_SEAT_QUEUE_CAPACITY,
  getSeatQueueSnapshot,
  joinOrUpdateSeatQueue,
  leaveSeatQueue,
} from '@/lib/seat-queue';

async function getBookedSeatCodes(scheduleId: string): Promise<Set<string>> {
  try {
    await releaseExpiredBookings();
  } catch {
    /* ignore */
  }
  const res = await query(
    `SELECT UPPER(st.nomor_kursi) AS nomor_kursi
     FROM booking_details bd
     JOIN seats st ON st.id = bd.seat_id
     WHERE bd.schedule_id = $1 AND bd.aktif = TRUE`,
    [scheduleId]
  );
  return new Set(res.rows.map((r: { nomor_kursi: string }) => String(r.nomor_kursi).toUpperCase()));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id') || undefined;
  const seatsParam = searchParams.get('seats') || '';
  const requestedSeats = seatsParam
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    const bookedSet = await getBookedSeatCodes(id);
    const snapshot = getSeatQueueSnapshot(id, sessionId, requestedSeats);

    const perSeat: Record<
      string,
      { seat: string; contenders: number; your_position: number | null; is_front_of_queue: boolean; is_booked: boolean }
    > = {};
    for (const [seatCode, info] of Object.entries(snapshot.seat_contenders)) {
      perSeat[seatCode] = {
        seat: seatCode,
        contenders: info.contenders,
        your_position: info.your_position,
        is_front_of_queue: info.is_front_of_queue && !bookedSet.has(seatCode),
        is_booked: bookedSet.has(seatCode),
      };
    }

    return NextResponse.json({
      success: true,
      schedule_id: id,
      total_active_queue: snapshot.total_active_queue,
      max_queue_capacity: MAX_SEAT_QUEUE_CAPACITY,
      booked_seats_count: bookedSet.size,
      per_seat: perSeat,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, message: 'Gagal memeriksa antrean kursi.', error: msg },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'join' | 'heartbeat' | 'leave' | 'check';
      session_id?: string;
      seats?: string[];
      user_label?: string;
    };

    const action = body.action || 'join';
    const sessionId = String(body.session_id || '').trim();
    const seats = Array.isArray(body.seats) ? body.seats : [];

    if (!sessionId) {
      return NextResponse.json({ success: false, message: 'session_id wajib diisi.' }, { status: 400 });
    }

    if (action === 'leave') {
      const remaining = leaveSeatQueue(id, sessionId);
      return NextResponse.json({
        success: true,
        schedule_id: id,
        total_active_queue: remaining,
        max_queue_capacity: MAX_SEAT_QUEUE_CAPACITY,
      });
    }

    const bookedSet = await getBookedSeatCodes(id);

    if (action === 'check') {
      const snapshot = getSeatQueueSnapshot(id, sessionId, seats);
      const perSeat: Record<
        string,
        { seat: string; contenders: number; your_position: number | null; is_front_of_queue: boolean; is_booked: boolean }
      > = {};
      for (const [seatCode, info] of Object.entries(snapshot.seat_contenders)) {
        perSeat[seatCode] = {
          seat: seatCode,
          contenders: info.contenders,
          your_position: info.your_position,
          is_front_of_queue: info.is_front_of_queue && !bookedSet.has(seatCode),
          is_booked: bookedSet.has(seatCode),
        };
      }
      return NextResponse.json({
        success: true,
        schedule_id: id,
        total_active_queue: snapshot.total_active_queue,
        max_queue_capacity: MAX_SEAT_QUEUE_CAPACITY,
        booked_seats_count: bookedSet.size,
        per_seat: perSeat,
      });
    }

    const res = joinOrUpdateSeatQueue({
      scheduleId: id,
      sessionId,
      seats,
      userLabel: body.user_label,
    });

    if (!res.accepted) {
      return NextResponse.json(
        {
          success: false,
          code: res.code,
          message: res.message,
          total_active_queue: res.total_active_queue,
          max_queue_capacity: res.max_queue_capacity,
        },
        { status: 429 }
      );
    }

    const perSeat: Record<
      string,
      { seat: string; contenders: number; your_position: number | null; is_front_of_queue: boolean; is_booked: boolean }
    > = {};
    for (const [seatCode, info] of Object.entries(res.seat_contenders)) {
      perSeat[seatCode] = {
        seat: seatCode,
        contenders: info.contenders,
        your_position: info.your_position,
        is_front_of_queue: info.is_front_of_queue && !bookedSet.has(seatCode),
        is_booked: bookedSet.has(seatCode),
      };
    }

    return NextResponse.json({
      success: true,
      schedule_id: id,
      total_active_queue: res.total_active_queue,
      max_queue_capacity: res.max_queue_capacity,
      booked_seats_count: bookedSet.size,
      per_seat: perSeat,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, message: 'Gagal memperbarui antrean kursi.', error: msg },
      { status: 500 }
    );
  }
}

