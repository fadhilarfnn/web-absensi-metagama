/**
 * GOOGLE APPS SCRIPT - FORM PRESENSI POLBAN
 * 
 * Petunjuk Penggunaan:
 * 1. Buka Google Sheets baru atau yang sudah ada.
 * 2. Klik menu 'Ekstensi' (Extensions) -> 'Apps Script'.
 * 3. Hapus semua kode default di editor, lalu salin seluruh kode di bawah ini.
 * 4. Simpan proyek dengan menekan ikon Disket atau Ctrl+S.
 * 5. Klik tombol 'Terapkan' (Deploy) di kanan atas -> pilih 'Penerapan Baru' (New deployment).
 * 6. Klik ikon Gear (Jenis penerapan) -> pilih 'Aplikasi Web' (Web app).
 * 7. Konfigurasikan:
 *    - Execute as: Me (Diri saya sendiri)
 *    - Who has access: Anyone (Siapa saja)
 * 8. Klik 'Terapkan' (Deploy).
 * 9. Salin 'URL Aplikasi Web' yang diberikan dan masukkan ke config.js atau panel admin.
 */

// Handler untuk metode GET (Digunakan untuk cek apakah email sudah submit atau ambil setelan)
function doGet(e) {
  try {
    var params = e.parameter;
    var action = params.action;
    
    if (action === "checkEmail") {
      var email = params.email.toLowerCase().trim();
      
      // === LOCK SERVICE: Mencegah race condition saat banyak user cek email bersamaan ===
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(5000); // Tunggu maksimal 5 detik untuk mendapatkan lock
      } catch (lockErr) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Server sedang sibuk. Silakan coba lagi dalam beberapa detik."
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        // Cek sheet Presensi/Sheet1 eksplisit untuk menghindari bug tab-focus
        var sheet = ss.getSheetByName("Presensi") || ss.getSheetByName("Sheet1");
        if (!sheet) {
          var sheets = ss.getSheets();
          for (var i = 0; i < sheets.length; i++) {
            if (sheets[i].getName() !== "Settings") {
              sheet = sheets[i];
              break;
            }
          }
          if (!sheet) sheet = sheets[0];
        }
        
        var lastRow = sheet.getLastRow();
        var alreadySubmitted = false;
        var submissionData = null;
        
        if (lastRow > 1) {
          var dataRange = sheet.getRange(2, 1, lastRow - 1, 4).getValues(); // Ambil Waktu, Email, Nama, NIM
          for (var i = 0; i < dataRange.length; i++) {
            if (dataRange[i][1].toString().toLowerCase().trim() === email) {
              alreadySubmitted = true;
              submissionData = {
                waktu: dataRange[i][0],
                nama: dataRange[i][2],
                nim: dataRange[i][3]
              };
              break;
            }
          }
        }
        
        var response = {
          status: "success",
          alreadySubmitted: alreadySubmitted,
          data: submissionData
        };
        
        return ContentService.createTextOutput(JSON.stringify(response))
          .setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock(); // Selalu lepaskan lock
      }
    }
    
    if (action === "getSettings") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var settingsSheet = ss.getSheetByName("Settings");
      var settings = {};
      if (settingsSheet) {
        var lastRow = settingsSheet.getLastRow();
        if (lastRow > 1) {
          var range = settingsSheet.getRange(2, 1, lastRow - 1, 2).getValues();
          for (var i = 0; i < range.length; i++) {
            var key = range[i][0].toString().trim();
            var val = range[i][1];
            if (!isNaN(val) && val !== "") {
              settings[key] = Number(val);
            } else {
              settings[key] = val;
            }
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        settings: settings
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Aksi tidak dikenal" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handler untuk metode POST (Penerimaan data presensi atau simpan setelan)
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    
    // === NEW: PENYELARASAN SETELAN ADMIN KE CLOUD ===
    if (data.action === "saveSettings") {
      var password = data.password;
      if (password !== "AdminPolban2026*") {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Autentikasi gagal: Password admin salah."
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(10000); // Tunggu maksimal 10 detik
      } catch (lockErr) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Server sedang sibuk. Silakan coba lagi dalam beberapa detik."
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var settingsSheet = ss.getSheetByName("Settings");
        if (!settingsSheet) {
          settingsSheet = ss.insertSheet("Settings");
        }
        settingsSheet.clear();
        settingsSheet.appendRow(["Key", "Value"]);
        
        var settings = data.settings;
        for (var key in settings) {
          if (settings.hasOwnProperty(key)) {
            settingsSheet.appendRow([key, settings[key]]);
          }
        }
        
        SpreadsheetApp.flush();
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: "Pengaturan berhasil disinkronkan ke Cloud!"
        })).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }
    
    // === LOCK SERVICE: Mengantrekan data masuk untuk mencegah data tertimpa ===
    // Krusial untuk 1000+ user yang submit bersamaan
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000); // Tunggu maksimal 10 detik untuk mendapatkan lock
    } catch (lockErr) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "Server sedang sangat sibuk menangani antrian presensi. Silakan coba lagi dalam 5-10 detik."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      // Pilih sheet Presensi/Sheet1 eksplisit untuk menghindari bug tab-focus
      var sheet = ss.getSheetByName("Presensi") || ss.getSheetByName("Sheet1");
      if (!sheet) {
        var sheets = ss.getSheets();
        for (var i = 0; i < sheets.length; i++) {
          if (sheets[i].getName() !== "Settings") {
            sheet = sheets[i];
            break;
          }
        }
        if (!sheet) sheet = sheets[0];
      }
      
      // Inisialisasi header jika sheet masih kosong
      if (sheet.getLastRow() === 0) {
        sheet.appendRow([
          "Waktu Presensi", 
          "Email Mahasiswa", 
          "Nama Lengkap", 
          "NIM", 
          "Jurusan", 
          "Prodi", 
          "Kelas", 
          "Latitude", 
          "Longitude", 
          "Jarak ke Masjid LH (Meter)", 
          "Status Geofencing",
          "Link Foto Selfie"
        ]);
      }
      
      // Cek duplikasi email (Double-check pengisian tunggal — ATOMIK di dalam lock)
      var email = data.email.toLowerCase().trim();
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var emailRange = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
        for (var i = 0; i < emailRange.length; i++) {
          if (emailRange[i][0].toString().toLowerCase().trim() === email) {
            var response = {
              status: "error",
              message: "Email " + email + " sudah pernah melakukan presensi sebelumnya!"
            };
            return ContentService.createTextOutput(JSON.stringify(response))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
      
      // Proses upload foto selfie ke Google Drive
      var fileUrl = "";
      if (data.selfie && data.selfie.indexOf("data:image") === 0) {
        try {
          var folderName = "Foto Presensi POLBAN";
          var folders = DriveApp.getFoldersByName(folderName);
          var folder;
          if (folders.hasNext()) {
            folder = folders.next();
          } else {
            folder = DriveApp.createFolder(folderName);
          }
          
          var imageParts = data.selfie.split(",");
          var imageBlob = Utilities.newBlob(
            Utilities.base64Decode(imageParts[1]), 
            "image/jpeg", 
            "selfie_" + data.nim + "_" + new Date().getTime() + ".jpg"
          );
          
          var file = folder.createFile(imageBlob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          fileUrl = file.getUrl();
        } catch (err) {
          fileUrl = "Gagal simpan foto: " + err.toString();
        }
      } else {
        fileUrl = "Tidak ada foto";
      }
      
      // Tambah data baris baru ke Google Sheet
      sheet.appendRow([
        new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
        email,
        data.nama,
        data.nim,
        data.jurusan,
        data.prodi,
        data.kelas,
        data.latitude,
        data.longitude,
        data.jarak.toFixed(2),
        data.statusGeofencing,
        fileUrl
      ]);
      
      // Flush agar data langsung tersimpan sebelum lock dilepas
      SpreadsheetApp.flush();
      
      var response = {
        status: "success",
        message: "Presensi mahasiswa berhasil disimpan!"
      };
      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    
    } finally {
      lock.releaseLock(); // Selalu lepaskan lock agar antrian berikutnya bisa masuk
    }

  } catch (error) {
    var response = {
      status: "error",
      message: "Gagal menyimpan data: " + error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Handler OPTIONS untuk preflight check browser
function doOptions(e) {
  var response = ContentService.createTextOutput("");
  return response;
}
