// Endpoint untuk relay Tasmota (ON, OFF, STATUS)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const { exec } = require("child_process");
const app = express();
const port = 3001;
const port2 = 3002;

app.use(cors());

const HEADERS = {
  apikey: process.env.SUPABASE_API_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_API_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const SUPABASE_URL = process.env.SUPABASE_URL;

const http = require("http");

function tasmotaRequest(ip, cmnd, cb) {
  const url = `http://${ip}/cm?cmnd=${encodeURIComponent(cmnd)}`;
  exec(`curl --max-time 3 "${url}"`, (err, stdout, stderr) => {
    if (err) return cb({ success: false, message: stderr || err.message });
    try {
      const data = JSON.parse(stdout);
      cb({ success: true, data });
    } catch {
      cb({ success: true, raw: stdout });
    }
  });
}

app.get("/relay/:ip/on", (req, res) => {
  const { ip } = req.params;
  tasmotaRequest(ip, "Power On", (result) => res.json(result));
});

app.get("/relay/:ip/off", (req, res) => {
  const { ip } = req.params;
  tasmotaRequest(ip, "Power Off", (result) => res.json(result));
});

app.get("/relay/:ip/status", (req, res) => {
  const { ip } = req.params;
  tasmotaRequest(ip, "Power", (result) => {
    // result.raw biasanya string JSON dari Tasmota, misal: {"POWER":"ON"}
    let power = null;
    if (result && result.data && typeof result.data.POWER !== "undefined") {
      power = result.data.POWER;
    } else if (result && result.raw) {
      try {
        const parsed = JSON.parse(result.raw);
        if (typeof parsed.POWER !== "undefined") {
          power = parsed.POWER;
        }
      } catch {}
    }
    if (power === "ON" || power === "OFF") {
      res.json({ POWER: power });
    } else {
      res.json({ POWER: "UNKNOWN" });
    }
  });
});

// Endpoint untuk cek status TV (hidup/mati)
app.get("/tv-status/:ip", (req, res) => {
  const { ip } = req.params;
  const { port, method } = req.query;
  if (!ip || !port || !method) {
    return res.json({
      status: "unknown",
      message: "IP, port, dan method harus diisi",
    });
  }
  if (method === "adb") {
    // Cek status power via dumpsys power (Android)
    exec(`adb connect ${ip}:${port}`, (err, stdout, stderr) => {
      if (err || (stderr && stderr.includes("failed"))) {
        return res.json({ status: "unknown", message: stderr || err.message });
      }
      exec(
        `adb -s ${ip}:${port} shell dumpsys power`,
        (err2, stdout2, stderr2) => {
          if (err2 || stderr2) {
            return res.json({
              status: "unknown",
              message: stderr2 || err2.message,
            });
          }
          // Cari baris mScreenOn atau Display Power: state=ON/OFF
          let status = "unknown";
          if (
            /Display Power: state=ON|mScreenOn=true|Display Power: state=ON/i.test(
              stdout2
            )
          ) {
            status = "on";
          } else if (
            /Display Power: state=OFF|mScreenOn=false|Display Power: state=OFF/i.test(
              stdout2
            )
          ) {
            status = "off";
          }
          res.json({ status });
        }
      );
    });
  } else if (method === "tv_server") {
    // Asumsi ada endpoint /status yang mengembalikan status TV
    exec(`curl --max-time 2 http://${ip}:${port}/status`, (err, stdout) => {
      if (err) {
        return res.json({ status: "unknown", message: err.message });
      }
      // stdout diharapkan JSON: { status: "on" } atau { status: "off" }
      try {
        const data = JSON.parse(stdout);
        if (data.status === "on" || data.status === "off") {
          res.json({ status: data.status });
        } else {
          res.json({
            status: "unknown",
            message: "Format status tidak dikenali",
          });
        }
      } catch (e) {
        res.json({
          status: "unknown",
          message: "Gagal parse status TV server",
        });
      }
    });
  } else {
    res.json({ status: "unknown", message: "Method tidak dikenali" });
  }
});

// Cek status ADB device
app.get("/adb-status", (req, res) => {
  const { ip, port } = req.query;
  if (!ip || !port) {
    return res.json({ error: true, message: "IP dan port harus diisi!" });
  }
  exec("adb devices", (err, stdout, stderr) => {
    if (err) {
      return res.json({ error: true, message: stderr || err.message });
    }
    const deviceLine = stdout.split("\n").find((line) => line.includes(ip));
    let adb_status = "not connected";
    if (deviceLine) {
      if (deviceLine.includes("device")) adb_status = "online";
      else if (deviceLine.includes("offline")) adb_status = "offline";
      else adb_status = deviceLine.trim();
    }
    res.json({ ip, port, adb_status });
  });
});

app.get("/tv-status2/:ip", (req, res) => {
  const { ip } = req.params;
  const { port, method } = req.query;

  if (!ip || !port || !method) {
    return res.json({
      status: "unknown",
      message: "IP, port, dan method harus diisi",
    });
  }

  if (method === "adb") {
    exec(`adb connect ${ip}:${port}`, (err, _unused, stderr) => {
      if (err || (stderr && stderr.includes("failed"))) {
        return res.json({
          status: "unknown",
          message: stderr || err.message,
        });
      }

      exec(
        `adb -s ${ip}:${port} shell dumpsys power | findstr "mWakefulness"`,
        (err2, stdout2, stderr2) => {
          if (err2 || stderr2) {
            return res.json({
              status: "unknown",
              message: stderr2 || err2.message,
            });
          }
          let status = "unknown";
          const match = stdout2.match(/mWakefulness=(Awake|Asleep)/);
          if (match) {
            if (match[1] === "Awake") {
              status = "on";
            } else if (match[1] === "Asleep") {
              status = "off";
            }
          }
          res.json({ status });
        }
      );
    });
  } else if (method === "tv_server") {
    exec(`curl --max-time 2 http://${ip}:${port}/status`, (err, stdout) => {
      if (err) {
        return res.json({ status: "unknown", message: err.message });
      }

      try {
        const data = JSON.parse(stdout);
        if (data.status === "on" || data.status === "off") {
          res.json({ status: data.status });
        } else {
          res.json({
            status: "unknown",
            message: "Format status tidak dikenali",
          });
        }
      } catch (e) {
        res.json({
          status: "unknown",
          message: "Gagal parse status TV server",
        });
      }
    });
  } else {
    res.json({ status: "unknown", message: "Method tidak dikenali" });
  }
});

// Cek status ADB device
app.get("/adb-status", (req, res) => {
  const { ip, port } = req.query;
  if (!ip || !port) {
    return res.json({ error: true, message: "IP dan port harus diisi!" });
  }
  exec("adb devices", (err, stdout, stderr) => {
    if (err) {
      return res.json({ error: true, message: stderr || err.message });
    }
    const deviceLine = stdout.split("\n").find((line) => line.includes(ip));
    let adb_status = "not connected";
    if (deviceLine) {
      if (deviceLine.includes("device")) adb_status = "online";
      else if (deviceLine.includes("offline")) adb_status = "offline";
      else adb_status = deviceLine.trim();
    }
    res.json({ ip, port, adb_status });
  });
});

app.use(express.json());

// Serve static files (interface)
app.use(express.static("public"));

// Root endpoint
app.get("/", (req, res) => {
  res.send("TV Controller Backend is running.");
});

// Check TV connectivity
app.get("/ping/:ip", (req, res) => {
  const { ip } = req.params;
  const { port, method } = req.query;

  if (method === "adb") {
    exec(`adb connect ${ip}:${port}`, (err, stdout, stderr) => {
      if (err || stderr.includes("failed")) {
        return res.json({ status: "offline", message: stderr || stdout });
      }
      res.json({ status: "online", detected_method: "adb" });
    });
  } else {
    // Ping a custom server port (tv_server)
    exec(`curl --max-time 2 http://${ip}:${port}/ping`, (err, stdout) => {
      if (err) {
        return res.json({ status: "offline", message: err.message });
      }
      res.json({ status: "online", detected_method: "tv_server" });
    });
  }
});

// Simple in-memory cache for last connected ADB device
let lastAdbConnected = { ip: null, port: null };

app.get("/tv/:ip/:action", (req, res) => {
  const { ip, action } = req.params;
  const { port, method } = req.query;

  if (method === "adb") {
    let keycode;
    if (action === "sleep" || action === "wake" || action === "power")
      keycode = 26;

    if (action === "volume_up") keycode = 24;
    else if (action === "volume_down") keycode = 25;

    const needConnect =
      lastAdbConnected.ip !== ip || lastAdbConnected.port !== port;
    const doKeyevent = (cb) => {
      exec(
        `adb -s ${ip}:${port} shell input keyevent ${keycode}`,
        (err, stdout, stderr) => {
          if (err) {
            if (action === "wake") {
              // Jika gagal hidupkan, coba reconnect lalu cek status
              exec(`adb connect ${ip}:${port}`, (err2, stdout2, stderr2) => {
                if (err2 || (stderr2 && stderr2.includes("failed"))) {
                  return res.json({
                    error: true,
                    message:
                      "Gagal reconnect ADB: " + (stderr2 || err2.message),
                  });
                }
                // Cek status ADB
                exec("adb devices", (err3, stdout3, stderr3) => {
                  if (err3) {
                    return res.json({
                      error: true,
                      message:
                        "Gagal cek status ADB: " + (stderr3 || err3.message),
                    });
                  }
                  const deviceLine = stdout3
                    .split("\n")
                    .find((line) => line.includes(ip));
                  if (deviceLine && deviceLine.includes("device")) {
                    // Sudah online, ulangi perintah hidupkan
                    exec(
                      `adb -s ${ip}:${port} shell input keyevent ${keycode}`,
                      (err4, stdout4, stderr4) => {
                        if (err4) {
                          return res.json({
                            error: true,
                            message:
                              "Gagal hidupkan TV setelah reconnect: " +
                              (stderr4 || err4.message),
                          });
                        }
                        return res.json({
                          success: true,
                          used_method: "adb",
                          reconnected: true,
                        });
                      }
                    );
                  } else {
                    return res.json({
                      error: true,
                      message: "ADB tetap offline setelah reconnect.",
                    });
                  }
                });
              });
              return;
            } else {
              return res.json({ error: true, message: stderr || err.message });
            }
          }
          res.json({ success: true, used_method: "adb" });
        }
      );
    };
    if (needConnect) {
      exec(`adb connect ${ip}:${port}`, (err, stdout, stderr) => {
        if (err || (stderr && stderr.includes("failed"))) {
          return res.json({ error: true, message: stderr || err.message });
        }
        lastAdbConnected = { ip, port };
        doKeyevent();
      });
    } else {
      doKeyevent();
    }
  } else {
    // Contoh untuk 'tv_server', kirim GET ke API endpoint
    exec(`curl http://${ip}:${port}/${action}`, (err, stdout) => {
      if (err) {
        return res.json({ error: true, message: err.message });
      }
      res.json({ success: true, used_method: "tv_server" });
    });
  }
});

// ...existing code...

app.get("/tv/:ip/volume", (req, res) => {
  const { ip } = req.params;
  const { port } = req.query;

  exec(`adb connect ${ip}:${port}`, (err, stdout, stderr) => {
    if (err || (stderr && stderr.includes("failed"))) {
      return res.json({ error: true, message: stderr || err.message });
    }
    exec(
      `adb -s ${ip}:${port} shell cmd media_session volume --stream 3 --get`,
      (err2, stdout2, stderr2) => {
        if (err2) {
          return res.json({ error: true, message: stderr2 || err2.message });
        }
        // Ambil nilai volume dari output
        const match = stdout2.match(/volume is:(\d+)/);
        const volume = match ? parseInt(match[1], 10) : null;
        res.json({ volume, raw: stdout2 });
      }
    );
  });
});

// Send raw keycode

app.get("/tv/:ip/key/:keycode", (req, res) => {
  const { ip, keycode } = req.params;
  const { port, method } = req.query;

  if (method === "adb") {
    const needConnect =
      lastAdbConnected.ip !== ip || lastAdbConnected.port !== port;
    const doKeyevent = () => {
      exec(
        `adb -s ${ip}:${port} shell input keyevent ${keycode}`,
        (err, stdout, stderr) => {
          if (err) {
            return res.json({ error: true, message: stderr || err.message });
          }
          res.json({ success: true, used_method: "adb" });
        }
      );
    };
    if (needConnect) {
      exec(`adb connect ${ip}:${port}`, (err, stdout, stderr) => {
        if (err || (stderr && stderr.includes("failed"))) {
          return res.json({ error: true, message: stderr || err.message });
        }
        lastAdbConnected = { ip, port };
        doKeyevent();
      });
    } else {
      doKeyevent();
    }
  } else {
    exec(`curl http://${ip}:${port}/key/${keycode}`, (err, stdout) => {
      if (err) {
        return res.json({ error: true, message: err.message });
      }
      res.json({ success: true, used_method: "tv_server" });
    });
  }
});

// Install ADB if missing
// Install ADB if missing
app.get("/install-adb", (req, res) => {
  // Cek jika 'adb' belum ada (hanya contoh kasar)
  exec("adb version", (err, stdout, stderr) => {
    if (err || stderr.includes("not recognized")) {
      // Contoh: auto-download adb di Linux
      // Untuk produksi, kamu harus menyesuaikan sistem operasi dan persetujuan pengguna
      return res.json({
        success: false,
        message: "ADB not installed manually. Please install it manually.",
      });
    } else {
      res.json({ success: true });
    }
  });
});

// Set Volume
app.get("/tv/:ip/volume/:level", (req, res) => {
  const { ip, level } = req.params;
  const { port, method } = req.query;

  if (method === "adb") {
    const needConnect =
      lastAdbConnected.ip !== ip || lastAdbConnected.port !== port;

    const doSetVolume = () => {
      const cmd = `adb -s ${ip}:${port} shell cmd media_session volume --show --stream 3 --set ${level}`;
      exec(cmd, (err, stdout, stderr) => {
        if (err || (stderr && stderr.includes("Error"))) {
          return res.json({ error: true, message: stderr || err.message });
        }
        res.json({ success: true, used_method: "adb", volume_set: level });
      });
    };

    if (needConnect) {
      exec(`adb connect ${ip}:${port}`, (err, stdout, stderr) => {
        if (err || (stderr && stderr.includes("failed"))) {
          return res.json({ error: true, message: stderr || err.message });
        }
        lastAdbConnected = { ip, port };
        doSetVolume();
      });
    } else {
      doSetVolume();
    }
  } else {
    // Method selain ADB tidak didukung untuk set volume
    res.json({
      error: true,
      message: "Only method=adb is supported for volume",
    });
  }
});

// ESP32 API
app.get("/console", async (req, res) => {
  const ip = req.query.ip;
  if (!ip) {
    return res.status(400).json({ error: "Param ip tidak ditemukan" });
  }

  const url = `${SUPABASE_URL}consoles?select=id,auto_shutdown_enabled,relay_command_on,relay_command_off,relay_command_status,power_tv_command,perintah_cek_power_tv,rate_profiles(hourly_rate)&ip_esp32=eq.${ip}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: HEADERS,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    return res.json(data[0] || {});
  } catch (error) {
    console.error("Proxy error:", error);
    return res.status(500).json({ error: "Gagal fetch ke Supabase" });
  }
});

app.get("/ip-local", async (req, res) => {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/system_settings?select=general&limit=1`,
      { headers: HEADERS }
    );
    const data = await resp.json();

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "Data tidak ditemukan" });
    }

    const iplocal = data[0].general?.ipBackendLocal;

    if (!iplocal) {
      return res.status(404).json({ error: "IP lokal tidak ditemukan" });
    }

    return res.json({ iplocal });
  } catch (error) {
    console.error("Gagal ambil IP lokal:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/card-info", async (req, res) => {
  const { uid } = req.query;

  if (!uid) {
    return res.status(400).json({ error: "UID diperlukan" });
  }

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rfid_cards?uid=eq.${uid}&select=is_admin,balance_points&limit=1`,
      { headers: HEADERS }
    );

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: data });
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: "Kartu tidak ditemukan" });
    }

    return res.json(data[0]);
  } catch (err) {
    console.error("Gagal ambil data kartu:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Start Rental Session
app.post("/start-session", async (req, res) => {
  const { console_id, card_uid } = req.body || {};
  if (!console_id || !card_uid) {
    return res
      .status(400)
      .json({ error: "console_id atau card_uid diperlukan" });
  }

  try {
    await fetch(
      `${SUPABASE_URL}/rental_sessions?console_id=eq.${console_id}&status=eq.active`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          status: "completed",
          end_time: new Date().toISOString(),
        }),
      }
    ).catch(() => {});

    const select =
      "id,name,status,rate_profile_id,rate_profiles(hourly_rate),power_tv_command,relay_command_on,relay_command_off";
    const consoleResp = await fetch(
      `${SUPABASE_URL}/consoles?id=eq.${console_id}&select=${select}&limit=1`,
      { headers: HEADERS }
    );
    const consoles = await consoleResp.json();
    if (!consoleResp.ok || !Array.isArray(consoles) || consoles.length === 0) {
      return res.status(404).json({ error: "Console tidak ditemukan" });
    }
    const latestConsole = consoles[0];

    if (latestConsole.status !== "available") {
      return res.status(409).json({ error: "Console tidak tersedia" });
    }

    const reserveResp = await fetch(
      `${SUPABASE_URL}/consoles?id=eq.${console_id}&status=eq.available`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status: "rented" }),
      }
    );
    const reservedRows = await reserveResp.json();
    if (
      !reserveResp.ok ||
      !Array.isArray(reservedRows) ||
      reservedRows.length === 0
    ) {
      return res
        .status(409)
        .json({ error: "Gagal reserve: console sudah digunakan" });
    }

    const hourlyRateSnapshot =
      latestConsole?.rate_profiles?.hourly_rate != null
        ? Number(latestConsole.rate_profiles.hourly_rate)
        : 15000;
    const perMinuteRateSnapshot = Math.ceil(hourlyRateSnapshot / 60);

    const startTimeISO = new Date().toISOString();
    const insertPayload = {
      customer_id: null,
      console_id,
      card_uid,
      status: "active",
      payment_status: "pending",
      total_amount: 0,
      paid_amount: 0,
      start_time: startTimeISO,
      duration_minutes: null,
      is_voucher_used: true,
      hourly_rate_snapshot: hourlyRateSnapshot,
      per_minute_rate_snapshot: perMinuteRateSnapshot,
    };

    const postResp = await fetch(`${SUPABASE_URL}/rental_sessions`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(insertPayload),
    });
    const postResult = await postResp.json();
    if (!postResp.ok) {
      await fetch(`${SUPABASE_URL}/consoles?id=eq.${console_id}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status: "available" }),
      }).catch(() => {});
      return res.status(postResp.status).json({ error: postResult });
    }

    return res.json({
      session: Array.isArray(postResult) ? postResult[0] : postResult,
      console: reservedRows[0],
    });
  } catch (err) {
    console.error("Error di /start-session:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// End Rental Session
app.post("/end-session", async (req, res) => {
  const { session_id, console_id } = req.body || {};
  if (!session_id && !console_id) {
    return res
      .status(400)
      .json({ error: "session_id atau console_id diperlukan" });
  }

  try {
    // 1) Ambil sesi aktif (is_voucher_used = true) yang akan diakhiri
    let session;
    if (session_id) {
      const sResp = await fetch(
        `${SUPABASE_URL}/rental_sessions?id=eq.${session_id}&select=*`,
        { headers: HEADERS }
      );
      const arr = await sResp.json();
      if (!sResp.ok || !Array.isArray(arr) || arr.length === 0) {
        return res.status(404).json({ error: "Session tidak ditemukan" });
      }
      session = arr[0];
      if (session.status !== "active" || !session.is_voucher_used) {
        return res
          .status(409)
          .json({ error: "Session bukan aktif atau bukan member card" });
      }
    }
    // else {
    //   // by console_id (+optional card_uid)
    //   const filters = [
    //     `console_id=eq.${encodeURIComponent(console_id)}`,
    //     "status=eq.active",
    //     "is_voucher_used=eq.true",
    //   ];
    //   if (card_uid) filters.push(`card_uid=eq.${encodeURIComponent(card_uid)}`);
    //   const sResp = await fetch(
    //     `${BASE}/rental_sessions?${filters.join("&")}&select=*&limit=1`,
    //     { headers: HEADERS }
    //   );
    //   const arr = await sResp.json();
    //   if (!sResp.ok || !Array.isArray(arr) || arr.length === 0) {
    //     return res
    //       .status(404)
    //       .json({ error: "Session aktif (member card) tidak ditemukan" });
    //   }
    //   session = arr[0];
    // }

    // 2) Ambil console + rate profile untuk minimum_minutes_member
    // const selectConsole =
    //   "id,name,rate_profile_id,rate_profiles(minimum_minutes_member),power_tv_command,relay_command_off";
    // const cResp = await fetch(
    //   `${SUPABASE_URL}/consoles?id=eq.${session.console_id}&select=${selectConsole}&limit=1`,
    //   { headers: HEADERS }
    // );
    // const consoles = await cResp.json();
    // if (!cResp.ok || !Array.isArray(consoles) || consoles.length === 0) {
    //   return res.status(404).json({ error: "Console tidak ditemukan" });
    // }
    // const consoleRow = consoles[0];

    const startTime = session.start_time
      ? new Date(session.start_time)
      : new Date();
    const endTime = new Date();
    const elapsedMinutes = Math.ceil(
      (endTime.getTime() - startTime.getTime()) / (1000 * 60)
    );

    // const hourlyRateSnapshot = Number(session.hourly_rate_snapshot ?? 15000);
    // const perMinuteRateSnapshot = Number(
    //   session.per_minute_rate_snapshot ?? hourlyRateSnapshot / 60
    // );

    // const minimumMinutesMember =
    //   consoleRow?.rate_profiles?.minimum_minutes_member != null
    //     ? Number(consoleRow.rate_profiles.minimum_minutes_member)
    //     : 60;

    // let totalPoints = 0;
    // if (minimumMinutesMember === 0) {
    //   totalPoints = elapsedMinutes * perMinuteRateSnapshot;
    // } else if (elapsedMinutes <= minimumMinutesMember) {
    //   totalPoints = hourlyRateSnapshot;
    // } else {
    //   totalPoints =
    //     hourlyRateSnapshot +
    //     Math.ceil(
    //       (elapsedMinutes - minimumMinutesMember) * perMinuteRateSnapshot
    //     );
    // }

    // const alreadyDeducted = Number(session.total_points_deducted ?? 0);
    // const needToDeduct = Math.max(0, totalPoints - alreadyDeducted);

    // 4) Update rental session => completed
    const updateSessionResp = await fetch(
      `${SUPABASE_URL}/rental_sessions?id=eq.${session.id}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          end_time: endTime.toISOString(),
          status: "completed",
          payment_status: "paid",
          duration_minutes: elapsedMinutes,
        }),
      }
    );
    const updatedSessionArr = await updateSessionResp.json();
    if (!updateSessionResp.ok) {
      return res
        .status(updateSessionResp.status)
        .json({ error: updatedSessionArr });
    }
    const updatedSession = Array.isArray(updatedSessionArr)
      ? updatedSessionArr[0]
      : updatedSessionArr;

    // 5) Set console available (tanpa guard sesuai frontend member-card flow)
    const updateConsoleResp = await fetch(
      `${SUPABASE_URL}/consoles?id=eq.${encodeURIComponent(
        session.console_id
      )}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ status: "available" }),
      }
    );
    const updateConsoleText = await updateConsoleResp.text();
    if (!updateConsoleResp.ok) {
      return res
        .status(updateConsoleResp.status)
        .json({ error: updateConsoleText, session: updatedSession });
    }

    // if (consoleRow?.power_tv_command)
    //   fetch(consoleRow.power_tv_command).catch(() => {});
    // if (consoleRow?.relay_command_off)
    //   fetch(consoleRow.relay_command_off).catch(() => {});

    // const cashierPayload = {
    //   type: "rental",
    //   amount: 0,
    //   payment_method: "cash",
    //   reference_id: `MEMBER_CARD-${Date.now()}`,
    //   description: "Rental (member card)",
    //   details: {
    //     items: [
    //       {
    //         name: `Rental ${consoleRow.name || "Console"}`,
    //         type: "rental",
    //         quantity: 1,
    //         total: totalPoints,
    //         description: `Member Card - ${elapsedMinutes} menit`,
    //         qty: 1,
    //         price: totalPoints,
    //         product_name: `Rental ${consoleRow.name || "Console"}`,
    //       },
    //     ],
    //     breakdown: {
    //       rental_cost: totalPoints,
    //       products_total: 0,
    //     },
    //     rental: {
    //       session_id: session.id,
    //       console: consoleRow.name,
    //       duration_minutes: elapsedMinutes,
    //       start_time: session.start_time,
    //       end_time: endTime.toISOString(),
    //     },
    //     member_card: {
    //       points_used: totalPoints,
    //       hourly_rate_snapshot: hourlyRateSnapshot,
    //       per_minute_rate_snapshot: perMinuteRateSnapshot,
    //     },
    //     payment: {
    //       method: "member_card",
    //       amount: totalPoints,
    //       change: 0,
    //     },
    //     customer_id: null,
    //     console_id: session.console_id,
    //     elapsed_minutes: elapsedMinutes,
    //   },
    // };

    // console.log(
    //   "Payload yang dikirim ke cashier_transactions:",
    //   cashierPayload
    // );

    // const logResp = await fetch(`${SUPABASE_URL}cashier_transactions`, {
    //   method: "POST",
    //   headers: HEADERS,
    //   body: JSON.stringify(cashierPayload),
    // });
    // console.log("Response log cashier_transactions:", logResp);
    // if (!logResp.ok) {
    //   console.error("Gagal log cashier transaction:", await logResp.text());
    // }

    return res.json({
      session: updatedSession,
      points: {
        elapsed_minutes: elapsedMinutes,
        // hourly_rate_snapshot: hourlyRateSnapshot,
        // per_minute_rate_snapshot: perMinuteRateSnapshot,
        // minimum_minutes_member: minimumMinutesMember,
        // total_points: totalPoints,
        // already_deducted: alreadyDeducted,
        // delta_to_deduct: needToDeduct,
      },
    });
  } catch (err) {
    console.error("Error di /end-session:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/update-protection/:console_id", async (req, res) => {
  const { console_id } = req.params;
  const { auto_shutdown_enabled } = req.body;

  if (auto_shutdown_enabled === undefined) {
    return res
      .status(400)
      .json({ error: "Field auto_shutdown_enabled dibutuhkan" });
  }

  try {
    const url = `${SUPABASE_URL}consoles?id=eq.${console_id}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ auto_shutdown_enabled }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res
        .status(500)
        .json({ error: "Gagal update Supabase", details: data });
    }

    return res
      .status(200)
      .json({ message: "Berhasil update auto_shutdown_enabled", data });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Server error", details: error.message });
  }
});

//Run
app.listen(port, () => {
  console.log(`TV controller backend running at http://localhost:${port}`);
});
// app.listen(port, () => {
//   console.log(`TV controller backend running at http://0.0.0.0:${port}`);
// });
app.listen(port2, () => {
  console.log(`TV controller backend running at http://localhost:${port2}`);
});
