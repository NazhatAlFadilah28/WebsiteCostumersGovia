import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { comparePassword, generateToken } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email dan password wajib diisi.' },
        { status: 400 }
      );
    }

    const res = await query('SELECT * FROM customers WHERE email = $1 AND status = \'aktif\'', [email]);
    if (res.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Email atau password salah.' },
        { status: 401 }
      );
    }

    const customer = res.rows[0];
    const isMatch = await comparePassword(password, customer.password);

    if (!isMatch) {
      return NextResponse.json(
        { success: false, message: 'Email atau password salah.' },
        { status: 401 }
      );
    }

    const token = generateToken({
      id: customer.id,
      nama: customer.nama,
      email: customer.email,
      role: 'customer'
    });

    const response = NextResponse.json({
      success: true,
      message: 'Login customer berhasil.',
      token,
      user: {
        id: customer.id,
        nama: customer.nama,
        email: customer.email,
        no_hp: customer.no_hp,
        role: 'customer'
      }
    });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
      path: '/'
    });

    return response;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Login Customer API Error:', error);
    return NextResponse.json(
      { success: false, message: 'Terjadi kesalahan pada server.', error: errMessage },
      { status: 500 }
    );
  }
}
