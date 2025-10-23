// server.js
// .env načítaj len mimo produkcie
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const path = require("path");
const net = require("net");

const app = express();

// Render beží za proxy → musí byť pred rate-limitom
app.set("trust proxy", 1);

// Parsovanie + rate-limit
app.use(express.json({ limit: "200kb" }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// CORS
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // povoliť file://
      if (process.env.ALLOW_ALL_ORIGINS === "true") return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed by CORS"), false);
    },
  })
);

// Statické súbory
app.use(express.static(__dirname));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Nodemailer – Websupport STARTTLS (587)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,              // smtp.websupport.sk
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE) === "true", // pri 587 = false
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,            // no-reply@listobook.sk
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  tls: {
    minVersion: "TLSv1.2",
    servername: process.env.SMTP_HOST,      // SNI
  },
});

// Diagnostika pri štarte (uvidíš v Render Logs)
transporter.verify((err, ok) => {
  if (err) console.error("SMTP VERIFY ERROR:", err && err.message);
  else console.log("SMTP ready:", ok);
});

// Sanitácia
const sanitize = (s) =>
  (s || "").toString().trim().replace(/\r?\n/g, " ").slice(0, 1000);

function sendMailWithTimeout(mail, ms = 15000) {
  return Promise.race([
    transporter.sendMail(mail),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("MAIL TIMEOUT")), ms)
    ),
  ]);
}

// API: /api/contact
app.post("/api/contact", (req, res) => {
  try {
    const { name, email, message, company } = req.body || {};

    // honeypot
    if (company) return res.status(200).json({ ok: true });

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: "Chýbajú údaje." });
    }

    const fromName = sanitize(name);
    const fromEmail = sanitize(email);
    const msg = sanitize(message);

    const mail = {
      from: `"Formulár – web" <${process.env.MAIL_FROM}>`,
      to: process.env.MAIL_TO,
      subject: `Nová správa z webu – ${fromName}`,
      replyTo: fromEmail,
      text: `Meno: ${fromName}\nE-mail: ${fromEmail}\n\nSpráva:\n${msg}`,
      html: `<p><b>Meno:</b> ${fromName}<br/><b>E-mail:</b> ${fromEmail}</p>
             <p><b>Správa:</b><br/>${msg
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;")}</p>`,
    };

    // Okamžitá odpoveď – frontend nečaká na SMTP
    res.status(202).json({ ok: true });

    // Odoslanie na pozadí
    sendMailWithTimeout(mail)
      .then((info) => {
        try { console.log("MAIL SENT:", info && info.messageId); } catch (_) {}
      })
      .catch((err) => {
        console.error("MAIL ERROR (background):", err && err.message);
      });
  } catch (err) {
    console.error("MAIL ERROR (handler):", err && err.message);
    try {
      res.status(500).json({ ok: false, error: "Nepodarilo sa odoslať e-mail." });
    } catch (_) {}
  }
});

// Healthcheck
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Dočasná diagnostika TCP konektivity na SMTP
app.get("/api/smtp-check", (req, res) => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const socket = new net.Socket();
  const timeoutMs = 8000;

  let finished = false;
  const done = (ok, info) => {
    if (finished) return;
    finished = true;
    try { socket.destroy(); } catch(_) {}
    res.json({ ok, host, port, info });
  };

  socket.setTimeout(timeoutMs);
  socket.once("connect", () => done(true, "TCP connect OK"));
  socket.once("timeout", () => done(false, "TCP connect TIMEOUT"));
  socket.once("error", (e) => done(false, `TCP connect ERROR: ${e.message}`));

  try {
    socket.connect(port, host);
  } catch (e) {
    done(false, `CONNECT THROW: ${e.message}`);
  }
});

// PORT – Render si ho nastaví sám
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server beží na porte ${PORT}`));
