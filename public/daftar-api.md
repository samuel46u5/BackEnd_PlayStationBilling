## 7. Kontrol Relay Tasmota
- **GET /relay/:ip/on**
  - Menyalakan relay (Power On) pada perangkat Tasmota.
- **GET /relay/:ip/off**
  - Mematikan relay (Power Off) pada perangkat Tasmota.
- **GET /relay/:ip/status**
  - Mengecek status relay (Power) pada perangkat Tasmota.
# Daftar API Backend TV Controller

Berikut adalah daftar endpoint API yang tersedia di backend:

## 1. Cek Status TV
- **GET /tv-status/:ip?port=PORT&method=adb|tv_server**
  - Cek status hidup/mati TV via ADB atau TV Server.
- **GET /tv-status2/:ip?port=PORT&method=adb|tv_server**
  - Cek status TV (versi lain, menggunakan mWakefulness untuk ADB).

## 2. Cek Status ADB Device
- **GET /adb-status?ip=IP&port=PORT**
  - Cek status koneksi ADB ke device tertentu.

## 3. Ping TV
- **GET /ping/:ip?port=PORT&method=adb|tv_server**
  - Cek konektivitas ke TV (ADB atau TV Server).

## 4. Kontrol Power TV
- **GET /tv/:ip/:action?port=PORT&method=adb|tv_server**
  - Kirim perintah power (wake/sleep/power) ke TV.
  - Contoh: `/tv/192.168.200.226/wake?port=5555&method=adb`

## 5. Kirim Keycode ke TV
- **GET /tv/:ip/key/:keycode?port=PORT&method=adb|tv_server**
  - Kirim keycode tertentu ke TV.

## 6. Install ADB (Cek ADB Terpasang)
- **GET /install-adb**
  - Cek apakah ADB sudah terpasang di server backend.

## Keterangan Parameter
- `ip` : IP address TV
- `port` : Port ADB atau TV Server
- `method` : Pilih antara `adb` atau `tv_server`
- `action` : Perintah power (`wake`, `sleep`, `power`)
- `keycode` : Kode tombol/key event Android

---

Setiap endpoint akan mengembalikan response JSON sesuai hasil eksekusi perintah.
