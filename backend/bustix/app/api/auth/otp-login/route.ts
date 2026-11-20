import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendEmailCode } from '@/lib/mailer';
import { generateToken } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, email, code, nama, no_hp, role, password } = body;

    // 0. Login Khusus Admin Operasional & Staf Penjemputan / Lapangan
    if (action === 'role-login') {
      const targetRole = role === 'admin' ? 'admin' : role === 'staf' ? 'staf' : 'customer';
      const cleanEmail = (email || `${targetRole}@bustix.id`).trim();
      const displayName =
        nama ||
        (targetRole === 'admin'
          ? 'Admin Operasional BusTix'
          : targetRole === 'staf'
          ? 'Staf Lapangan & Dispatcher Bus'
          : 'Customer BusTix');

      const roleId = targetRole === 'admin' ? 'admin-1' : targetRole === 'staf' ? 'staf-1' : '1';

      if (password && password.length < 3) {
        return NextResponse.json({ success: false, message: 'Password tidak valid.' }, { status: 400 });
      }

      const jwtToken = generateToken({
        id: roleId,
        nama: displayName,
        email: cleanEmail,
        role: targetRole,
      });

      const response = NextResponse.json({
        success: true,
        message: `Login sebagai ${targetRole.toUpperCase()} berhasil.`,
        token: jwtToken,
        user: {
          id: roleId,
          nama: displayName,
          email: cleanEmail,
          no_hp: no_hp || '081200001111',
          role: targetRole,
        },
      });

      response.cookies.set('token', jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      });

      return response;
    }

    // 1. Request OTP Code via Email
    if (action === 'request-code') {
      if (!email) {
        return NextResponse.json({ success: false, message: 'Email wajib diisi.' }, { status: 400 });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      const checkCust = await query('SELECT * FROM customers WHERE email = $1', [email]);
      if (checkCust.rows.length === 0) {
        await query(
          'INSERT INTO customers (nama, email, no_hp, password, status, verification_code, verification_code_expires) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [nama || email.split('@')[0], email, no_hp || '-', 'OTP_USER', 'aktif', otp, expires]
        );
      } else {
        await query(
          'UPDATE customers SET verification_code = $1, verification_code_expires = $2 WHERE email = $3',
          [otp, expires, email]
        );
      }

      const { sent } = await sendEmailCode(email, otp);

      // Kode hanya dibocorkan di response saat SMTP belum dikonfigurasi (dev lokal)
      const devMode = !sent && process.env.NODE_ENV !== 'production';

      return NextResponse.json({
        success: true,
        message: sent
          ? 'Kode verifikasi telah dikirim ke email Anda.'
          : 'SMTP email belum dikonfigurasi. Gunakan kode di bawah (mode dev).',
        ...(devMode ? { dev_code: otp } : {}),
      });
    }

    // 2. Verify OTP Code
    if (action === 'verify-code') {
      if (!email) {
        return NextResponse.json({ success: false, message: 'Email wajib diisi.' }, { status: 400 });
      }

      const res = await query('SELECT * FROM customers WHERE email = $1', [email]);
      let customer;

      if (res.rows.length === 0) {
        const insertRes = await query(
          'INSERT INTO customers (nama, email, no_hp, password, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [nama || email.split('@')[0], email, no_hp || '-', 'OTP_USER', 'aktif']
        );
        customer = insertRes.rows[0];
      } else {
        customer = res.rows[0];
        if (action === 'verify-code') {
          if (customer.verification_code && customer.verification_code !== code) {
            return NextResponse.json({ success: false, message: 'Kode verifikasi salah.' }, { status: 400 });
          }
        }
      }

      const jwtToken = generateToken({
        id: customer.id,
        nama: customer.nama,
        email: customer.email,
        role: 'customer'
      });

      const response = NextResponse.json({
        success: true,
        message: 'Login berhasil.',
        token: jwtToken,
        user: {
          id: customer.id,
          nama: customer.nama,
          email: customer.email,
          no_hp: customer.no_hp,
          google_id: customer.google_id || null,
          role: 'customer'
        }
      });

      response.cookies.set('token', jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60,
        path: '/'
      });

      return response;
    }

    return NextResponse.json({ success: false, message: 'Aksi tidak dikenal.' }, { status: 400 });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Auth Error:', error);
    return NextResponse.json({ success: false, message: 'Terjadi kesalahan server.', error: errMessage }, { status: 500 });
  }
}
