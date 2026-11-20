const http = require('http');

const PORT = 3000;

console.log('=== BUSTIX CUSTOMER BACKEND API TESTER ===\n');

async function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  try {
    console.log('1. Testing GET /api/schedules/search TANPA LOGIN (Harus Ditolak 401)...');
    const searchNoAuth = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/schedules/search',
      method: 'GET'
    });
    console.log('   Response Status:', searchNoAuth.status, searchNoAuth.status === 401 ? '✅ (Terkunci Sesuai Kebijakan Wajib Login)' : '❌');
    console.log('   Pesan:', searchNoAuth.body?.message || searchNoAuth.body, '\n');

    console.log('2. Testing POST /api/auth/login-customer...');
    const loginRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/auth/login-customer',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      email: 'customer@bustix.com',
      password: 'customer123'
    });
    console.log('   Response Status:', loginRes.status);
    console.log('   User Logged In:', loginRes.body?.user?.nama || loginRes.body?.message);
    const token = loginRes.body?.token;
    console.log('   Token Diterima:', token ? '✅ Ya' : '❌ Tidak', '\n');

    if (token) {
      console.log('3. Testing GET /api/schedules/search DENGAN TOKEN LOGIN (Harus Berhasil 200)...');
      const searchWithAuth = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: '/api/schedules/search',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      console.log('   Response Status:', searchWithAuth.status, searchWithAuth.status === 200 ? '✅ (Berhasil Akses Jadwal)' : '❌');
      console.log('   Total Jadwal Ditemukan:', searchWithAuth.body?.total, 'jadwal\n');
    }

  } catch (error) {
    console.error('Test Error (Pastikan server "npm run dev" sudah berjalan):', error.message);
  }
}

console.log('Petunjuk: Jalankan "npm run dev" di terminal lain terlebih dahulu, lalu jalankan "node test-api.js".\n');
runTests();
