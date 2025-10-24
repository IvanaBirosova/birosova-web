// server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 10000;

// ====== Nastavenia ======
app.use(cors());              // povol CORS (OK aj produkčne)
app.use(express.json());      // JSON body parser

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

// ====== API ======

// Uloženie správy z formulára
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

// Zoznam správ
app.get('/api/messages', async (_req, res) => {
  try {
    const messages = await readMessages();
    return res.json({ ok: true, messages });
  } catch (err) {
    console.error('GET /api/messages error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Zmazanie správy podľa ID
app.delete('/api/messages/:id', async (req, res) => {
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
