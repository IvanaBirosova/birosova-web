// server.js
// (1) Načítaj .env len mimo produkcie – na Renderi sa používa Env Vars
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();

// (2) Render beží za reverse proxy -> povol X-Forwarded-*
app.set("trust proxy", 1);

// Parsovanie JSON + jednoduchý rate limit
app.use(express.json({ limit: "200kb" }));
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 min
    limit: 120, // 120 požiadaviek / min
    standardHeaders: "draft-7",
    legacyHeaders: false,
  })
);

// ---- CORS (vývoj: povolíme aj file:// a localhost)
const allowed =
  (process.env.ALLOW_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    "") // podporíme obe mená
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const allowAll = String(process.env.ALLOW_ALL_ORIGINS || "").toLowerCase() === "true";

app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  if (allowAll) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (
    origin &&
    (allowed.includes(origin) ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("https://localhost") ||
      origin === "capacitor://localhost")
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ========= Nodemailer =========
function makeTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, // napr. smtp.websupport.sk
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true", // false pre 587/STARTTLS
    auth: {
      user: process.env.SMTP_USER, // MUSÍ byť celá adresa, napr. no-reply@listobook.sk
      pass: process.env.SMTP_PASS,
    },
    requireTLS: true, // Websupport podporuje STARTTLS
    tls: { minVersion: "TLSv1.2" },
    pool: true,
  });
}
const mailer = makeTransport();

// ========= API =========

// test mail: GET /api/test-mail?to=volitelne
app.get("/api/test-mail", async (req, res) => {
  try {
    const to = (req.query.to || process.env.MAIL_TO || "").toString();
    if (!to) return res.status(400).json({ ok: false, error: "No recipient" });

    const info = await mailer.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject: "Test — Ivana Birošová web",
      text: "Fungujem. 🙂",
      html: "<p>Fungujem. 🙂</p>",
    });

    res.json({ ok: true, id: info.messageId });
  } catch (err) {
    console.error("TEST MAIL ERROR", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// kontakt: POST /api/contact
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message, company } = req.body || {};

    // honeypot
    if (company) return res.json({ ok: true });

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const info = await mailer.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: process.env.MAIL_TO,
      subject: `Nová správa z webu — ${name}`,
      replyTo: email,
      text: `Meno: ${name}\nE-mail: ${email}\n\n${message}`,
      html: `<p><b>Meno:</b> ${escapeHtml(name)}<br><b>E-mail:</b> ${escapeHtml(
        email
      )}</p><pre style="font:inherit; white-space:pre-wrap">${escapeHtml(message)}</pre>`,
    });

    res.json({ ok: true, id: info.messageId });
  } catch (err) {
    console.error("MAIL ERROR", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ========= Statické súbory =========

// Servuj celý koreň projektu (index.html, m-*.html, /img, atď.)
app.use(express.static(path.join(__dirname), { extensions: ["html"] }));

// Fallback pre / (nech vždy vracia aktuálny index)
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ========= Helper =========
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ========= Štart =========
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, "0.0.0.0", () => {
  console.log("/////////////////////////////////////////////////////");
  console.log(`=> Server beží na porte ${PORT}`);
  console.log("=> Your service is live 🎉");
  console.log("/////////////////////////////////////////////////////");
});
