import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface NotificationRow {
  id: number;
  category: string | null;
  code: string | null;
  time_label: string | null;
  title: string | null;
  message: string | null;
  is_read: boolean | null;
  created_at: string | Date | null;
}

export async function GET() {
  try {
    const res = await query(
      `SELECT id, category, code, time_label, title, message, is_read, created_at
       FROM notifications
       ORDER BY id DESC
       LIMIT 30`
    );

    const rows = (res.rows as NotificationRow[]).map((row) => ({
      id: `SB-${row.id}`,
      rawId: row.id,
      category: row.category || 'Notifikasi Admin',
      code: row.code || 'ADMIN-PUSAT',
      title: row.title || 'Pengumuman Resmi GOVIA',
      message: row.message || '-',
      time_label: row.time_label || 'Baru saja',
      is_read: Boolean(row.is_read),
      created_at: row.created_at
        ? new Date(row.created_at).toISOString()
        : new Date().toISOString(),
    }));

    return NextResponse.json({ success: true, data: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Customer GET /api/notifications error:', msg);
    return NextResponse.json({ success: true, data: [] });
  }
}

