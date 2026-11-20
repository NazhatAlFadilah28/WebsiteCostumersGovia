import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * ============================================================
 * POST /api/jadwal — Simpan Input Rute & Penumpang ke Database
 * ============================================================
 * Menampung input Foto ke-2:
 * 1. nama_penumpang (Nama Lengkap Penumpang)
 * 2. no_identitas   (Nomor Induk Kependudukan / Identitas)
 * 3. asal_kota      (Rute Kamu Sekarang / Kota Asal)
 * 4. tujuan_kota    (Rute Tujuan / Terminal Kedatangan)
 * 5. tanggal_berangkat (Tanggal Berangkat - YYYY-MM-DD)
 * 6. kelas_layanan  (Kelas Layanan)
 * ============================================================
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      nama_penumpang,
      no_identitas,
      asal_kota,
      tujuan_kota,
      tanggal_berangkat,
      kelas_layanan = 'Eksekutif'
    } = body;

    // ── 1. Validasi Input Data ──────────────────────────────
    if (!nama_penumpang?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Nama lengkap penumpang wajib diisi.' },
        { status: 400 }
      );
    }

    if (!no_identitas?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Nomor Induk Kependudukan (NIK) / Identitas wajib diisi.' },
        { status: 400 }
      );
    }

    if (!asal_kota?.trim() || !tujuan_kota?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Rute asal dan rute tujuan wajib diisi.' },
        { status: 400 }
      );
    }

    if (!tanggal_berangkat) {
      return NextResponse.json(
        { success: false, message: 'Tanggal berangkat wajib dipilih.' },
        { status: 400 }
      );
    }

    // ── 2. Simpan ke Tabel tiket_perjalanan di Database ──────
    const insertSql = `
      INSERT INTO tiket_perjalanan (
        nama_penumpang,
        no_identitas,
        asal_kota,
        tujuan_kota,
        tanggal_berangkat,
        kelas_layanan,
        status_pemesanan
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      nama_penumpang.trim(),
      no_identitas.trim(),
      asal_kota.trim(),
      tujuan_kota.trim(),
      tanggal_berangkat,
      kelas_layanan.trim() || 'Eksekutif',
      'terkonfirmasi'
    ];

    const result = await query(insertSql, values);
    const newRecord = result.rows[0];

    return NextResponse.json(
      {
        success: true,
        message: 'Data perjalanan dan identitas penumpang berhasil disimpan ke database!',
        data: newRecord
      },
      { status: 201 }
    );

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('API Jadwal POST Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Terjadi kesalahan pada server saat menyimpan data ke database.',
        error: errMessage
      },
      { status: 500 }
    );
  }
}

/**
 * ============================================================
 * GET /api/jadwal — Ambil Riwayat Inputan Tiket dari Database
 * ============================================================
 */
export async function GET() {
  try {
    const result = await query(
      `SELECT * FROM tiket_perjalanan ORDER BY id DESC LIMIT 50`
    );

    return NextResponse.json({
      success: true,
      total: result.rowCount,
      data: result.rows
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('API Jadwal GET Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Gagal mengambil data dari database.',
        error: errMessage
      },
      { status: 500 }
    );
  }
}
