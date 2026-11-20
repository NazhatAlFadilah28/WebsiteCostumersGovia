import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword, generateToken } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nama, email, password, no_hp } = body;

    if (!nama || !email || !password || !no_hp) {
      return NextResponse.json(
        { success: false, message: 'Semua field (nama, email, password, no_hp) wajib diisi.' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, message: 'Password minimal harus 8 karakter.' },
        { status: 400 }
      );
    }

    // Check existing customer email
    const existing = await query('SELECT id FROM customers WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { success: false, message: 'Email sudah terdaftar. Silakan gunakan email lain atau login.' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    const result = await query(
      `INSERT INTO customers (nama, email, password, no_hp, status)
       VALUES ($1, $2, $3, $4, 'aktif')
       RETURNING id, nama, email, no_hp, status, created_at`,
      [nama, email, hashedPassword, no_hp]
    );

    const customer = result.rows[0];
    const token = generateToken({
      id: customer.id,
      nama: customer.nama,
      email: customer.email,
      role: 'customer'
    });

    const response = NextResponse.json({
      success: true,
      message: 'Registrasi customer berhasil.',
      token,
      user: {
        id: customer.id,
        nama: customer.nama,
        email: customer.email,
        no_hp: customer.no_hp,
        role: 'customer'
      }
    }, { status: 201 });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
      path: '/'
    });

    return response;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Register API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Terjadi kesalahan pada server.', error: errMessage },
      { status: 500 }
    );
  }
}
