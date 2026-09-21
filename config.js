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

  // ======== 1. GOOGLE SHEETS ========
  // Masukkan URL Web App dari Google Apps Script yang sudah di-deploy.
  // Contoh: "https://script.google.com/macros/s/AKfycbxfL.../exec"
  GOOGLE_SHEET_URL: "https://script.google.com/macros/s/AKfycbxfcEZvqedbxFb2MmqnEVU492UEl4WaQ-Ahenyf8cO2lzo98w20wH7hhztWzkdu6n5snQ/exec",

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
