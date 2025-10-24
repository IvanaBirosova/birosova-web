// server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser'); // ⬅️ cookies pre admin PIN
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 10000;

// ====== Nastavenia ======
app.use(cors());              // CORS (OK aj produkčne)
app.use(express.json());      // JSON body parser
app.use(cookieParser());      // ⬅️ čítanie/zápis cookies

// Statický hosting CELÉHO koreňa projektu (index.html, admin.html, img/, atď.)
app.use(express.static(path.join(__dirname)));

// Explicitne, ak chceš mať istotu (inak stačí statika vyššie)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ====== Práca so "DB" (JSON súbor) ======
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

// ====== Admin pomocné ======
const ADMIN_PIN = process.env.ADMIN_PIN || ''; // ⬅️ PIN z Renderu (Environment → ADMIN_PIN)
const REQUIRE_ADMIN = Boolean(ADMIN_PIN);      // len keď je PIN zadaný

function isAdmin(req) {
  // jednoduchá kontrola cookie; httpOnly cookie nastavíme pri /api/admin/login
  return req.cookies && req.cookies.admin === '1';
}

function requireAdmin(req, res, next) {
  if (!REQUIRE_ADMIN) return next();         // keď nie je PIN v env, nepýtame prihlásenie
  if (isAdmin(req)) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

// ====== API: Admin login/logout ======
app.post('/api/admin/login', (req, res) => {
  const pin = String(req.body?.pin || '');
  if (!REQUIRE_ADMIN) {
    // keď nie je nastavený ADMIN_PIN, považuj za OK (nič nechránime)
    return res.json({ ok: true, note: 'no_pin_set' });
  }
  if (pin === ADMIN_PIN) {
    // nastavíme bezpečné httpOnly cookie
    res.cookie('admin', '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 6, // 6 hodín
      path: '/',
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'bad_pin' });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin', { path: '/' });
  return res.json({ ok: true });
});

// ====== API: Kontakt (uloženie správy) ======
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body || {};
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

    const messages = await readMessages();
    messages.unshift(item);              // najnovšie navrchu
    await writeMessages(messages);

    return res.json({ ok: true, id: item.id });
  } catch (err) {
    console.error('POST /api/contact error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ====== API: Zoznam správ (chránené PIN-om, ak je nastavený) ======
app.get('/api/messages', requireAdmin, async (_req, res) => {
  try {
    const messages = await readMessages();
    return res.json({ ok: true, messages });
  } catch (err) {
    console.error('GET /api/messages error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ====== API: Zmazanie správy (chránené PIN-om, ak je nastavený) ======
app.delete('/api/messages/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const messages = await readMessages();
    const idx = messages.findIndex(m => m.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'not_found' });
    messages.splice(idx, 1);
    await writeMessages(messages);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/messages/:id error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ====== Štart ======
app.listen(PORT, () => {
  console.log('/////////////////////////////////////////////////////');
  console.log(`=> Server beží na porte ${PORT}`);
  console.log('=> Your service is live 🎉');
  console.log('/////////////////////////////////////////////////////');
});
