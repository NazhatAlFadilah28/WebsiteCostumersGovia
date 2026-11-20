/**
 * High-Concurrency In-Memory Seat Selection Queue (kapasitas hingga 20.000 pemilih simultan)
 * Melacak antrean pengguna yang sedang memilih / mengincar kursi tertentu secara real-time,
 * terpisah dari kursi yang sudah selesai dibooking di PostgreSQL.
 */

export const MAX_SEAT_QUEUE_CAPACITY = 20000;
const CONTENDER_TTL_MS = 90_000; // 90 detik heartbeat

export interface SeatContenderEntry {
  sessionId: string;
  scheduleId: string;
  userLabel: string;
  /** Map seatCode (uppercase) -> monotonic sequence number when this session selected that seat */
  seatSeqs: Map<string, number>;
  joinedAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface PerSeatQueueInfo {
  seat: string;
  contenders: number;
  your_position: number | null;
  is_front_of_queue: boolean;
  is_booked: boolean;
}

const globalForSeatQueue = globalThis as unknown as {
  seatQueueMap?: Map<string, Map<string, SeatContenderEntry>>;
  seatQueueSeq?: number;
  bookingAttemptSeq?: Map<string, number>;
};

if (!globalForSeatQueue.seatQueueMap) {
  globalForSeatQueue.seatQueueMap = new Map();
}
if (!globalForSeatQueue.seatQueueSeq) {
  globalForSeatQueue.seatQueueSeq = 0;
}
if (!globalForSeatQueue.bookingAttemptSeq) {
  globalForSeatQueue.bookingAttemptSeq = new Map();
}

function getScheduleBucket(scheduleId: string): Map<string, SeatContenderEntry> {
  const key = String(scheduleId);
  let bucket = globalForSeatQueue.seatQueueMap!.get(key);
  if (!bucket) {
    bucket = new Map();
    globalForSeatQueue.seatQueueMap!.set(key, bucket);
  }
  return bucket;
}

export function pruneExpiredContenders(scheduleId: string): Map<string, SeatContenderEntry> {
  const bucket = getScheduleBucket(scheduleId);
  const now = Date.now();
  for (const [sid, entry] of bucket.entries()) {
    if (entry.expiresAt <= now) {
      bucket.delete(sid);
    }
  }
  return bucket;
}

export function nextBookingAttemptNumber(scheduleId: string): number {
  const key = String(scheduleId);
  const next = (globalForSeatQueue.bookingAttemptSeq!.get(key) || 0) + 1;
  globalForSeatQueue.bookingAttemptSeq!.set(key, next);
  return next;
}

export function joinOrUpdateSeatQueue(params: {
  scheduleId: string;
  sessionId: string;
  seats: string[];
  userLabel?: string;
}): {
  accepted: boolean;
  code?: string;
  message?: string;
  total_active_queue: number;
  max_queue_capacity: number;
  seat_contenders: Record<string, { contenders: number; your_position: number | null; is_front_of_queue: boolean }>;
} {
  const bucket = pruneExpiredContenders(params.scheduleId);
  const now = Date.now();
  const normalizedSeats = Array.from(
    new Set(params.seats.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))
  );

  let entry = bucket.get(params.sessionId);
  if (!entry) {
    if (bucket.size >= MAX_SEAT_QUEUE_CAPACITY) {
      return {
        accepted: false,
        code: 'QUEUE_FULL',
        message: `Antrean pemilihan kursi sedang penuh (${MAX_SEAT_QUEUE_CAPACITY.toLocaleString('id-ID')} pengguna aktif). Silakan coba sesaat lagi.`,
        total_active_queue: bucket.size,
        max_queue_capacity: MAX_SEAT_QUEUE_CAPACITY,
        seat_contenders: {},
      };
    }
    entry = {
      sessionId: params.sessionId,
      scheduleId: String(params.scheduleId),
      userLabel: params.userLabel || 'Customer',
      seatSeqs: new Map(),
      joinedAt: now,
      lastSeenAt: now,
      expiresAt: now + CONTENDER_TTL_MS,
    };
    bucket.set(params.sessionId, entry);
  }

  // Pertahankan urutan seq lama untuk kursi yang masih dipilih; beri seq baru untuk kursi baru
  const updatedSeatSeqs = new Map<string, number>();
  for (const seatCode of normalizedSeats) {
    const existingSeq = entry.seatSeqs.get(seatCode);
    if (existingSeq !== undefined) {
      updatedSeatSeqs.set(seatCode, existingSeq);
    } else {
      globalForSeatQueue.seatQueueSeq = (globalForSeatQueue.seatQueueSeq || 0) + 1;
      updatedSeatSeqs.set(seatCode, globalForSeatQueue.seatQueueSeq);
    }
  }
  entry.seatSeqs = updatedSeatSeqs;
  entry.lastSeenAt = now;
  entry.expiresAt = now + CONTENDER_TTL_MS;
  if (params.userLabel) entry.userLabel = params.userLabel;

  const snapshot = buildSeatContendersSnapshot(bucket, params.sessionId, normalizedSeats);
  return {
    accepted: true,
    total_active_queue: bucket.size,
    max_queue_capacity: MAX_SEAT_QUEUE_CAPACITY,
    seat_contenders: snapshot,
  };
}

export function leaveSeatQueue(scheduleId: string, sessionId: string): number {
  const bucket = pruneExpiredContenders(scheduleId);
  bucket.delete(sessionId);
  return bucket.size;
}

export function clearSeatFromAllContenders(scheduleId: string, seatCodes: string[]): void {
  const bucket = pruneExpiredContenders(scheduleId);
  const targets = new Set(seatCodes.map((s) => String(s || '').trim().toUpperCase()));
  for (const entry of bucket.values()) {
    for (const code of targets) {
      entry.seatSeqs.delete(code);
    }
  }
}

export function getSeatQueueSnapshot(
  scheduleId: string,
  sessionId?: string,
  requestedSeats: string[] = []
): {
  total_active_queue: number;
  max_queue_capacity: number;
  seat_contenders: Record<string, { contenders: number; your_position: number | null; is_front_of_queue: boolean }>;
} {
  const bucket = pruneExpiredContenders(scheduleId);
  const normalizedSeats = Array.from(
    new Set(requestedSeats.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))
  );
  return {
    total_active_queue: bucket.size,
    max_queue_capacity: MAX_SEAT_QUEUE_CAPACITY,
    seat_contenders: buildSeatContendersSnapshot(bucket, sessionId, normalizedSeats),
  };
}

function buildSeatContendersSnapshot(
  bucket: Map<string, SeatContenderEntry>,
  sessionId?: string,
  requestedSeats: string[] = []
): Record<string, { contenders: number; your_position: number | null; is_front_of_queue: boolean }> {
  // Kumpulkan semua kursi yang sedang diincar (atau diminta)
  const seatLists = new Map<string, Array<{ sessionId: string; seq: number }>>();
  for (const seat of requestedSeats) {
    seatLists.set(seat, []);
  }
  for (const entry of bucket.values()) {
    for (const [seatCode, seq] of entry.seatSeqs.entries()) {
      let arr = seatLists.get(seatCode);
      if (!arr) {
        arr = [];
        seatLists.set(seatCode, arr);
      }
      arr.push({ sessionId: entry.sessionId, seq });
    }
  }

  const result: Record<string, { contenders: number; your_position: number | null; is_front_of_queue: boolean }> = {};
  for (const [seatCode, arr] of seatLists.entries()) {
    arr.sort((a, b) => a.seq - b.seq);
    const idx = sessionId ? arr.findIndex((item) => item.sessionId === sessionId) : -1;
    const pos = idx >= 0 ? idx + 1 : null;
    result[seatCode] = {
      contenders: arr.length,
      your_position: pos,
      is_front_of_queue: pos === 1,
    };
  }
  return result;
}

