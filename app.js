/* ==========================================================================
   APP CONFIGURATION & STATE MANAGEMENT
   ========================================================================== */

const DEFAULTS = {
  targetLat: APP_CONFIG.TARGET_LAT,
  targetLng: APP_CONFIG.TARGET_LNG,
  radius: APP_CONFIG.RADIUS_METER,
  sheetUrl: APP_CONFIG.GOOGLE_SHEET_URL,
  clientId: APP_CONFIG.GOOGLE_CLIENT_ID,
  supabaseUrl: APP_CONFIG.SUPABASE_URL || "",
  supabaseKey: APP_CONFIG.SUPABASE_ANON_KEY || "",
  backendProvider: APP_CONFIG.BACKEND_PROVIDER || "sheets",
  gpsMode: "real"
};

let supabaseClient = null;

let state = {
  settings: { ...DEFAULTS },
  userEmail: null,
  userLocation: { lat: null, lng: null, accuracy: null },
  userDistance: null,
  isWithinGeofence: false,
  selfieBase64: null,
  cameraStream: null,
  currentFacingMode: "user",
  camerasList: [],
  map: null,
  mapMarkerUser: null,
  mapMarkerTarget: null,
  mapCircleGeofence: null,
  watchId: null,
  mapInitialCenterDone: false
};

// Helper for encryption/decryption (Hex + XOR Cipher)
const CRYPTO_KEY = "polban_presence_sec_2026";

function obfuscate(str) {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const hex = (str.charCodeAt(i) ^ CRYPTO_KEY.charCodeAt(i % CRYPTO_KEY.length)).toString(16).padStart(2, '0');
    result += hex;
  }
  return result;
}

function deobfuscate(hexStr) {
  try {
    let str = "";
    for (let i = 0; i < hexStr.length; i += 2) {
      const charCode = parseInt(hexStr.substr(i, 2), 16);
      str += String.fromCharCode(charCode ^ CRYPTO_KEY.charCodeAt((i / 2) % CRYPTO_KEY.length));
    }
    return str;
  } catch (e) {
    console.error("Gagal deobfuscate:", e);
    return null;
  }
}

// Check if settings are overridden by admin in local storage and sync with Google Sheets Cloud
async function initStorage() {
  // 1. Muat pengaturan default terlebih dahulu
  state.settings = { ...DEFAULTS };

  // 2. Muat pengaturan terenkripsi dari localStorage sebagai fallback lokal
  const savedSettings = localStorage.getItem("polban_presence_settings");
  if (savedSettings) {
    try {
      let parsedSettings = null;
      
      // Deteksi jika data masih berformat JSON biasa dari versi sebelumnya (migrasi otomatis)
      if (savedSettings.trim().startsWith("{")) {
        parsedSettings = JSON.parse(savedSettings);
        // Migrasikan langsung ke format ter-enkripsi
        localStorage.setItem("polban_presence_settings", obfuscate(savedSettings));
      } else {
        const decrypted = deobfuscate(savedSettings);
        if (decrypted) {
          parsedSettings = JSON.parse(decrypted);
        }
      }
      
      if (parsedSettings) {
        state.settings = { ...state.settings, ...parsedSettings };
      }
    } catch (e) {
      console.error("Gagal memuat pengaturan lokal:", e);
    }
  }

  // 3. Sinkronisasikan pengaturan dari Google Sheets (Cloud) jika URL tersedia
  if (state.settings.sheetUrl) {
    try {
      const settingsUrl = `${state.settings.sheetUrl}?action=getSettings&_t=${Date.now()}`;
      const response = await fetch(settingsUrl);
      const result = await response.json();
      
      if (result.status === "success" && result.settings) {
        const cloudSettings = {};
        
        if (result.settings.TARGET_LAT !== undefined) cloudSettings.targetLat = Number(result.settings.TARGET_LAT);
        if (result.settings.TARGET_LNG !== undefined) cloudSettings.targetLng = Number(result.settings.TARGET_LNG);
        if (result.settings.RADIUS_METER !== undefined) cloudSettings.radius = Number(result.settings.RADIUS_METER);
        if (result.settings.GOOGLE_CLIENT_ID !== undefined) cloudSettings.clientId = result.settings.GOOGLE_CLIENT_ID;
        
        state.settings = { ...state.settings, ...cloudSettings };
        console.log("Pengaturan disinkronkan dari Google Sheets:", state.settings);
      }
    } catch (err) {
      console.warn("Gagal menyinkronkan pengaturan dari Google Sheets, menggunakan fallback lokal:", err);
    }
  }

  // 4. Inisialisasi Supabase Client jika SDK tersedia dan konfigurasi diisi
  if (typeof supabase !== "undefined" && state.settings.supabaseUrl && state.settings.supabaseKey) {
    try {
      if (state.settings.supabaseUrl.indexOf("YOUR_PROJECT_ID") === -1) {
        supabaseClient = supabase.createClient(state.settings.supabaseUrl, state.settings.supabaseKey);
        console.log("Supabase Client berhasil diinisialisasi");
      }
    } catch (supaErr) {
      console.warn("Gagal inisialisasi Supabase Client:", supaErr);
    }
  }
}

/* ==========================================================================
   GOOGLE AUTHENTICATION (100% REAL GOOGLE SIGN-IN)
   ========================================================================== */
function initAuth() {
  const clientId = state.settings.clientId;
  const errorContainer = document.getElementById("google-load-error");
  const signinBtnContainer = document.getElementById("google-signin-btn-container");
  
  errorContainer.classList.add("d-none");
  signinBtnContainer.innerHTML = "";

  if (!clientId || clientId.trim() === "") {
    showGoogleLoadError("Google Client ID belum dikonfigurasi di config.js. Harap hubungi admin.");
    return;
  }

  // Polling untuk memastikan library google.accounts.id telah dimuat sempurna (mengatasi race condition)
  let checkCount = 0;
  const maxChecks = 50; // 5 detik batas waktu (50 x 100ms)
  
  const checkInterval = setInterval(() => {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      clearInterval(checkInterval);
      initializeRealGoogleSignIn(clientId);
    } else {
      checkCount++;
      if (checkCount >= maxChecks) {
        clearInterval(checkInterval);
        showGoogleLoadError("Gagal menghubungkan ke layanan Google Sign-In. Silakan periksa koneksi internet Anda atau matikan ad-blocker.");
      }
    }
  }, 100);
}

function showGoogleLoadError(message) {
  const errorContainer = document.getElementById("google-load-error");
  const errorMsg = document.getElementById("google-error-message");
  const signinBtnContainer = document.getElementById("google-signin-btn-container");
  
  signinBtnContainer.innerHTML = "";
  errorMsg.innerText = message;
  errorContainer.classList.remove("d-none");
}

function initializeRealGoogleSignIn(clientId) {
  try {
    window.g_id_onload_callback = handleCredentialResponse;
    
    const container = document.getElementById("google-signin-btn-container");
    container.innerHTML = ""; // Clear
    
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      context: "signin",
      ux_mode: "popup",
      auto_prompt: false
    });
    
    google.accounts.id.renderButton(
      container,
      { theme: "outline", size: "large", width: 280, text: "signin_with", shape: "rectangular" }
    );
    
    document.getElementById("google-load-error").classList.add("d-none");
  } catch (err) {
    console.error("Gagal menginisialisasi tombol Google Sign-In:", err);
    showGoogleLoadError("Terjadi kesalahan teknis saat mengaktifkan tombol Google Sign-In.");
  }
}

// Handler Callback setelah Google Login Sukses
function handleCredentialResponse(response) {
  try {
    const payload = decodeJwtResponse(response.credential);
    const email = payload.email.toLowerCase().trim();
    
    // Verifikasi domain email POLBAN
    if (validatePolbanEmail(email)) {
      loginUser(email);
    } else {
      showToast("Akses ditolak: Gunakan akun email POLBAN resmi!");
    }
  } catch (err) {
    console.error("Gagal membaca kredensial Google:", err);
    showToast("Login gagal. Coba lagi.");
  }
}

// Decode JSON Web Token (JWT) dari Google secara manual
function decodeJwtResponse(token) {
  var base64Url = token.split('.')[1];
  var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));

  return JSON.parse(jsonPayload);
}

function validatePolbanEmail(email) {
  return /^[a-zA-Z0-9._%+-]+@(?:mahasiswa\.)?polban\.ac\.id$/.test(email);
}

function loginUser(email) {
  state.userEmail = email;
  document.getElementById("user-email-badge").innerText = email;
  
  showToast("Login berhasil!");
  
  // Lanjut ke pemeriksaan duplikasi dan GPS
  checkSubmissionAndLocation();
}

function signoutUser() {
  state.userEmail = null;
  stopCamera();
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  
  // Tampilkan kembali layar login
  showScreen("screen-login");
  initAuth();
}

/* ==========================================================================
   SERVER & LOCAL DUPLICATION CHECK
   ========================================================================== */
async function checkSubmissionAndLocation() {
  showScreen("screen-checking");
  document.getElementById("step-gps").innerHTML = '<i class="fa-solid fa-circle-notch fa-spin step-icon"></i> <span>Memeriksa status pengisian...</span>';
  document.getElementById("step-geofence").innerHTML = '<i class="fa-regular fa-circle step-icon text-muted"></i> <span>Menunggu verifikasi server</span>';

  const sheetUrl = state.settings.sheetUrl;
  const email = state.userEmail;
  
  let alreadySubmitted = false;
  let serverData = null;

  // 1. Cek Server (Supabase atau Google Sheets)
  if (supabaseClient) {
    try {
      const todayDate = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabaseClient
        .from("presensi")
        .select("nama, nim, created_at")
        .eq("email", email)
        .eq("session_date", todayDate)
        .maybeSingle();

      if (!error && data) {
        alreadySubmitted = true;
        serverData = {
          nama: data.nama,
          nim: data.nim,
          waktu: data.created_at
        };
      }
    } catch (supaErr) {
      console.warn("Gagal cek duplikasi via Supabase, mencoba Google Sheets fallback:", supaErr);
    }
  }

  // 1b. Cek Google Sheets jika belum terdeteksi di Supabase dan URL Sheet tersedia
  if (!alreadySubmitted && sheetUrl) {
    try {
      // Menambahkan parameter query bypass cache
      const checkUrl = `${sheetUrl}?action=checkEmail&email=${encodeURIComponent(email)}&_t=${new Date().getTime()}`;
      const response = await fetch(checkUrl);
      const result = await response.json();
      
      if (result.status === "success" && result.alreadySubmitted) {
        alreadySubmitted = true;
        serverData = result.data;
      }
    } catch (err) {
      console.warn("Gagal terhubung ke server untuk cek email, menggunakan fallback local storage:", err);
      // Fallback ke check local jika koneksi gagal
      const localSubmitted = JSON.parse(localStorage.getItem("polban_submitted_emails") || "[]");
      if (localSubmitted.includes(email)) {
        alreadySubmitted = true;
      }
    }
  } else if (!alreadySubmitted && !supabaseClient) {
    // Uji lokal jika backend belum diset
    const localSubmitted = JSON.parse(localStorage.getItem("polban_submitted_emails") || "[]");
    if (localSubmitted.includes(email)) {
      alreadySubmitted = true;
    }
  }

  // Jika sudah mengisi presensi, langsung kunci di layar Sukses
  if (alreadySubmitted) {
    showToast("Anda sudah mengisi presensi sebelumnya!");
    showSuccessView({
      nama: serverData ? serverData.nama : "Terverifikasi (Server)",
      nim: serverData ? serverData.nim : "NIM Terdaftar",
      waktu: serverData ? new Date(serverData.waktu).toLocaleString("id-ID") + " WIB" : new Date().toLocaleString("id-ID") + " WIB"
    }, true);
  } else {
    // Belum mengisi, lanjut pelacakan GPS
    startLocationTracking();
  }
}

/* ==========================================================================
   GEOLOCATION & GEOFENCING LOGIC (HAVERSINE FORMULA)
   ========================================================================== */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // returns distance in meters
}

function startLocationTracking() {
  if (!("geolocation" in navigator)) {
    showToast("GPS tidak didukung oleh browser Anda!");
    updateLocationState(null, null, false, 999999);
    return;
  }

  document.getElementById("step-gps").innerHTML = '<i class="fa-solid fa-circle-notch fa-spin step-icon"></i> <span>Mencari koordinat GPS...</span>';
  document.getElementById("step-geofence").innerHTML = '<i class="fa-regular fa-circle step-icon text-muted"></i> <span>Menghitung jarak ke Masjid LH</span>';

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      document.getElementById("step-gps").innerHTML = '<i class="fa-solid fa-circle-check step-icon text-success"></i> <span>GPS Terhubung</span>';
      processLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
    },
    (error) => {
      console.error("GPS Error:", error);
      document.getElementById("step-gps").innerHTML = '<i class="fa-solid fa-circle-xmark step-icon text-danger"></i> <span>GPS gagal diakses</span>';
      
      // Jika mode simulasi diaktifkan oleh admin
      if (state.settings.gpsMode !== "real") {
        processLocation(DEFAULTS.targetLat, DEFAULTS.targetLng, 10);
      } else {
        showToast("Gagal mengakses lokasi. Pastikan izin GPS aktif.");
        updateLocationState(null, null, false, 999999);
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function processLocation(realLat, realLng, accuracy) {
  let lat = realLat;
  let lng = realLng;

  const gpsIndicator = document.getElementById("gps-indicator");
  const gpsLabel = gpsIndicator.querySelector(".label");

  if (state.settings.gpsMode === "inside") {
    lat = state.settings.targetLat + 0.00003;
    lng = state.settings.targetLng + 0.00003;
    gpsIndicator.className = "indicator-gps simulated";
    gpsLabel.innerText = "Simulasi Dalam Radius";
  } else if (state.settings.gpsMode === "outside") {
    lat = state.settings.targetLat + 0.006;
    lng = state.settings.targetLng + 0.006;
    gpsIndicator.className = "indicator-gps simulated";
    gpsLabel.innerText = "Simulasi Luar Radius";
  } else {
    gpsIndicator.className = "indicator-gps";
    gpsLabel.innerText = "GPS Aktif";
  }

  // === BUG 9: FILTER AKURASI GPS RENDAH (> 100 Meter) ===
  if (accuracy && accuracy > 100 && state.settings.gpsMode === "real") {
    console.warn("Akurasi GPS rendah:", accuracy);
    showToast("Akurasi GPS Anda rendah. Mohon membuka Google Maps atau keluar ruangan sejenak agar koordinat kembali akurat.");
    
    document.getElementById("step-gps").innerHTML = 
      `<i class="fa-solid fa-circle-exclamation step-icon text-warning"></i> <span>Akurasi GPS rendah (~${Math.round(accuracy)}m)</span>`;
    document.getElementById("step-geofence").innerHTML = 
      `<i class="fa-regular fa-circle step-icon text-muted"></i> <span>Menghitung jarak ke Masjid LH</span>`;

    state.userLocation = { lat: realLat, lng: realLng, accuracy };
    state.userDistance = null;
    state.isWithinGeofence = false;

    showScreen("screen-denied");
    
    const distanceInfo = document.getElementById("denied-distance");
    if (distanceInfo) {
      distanceInfo.innerHTML = `<span style="font-size: 0.95rem; font-weight: 600; color: var(--danger); line-height: 1.4;"><i class="fa-solid fa-triangle-exclamation"></i> Akurasi GPS rendah (~${Math.round(accuracy)}m).<br>Mohon buka Google Maps atau keluar ke area terbuka sejenak.</span>`;
    }

    const reqRadiusInfo = document.getElementById("denied-required-radius");
    if (reqRadiusInfo) {
      reqRadiusInfo.innerText = Math.round(state.settings.radius) + " meter";
    }

    renderMap(realLat, realLng);
    return;
  }

  state.userLocation = { lat, lng, accuracy };

  // Hitung jarak ke Masjid
  const distance = calculateDistance(lat, lng, state.settings.targetLat, state.settings.targetLng);
  state.userDistance = distance;
  state.isWithinGeofence = distance <= state.settings.radius;

  document.getElementById("step-geofence").innerHTML = '<i class="fa-solid fa-circle-check step-icon text-success"></i> <span>Jarak terhitung: ' + Math.round(distance) + 'm</span>';

  setTimeout(() => {
    updateLocationState(lat, lng, state.isWithinGeofence, distance);
  }, 800);
}

/* ==========================================================================
   LOCATION STATE HANDLER & GEOFENCE DECISION
   ========================================================================== */
function updateLocationState(lat, lng, isInside, distance) {
  if (isInside) {
    // User berada dalam radius geofencing — tampilkan form presensi
    showScreen("screen-form");

    // Hanya inisialisasi kamera SATU KALI dan jika belum ada foto terambil (mencegah loop di mobile)
    if (!state.cameraStream && !state.selfieBase64) {
      startCamera();
    }
  } else {
    // User di luar radius — tampilkan layar ditolak dengan peta
    showScreen("screen-denied");

    // Update info jarak di layar denied
    const distanceInfo = document.getElementById("denied-distance");
    if (distanceInfo) {
      distanceInfo.innerText = Math.round(distance) + " meter dari area presensi";
    }

    // Update info radius yang diperlukan secara dinamis
    const reqRadiusInfo = document.getElementById("denied-required-radius");
    if (reqRadiusInfo) {
      reqRadiusInfo.innerText = Math.round(state.settings.radius) + " meter";
    }

    renderMap(lat, lng);
  }
}

function restartLocationTracking() {
  // Hentikan GPS watch sebelumnya
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  // Reset state lokasi
  state.userLocation = { lat: null, lng: null, accuracy: null };
  state.userDistance = null;
  state.isWithinGeofence = false;

  // Reset flag auto-centering peta agar bisa memusatkan ulang sekali saja pada tracking baru
  state.mapInitialCenterDone = false;

  // Mulai ulang pelacakan
  startLocationTracking();
}

/* ==========================================================================
   MAP RENDERING (LEAFLET.JS)
   ========================================================================== */
function renderMap(userLat, userLng) {
  if (typeof L === "undefined") {
    console.warn("Leaflet library belum siap dimuat.");
    return;
  }

  const targetLat = state.settings.targetLat;
  const targetLng = state.settings.targetLng;
  const radius = state.settings.radius;

  if (!state.map) {
    state.map = L.map('denied-map', { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
  }

  // Menjamin ukuran peta terkalkulasi tepat saat kontainer baru ditampilkan
  setTimeout(() => {
    if (state.map) {
      state.map.invalidateSize();
    }
  }, 100);

  if (state.mapMarkerTarget) state.map.removeLayer(state.mapMarkerTarget);
  if (state.mapMarkerUser) state.map.removeLayer(state.mapMarkerUser);
  if (state.mapCircleGeofence) state.map.removeLayer(state.mapCircleGeofence);

  state.mapCircleGeofence = L.circle([targetLat, targetLng], {
    color: 'hsl(174, 75%, 38%)', fillColor: 'hsl(174, 75%, 38%)', fillOpacity: 0.2, radius: radius
  }).addTo(state.map);

  const mosqueIcon = L.divIcon({
    html: '<div style="background: hsl(174, 75%, 38%); color: white; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(0,0,0,0.3); border: 2px solid white;"><i class="fa-solid fa-mosque"></i></div>',
    className: 'custom-div-icon', iconSize: [32, 32], iconAnchor: [16, 16]
  });
  
  state.mapMarkerTarget = L.marker([targetLat, targetLng], { icon: mosqueIcon })
    .addTo(state.map)
    .bindPopup('<b>Masjid Luqmanul Hakim POLBAN</b><br>Area Presensi Resmi');

  // Hanya buka popup target di awal load
  if (!state.mapInitialCenterDone) {
    state.mapMarkerTarget.openPopup();
  }
  state.mapMarkerTarget.addTo(state.map);

  if (userLat && userLng) {
    const userIcon = L.divIcon({
      html: '<div style="background: #ef4444; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(239, 68, 68, 0.5); border: 2px solid white;"><i class="fa-solid fa-user-large" style="font-size: 0.65rem;"></i></div>',
      className: 'custom-div-icon', iconSize: [24, 24], iconAnchor: [12, 12]
    });
    
    state.mapMarkerUser = L.marker([userLat, userLng], { icon: userIcon })
      .addTo(state.map)
      .bindPopup('<b>Posisi Anda</b><br>Di luar radius presensi.');

    // BUG 10 FIX: Hanya lakukan fitBounds/auto-centering satu kali saja di awal load
    if (!state.mapInitialCenterDone) {
      const bounds = L.latLngBounds([[targetLat, targetLng], [userLat, userLng]]);
      state.map.fitBounds(bounds, { padding: [40, 40] });
      state.mapInitialCenterDone = true;
    }
  } else {
    // BUG 10 FIX: Hanya lakukan setView/auto-centering satu kali saja di awal load
    if (!state.mapInitialCenterDone) {
      state.map.setView([targetLat, targetLng], 17);
      state.mapInitialCenterDone = true;
    }
  }
}

/* ==========================================================================
   CAMERA & SELFIE LOGIC (WEBCAM API)
   ========================================================================== */
async function startCamera() {
  const video = document.getElementById("webcam");
  const canvas = document.getElementById("photo-canvas");
  const placeholder = document.getElementById("camera-placeholder");
  const btnCapture = document.getElementById("btn-capture");
  const btnRecapture = document.getElementById("btn-recapture");
  const container = document.querySelector(".camera-container");

  // Bersihkan state preview sebelumnya (untuk kasus foto ulang)
  container.classList.remove("captured");
  const oldBadge = container.querySelector(".photo-success-badge");
  if (oldBadge) oldBadge.remove();

  // Reset selfie data
  state.selfieBase64 = null;

  video.classList.add("active");
  canvas.classList.remove("active");
  btnCapture.classList.remove("d-none");
  btnRecapture.classList.add("d-none");
  placeholder.style.display = "flex";
  placeholder.innerHTML = '<i class="fa-solid fa-camera"></i><p>Menginisialisasi Kamera...</p>';

  if (state.cameraStream) { stopCamera(); }

  // Gunakan kamera depan saja (facingMode: user)
  const constraints = {
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      facingMode: { ideal: "user" }
    },
    audio: false
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.cameraStream = stream;
    video.srcObject = stream;
    video.style.transform = "none";
    placeholder.style.display = "none";
  } catch (err) {
    console.error("Camera access failed:", err);
    placeholder.innerHTML = '<i class="fa-solid fa-video-slash text-danger"></i><p>Gagal mengakses kamera. Mohon berikan izin kamera.</p>';
    showToast("Gagal menyalakan kamera. Periksa izin kamera browser!");
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  const video = document.getElementById("webcam");
  if (video) video.srcObject = null;
}

function capturePhoto() {
  const video = document.getElementById("webcam");
  const canvas = document.getElementById("photo-canvas");
  const btnCapture = document.getElementById("btn-capture");
  const btnRecapture = document.getElementById("btn-recapture");
  const container = document.querySelector(".camera-container");

  if (!state.cameraStream) { showToast("Kamera tidak aktif!"); return; }

  // === KOMPRESI SISI CLIENT (RESOLUSI OPTIMAL: 480x360, JPEG QUALITY 0.7) ===
  // Memangkas ukuran file dari ~2MB menjadi hanya ~40-80KB (90% hemat bandwidth)
  const ctx = canvas.getContext("2d");
  const targetWidth = 480;
  const targetHeight = 360;
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

  state.selfieBase64 = canvas.toDataURL("image/jpeg", 0.7);

  // === FREEZE: Sembunyikan video live, tampilkan foto diam (canvas) ===
  video.classList.remove("active");
  canvas.classList.add("active");
  btnCapture.classList.add("d-none");
  btnRecapture.classList.remove("d-none");
  document.getElementById("err-selfie").style.display = "none";

  // Hentikan kamera (hemat resource, hentikan lampu kamera)
  stopCamera();

  // === VISUAL FEEDBACK: Tampilkan badge sukses + border hijau ===
  container.classList.add("captured");

  // Hapus badge lama jika ada
  const oldBadge = container.querySelector(".photo-success-badge");
  if (oldBadge) oldBadge.remove();

  // Tambahkan badge "Foto Berhasil Diambil"
  const badge = document.createElement("div");
  badge.className = "photo-success-badge";
  badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Foto Berhasil Diambil';
  container.appendChild(badge);

  showToast("Foto berhasil diambil! Tekan 'Foto Ulang' jika ingin mengganti.");
}

/* ==========================================================================
   FORM VALIDATION & SUBMISSION
   ========================================================================== */
function validateForm() {
  let isValid = true;

  // Nama Lengkap
  const namaInput = document.getElementById("input-nama");
  const grpNama = namaInput.closest(".form-group");
  if (namaInput.value.trim().length < 3) {
    grpNama.classList.add("invalid");
    document.getElementById("err-nama").innerText = "Nama lengkap wajib diisi minimal 3 karakter";
    isValid = false;
  } else { grpNama.classList.remove("invalid"); }

  // NIM
  const nimInput = document.getElementById("input-nim");
  const grpNim = nimInput.closest(".form-group");
  if (!/^\d{9}$/.test(nimInput.value.trim())) {
    grpNim.classList.add("invalid"); isValid = false;
  } else { grpNim.classList.remove("invalid"); }

  // Jurusan
  const jurusanSelect = document.getElementById("select-jurusan");
  const grpJurusan = jurusanSelect.closest(".form-group");
  if (!jurusanSelect.value) { grpJurusan.classList.add("invalid"); isValid = false; }
  else { grpJurusan.classList.remove("invalid"); }

  // Prodi
  const prodiSelect = document.getElementById("select-prodi");
  const grpProdi = prodiSelect.closest(".form-group");
  if (!prodiSelect.value) { grpProdi.classList.add("invalid"); isValid = false; }
  else { grpProdi.classList.remove("invalid"); }

  // Kelas
  const kelasSelect = document.getElementById("select-kelas");
  const grpKelas = kelasSelect.closest(".form-group");
  if (!kelasSelect.value) { grpKelas.classList.add("invalid"); isValid = false; }
  else { grpKelas.classList.remove("invalid"); }

  // Selfie
  const grpSelfie = document.getElementById("photo-canvas").closest(".form-group");
  if (!state.selfieBase64) {
    grpSelfie.classList.add("invalid");
    document.getElementById("err-selfie").style.display = "block";
    isValid = false;
  } else {
    grpSelfie.classList.remove("invalid");
    document.getElementById("err-selfie").style.display = "none";
  }

  return isValid;
}

// ==========================================================================
// SUPABASE STORAGE & RPC HANDLER (HIGH-TRAFFIC BACKEND)
// ==========================================================================
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

async function handleSupabaseSubmit(formData) {
  // 1. Upload foto terkompresi langsung ke Supabase Storage Bucket via CDN
  const photoUrl = await uploadSelfieToStorage(formData.selfieBase64, formData.nim);

  // 2. Panggil Stored Procedure yang memverifikasi rumus Haversine di DB
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

async function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) {
    const firstInvalid = document.querySelector(".form-group.invalid");
    if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btnSubmit = document.getElementById("btn-submit");
  const originalHtml = btnSubmit.innerHTML;
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan Presensi...';

  const payload = {
    email: state.userEmail,
    nama: document.getElementById("input-nama").value.trim(),
    nim: document.getElementById("input-nim").value.trim(),
    jurusan: document.getElementById("select-jurusan").value,
    prodi: document.getElementById("select-prodi").value,
    kelas: document.getElementById("select-kelas").value,
    latitude: state.userLocation.lat,
    longitude: state.userLocation.lng,
    jarak: state.userDistance,
    statusGeofencing: state.isWithinGeofence ? "DALAM AREA" : "LUAR AREA",
    selfieBase64: state.selfieBase64
  };

  // OPSI 1: JIKA SUPABASE TERHUBUNG (HIGH TRAFFIC PRIORITAS UTAMA)
  if (supabaseClient) {
    try {
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah ke Supabase...';
      const result = await handleSupabaseSubmit(payload);
      
      if (result && result.status === "success") {
        saveSuccessToLocal(payload.email);
        showSuccessView({
          nama: payload.nama,
          nim: payload.nim,
          waktu: new Date().toLocaleString("id-ID") + " WIB"
        }, false);
        return;
      } else {
        showToast(result.message || "Gagal memverifikasi presensi");
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalHtml;
        return;
      }
    } catch (supaErr) {
      console.error("Supabase submit failed:", supaErr);
      showToast(supaErr.message || "Terjadi kendala saat mengirim ke Supabase.");
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalHtml;
      return;
    }
  }

  // OPSI 2: FALLBACK KE GOOGLE SHEETS
  const sheetUrl = state.settings.sheetUrl;

  if (sheetUrl) {
    try {
      const response = await fetch(sheetUrl, { 
        method: "POST", 
        mode: "cors", 
        body: JSON.stringify({ ...payload, selfie: payload.selfieBase64 }) 
      });
      const result = await response.json();
      
      if (result.status === "success") {
        saveSuccessToLocal(payload.email);
        showSuccessView({
          nama: payload.nama,
          nim: payload.nim,
          waktu: new Date().toLocaleString("id-ID") + " WIB"
        }, false);
      } else {
        showToast(result.message);
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalHtml;
      }
    } catch (err) {
      console.warn("CORS/Network error, trying fallback:", err);
      try {
        await fetch(sheetUrl, { 
          method: "POST", 
          mode: "no-cors", 
          headers: { "Content-Type": "text/plain" }, 
          body: JSON.stringify({ ...payload, selfie: payload.selfieBase64 }) 
        });
        saveSuccessToLocal(payload.email);
        showSuccessView({
          nama: payload.nama,
          nim: payload.nim,
          waktu: new Date().toLocaleString("id-ID") + " WIB"
        }, false);
        showToast("Presensi dikirim (mode fallback)");
      } catch (err2) {
        console.error("Gagal total kirim ke Sheets:", err2);
        showToast("Gagal terhubung ke Google Sheets. Coba lagi.");
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalHtml;
      }
    }
  } else {
    // local fallback
    setTimeout(() => {
      saveSuccessToLocal(payload.email);
      showSuccessView({
        nama: payload.nama,
        nim: payload.nim,
        waktu: new Date().toLocaleString("id-ID") + " WIB"
      }, false);
      showToast("Tersimpan secara lokal! (Backend belum dikonfigurasi)");
    }, 1500);
  }
}

function saveSuccessToLocal(email) {
  const localSubmitted = JSON.parse(localStorage.getItem("polban_submitted_emails") || "[]");
  if (!localSubmitted.includes(email)) {
    localSubmitted.push(email);
    localStorage.setItem("polban_submitted_emails", JSON.stringify(localSubmitted));
  }
}

function showSuccessView(data, isAlreadySubmitted = false) {
  stopCamera();
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  
  showScreen("screen-success");
  
  if (isAlreadySubmitted) {
    document.getElementById("success-title").innerText = "Anda Sudah Mengisi Presensi!";
    document.getElementById("success-msg").innerText = "Pengisian presensi telah berhasil diverifikasi oleh server Google Sheets sebelumnya.";
  } else {
    document.getElementById("success-title").innerText = "Presensi Berhasil Terkirim!";
    document.getElementById("success-msg").innerText = "Terima kasih, kehadiran Anda telah berhasil diverifikasi dan disimpan.";
  }
  
  document.getElementById("summary-nama").innerText = data.nama;
  document.getElementById("summary-nim").innerText = data.nim;
  document.getElementById("summary-waktu").innerText = data.waktu;
}

function showScreen(screenId) {
  ["screen-login", "screen-checking", "screen-denied", "screen-form", "screen-success"].forEach(id => {
    document.getElementById(id).classList.remove("active");
  });
  document.getElementById(screenId).classList.add("active");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  document.getElementById("toast-message").innerText = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

/* ==========================================================================
   EVENT LISTENERS & INITIALIZATION
   ========================================================================== */
function setupEvents() {
  // Sign out event
  document.getElementById("btn-signout").addEventListener("click", signoutUser);

  // Retry location
  document.getElementById("btn-retry-location").addEventListener("click", () => {
    restartLocationTracking();
    showToast("Memindai ulang lokasi...");
  });

  // Webcam controls
  document.getElementById("btn-capture").addEventListener("click", capturePhoto);
  document.getElementById("btn-recapture").addEventListener("click", startCamera);

  // Form submission
  document.getElementById("presence-form").addEventListener("submit", handleFormSubmit);
}

window.addEventListener("DOMContentLoaded", async () => {
  await initStorage();
  setupEvents();
  initAuth();
});

window.addEventListener("beforeunload", () => { stopCamera(); });
