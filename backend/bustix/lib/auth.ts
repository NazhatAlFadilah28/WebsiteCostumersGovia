import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bustix-super-secret-jwt-key-2026';

export interface TokenPayload {
  id: string | number;
  nama: string;
  email: string;
  role: 'customer' | 'admin' | 'staf';
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(password, hashed);
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Ambil JWT token dari request: prioritas header `Authorization: Bearer <token>`,
 * lalu fallback ke cookie `token` (yang di-set saat login/register).
 */
export function getTokenFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  const headerToken = extractTokenFromHeader(authHeader);
  if (headerToken) return headerToken;

  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map((c) => {
      const [k, ...v] = c.split('=');
      return [k, v.join('=')];
    })
  );

  return cookies['token'] || null;
}

/**
 * Autentikasi request dan kembalikan payload token jika valid.
 * Return `null` jika token tidak ada / tidak valid / kedaluwarsa.
 */
export function authenticateRequest(request: Request): TokenPayload | null {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}
