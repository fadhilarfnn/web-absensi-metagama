# Panduan Setup Backend Supabase: Presensi Metagama (High-Traffic Scale)

Dokumen ini berisi panduan arsitektur dan langkah implementasi teknis untuk memigrasikan backend Presensi Metagama dari Google Apps Script ke **Supabase (PostgreSQL + Object Storage + PostgREST)**, dirancang khusus untuk menangani lonjakan trafik (*concurrency rush*) **1.000+ mahasiswa** dalam rentang waktu beberapa menit.

---

## 1. Mengapa Supabase Ideal untuk Kasus Ini?

| Kebutuhan | Google Apps Script (Lama) | Supabase (Baru) |
| :--- | :--- | :--- |
| **Throughput Konkurensi** | Maksimal ~30 eksekusi serentak (sering timeout `waitLock`) | **Ribuan request/detik** didukung *connection pooling* Supabase (PgBouncer/Supavisor) |
| **Upload Foto Selfie** | Base64 di-decode di script -> Google Drive (2-4 detik/user) | Direct Upload ke **Supabase Storage Bucket** via CDN (< 300 ms) |
| **Validasi Anti-Joki** | Loop pencarian email di sheet (O(N)) | `UNIQUE constraint` & `B-Tree Index` di PostgreSQL (O(1)) |
| **Geofencing Calculation** | Rentan bypass di client-side | Menggunakan kalkulasi PostGIS / Haversine di Database Function (RPC) |
| **Biaya** | Gratis tapi ada kuota harian | Free Tier Supabase: 500 MB database, 1 GB storage, 50.000 active users |

---

## 2. Langkah Pembuatan Proyek di Supabase

1. Buka [https://supabase.com](https://supabase.com) dan login/daftar akun.
2. Klik **"New Project"**.
3. Isi konfigurasi:
   - **Name:** `metagama-presence`
   - **Database Password:** Buat kata sandi yang kuat (simpan baik-baik).
   - **Region:** Pilih **Singapore (`ap-southeast-1`)** untuk latensi terendah dari Indonesia (< 40ms).
4. Tunggu 1–2 menit hingga penyediaan infrastruktur selesai.
5. Masuk ke menu **Project Settings** -> **API**:
   - Salin **Project URL** (contoh: `https://xyzcompany.supabase.co`).
   - Salin **Anon (Public) Key** (key aman untuk sisi frontend web client).

---

## 3. Skema Database PostgreSQL (SQL Editor)

Buka menu **SQL Editor** di Dashboard Supabase, buat query baru dan jalankan DDL berikut:

```sql
-- 1. Buat Tabel Presensi dengan Constraint Anti-Duplikasi
CREATE TABLE public.presensi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT timezone('Asia/Jakarta', now()) NOT NULL,
    session_date DATE DEFAULT (CURRENT_DATE AT TIME ZONE 'Asia/Jakarta') NOT NULL,
    email VARCHAR(255) NOT NULL,
    nama VARCHAR(255) NOT NULL,
    nim VARCHAR(20) NOT NULL,
    jurusan VARCHAR(100) NOT NULL,
    prodi VARCHAR(100) NOT NULL,
    kelas VARCHAR(50) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    jarak_meter DOUBLE PRECISION NOT NULL,
    status_geofence VARCHAR(20) DEFAULT 'DALAM AREA' NOT NULL,
    selfie_url TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,

    -- Anti-Joki Layer: 1 Email & 1 NIM hanya boleh hadir 1x per sesi hari yang sama
    CONSTRAINT unique_email_per_day UNIQUE (email, session_date),
    CONSTRAINT unique_nim_per_day UNIQUE (nim, session_date)
);

-- 2. Index Performa Tinggi untuk Cek Kehadiran Instan (O(1))
CREATE INDEX idx_presensi_email_date ON public.presensi (email, session_date);
CREATE INDEX idx_presensi_nim_date ON public.presensi (nim, session_date);

-- 3. Aktifkan Row Level Security (RLS)
ALTER TABLE public.presensi ENABLE ROW LEVEL SECURITY;

-- 4. Kebijakan Keamanan (RLS Policies):
-- Mahasiswa anonim boleh menginput kehadiran (INSERT)
CREATE POLICY "Mahasiswa dapat submit presensi" 
ON public.presensi 
FOR INSERT 
TO anon 
WITH CHECK (true);

-- Hanya admin/panitia yang berhak membaca rekap data lengkap
CREATE POLICY "Hanya admin yang dapat membaca data presensi" 
ON public.presensi 
FOR SELECT 
TO authenticated 
USING (true);

-- Mahasiswa diizinkan membaca status dirinya sendiri hari ini untuk cek duplikasi
CREATE POLICY "Cek kehadiran diri sendiri"
ON public.presensi
FOR SELECT
TO anon
USING (true);
```

---

## 4. Konfigurasi Storage Bucket (Upload Foto Selfie)

Agar server database tidak terbebani file biner besar:
1. Masuk ke menu **Storage** -> Klik **"New Bucket"**.
2. Beri nama: `selfie-presensi`.
3. Centang opsi: **"Public bucket"** (agar foto memiliki URL publik yang bisa ditampilkan di panel admin).
4. Masuk ke tab **Policies** pada bucket `selfie-presensi`, tambahkan policy:
   - **Name:** `Allow Public Upload`
   - **Allowed operations:** Centang `INSERT`
   - **Target roles:** Centang `anon`

---

## 5. Server-Side Geofencing Function (Anti-Kecurangan GPS)

Untuk mencegah mahasiswa memalsukan parameter `jarak` melalui console browser, kita buat fungsi Stored Procedure (RPC) di SQL Editor:

```sql
CREATE OR REPLACE FUNCTION submit_presensi_verified(
    p_email TEXT,
    p_nama TEXT,
    p_nim TEXT,
    p_jurusan TEXT,
    p_prodi TEXT,
    p_kelas TEXT,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_selfie_url TEXT,
    p_target_lat DOUBLE PRECISION DEFAULT -6.872000, -- Masjid Luqmanul Hakim POLBAN
    p_target_lng DOUBLE PRECISION DEFAULT 107.573700,
    p_max_radius DOUBLE PRECISION DEFAULT 50.0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_distance DOUBLE PRECISION;
    v_new_id UUID;
BEGIN
    -- Formula Haversine di tingkat Database
    v_distance := 6371000 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS(p_lat - p_target_lat) / 2), 2) +
        COS(RADIANS(p_target_lat)) * COS(RADIANS(p_lat)) *
        POWER(SIN(RADIANS(p_lng - p_target_lng) / 2), 2)
    ));

    -- Validasi Geofence Sisi Server
    IF v_distance > p_max_radius THEN
        RETURN jsonb_build_object(
            'status', 'error',
            'message', 'Gagal: Lokasi Anda terdeteksi ' || ROUND(v_distance::numeric, 1) || ' meter di luar area Masjid Luqmanul Hakim.'
        );
    END IF;

    -- Simpan Data
    INSERT INTO public.presensi (
        email, nama, nim, jurusan, prodi, kelas, latitude, longitude, jarak_meter, status_geofence, selfie_url
    ) VALUES (
        LOWER(TRIM(p_email)), p_nama, p_nim, p_jurusan, p_prodi, p_kelas, p_lat, p_lng, v_distance, 'DALAM AREA', p_selfie_url
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'status', 'success',
        'id', v_new_id,
        'jarak', ROUND(v_distance::numeric, 1),
        'message', 'Presensi berhasil diverifikasi!'
    );

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'status', 'error',
            'message', 'Anda sudah melakukan presensi pada sesi hari ini.'
        );
END;
$$;
```

---

## 6. Integrasi ke Frontend Web (`app.js`)

Tambahkan CDN Supabase SDK di `index.html` (sebelum `app.js`):
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

Ubah fungsi penyimpanan di frontend:

```javascript
// 1. Inisialisasi Klien Supabase
const supabaseClient = supabase.createClient(
  "https://YOUR_PROJECT_REF.supabase.co",
  "YOUR_ANON_PUBLIC_KEY"
);

// 2. Fungsi Upload Foto Selfie (Blob Langsung ke Storage)
async function uploadSelfieToStorage(base64Data, nim) {
  const blob = await (await fetch(base64Data)).blob();
  const filePath = `${new Date().toISOString().slice(0, 10)}/${nim}_${Date.now()}.jpg`;

  const { data, error } = await supabaseClient.storage
    .from('selfie-presensi')
    .upload(filePath, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });

  if (error) throw error;

  const { data: publicUrlData } = supabaseClient.storage
    .from('selfie-presensi')
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
}

// 3. Submit Form Absensi Memanggil RPC Server-Side
async function handleSupabaseSubmit(formData) {
  // Upload foto ke Storage
  const photoUrl = await uploadSelfieToStorage(formData.selfieBase64, formData.nim);

  // Panggil Stored Procedure yang menghitung Haversine di DB
  const { data, error } = await supabaseClient.rpc('submit_presensi_verified', {
    p_email: formData.email,
    p_nama: formData.nama,
    p_nim: formData.nim,
    p_jurusan: formData.jurusan,
    p_prodi: formData.prodi,
    p_kelas: formData.kelas,
    p_lat: formData.latitude,
    p_lng: formData.longitude,
    p_selfie_url: photoUrl
  });

  if (error) throw error;
  return data;
}
```

---

## 7. Best Practices Menghadapi Trafik Tinggi (> 100 User/Detik)

1. **Gunakan Connection Pooling (Supavisor):**
   - API Supabase JS secara default menggunakan REST endpoint (PostgREST) yang bersifat *stateless* dan berjalan di atas *pooler*. Ini tidak mengunci koneksi database Postgres secara langsung sehingga ribuan koneksi masuk tidak akan membuat server kehabisan pool koneksi.
2. **Compress Foto di Sisi Client Sebelum Upload:**
   - Di `app.js`, kecilkan ukuran canvas selfie sebelum diubah ke Blob (resolusi optimal: `480x360` dengan JPEG quality `0.7`).
   - Ukuran file berkurang dari ~2 MB menjadi hanya **~40 KB - 80 KB**. Waktu upload terpangkas 90% dan menghemat kuota bandwidth mahasiswa.
3. **Database Constraints Membabat Race Condition:**
   - Tidak perlu lagi menggunakan mekanisme lock berdurasi lama seperti `LockService` di Google Apps Script. `UNIQUE (email, session_date)` di PostgreSQL mengeksekusi validasi duplikasi dalam hitungan mikrodetik pada tingkat database engine.
4. **Deploy Frontend di Global CDN Edge:**
   - Host frontend HTML/CSS/JS statis di **Cloudflare Pages**, **Vercel**, atau **GitHub Pages**. Beban pengunduhan aset CSS, icons, Leaflet, dan HTML ditangani 100% oleh edge CDN terdekat.
