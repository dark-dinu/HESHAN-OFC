const express = require("express");
const pino = require("pino");
const { 
  makeWASocket, 
  delay, 
  makeCacheableSignalKeyStore, 
  Browsers 
} = require("@whiskeysockets/baileys");
const { useMongoAuthState } = require("./database/mongoSession");
const config = require("./config");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HESHAN-MD Link Device</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0b141a; color: #e9edef; margin: 0; }
        .card { background: #111b21; padding: 2.2rem; border-radius: 16px; width: 340px; text-align: center; border: 1px solid #222e35; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
        h2 { margin: 0 0 10px 0; color: #00a884; font-size: 1.4rem; }
        p { font-size: 0.85rem; color: #8696a0; margin-bottom: 20px; }
        input { width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid #2a3942; border-radius: 8px; box-sizing: border-box; background: #202c33; color: #fff; font-size: 1rem; outline: none; }
        button { width: 100%; padding: 12px; background: #00a884; color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 1rem; transition: 0.2s; }
        button:hover { background: #029071; }
        #code-display { margin-top: 20px; font-size: 1.5rem; font-weight: 700; color: #53bdeb; letter-spacing: 3px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>HESHAN-MD</h2>
        <p>Enter your phone number with country code</p>
        <input type="text" id="phone" placeholder="947xxxxxxxx" required />
        <button id="btn" onclick="fetchCode()">Get Pairing Code</button>
        <div id="code-display"></div>
      </div>
      <script>
        async function fetchCode() {
          const num = document.getElementById('phone').value.replace(/[^0-9]/g, '');
          const display = document.getElementById('code-display');
          const btn = document.getElementById('btn');
          if(!num) return alert('Please enter phone number');
          display.innerText = 'Connecting...';
          btn.disabled = true;
          try {
            const res = await fetch('/get-code?num=' + num);
            const data = await res.json();
            if(data.code) {
              display.innerText = data.code;
            } else {
              display.innerText = data.error || 'Failed';
            }
          } catch(e) {
            display.innerText = 'Server Error';
          } finally {
            btn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/get-code", async (req, res) => {
  let num = req.query.num;
  if (!num) return res.status(400).json({ error: "Missing number" });

  try {
    const { state, saveCreds } = await useMongoAuthState();
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
      },
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Chrome")
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {
      await delay(2500);
      const code = await sock.requestPairingCode(num);
      const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
      return res.json({ code: formattedCode });
    } else {
      return res.json({ code: "Already Paired! Run index.js" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(config.PORT, () => {
  console.log(`Pairing Server active: http://localhost:${config.PORT}`);
});
