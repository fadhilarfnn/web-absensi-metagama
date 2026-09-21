/**
 * ============================================================
 * KONFIGURASI ADMIN - EDIT FILE INI SEBELUM DEPLOY
 * ============================================================
 * 
 * File ini berisi pengaturan utama yang hanya perlu diubah 
 * oleh admin (Anda) satu kali sebelum membagikan link ke mahasiswa.
 * 
 * Mahasiswa TIDAK perlu mengubah apapun di file ini.
 */

const APP_CONFIG = {

  // ======== 1. BACKEND STORAGE & DATABASE ========
  // Opsi A: Google Sheets (Google Apps Script Web App URL)
  GOOGLE_SHEET_URL: "https://script.google.com/macros/s/AKfycbxfcEZvqedbxFb2MmqnEVU492UEl4WaQ-Ahenyf8cO2lzo98w20wH7hhztWzkdu6n5snQ/exec",

  // Opsi B: Supabase (High Traffic Scale - Rekomendasi 1000+ Peserta)
  // Dapatkan URL dan Anon Key dari: Supabase Dashboard -> Project Settings -> API
  SUPABASE_URL: "https://ceqkhwlbjsikcicrbqjo.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlcWtod2xianNpa2NpY3JicWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5ODE1NTUsImV4cCI6MjEwNTU1NzU1NX0.T0_PeE_ZOTQ3xdTq0ZohIU0N0FkkR9OD39fOhPO5sCw",
  // Pilih provider backend aktif: "sheets" atau "supabase"
  BACKEND_PROVIDER: "supabase",

  // ======== 2. GOOGLE SIGN-IN CREDENTIALS ========
  // Buat Google Client ID dari Google Cloud Console agar mahasiswa wajib login Google POLBAN.
  // Panduan lengkap cara mendapatkannya tertulis di admin.html.
  // Jika ini dibiarkan kosong (""), sistem otomatis menggunakan 'Simulasi Google Login' untuk uji coba lokal.
  GOOGLE_CLIENT_ID: "22320107936-sbadrbil3kf27846fae8s6r6vjje8uod.apps.googleusercontent.com",

  // ======== 3. LOKASI TARGET GEOFENCING ========
  // Koordinat pusat area presensi (Masjid Luqmanul Hakim POLBAN)
  TARGET_LAT: -6.872000,
  TARGET_LNG: 107.573700,

  // Radius dalam meter. Mahasiswa harus berada dalam jarak ini untuk bisa mengisi form.
  RADIUS_METER: 50,

  // ======== 4. INFO TAMPILAN ========
  // Nama lokasi yang ditampilkan di UI
  LOCATION_NAME: "Masjid Luqmanul Hakim POLBAN",

  // Judul halaman
  PAGE_TITLE: "Presensi Metagama",

  // ======== 5. KEAMANAN ADMIN ========
  // Daftar email admin/dosen yang diizinkan mengakses admin.html (menggunakan Google Sign-In)
  ADMIN_EMAILS: [
    "muhammad.fadhil.tif425@polban.ac.id"
  ],

  // Password cadangan untuk masuk halaman admin jika Google Client ID tidak digunakan/error
  ADMIN_PASSWORD: "AdminPolban2026*",
};
