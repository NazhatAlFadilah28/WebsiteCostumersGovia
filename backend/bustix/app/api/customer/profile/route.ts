import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword, authenticateRequest } from '@/lib/auth';

export async function PUT(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Anda harus login terlebih dahulu untuk memperbarui profil.'
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { nama, no_hp, password_baru } = body;
    const customer_id = auth.id;

    if (password_baru && password_baru.length < 8) {
      return NextResponse.json(
        { success: false, message: 'Password baru minimal 8 karakter.' },
        { status: 400 }
      );
    }

    if (password_baru) {
      const hashedPassword = await hashPassword(password_baru);
      await query(
        `UPDATE customers 
         SET nama = COALESCE($1, nama), no_hp = COALESCE($2, no_hp), password = $3 
         WHERE id = $4`,
        [nama || null, no_hp || null, hashedPassword, customer_id]
      );
    } else {
      await query(
        `UPDATE customers 
         SET nama = COALESCE($1, nama), no_hp = COALESCE($2, no_hp) 
         WHERE id = $3`,
        [nama || null, no_hp || null, customer_id]
      );
    }

    const updated = await query('SELECT id, nama, email, no_hp, status FROM customers WHERE id = $1', [customer_id]);

    return NextResponse.json({
      success: true,
      message: 'Profil customer berhasil diperbarui.',
      user: updated.rows[0]
    });

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Customer Profile API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal memperbarui profil.', error: errMessage },
      { status: 500 }
    );
  }
}
