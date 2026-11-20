/**
 * =============================================================================
 * BusTix End-to-End Flow Test
 * =============================================================================
 * Menguji alur lengkap: login → cari jadwal → ambil kursi → lock kursi →
 * uji anti double-booking → charge pembayaran → konfirmasi → ambil e-ticket.
 *
 * Jalankan: node test-flow.js
 * (Pastikan backend "npm run dev" sudah berjalan di port 3000)
 * =============================================================================
 */

const BASE = 'http://localhost:3000';

let pass = 0;
let fail = 0;

function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name} ${extra}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function ensureCustomer() {
  // Coba login dengan akun seed
  let r = await req('/api/auth/login-customer', {
    method: 'POST',
    body: { email: 'customer@bustix.com', password: 'customer123' },
  });
  if (r.status === 200 && r.data?.token) return r.data;

  // Jika gagal, daftar akun baru dengan email unik
  const email = `tester${Date.now()}@bustix.com`;
  r = await req('/api/auth/register', {
    method: 'POST',
    body: { nama: 'Tester Otomatis', email, password: 'tester12345', no_hp: '081200000000' },
  });
  return r.data;
}

async function main() {
  console.log('\n=== BUS TIX END-TO-END FLOW TEST ===\n');

  // ── 1. AUTH ──────────────────────────────────────────────────────────
  console.log('1. AUTHENTIKASI');
  const userA = await ensureCustomer();
  ok('Login/Register user A', !!userA?.token, `(${userA?.user?.nama})`);

  const userB = await (async () => {
    const email = `testerb${Date.now()}@bustix.com`;
    const r = await req('/api/auth/register', {
      method: 'POST',
      body: { nama: 'Tester B', email, password: 'tester12345', no_hp: '081200000001' },
    });
    return r.data;
  })();
  ok('Register user B', !!userB?.token);

  // ── 2. CARI JADWAL (WAJIB LOGIN) ────────────────────────────────────
  console.log('\n2. CARI JADWAL (UJI KEBIJAKAN LOGIN)');
  const noAuthSearch = await req('/api/schedules/search');
  ok('Cari jadwal tanpa login DITOLAK (401)', noAuthSearch.status === 401, `(status=${noAuthSearch.status})`);

  let search = await req('/api/schedules/search', { token: userA.token });
  let schedules = search.data?.data || [];
  if (schedules.length === 0) {
    // Coba tanpa filter tanggal — ambil semua
    search = await req('/api/schedules/search?', { token: userA.token });
    schedules = search.data?.data || [];
  }
  ok('Cari jadwal dengan login BERHASIL', Array.isArray(schedules), `(${schedules.length} jadwal)`);

  if (schedules.length === 0) {
    console.log('\n⚠️  Tidak ada jadwal. Jalankan "node seed-data.js" lalu ulangi.\n');
    process.exit(1);
  }

  const scheduleId = schedules[0].id;
  console.log(`  ℹ️  Memakai schedule_id = ${scheduleId} (${schedules[0].nama_bus})`);

  // ── 3. AMBIL KURSI ───────────────────────────────────────────────────
  console.log('\n3. AMBIL DENAH KURSI (WAJIB LOGIN)');
  const noAuthSeats = await req(`/api/schedules/${scheduleId}/seats`);
  ok('Denah kursi tanpa login DITOLAK (401)', noAuthSeats.status === 401, `(status=${noAuthSeats.status})`);

  const seatsRes = await req(`/api/schedules/${scheduleId}/seats`, { token: userA.token });
  const seats = seatsRes.data?.seats || [];
  ok('Endpoint seats mengembalikan kursi', seats.length > 0, `(${seats.length} kursi)`);

  const available = seats.filter(s => s.status === 'tersedia');
  ok('Ada kursi tersedia', available.length > 0, `(${available.length} tersedia)`);

  if (available.length < 1) {
    console.log('\n⚠️  Semua kursi terisi. Pilih jadwal lain.\n');
    process.exit(1);
  }

  const seat1 = available[0];
  const seat2 = available[1] || available[0];

  // ── 4. LOCK KURSI (USER A) ───────────────────────────────────────────
  console.log('\n4. LOCK KURSI — USER A');
  const lockA = await req('/api/booking/lock-seats', {
    method: 'POST',
    token: userA.token,
    body: {
      schedule_id: scheduleId,
      metode_pembayaran: 'qris',
      passengers: [{
        seat_id: seat1.seat_id,
        nama_penumpang: 'Tester A',
        no_identitas: '3171052809920001',
        no_hp: '081200000000',
      }],
    },
  });
  ok('Lock kursi berhasil (201)', lockA.status === 201, `(kursi ${seat1.nomor_kursi})`);
  const bookingCode = lockA.data?.booking?.kode_booking;
  ok('Dapat kode booking', !!bookingCode, `(${bookingCode})`);

  // ── 5. UJI ANTI DOUBLE-BOOKING (USER B, kursi sama) ──────────────────
  console.log('\n5. ANTI DOUBLE-BOOKING — USER B coba kursi yang sama');
  const lockB = await req('/api/booking/lock-seats', {
    method: 'POST',
    token: userB.token,
    body: {
      schedule_id: scheduleId,
      metode_pembayaran: 'qris',
      passengers: [{
        seat_id: seat1.seat_id,
        nama_penumpang: 'Tester B',
        no_identitas: '3171052809920002',
        no_hp: '081200000001',
      }],
    },
  });
  ok('Kursi yang sama DITOLAK (409)', lockB.status === 409, `(status=${lockB.status})`);
  ok('Pesan error menyebut kursi sudah dipesan', /sudah dipesan|ditahan/i.test(lockB.data?.message || ''), `("${lockB.data?.message}")`);

  // ── 6. UJI AUTH WAJIB ────────────────────────────────────────────────
  console.log('\n6. AUTH WAJIB (tanpa token)');
  const lockNoAuth = await req('/api/booking/lock-seats', {
    method: 'POST',
    body: {
      schedule_id: scheduleId,
      passengers: [{
        seat_id: seat2.seat_id,
        nama_penumpang: 'Hacker',
        no_identitas: '1111111111111111',
        no_hp: '081111111111',
      }],
    },
  });
  ok('Tanpa token DITOLAK (401)', lockNoAuth.status === 401, `(status=${lockNoAuth.status})`);

  // ── 7. CEK DENAH — kursi yang di-lock harus "terisi" ─────────────────
  console.log('\n7. VERIFIKASI STATUS KURSI DI DENAH');
  const seatsAfter = await req(`/api/schedules/${scheduleId}/seats`, { token: userA.token });
  const lockedSeat = (seatsAfter.data?.seats || []).find(s => String(s.seat_id) === String(seat1.seat_id));
  ok('Kursi yang di-lock berstatus "terisi"', lockedSeat?.status === 'terisi', `(status=${lockedSeat?.status})`);

  // ── 8. DETAIL BOOKING ────────────────────────────────────────────────
  console.log('\n8. DETAIL BOOKING');
  const detail = await req(`/api/booking/${bookingCode}`, { token: userA.token });
  ok('Ambil detail booking', detail.status === 200 && detail.data?.success);
  ok('Booking berstatus menunggu_bayar', detail.data?.data?.status === 'menunggu_bayar', `(${detail.data?.data?.status})`);

  // ── 9. CHARGE PEMBAYARAN ─────────────────────────────────────────────
  console.log('\n9. CHARGE PEMBAYARAN');
  const charge = await req('/api/payments/charge', {
    method: 'POST',
    token: userA.token,
    body: { booking_code: bookingCode, metode: 'qris' },
  });
  ok('Charge berhasil', charge.status === 200 && charge.data?.success, `(mode=${charge.data?.mode})`);
  ok('Mode midtrans atau simulation', ['midtrans', 'simulation'].includes(charge.data?.mode));

  // ── 10. KONFIRMASI PEMBAYARAN ────────────────────────────────────────
  console.log('\n10. KONFIRMASI PEMBAYARAN');
  const confirm = await req('/api/payments/confirm', {
    method: 'POST',
    token: userA.token,
    body: { booking_code: bookingCode },
  });
  ok('Konfirmasi berhasil', confirm.status === 200 && confirm.data?.success, `(status=${confirm.data?.status})`);

  // ── 11. E-TICKET ─────────────────────────────────────────────────────
  console.log('\n11. AMBIL E-TICKET');
  const ticket = await req(`/api/tickets/${bookingCode}`, { token: userA.token });
  ok('E-Ticket ditemukan', ticket.status === 200 && ticket.data?.success);
  ok('Status booking = lunas', ticket.data?.data?.status_booking === 'lunas', `(${ticket.data?.data?.status_booking})`);

  // ── 12. RIWAYAT PESANAN ──────────────────────────────────────────────
  console.log('\n12. RIWAYAT PESANAN (USER A)');
  const history = await req('/api/customer/history', { token: userA.token });
  ok('Riwayat berhasil diambil', history.status === 200 && history.data?.success, `(${history.data?.total} pesanan)`);

  // ── 13. BATALKAN BOOKING BARU ────────────────────────────────────────
  console.log('\n13. BATALKAN BOOKING (melepas kursi)');
  const lockCancel = await req('/api/booking/lock-seats', {
    method: 'POST',
    token: userA.token,
    body: {
      schedule_id: scheduleId,
      passengers: [{
        seat_id: seat2.seat_id,
        nama_penumpang: 'Tester A2',
        no_identitas: '3171052809920003',
        no_hp: '081200000000',
      }],
    },
  });
  const cancelCode = lockCancel.data?.booking?.kode_booking;
  const cancel = await req(`/api/booking/${cancelCode}`, { method: 'DELETE', token: userA.token });
  ok('Batalkan booking berhasil', cancel.status === 200 && cancel.data?.success);

  const seatsAfterCancel = await req(`/api/schedules/${scheduleId}/seats`, { token: userA.token });
  const releasedSeat = (seatsAfterCancel.data?.seats || []).find(s => String(s.seat_id) === String(seat2.seat_id));
  ok('Kursi kembali "tersedia" setelah dibatalkan', releasedSeat?.status === 'tersedia', `(status=${releasedSeat?.status})`);

  // ── HASIL ────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  console.log(`HASIL: ${pass} lulus, ${fail} gagal`);
  console.log('='.repeat(50) + '\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ Test error (pastikan backend "npm run dev" sudah berjalan):', e.message, '\n');
  process.exit(1);
});
