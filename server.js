// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();

// ---- Parsovanie JSON + jednoduchý rate limit
app.use(express.json({ limit: "200kb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 20 }));

// ---- CORS (vývoj: povolíme aj file:// a localhost)
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

// ---- Servírovanie statických súborov (index.html, img/)
app.use(express.static(__dirname));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ---- SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // napr. smtp.m1.websupport.sk
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE) === "true", // 465=true, 587=false
  auth: {
    user: process.env.SMTP_USER, // napr. no-reply@listobook.sk
    pass: process.env.SMTP_PASS,
  },
});

// ---- Pomocná sanitácia
const sanitize = (s) =>
  (s || "").toString().trim().replace(/\r?\n/g, " ").slice(0, 1000);

// ---- API: /api/contact
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message, company } = req.body || {};

    // honeypot proti botom
    if (company) return res.status(200).json({ ok: true });

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: "Chýbajú údaje." });
    }

    const fromName = sanitize(name);
    const fromEmail = sanitize(email);
    const msg = sanitize(message);

    const mail = {
      from: `"Formulár – web" <${process.env.MAIL_FROM}>`,
      to: process.env.MAIL_TO, // Ivana dostane mail
      subject: `Nová správa z webu – ${fromName}`,
      replyTo: fromEmail,
      text: `Meno: ${fromName}\nE-mail: ${fromEmail}\n\nSpráva:\n${msg}`,
      html: `<p><b>Meno:</b> ${fromName}<br/><b>E-mail:</b> ${fromEmail}</p>
             <p><b>Správa:</b><br/>${msg
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;")}</p>`,
    };

    await transporter.sendMail(mail);
    return res.json({ ok: true });
  } catch (err) {
    console.error("MAIL ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Nepodarilo sa odoslať e-mail." });
  }
});

// healthcheck
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server beží na porte ${PORT}`));
