const express = require("express");
const { exec } = require("child_process");
const app = express();
const port = 3002;

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
      exec(`adb shell dumpsys power`, (err2, stdout2, stderr2) => {
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
      });
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
    else return res.json({ error: true, message: "Unknown action" });

    const needConnect =
      lastAdbConnected.ip !== ip || lastAdbConnected.port !== port;
    const doKeyevent = (cb) => {
      exec(`adb shell input keyevent ${keycode}`, (err, stdout, stderr) => {
        if (err) {
          if (action === "wake") {
            // Jika gagal hidupkan, coba reconnect lalu cek status
            exec(`adb connect ${ip}:${port}`, (err2, stdout2, stderr2) => {
              if (err2 || (stderr2 && stderr2.includes("failed"))) {
                return res.json({
                  error: true,
                  message: "Gagal reconnect ADB: " + (stderr2 || err2.message),
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
                    `adb shell input keyevent ${keycode}`,
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
      });
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

// Send raw keycode

app.get("/tv/:ip/key/:keycode", (req, res) => {
  const { ip, keycode } = req.params;
  const { port, method } = req.query;

  if (method === "adb") {
    const needConnect =
      lastAdbConnected.ip !== ip || lastAdbConnected.port !== port;
    const doKeyevent = () => {
      exec(`adb shell input keyevent ${keycode}`, (err, stdout, stderr) => {
        if (err) {
          return res.json({ error: true, message: stderr || err.message });
        }
        res.json({ success: true, used_method: "adb" });
      });
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
app.get('/install-adb', (req, res) => {
  // Cek jika 'adb' belum ada (hanya contoh kasar)
  exec('adb version', (err, stdout, stderr) => {
      if (err || stderr.includes('not recognized')) {
          // Contoh: auto-download adb di Linux
          // Untuk produksi, kamu harus menyesuaikan sistem operasi dan persetujuan pengguna
          return res.json({ success: false, message: 'ADB not installed manually. Please install it manually.' });
      } else {
          res.json({ success: true });
      }
  });
});



app.listen(port, '0.0.0.0', () => {
  console.log(`TV controller backend running at http://0.0.0.0:${port}`);
});
