// server.js
require('dotenv').config(); // .env lokálne
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 10000;

// ====== ENV ======
const ADMIN_PIN = process.env.ADMIN_PIN || ''; // ak ostáva admin, inak neskôr vyhodíme

// ====== Middlewares ======
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// statické súbory z koreňa (index.html, admin.html, img/, …)
app.use(express.static(path.join(__dirname)));

// ====== jednoduché health/info ======
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: 'auth-v1' });
});

// ====== „DB“ (JSON) ======
const DB_FILE = path.join(__dirname, 'data', 'messages.json');

async function ensureDb() {
  await fs.ensureDir(path.dirname(DB_FILE));
  if (!(await fs.pathExists(DB_FILE))) {
    await fs.writeJson(DB_FILE, []);
  }
}
async function readMessages() {
  await ensureDb();
  const raw = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}
async function writeMessages(arr) {
  await ensureDb();
  await fs.writeJson(DB_FILE, arr, { spaces: 2 });
}

// ====== Mailer (Websupport SMTP) ======
function getTransporter() {
  const host   = process.env.SMTP_HOST;
  const port   = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true';
  const user   = process.env.SMTP_USER;
  const pass   = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error('SMTP config missing (check SMTP_HOST, SMTP_USER, SMTP_PASS).');
  }
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

// ====== API – verejný kontakt (bez PIN) ======
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message, company } = req.body || {};

    // honeypot (skryté pole)
    if (company) return res.json({ ok: true });

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }

    const item = {
      id: uuidv4(),
      name: String(name).slice(0, 200),
      email: String(email).slice(0, 200),
      message: String(message).slice(0, 5000),
      ts: new Date().toISOString(),
    };

    // 1) uloženie do „DB“ (tvoj pôvodný kód)
    const messages = await readMessages();
    messages.unshift(item);
    await writeMessages(messages);

    // 2) odoslanie emailu
    const MAIL_FROM = process.env.MAIL_FROM || 'no-reply@listobook.sk';
    const MAIL_TO   = process.env.MAIL_TO   || 'ivanabirosova1@gmail.com';
    const transporter = getTransporter();

    await transporter.sendMail({
      from: `"Web formulár" <${MAIL_FROM}>`,
      to: MAIL_TO,
      replyTo: `"${item.name}" <${item.email}>`,
      subject: `Nová správa z webu — ${item.name}`,
      text:
`Meno: ${item.name}
E-mail: ${item.email}

Správa:
${item.message}
`,
      html:
`<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
  <p><strong>Meno:</strong> ${item.name}<br/>
  <strong>E-mail:</strong> ${item.email}</p>
  <p><strong>Správa:</strong><br/>${String(item.message).replace(/\n/g,'<br/>')}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0"/>
  <small>Odoslané: ${item.ts}</small>
</div>`
    });

    res.json({ ok: true, id: item.id });
  } catch (e) {
    console.error('POST /api/contact', e);
    res.status(500).json({ ok: false, error: 'server_error_or_mail_failed' });
  }
});

// ====== ADMIN – prihlásenie PINom (ponecháme dočasne)
app.post('/api/admin/login', (req, res) => {
  try {
    const { pin } = req.body || {};
    if (!ADMIN_PIN) return res.status(500).json({ ok: false, error: 'pin_not_set' });
    if (String(pin) !== String(ADMIN_PIN)) {
      return res.status(401).json({ ok: false, error: 'invalid_pin' });
    }
    res.cookie('admin', '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 2 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.post('/api/admin/logout', (_req, res) => {
  res.clearCookie('admin');
  res.json({ ok: true });
});

// middleware na ochranu admin endpointov
function requireAdmin(req, res, next) {
  if (req.cookies && req.cookies.admin === '1') return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

// ====== ADMIN endpointy (vyžadujú PIN)
app.get('/api/messages', requireAdmin, async (_req, res) => {
  try {
    const messages = await readMessages();
    res.json({ ok: true, messages });
  } catch (e) {
    console.error('GET /api/messages', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

app.delete('/api/messages/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const messages = await readMessages();
    const idx = messages.findIndex(m => m.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'not_found' });
    messages.splice(idx, 1);
    await writeMessages(messages);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/messages/:id', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// (nechávam pre istotu, statika by to zvládla aj sama)
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin.html', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ====== Štart ======
app.listen(PORT, () => {
  console.log('/////////////////////////////////////////////////////');
  console.log(`=> Server beží na porte ${PORT}`);
  console.log('=> Your service is live 🎉');
  console.log('/////////////////////////////////////////////////////');
});
