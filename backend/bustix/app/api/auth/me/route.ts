import { NextResponse } from 'next/server';
import { extractTokenFromHeader, verifyToken } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = extractTokenFromHeader(authHeader);

    // Fallback to cookie
    if (!token) {
      const cookieHeader = request.headers.get('cookie');
      if (cookieHeader) {
        const cookies = Object.fromEntries(
          cookieHeader.split('; ').map(c => {
            const [k, ...v] = c.split('=');
            return [k, v.join('=')];
          })
        );
        token = cookies['token'] || null;
      }
    }

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Tidak terautentikasi (Token tidak ditemukan).' },
        { status: 401 }
      );
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json(
        { success: false, message: 'Token tidak valid atau sudah kedaluwarsa.' },
        { status: 401 }
      );
    }

    // Ambil detail pengguna terkini dari database
    let userDetails = { ...decoded };
    try {
      const dbRes = await query(
        'SELECT id, nama, email, no_hp, google_id, avatar_url, status FROM customers WHERE id = $1',
        [decoded.id]
      );
      if (dbRes.rows.length > 0) {
        userDetails = { ...decoded, ...dbRes.rows[0], role: 'customer' };
      }
    } catch {
      // Jika fallback query gagal, gunakan token decoded
    }

    return NextResponse.json({
      success: true,
      user: userDetails
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: 'Terjadi kesalahan pada server.', error: errMessage },
      { status: 500 }
    );
  }
}
