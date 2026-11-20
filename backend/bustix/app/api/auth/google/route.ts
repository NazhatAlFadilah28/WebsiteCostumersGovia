import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { query } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface CachedGoogleAuthResult {
  expiresAt: number;
  payload: {
    success: boolean;
    message: string;
    token: string;
    user: {
      id: number | string;
      nama: string;
      email: string;
      no_hp: string;
      google_id: string | null;
      avatar_url: string | null;
      role: string;
    };
  };
}

const globalForGoogle = globalThis as unknown as {
  googleColumnsEnsured?: boolean;
  googleCodeCache?: Map<string, CachedGoogleAuthResult>;
};

if (!globalForGoogle.googleCodeCache) {
  globalForGoogle.googleCodeCache = new Map();
}

function readEnvFallback(key: string): string {
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        if (trimmed.slice(0, idx).trim() === key) {
          return trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        }
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

function getGoogleCredentials() {
  return {
    clientId: readEnvFallback('GOOGLE_CLIENT_ID'),
    clientSecret: readEnvFallback('GOOGLE_CLIENT_SECRET'),
  };
}

async function ensureGoogleColumns() {
  if (globalForGoogle.googleColumnsEnsured) return;
  try {
    await query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_id VARCHAR(120);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    `);
    globalForGoogle.googleColumnsEnsured = true;
  } catch {
    /* abaikan jika sudah ada */
  }
}

export async function GET(request: Request) {
  const { clientId, clientSecret } = getGoogleCredentials();
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { success: false, message: 'Konfigurasi GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum diatur di server.' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const originHeader = request.headers.get('origin') || request.headers.get('referer');
  let defaultRedirect = 'http://localhost:5174/auth/google/callback';
  if (originHeader) {
    try {
      const u = new URL(originHeader);
      defaultRedirect = `${u.origin}/auth/google/callback`;
    } catch {
      /* ignore */
    }
  }

  const redirectUri = searchParams.get('redirect_uri')?.trim() || defaultRedirect;
  const state = crypto.randomBytes(16).toString('hex');

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state,
    redirect_uri: redirectUri,
  });

  const response = NextResponse.json({
    success: true,
    client_id: clientId,
    auth_url: authUrl,
    state,
    redirect_uri: redirectUri,
  });

  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return response;
}

export async function POST(request: Request) {
  try {
    await ensureGoogleColumns();

    const { clientId, clientSecret } = getGoogleCredentials();
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { success: false, message: 'Konfigurasi Google OAuth belum diatur di server.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { code, redirect_uri, credential } = body as {
      code?: string;
      redirect_uri?: string;
      credential?: string;
    };

    // Idempotensi untuk mencegah React StrictMode menukar authorization code 2x
    if (code && globalForGoogle.googleCodeCache) {
      const cached = globalForGoogle.googleCodeCache.get(String(code));
      if (cached && cached.expiresAt > Date.now()) {
        const cachedRes = NextResponse.json(cached.payload);
        cachedRes.cookies.set('token', cached.payload.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 7 * 24 * 60 * 60,
          path: '/',
        });
        return cachedRes;
      }
    }

    let googleId = '';
    let email = '';
    let displayName = '';
    let avatarUrl: string | null = null;

    const finalRedirectUri = redirect_uri?.trim() || 'http://localhost:5174/auth/google/callback';
    const oauth2Client = new OAuth2Client(clientId, clientSecret, finalRedirectUri);

    if (code) {
      const { tokens } = await oauth2Client.getToken({
        code: String(code),
        redirect_uri: finalRedirectUri,
      });

      if (tokens.id_token) {
        const ticket = await oauth2Client.verifyIdToken({
          idToken: tokens.id_token,
          audience: clientId,
        });
        const info = ticket.getPayload();
        if (info) {
          googleId = info.sub || '';
          email = info.email || '';
          displayName = info.name || '';
          avatarUrl = info.picture || null;
        }
      }

      // Fallback ambil profil via Google UserInfo API jika id_token tidak menyertakan email/nama
      if ((!email || !googleId) && tokens.access_token) {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userInfoRes.ok) {
          const info = await userInfoRes.json();
          googleId = googleId || info.sub || '';
          email = email || info.email || '';
          displayName = displayName || info.name || '';
          avatarUrl = avatarUrl || info.picture || null;
        }
      }
    } else if (credential) {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: String(credential),
        audience: clientId,
      });
      const info = ticket.getPayload();
      if (info) {
        googleId = info.sub || '';
        email = info.email || '';
        displayName = info.name || '';
        avatarUrl = info.picture || null;
      }
    } else {
      return NextResponse.json(
        { success: false, message: 'Kode otorisasi atau token Google wajib dikirim.' },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { success: false, message: 'Email akun Google tidak berhasil diperoleh.' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const finalName = displayName.trim() || cleanEmail.split('@')[0];

    // Cari atau buat akun customer di database
    const existingRes = await query(
      `SELECT * FROM customers
       WHERE (google_id = $1 AND $1 <> '')
          OR LOWER(email) = LOWER($2)
       LIMIT 1`,
      [googleId, cleanEmail]
    );

    let customer;
    if (existingRes.rows.length === 0) {
      const insertRes = await query(
        `INSERT INTO customers (nama, email, no_hp, password, status, google_id, avatar_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [finalName, cleanEmail, '-', 'GOOGLE_OAUTH_AUTH', 'aktif', googleId || null, avatarUrl || null]
      );
      customer = insertRes.rows[0];
    } else {
      customer = existingRes.rows[0];
      const updateRes = await query(
        `UPDATE customers
         SET google_id = COALESCE(NULLIF($1, ''), google_id),
             nama = CASE WHEN (nama IS NULL OR nama = '') AND $2 <> '' THEN $2 ELSE nama END,
             avatar_url = COALESCE(NULLIF($4, ''), avatar_url)
         WHERE id = $3
         RETURNING *`,
        [googleId || '', finalName, customer.id, avatarUrl || '']
      );
      if (updateRes.rows.length > 0) {
        customer = updateRes.rows[0];
      }
    }

    const jwtToken = generateToken({
      id: customer.id,
      nama: customer.nama,
      email: customer.email,
      role: 'customer',
    });

    const payload = {
      success: true,
      message: 'Login dengan Akun Google berhasil.',
      token: jwtToken,
      user: {
        id: customer.id,
        nama: customer.nama,
        email: customer.email,
        no_hp: customer.no_hp,
        google_id: customer.google_id || googleId || null,
        avatar_url: avatarUrl || customer.avatar_url || null,
        role: 'customer',
      },
    };

    if (code && globalForGoogle.googleCodeCache) {
      globalForGoogle.googleCodeCache.set(String(code), {
        expiresAt: Date.now() + 60_000,
        payload,
      });
    }

    const response = NextResponse.json(payload);
    response.cookies.set('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });
    response.cookies.set('google_oauth_state', '', { maxAge: 0, path: '/' });

    return response;
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('Google Auth Error:', error);
    return NextResponse.json(
      { success: false, message: `Gagal login dengan Google: ${errMessage}` },
      { status: 500 }
    );
  }
}

