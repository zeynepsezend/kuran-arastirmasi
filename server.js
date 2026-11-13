'use strict';
// Kur'an Araştırması platformu — sunucu
// Node.js >= 22.13 (yerleşik node:sqlite kullanılır) + Express

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'kuran.db');

const Q = require('./lib/quran');
const AK = require('./lib/acikkuran');
const mailer = require('./lib/mailer');
const { SURAHS, VERSES, TOTAL, verseIndex, publicVerse, normTr, normAr } = Q;

// ---------------------------------------------------------------------------
// Veritabanı
// ---------------------------------------------------------------------------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  active_group_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memberships (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  subgroup TEXT NOT NULL DEFAULT '',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS schedule_anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  start_index INTEGER NOT NULL,
  morning_count INTEGER NOT NULL,
  evening_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3d6b45',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, name)
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  context_date TEXT,
  context_period TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_verse ON notes(group_id, surah, ayah);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
  surah_from INTEGER,
  surah_to INTEGER,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS root_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  root TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_root_notes ON root_notes(group_id, root);
`);
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('translation')) db.exec("ALTER TABLE users ADD COLUMN translation TEXT NOT NULL DEFAULT 'diyanet'");
if (!userCols.includes('show_translit')) db.exec('ALTER TABLE users ADD COLUMN show_translit INTEGER NOT NULL DEFAULT 0');
// KVKK: aydınlatma metninin hangi sürümünün ne zaman onaylandığı
if (!userCols.includes('consent_at')) db.exec('ALTER TABLE users ADD COLUMN consent_at TEXT');
if (!userCols.includes('consent_version')) db.exec('ALTER TABLE users ADD COLUMN consent_version TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
`);
// Aydınlatma metni değiştiğinde bu sürümü artırın; kullanıcılardan yeniden onay istenir.
const CONSENT_VERSION = '2026-11';

AK.init(db);
const q = (sql) => db.prepare(sql);
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(b, h);
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newGroupCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!q('SELECT 1 FROM groups WHERE code = ?').get(c)) return c;
  }
}
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function serverToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function nowIso() { return new Date().toISOString(); }
function mod(n, m) { return ((n % m) + m) % m; }
function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

// ---------------------------------------------------------------------------
// Günlük ayet planı
// Plan, "çapa" kayıtlarından oluşur: belirli bir tarihten itibaren hangi
// ayetten başlanacağı ve sabah/akşam kaç ayet okunacağı. Ayarlar değiştiğinde
// yeni bir çapa eklenir; böylece geçmiş günlerin ayetleri değişmez.
// ---------------------------------------------------------------------------
function anchorsOf(gid) {
  return q('SELECT * FROM schedule_anchors WHERE group_id = ? ORDER BY start_date ASC, id ASC').all(gid);
}
function dayStartIndex(gid, date) {
  const anchors = anchorsOf(gid);
  if (!anchors.length) return { start: 0, morning: 5, evening: 5 };
  let a = anchors[0];
  for (const x of anchors) if (x.start_date <= date) a = x;
  const perDay = a.morning_count + a.evening_count;
  return { start: mod(a.start_index + dayDiff(a.start_date, date) * perDay, TOTAL), morning: a.morning_count, evening: a.evening_count };
}
function dailyVerses(gid, date, period) {
  const d = dayStartIndex(gid, date);
  const offset = period === 'aksam' ? d.morning : 0;
  const count = period === 'aksam' ? d.evening : d.morning;
  const out = [];
  for (let i = 0; i < count; i++) out.push(VERSES[mod(d.start + offset + i, TOTAL)]);
  return out;
}

// ---------------------------------------------------------------------------
// Uygulama
// ---------------------------------------------------------------------------
const app = express();
// Canlı ortamda (HTTPS arkasında) çerezler yalnızca güvenli bağlantıda gönderilir.
const PROD = process.env.NODE_ENV === 'production';
const SECURE = PROD ? '; Secure' : '';
if (process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '200kb' }));

// Giriş ve kayıt denemelerine sınır: bir IP'den 15 dakikada en fazla 20 deneme.
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (a.length >= 20) return res.status(429).json({ error: 'Çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.' });
  a.push(now);
  attempts.set(key, a);
  if (attempts.size > 10000) attempts.clear();
  next();
}
app.use(['/api/auth/login', '/api/auth/register', '/api/auth/forgot', '/api/auth/reset', '/api/groups/join'], (req, res, next) => (req.method === 'POST' ? rateLimit(req, res, next) : next()));

app.get('/healthz', (req, res) => res.json({ ok: true }));

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}${SECURE}`);
}

const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.then === 'function') {
      r.then((v) => { if (v !== undefined && !res.headersSent) res.json(v); }).catch(next);
    } else if (r !== undefined && !res.headersSent) res.json(r);
  } catch (e) { next(e); }
};

function auth(req, res, next) {
  const sid = parseCookies(req).sid;
  const row = sid && q('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(sid);
  if (!row) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
  req.user = row;
  req.sid = sid;
  next();
}

function groupAccess(req, res, next) {
  const gid = parseInt(req.params.gid, 10);
  const m = q(`SELECT m.role, m.subgroup, g.* FROM memberships m JOIN groups g ON g.id = m.group_id
               WHERE m.group_id = ? AND m.user_id = ?`).get(gid, req.user.id);
  if (!m) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });
  req.group = m;
  req.isAdmin = m.role === 'admin';
  next();
}
function requireAdmin(req) { if (!req.isAdmin) throw new HttpError(403, 'Bu işlem için grup yöneticisi olmalısınız.'); }

// --- Kimlik doğrulama -------------------------------------------------------
app.post('/api/auth/register', wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name) throw bad('Ad soyad gerekli.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Geçerli bir e-posta girin.');
  if (password.length < 6) throw bad('Şifre en az 6 karakter olmalı.');
  if (req.body.consent !== true) throw bad('Devam etmek için aydınlatma metnini okuyup onaylamanız gerekir.');
  if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('Bu e-posta ile kayıtlı bir hesap var.');
  const r = q('INSERT INTO users (name, email, pass_hash, consent_at, consent_version) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, hashPassword(password), nowIso(), CONSENT_VERSION);
  setSession(res, Number(r.lastInsertRowid));
  return { ok: true };
}));

app.post('/api/auth/login', wrap((req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = q('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !checkPassword(String(req.body.password || ''), u.pass_hash)) throw bad('E-posta veya şifre hatalı.');
  setSession(res, u.id);
  return { ok: true };
}));

// --- Şifremi unuttum ---------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function appUrl(req) {
  // Canlı ortamda bağlantı adresi APP_URL'den alınır (sahte "Host" başlığıyla yanıltılamasın diye).
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
app.post('/api/auth/forgot', wrap(async (req) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = email && q('SELECT id, name, email FROM users WHERE email = ?').get(email);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    q('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(u.id, Date.now());
    q('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), u.id, Date.now() + 60 * 60 * 1000);
    const link = `${appUrl(req)}/#/sifre-sifirla?t=${token}`;
    try {
      await mailer.send({
        to: u.email,
        subject: 'Kuran Araştırması — şifre sıfırlama',
        text: `Selâmün aleyküm ${u.name},\n\nŞifrenizi sıfırlamak için aşağıdaki bağlantıyı açın (1 saat geçerlidir):\n${link}\n\nBu isteği siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmez.\n\nKuran Araştırması`,
        html: `<p>Selâmün aleyküm ${u.name.replace(/[<>&"]/g, '')},</p><p>Şifrenizi sıfırlamak için aşağıdaki düğmeye tıklayın. Bağlantı <b>1 saat</b> geçerlidir.</p>`
          + `<p><a href="${link}" style="display:inline-block;background:#1f5c45;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none">Şifremi sıfırla</a></p>`
          + `<p style="color:#666;font-size:13px">Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın; şifreniz değişmez.</p>`,
      });
    } catch (e) {
      console.error('Şifre sıfırlama e-postası gönderilemedi:', e.message);
    }
  }
  // Hesabın var olup olmadığı açığa çıkmasın diye yanıt her zaman aynıdır.
  return { ok: true };
}));
app.post('/api/auth/reset', wrap((req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (password.length < 6) throw bad('Şifre en az 6 karakter olmalı.');
  const r = token && q('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token));
  if (!r || r.used_at || r.expires_at < Date.now()) throw bad('Bağlantı geçersiz ya da süresi dolmuş. Lütfen yeniden şifre sıfırlama isteyin.');
  tx(() => {
    q('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), r.user_id);
    q('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(Date.now(), r.token_hash);
    q('DELETE FROM sessions WHERE user_id = ?').run(r.user_id); // her cihazdan çıkış
  });
  setSession(res, r.user_id);
  return { ok: true };
}));

app.post('/api/auth/logout', auth, wrap((req, res) => {
  q('DELETE FROM sessions WHERE token = ?').run(req.sid);
  res.setHeader('Set-Cookie', `sid=; HttpOnly; Path=/; Max-Age=0${SECURE}`);
  return { ok: true };
}));

// --- Profil -----------------------------------------------------------------
function myGroups(uid) {
  // Davet kodu ve üye sayısı yalnızca grubun yöneticisine gönderilir.
  return q(`SELECT g.id, g.name, g.code, m.role, m.subgroup,
              (SELECT COUNT(*) FROM memberships x WHERE x.group_id = g.id) AS member_count
            FROM memberships m JOIN groups g ON g.id = m.group_id
            WHERE m.user_id = ? ORDER BY m.joined_at ASC, g.id ASC`).all(uid)
    .map((g) => (g.role === 'admin' ? g : { ...g, code: null, member_count: null }));
}
function fixActiveGroup(user) {
  const groups = myGroups(user.id);
  let active = user.active_group_id;
  if (!groups.find((g) => g.id === active)) {
    active = groups.length ? groups[0].id : null;
    q('UPDATE users SET active_group_id = ? WHERE id = ?').run(active, user.id);
  }
  return { groups, active };
}

app.get('/api/me', auth, wrap((req) => {
  const { groups, active } = fixActiveGroup(req.user);
  return {
    user: {
      id: req.user.id, name: req.user.name, email: req.user.email,
      translation: Q.trId(req.user.translation), showTransliteration: !!req.user.show_translit,
      consentRequired: req.user.consent_version !== CONSENT_VERSION,
    },
    groups, activeGroupId: active, translations: Q.TRANSLATIONS,
  };
}));

app.patch('/api/me', auth, wrap((req) => {
  if (req.body.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) throw bad('Ad soyad boş olamaz.');
    q('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  }
  if (req.body.translation !== undefined) q('UPDATE users SET translation = ? WHERE id = ?').run(Q.trId(req.body.translation), req.user.id);
  if (req.body.showTransliteration !== undefined) q('UPDATE users SET show_translit = ? WHERE id = ?').run(req.body.showTransliteration ? 1 : 0, req.user.id);
  return { ok: true };
}));

app.post('/api/me/consent', auth, wrap((req) => {
  if (req.body.consent !== true) throw bad('Onay gerekli.');
  q('UPDATE users SET consent_at = ?, consent_version = ? WHERE id = ?').run(nowIso(), CONSENT_VERSION, req.user.id);
  return { ok: true };
}));

// KVKK md. 11: kişinin kendisiyle ilgili işlenen verileri öğrenme hakkı
app.get('/api/me/export', auth, (req, res) => {
  const u = req.user;
  const data = {
    olusturulma: nowIso(),
    hesap: { ad: u.name, eposta: u.email, kayit_tarihi: u.created_at, aydinlatma_onayi: { tarih: u.consent_at, surum: u.consent_version } },
    gruplar: q(`SELECT g.name AS grup, m.role AS rol, m.subgroup AS alt_grup, m.joined_at AS katilma
                FROM memberships m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ?`).all(u.id),
    cikarimlar: q(`SELECT g.name AS grup, n.surah AS sure, n.ayah AS ayet, t.name AS etiket, n.body AS metin, n.created_at AS tarih, n.updated_at AS duzenleme
                   FROM notes n JOIN groups g ON g.id = n.group_id LEFT JOIN tags t ON t.id = n.tag_id WHERE n.user_id = ? ORDER BY n.created_at`).all(u.id),
    kok_aciklamalari: q(`SELECT g.name AS grup, r.root AS kok, r.body AS metin, r.created_at AS tarih
                         FROM root_notes r JOIN groups g ON g.id = r.group_id WHERE r.user_id = ?`).all(u.id),
    kaldigi_yerler: q(`SELECT g.name AS grup, b.surah AS sure, b.ayah AS ayet, b.updated_at AS tarih
                       FROM bookmarks b JOIN groups g ON g.id = b.group_id WHERE b.user_id = ?`).all(u.id),
    gorevler: q(`SELECT g.name AS grup, k.title AS baslik, k.status AS durum, k.due_date AS son_tarih
                 FROM tasks k JOIN groups g ON g.id = k.group_id WHERE k.assignee_id = ?`).all(u.id),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="kuran-arastirmasi-verilerim.json"');
  res.json(data);
});

app.post('/api/me/password', auth, wrap((req) => {
  if (!checkPassword(String(req.body.current || ''), req.user.pass_hash)) throw bad('Mevcut şifre hatalı.');
  const np = String(req.body.next || '');
  if (np.length < 6) throw bad('Yeni şifre en az 6 karakter olmalı.');
  q('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(np), req.user.id);
  q('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sid);
  return { ok: true };
}));

app.delete('/api/me', auth, wrap((req, res) => {
  if (!checkPassword(String(req.body.password || ''), req.user.pass_hash)) throw bad('Şifre hatalı.');
  tx(() => {
    // Sahibi olduğu gruplarda yönetimi başka üyeye devret; tek üyeli grupları sil.
    for (const g of q("SELECT group_id FROM memberships WHERE user_id = ? AND role = 'admin'").all(req.user.id)) {
      const otherAdmin = q("SELECT 1 FROM memberships WHERE group_id = ? AND user_id <> ? AND role = 'admin'").get(g.group_id, req.user.id);
      if (!otherAdmin) {
        const next = q('SELECT user_id FROM memberships WHERE group_id = ? AND user_id <> ? ORDER BY joined_at LIMIT 1').get(g.group_id, req.user.id);
        if (next) q("UPDATE memberships SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(g.group_id, next.user_id);
        else q('DELETE FROM groups WHERE id = ?').run(g.group_id);
      }
    }
    // KVKK: gruplarda kalan içeriklerde ad anonimleştirilir
    q("UPDATE notes SET author_name = 'Silinmiş üye' WHERE user_id = ?").run(req.user.id);
    q("UPDATE root_notes SET author_name = 'Silinmiş üye' WHERE user_id = ?").run(req.user.id);
    q('DELETE FROM users WHERE id = ?').run(req.user.id);
  });
  res.setHeader('Set-Cookie', `sid=; HttpOnly; Path=/; Max-Age=0${SECURE}`);
  return { ok: true };
}));

app.post('/api/me/active-group', auth, wrap((req) => {
  const gid = parseInt(req.body.groupId, 10);
  if (!q('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(gid, req.user.id)) throw bad('Bu grubun üyesi değilsiniz.');
  q('UPDATE users SET active_group_id = ? WHERE id = ?').run(gid, req.user.id);
  return { ok: true };
}));

// --- Gruplar ----------------------------------------------------------------
const DEFAULT_TAGS = [
  ['Karakter Analizi', '#3d6b45'], ['Ahlak', '#8a5a2b'], ['Dua', '#2f5d8a'],
  ['Kıssa', '#7a3f74'], ['Hüküm', '#9b3b3b'], ['Tevhid', '#4f6b2a'],
];

app.post('/api/groups', auth, wrap((req) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw bad('Grup adı gerekli.');
  const today = isDate(req.body.today) ? req.body.today : serverToday();
  const gid = tx(() => {
    const r = q('INSERT INTO groups (name, code, owner_id) VALUES (?, ?, ?)').run(name, newGroupCode(), req.user.id);
    const gid = Number(r.lastInsertRowid);
    q("INSERT INTO memberships (group_id, user_id, role) VALUES (?, ?, 'admin')").run(gid, req.user.id);
    q('INSERT INTO schedule_anchors (group_id, start_date, start_index, morning_count, evening_count) VALUES (?, ?, 0, 5, 5)').run(gid, today);
    for (const [n, c] of DEFAULT_TAGS) q('INSERT INTO tags (group_id, name, color) VALUES (?, ?, ?)').run(gid, n, c);
    q('UPDATE users SET active_group_id = ? WHERE id = ?').run(gid, req.user.id);
    return gid;
  });
  return { ok: true, groupId: gid };
}));

app.post('/api/groups/join', auth, wrap((req) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const g = q('SELECT * FROM groups WHERE code = ?').get(code);
  if (!g) throw bad('Bu koda ait bir grup bulunamadı.');
  if (q('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(g.id, req.user.id)) throw bad('Bu gruba zaten üyesiniz.');
  q('INSERT INTO memberships (group_id, user_id) VALUES (?, ?)').run(g.id, req.user.id);
  q('UPDATE users SET active_group_id = ? WHERE id = ?').run(g.id, req.user.id);
  return { ok: true, groupId: g.id, name: g.name };
}));

const G = '/api/g/:gid';
app.use(G, auth, groupAccess);

app.get(G, wrap((req) => {
  const today = isDate(req.query.today) ? req.query.today : serverToday();
  const d = dayStartIndex(req.group.id, today);
  const startVerse = VERSES[d.start];
  return {
    id: req.group.id, name: req.group.name, code: req.isAdmin ? req.group.code : null, role: req.group.role, subgroup: req.group.subgroup,
    isAdmin: req.isAdmin,
    schedule: { morning: d.morning, evening: d.evening, todayStart: { surah: startVerse.surah, ayah: startVerse.ayah, surahName: startVerse.surahName } },
  };
}));

app.patch(G, wrap((req) => {
  requireAdmin(req);
  const name = String(req.body.name || '').trim();
  if (!name) throw bad('Grup adı gerekli.');
  q('UPDATE groups SET name = ? WHERE id = ?').run(name, req.group.id);
  return { ok: true };
}));

app.delete(G, wrap((req) => {
  requireAdmin(req);
  q('DELETE FROM groups WHERE id = ?').run(req.group.id);
  return { ok: true };
}));

app.post(G + '/code', wrap((req) => {
  requireAdmin(req);
  const code = newGroupCode();
  q('UPDATE groups SET code = ? WHERE id = ?').run(code, req.group.id);
  return { code };
}));

app.post(G + '/leave', wrap((req) => {
  const gid = req.group.id;
  tx(() => {
    if (req.isAdmin && !q("SELECT 1 FROM memberships WHERE group_id = ? AND user_id <> ? AND role = 'admin'").get(gid, req.user.id)) {
      const next = q('SELECT user_id FROM memberships WHERE group_id = ? AND user_id <> ? ORDER BY joined_at LIMIT 1').get(gid, req.user.id);
      if (next) q("UPDATE memberships SET role = 'admin' WHERE group_id = ? AND user_id = ?").run(gid, next.user_id);
    }
    q('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(gid, req.user.id);
    if (!q('SELECT 1 FROM memberships WHERE group_id = ?').get(gid)) q('DELETE FROM groups WHERE id = ?').run(gid);
  });
  return { ok: true };
}));

app.get(G + '/members', wrap((req) => {
  requireAdmin(req);
  return q(`SELECT u.id, u.name, m.role, m.subgroup, m.joined_at,
              (SELECT COUNT(*) FROM notes n WHERE n.group_id = m.group_id AND n.user_id = u.id) AS note_count
            FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.group_id = ? ORDER BY m.role = 'admin' DESC, u.name COLLATE NOCASE`).all(req.group.id);
}));

app.patch(G + '/members/:uid', wrap((req) => {
  requireAdmin(req); // alt grup / görev ve rol dağılımı yalnızca yöneticide
  const uid = parseInt(req.params.uid, 10);
  const m = q('SELECT * FROM memberships WHERE group_id = ? AND user_id = ?').get(req.group.id, uid);
  if (!m) throw new HttpError(404, 'Üye bulunamadı.');
  if (req.body.subgroup !== undefined) {
    q('UPDATE memberships SET subgroup = ? WHERE group_id = ? AND user_id = ?').run(String(req.body.subgroup).trim().slice(0, 100), req.group.id, uid);
  }
  if (req.body.role !== undefined) {
    requireAdmin(req);
    const role = req.body.role === 'admin' ? 'admin' : 'member';
    if (role === 'member' && m.role === 'admin' &&
        !q("SELECT 1 FROM memberships WHERE group_id = ? AND user_id <> ? AND role = 'admin'").get(req.group.id, uid)) {
      throw bad('Grupta en az bir yönetici kalmalı.');
    }
    q('UPDATE memberships SET role = ? WHERE group_id = ? AND user_id = ?').run(role, req.group.id, uid);
  }
  return { ok: true };
}));

app.delete(G + '/members/:uid', wrap((req) => {
  requireAdmin(req);
  const uid = parseInt(req.params.uid, 10);
  if (uid === req.user.id) throw bad('Kendinizi çıkarmak için "Gruptan Ayrıl" seçeneğini kullanın.');
  q('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(req.group.id, uid);
  return { ok: true };
}));

// --- Günlük ayetler ---------------------------------------------------------
function noteCountsFor(gid, verses) {
  const counts = {};
  if (!verses.length) return counts;
  const rows = q('SELECT surah, ayah, COUNT(*) AS c FROM notes WHERE group_id = ? GROUP BY surah, ayah').all(gid);
  const want = new Set(verses.map((v) => v.surah + ':' + v.ayah));
  for (const r of rows) { const k = r.surah + ':' + r.ayah; if (want.has(k)) counts[k] = r.c; }
  return counts;
}

app.get(G + '/daily', wrap((req) => {
  const date = isDate(req.query.date) ? req.query.date : serverToday();
  const period = req.query.period === 'aksam' ? 'aksam' : 'sabah';
  const verses = dailyVerses(req.group.id, date, period);
  const counts = noteCountsFor(req.group.id, verses);
  return { date, period, verses: verses.map((v) => ({ ...publicVerse(v, req.query.tr || req.user.translation), noteCount: counts[v.surah + ':' + v.ayah] || 0 })) };
}));

app.put(G + '/schedule', wrap((req) => {
  requireAdmin(req);
  const morning = clampInt(req.body.morning, 0, 300, 5);
  const evening = clampInt(req.body.evening, 0, 300, 5);
  if (morning + evening === 0) throw bad('Sabah ve akşam ayet sayısı birlikte sıfır olamaz.');
  const from = isDate(req.body.today) ? req.body.today : serverToday();
  let start;
  if (req.body.restart && req.body.restart.surah) {
    start = verseIndex(parseInt(req.body.restart.surah, 10), parseInt(req.body.restart.ayah || 1, 10));
    if (start < 0) throw bad('Geçersiz başlangıç ayeti.');
  } else {
    start = dayStartIndex(req.group.id, from).start;
  }
  tx(() => {
    q('DELETE FROM schedule_anchors WHERE group_id = ? AND start_date >= ?').run(req.group.id, from);
    q('INSERT INTO schedule_anchors (group_id, start_date, start_index, morning_count, evening_count) VALUES (?, ?, ?, ?, ?)')
      .run(req.group.id, from, start, morning, evening);
  });
  return { ok: true };
}));

// --- Etiketler --------------------------------------------------------------
app.get(G + '/tags', wrap((req) => {
  return q(`SELECT t.*, (SELECT COUNT(*) FROM notes n WHERE n.tag_id = t.id) AS note_count
            FROM tags t WHERE t.group_id = ? ORDER BY t.name COLLATE NOCASE`).all(req.group.id);
}));
function validColor(c) { return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#3d6b45'; }
app.post(G + '/tags', wrap((req) => {
  requireAdmin(req);
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) throw bad('Etiket adı gerekli.');
  if (q('SELECT 1 FROM tags WHERE group_id = ? AND name = ?').get(req.group.id, name)) throw bad('Bu etiket zaten var.');
  const r = q('INSERT INTO tags (group_id, name, color, description) VALUES (?, ?, ?, ?)')
    .run(req.group.id, name, validColor(req.body.color), String(req.body.description || '').slice(0, 300));
  return { id: Number(r.lastInsertRowid) };
}));
app.patch(G + '/tags/:id', wrap((req) => {
  requireAdmin(req);
  const t = q('SELECT * FROM tags WHERE id = ? AND group_id = ?').get(req.params.id, req.group.id);
  if (!t) throw new HttpError(404, 'Etiket bulunamadı.');
  const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 60) : t.name;
  if (!name) throw bad('Etiket adı gerekli.');
  if (name !== t.name && q('SELECT 1 FROM tags WHERE group_id = ? AND name = ?').get(req.group.id, name)) throw bad('Bu etiket zaten var.');
  q('UPDATE tags SET name = ?, color = ?, description = ? WHERE id = ?').run(
    name, req.body.color !== undefined ? validColor(req.body.color) : t.color,
    req.body.description !== undefined ? String(req.body.description).slice(0, 300) : t.description, t.id);
  return { ok: true };
}));
app.delete(G + '/tags/:id', wrap((req) => {
  requireAdmin(req);
  q('DELETE FROM tags WHERE id = ? AND group_id = ?').run(req.params.id, req.group.id);
  return { ok: true };
}));

// --- Çıkarımlar (notlar) ----------------------------------------------------
const NOTE_SELECT = `SELECT n.*, t.name AS tag_name, t.color AS tag_color, u.name AS user_name
  FROM notes n LEFT JOIN tags t ON t.id = n.tag_id LEFT JOIN users u ON u.id = n.user_id`;
function decorateNote(n, req) {
  const v = VERSES[verseIndex(n.surah, n.ayah)];
  return {
    id: n.id, surah: n.surah, ayah: n.ayah, surahName: v ? v.surahName : '', verseText: v ? Q.TR_TEXT[Q.trId(req.query.tr || req.user.translation)][v.index] : '',
    tagId: n.tag_id, tagName: n.tag_name, tagColor: n.tag_color, body: n.body,
    mine: n.user_id === req.user.id,
    author: req.isAdmin || n.user_id === req.user.id ? (n.user_name || n.author_name) : null,
    userId: req.isAdmin ? n.user_id : null,
    contextDate: n.context_date, contextPeriod: n.context_period,
    createdAt: n.created_at, updatedAt: n.updated_at,
    canEdit: n.user_id === req.user.id || req.isAdmin,
  };
}

app.get(G + '/notes', wrap((req) => {
  const where = ['n.group_id = ?'];
  const args = [req.group.id];
  if (req.query.surah) { where.push('n.surah = ?'); args.push(parseInt(req.query.surah, 10)); }
  if (req.query.ayah) { where.push('n.ayah = ?'); args.push(parseInt(req.query.ayah, 10)); }
  if (req.query.surahFrom) { where.push('n.surah >= ?'); args.push(parseInt(req.query.surahFrom, 10)); }
  if (req.query.surahTo) { where.push('n.surah <= ?'); args.push(parseInt(req.query.surahTo, 10)); }
  if (req.query.tag === 'none') where.push('n.tag_id IS NULL');
  else if (req.query.tag) { where.push('n.tag_id = ?'); args.push(parseInt(req.query.tag, 10)); }
  if (req.query.user && req.isAdmin) { where.push('n.user_id = ?'); args.push(parseInt(req.query.user, 10)); }
  if (req.query.mine === '1') { where.push('n.user_id = ?'); args.push(req.user.id); }
  const order = req.query.sort === 'verse' ? 'n.surah, n.ayah, n.created_at' : 'n.created_at DESC';
  let rows = q(`${NOTE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...args);
  if (req.query.q) {
    const term = normTr(req.query.q);
    rows = rows.filter((n) => normTr(n.body).includes(term));
  }
  return rows.slice(0, 1000).map((n) => decorateNote(n, req));
}));

function noteInput(req) {
  const body = String(req.body.body || '').trim();
  if (!body) throw bad('Not boş olamaz.');
  let tagId = req.body.tagId ? parseInt(req.body.tagId, 10) : null;
  if (tagId && !q('SELECT 1 FROM tags WHERE id = ? AND group_id = ?').get(tagId, req.group.id)) throw bad('Geçersiz etiket.');
  return { body: body.slice(0, 20000), tagId };
}

app.post(G + '/notes', wrap((req) => {
  const surah = parseInt(req.body.surah, 10), ayah = parseInt(req.body.ayah, 10);
  if (verseIndex(surah, ayah) < 0) throw bad('Geçersiz ayet.');
  const { body, tagId } = noteInput(req);
  const ctxDate = isDate(req.body.contextDate) ? req.body.contextDate : null;
  const ctxPeriod = ['sabah', 'aksam'].includes(req.body.contextPeriod) ? req.body.contextPeriod : null;
  const r = q(`INSERT INTO notes (group_id, user_id, author_name, surah, ayah, tag_id, body, context_date, context_period, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.group.id, req.user.id, req.user.name, surah, ayah, tagId, body, ctxDate, ctxPeriod, nowIso());
  return { id: Number(r.lastInsertRowid) };
}));

function ownNote(req) {
  const n = q('SELECT * FROM notes WHERE id = ? AND group_id = ?').get(req.params.id, req.group.id);
  if (!n) throw new HttpError(404, 'Çıkarım bulunamadı.');
  if (n.user_id !== req.user.id && !req.isAdmin) throw new HttpError(403, 'Sadece kendi çıkarımlarınızı düzenleyebilirsiniz.');
  return n;
}
app.get(G + '/notes/:id', wrap((req) => {
  const n = q(`${NOTE_SELECT} WHERE n.id = ? AND n.group_id = ?`).get(req.params.id, req.group.id);
  if (!n) throw new HttpError(404, 'Çıkarım bulunamadı.');
  return decorateNote(n, req);
}));
app.patch(G + '/notes/:id', wrap((req) => {
  const n = ownNote(req);
  const { body, tagId } = noteInput(req);
  q('UPDATE notes SET body = ?, tag_id = ?, updated_at = ? WHERE id = ?').run(body, tagId, nowIso(), n.id);
  return { ok: true };
}));
app.delete(G + '/notes/:id', wrap((req) => {
  const n = ownNote(req);
  q('DELETE FROM notes WHERE id = ?').run(n.id);
  return { ok: true };
}));

// --- Kaldığım yer -----------------------------------------------------------
app.get(G + '/bookmark', wrap((req) => {
  return q('SELECT surah, ayah, updated_at FROM bookmarks WHERE user_id = ? AND group_id = ?').get(req.user.id, req.group.id) || null;
}));
app.put(G + '/bookmark', wrap((req) => {
  const surah = parseInt(req.body.surah, 10), ayah = parseInt(req.body.ayah, 10);
  if (verseIndex(surah, ayah) < 0) throw bad('Geçersiz ayet.');
  q(`INSERT INTO bookmarks (user_id, group_id, surah, ayah, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, group_id) DO UPDATE SET surah = excluded.surah, ayah = excluded.ayah, updated_at = excluded.updated_at`)
    .run(req.user.id, req.group.id, surah, ayah);
  return { ok: true };
}));

// --- İstatistikler ----------------------------------------------------------
app.get(G + '/stats', wrap((req) => {
  requireAdmin(req);
  const gid = req.group.id;
  const total = q('SELECT COUNT(*) AS c FROM notes WHERE group_id = ?').get(gid).c;
  const verses = q('SELECT COUNT(*) AS c FROM (SELECT DISTINCT surah, ayah FROM notes WHERE group_id = ?)').get(gid).c;
  const members = q('SELECT COUNT(*) AS c FROM memberships WHERE group_id = ?').get(gid).c;
  const byTag = q(`SELECT COALESCE(t.name, 'Etiketsiz') AS name, COALESCE(t.color, '#9a9a9a') AS color, COUNT(*) AS c
                   FROM notes n LEFT JOIN tags t ON t.id = n.tag_id WHERE n.group_id = ? GROUP BY n.tag_id ORDER BY c DESC`).all(gid);
  const byMember = q(`SELECT COALESCE(u.name, n.author_name) AS name, COUNT(*) AS c FROM notes n LEFT JOIN users u ON u.id = n.user_id
                      WHERE n.group_id = ? GROUP BY COALESCE(n.user_id, n.author_name) ORDER BY c DESC`).all(gid);
  const bySurah = q('SELECT surah, COUNT(*) AS c FROM notes WHERE group_id = ? GROUP BY surah ORDER BY c DESC LIMIT 10').all(gid)
    .map((r) => ({ name: `${r.surah}. ${SURAHS[r.surah - 1].name}`, c: r.c }));
  const last30 = q(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM notes
                    WHERE group_id = ? AND created_at >= ? GROUP BY day ORDER BY day`).all(gid, new Date(Date.now() - 30 * 86400000).toISOString());
  const mine = q('SELECT COUNT(*) AS c FROM notes WHERE group_id = ? AND user_id = ?').get(gid, req.user.id).c;
  const today = isDate(req.query.today) ? req.query.today : serverToday();
  const d = dayStartIndex(gid, today);
  return {
    total, verses, members, mine, byTag, byMember, bySurah, last30,
    coverage: { percent: Math.round((verses / TOTAL) * 1000) / 10, total: TOTAL },
    progress: { index: d.start, percent: Math.round((d.start / TOTAL) * 1000) / 10 },
  };
}));

// --- Çıkarım düzenleme görevleri --------------------------------------------
const TASK_SELECT = `SELECT k.*, a.name AS assignee_name, c.name AS creator_name, t.name AS tag_name, t.color AS tag_color
  FROM tasks k LEFT JOIN users a ON a.id = k.assignee_id LEFT JOIN users c ON c.id = k.creator_id LEFT JOIN tags t ON t.id = k.tag_id`;
function decorateTask(k, req) {
  return {
    id: k.id, title: k.title, description: k.description, status: k.status, dueDate: k.due_date,
    assigneeId: k.assignee_id, assigneeName: k.assignee_name, creatorId: k.creator_id, creatorName: k.creator_name,
    tagId: k.tag_id, tagName: k.tag_name, tagColor: k.tag_color,
    surahFrom: k.surah_from, surahTo: k.surah_to,
    surahFromName: k.surah_from ? SURAHS[k.surah_from - 1].name : null,
    surahToName: k.surah_to ? SURAHS[k.surah_to - 1].name : null,
    createdAt: k.created_at,
    canEdit: req.isAdmin,
    canToggle: req.isAdmin || k.assignee_id === req.user.id,
  };
}
function taskInput(req) {
  const title = String(req.body.title || '').trim().slice(0, 200);
  if (!title) throw bad('Görev başlığı gerekli.');
  const assignee = req.body.assigneeId ? parseInt(req.body.assigneeId, 10) : null;
  if (assignee && !q('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(req.group.id, assignee)) throw bad('Atanan kişi grupta değil.');
  const tagId = req.body.tagId ? parseInt(req.body.tagId, 10) : null;
  if (tagId && !q('SELECT 1 FROM tags WHERE id = ? AND group_id = ?').get(tagId, req.group.id)) throw bad('Geçersiz etiket.');
  let from = req.body.surahFrom ? clampInt(req.body.surahFrom, 1, 114, null) : null;
  let to = req.body.surahTo ? clampInt(req.body.surahTo, 1, 114, null) : from;
  if (from && to && to < from) [from, to] = [to, from];
  return { title, description: String(req.body.description || '').slice(0, 5000), assignee, tagId, from, to, due: isDate(req.body.dueDate) ? req.body.dueDate : null };
}
app.get(G + '/tasks', wrap((req) => {
  const mineOnly = req.isAdmin ? '' : ' AND k.assignee_id = ' + Number(req.user.id);
  return q(`${TASK_SELECT} WHERE k.group_id = ?${mineOnly} ORDER BY k.status = 'done', k.due_date IS NULL, k.due_date, k.id DESC`)
    .all(req.group.id).map((k) => decorateTask(k, req));
}));
app.post(G + '/tasks', wrap((req) => {
  requireAdmin(req);
  const t = taskInput(req);
  const r = q(`INSERT INTO tasks (group_id, title, description, assignee_id, creator_id, tag_id, surah_from, surah_to, due_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.group.id, t.title, t.description, t.assignee, req.user.id, t.tagId, t.from, t.to, t.due);
  return { id: Number(r.lastInsertRowid) };
}));
function editableTask(req) {
  const k = q(`${TASK_SELECT} WHERE k.id = ? AND k.group_id = ?`).get(req.params.id, req.group.id);
  if (!k) throw new HttpError(404, 'Görev bulunamadı.');
  const d = decorateTask(k, req);
  const statusOnly = req.method === 'PATCH' && req.body.status !== undefined && Object.keys(req.body).length === 1;
  if (!(statusOnly ? d.canToggle : d.canEdit)) throw new HttpError(403, 'Görevleri yalnızca grup yöneticisi düzenleyebilir.');
  return k;
}
app.patch(G + '/tasks/:id', wrap((req) => {
  const k = editableTask(req);
  if (req.body.status !== undefined && Object.keys(req.body).length === 1) {
    q('UPDATE tasks SET status = ? WHERE id = ?').run(req.body.status === 'done' ? 'done' : 'open', k.id);
    return { ok: true };
  }
  const t = taskInput(req);
  q(`UPDATE tasks SET title = ?, description = ?, assignee_id = ?, tag_id = ?, surah_from = ?, surah_to = ?, due_date = ?,
     status = COALESCE(?, status) WHERE id = ?`)
    .run(t.title, t.description, t.assignee, t.tagId, t.from, t.to, t.due, req.body.status ? (req.body.status === 'done' ? 'done' : 'open') : null, k.id);
  return { ok: true };
}));
app.delete(G + '/tasks/:id', wrap((req) => {
  const k = editableTask(req);
  q('DELETE FROM tasks WHERE id = ?').run(k.id);
  return { ok: true };
}));

// --- Kök açıklamaları (grup içi) --------------------------------------------
app.get(G + '/root-notes/:root', wrap((req) => {
  return q(`SELECT r.*, u.name AS user_name FROM root_notes r LEFT JOIN users u ON u.id = r.user_id
            WHERE r.group_id = ? AND r.root = ? ORDER BY r.created_at`).all(req.group.id, req.params.root)
    .map((r) => ({ id: r.id, body: r.body, mine: r.user_id === req.user.id,
      author: req.isAdmin || r.user_id === req.user.id ? (r.user_name || r.author_name) : null,
      createdAt: r.created_at, updatedAt: r.updated_at, canEdit: r.user_id === req.user.id || req.isAdmin }));
}));
app.get(G + '/root-notes', wrap((req) => {
  return q('SELECT root, COUNT(*) AS c FROM root_notes WHERE group_id = ? GROUP BY root ORDER BY c DESC').all(req.group.id)
    .map((r) => ({ root: r.root, count: r.c, rootArabic: (Q.searchRoots(r.root)[0] || {}).rootArabic || r.root }));
}));
app.post(G + '/root-notes/:root', wrap((req) => {
  if (!Q.ROOTS.has(req.params.root)) throw bad('Geçersiz kök.');
  const body = String(req.body.body || '').trim().slice(0, 20000);
  if (!body) throw bad('Açıklama boş olamaz.');
  const r = q('INSERT INTO root_notes (group_id, root, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.group.id, req.params.root, req.user.id, req.user.name, body, nowIso());
  return { id: Number(r.lastInsertRowid) };
}));
function ownRootNote(req) {
  const n = q('SELECT * FROM root_notes WHERE id = ? AND group_id = ?').get(req.params.id, req.group.id);
  if (!n) throw new HttpError(404, 'Açıklama bulunamadı.');
  if (n.user_id !== req.user.id && !req.isAdmin) throw new HttpError(403, 'Sadece kendi açıklamalarınızı düzenleyebilirsiniz.');
  return n;
}
app.patch(G + '/root-note/:id', wrap((req) => {
  const n = ownRootNote(req);
  const body = String(req.body.body || '').trim().slice(0, 20000);
  if (!body) throw bad('Açıklama boş olamaz.');
  q('UPDATE root_notes SET body = ?, updated_at = ? WHERE id = ?').run(body, nowIso(), n.id);
  return { ok: true };
}));
app.delete(G + '/root-note/:id', wrap((req) => {
  q('DELETE FROM root_notes WHERE id = ?').run(ownRootNote(req).id);
  return { ok: true };
}));

// --- Kur'an -----------------------------------------------------------------
app.get('/api/quran/translations', (req, res) => res.json(Q.TRANSLATIONS));
app.get('/api/quran/surahs', (req, res) => {
  res.json(SURAHS.map(({ startIndex, ...s }) => s));
});
app.get('/api/quran/surah/:n', (req, res) => {
  const s = SURAHS[parseInt(req.params.n, 10) - 1];
  if (!s) return res.status(404).json({ error: 'Sure bulunamadı.' });
  const { startIndex, ...info } = s;
  res.json({ ...info, verses: VERSES.slice(s.startIndex, s.startIndex + s.verseCount).map((v) => publicVerse(v, req.query.tr)) });
});
app.get('/api/quran/verse/:s/:a', (req, res) => {
  const i = verseIndex(parseInt(req.params.s, 10), parseInt(req.params.a, 10));
  if (i < 0) return res.status(404).json({ error: 'Ayet bulunamadı.' });
  const v = VERSES[i];
  const tr = req.query.tr;
  res.json({
    ...publicVerse(v, tr, { all: true }),
    surahVerseCount: SURAHS[v.surah - 1].verseCount,
    prev: i > 0 ? { surah: VERSES[i - 1].surah, ayah: VERSES[i - 1].ayah } : null,
    next: i < TOTAL - 1 ? { surah: VERSES[i + 1].surah, ayah: VERSES[i + 1].ayah } : null,
  });
});
// Kelimeler: dilbilgisi ve kökler Kur'an Arapça Korpusu'ndan; Türkçe kelime anlamları, okunuşlar
// ve kök anlamları Açık Kuran'dan (ilk istekte indirilip saklanır). Açık Kuran'a ulaşılamazsa
// yalnızca Korpus verisi döner.
app.get('/api/quran/words/:s/:a', async (req, res) => {
  const s = parseInt(req.params.s, 10), a = parseInt(req.params.a, 10);
  const i = verseIndex(s, a);
  if (i < 0) return res.status(404).json({ error: 'Ayet bulunamadı.' });
  const words = Q.verseWords(i);
  let ak = null;
  try { ak = await AK.verse(s, a); } catch (e) { console.warn('Açık Kuran:', e.message); }
  const akWords = ak && ak.words.length === words.length ? ak.words : null;
  res.json({
    source: akWords ? 'acikkuran' : 'corpus',
    sourceUrl: `${AK.BASE}/${s}/${a}`,
    words: words.map((w, k) => {
      const x = akWords && akWords[k];
      return {
        ...w,
        transliteration: (x && x.transcription) || w.transliteration,
        meaning: x ? x.meaning : '',
        akDetails: x ? x.details : [],
        rootMeaning: x && x.root && x.root.latin === w.root ? x.root.mean : '',
        rootTranscription: x && x.root ? x.root.transcription : '',
      };
    }),
  });
});
app.get('/api/quran/extra/:s/:a', async (req, res) => {
  const s = parseInt(req.params.s, 10), a = parseInt(req.params.a, 10);
  if (verseIndex(s, a) < 0) return res.status(404).json({ error: 'Ayet bulunamadı.' });
  try {
    const ak = await AK.verse(s, a);
    res.json({ sourceUrl: `${AK.BASE}/${s}/${a}`, transcription: ak.transcription, translations: ak.translations });
  } catch (e) {
    res.status(502).json({ error: "Açık Kuran'a şu an ulaşılamıyor." });
  }
});
app.get('/api/quran/root/:root', async (req, res) => {
  const info = Q.rootInfo(req.params.root, req.query.tr);
  if (!info) return res.status(404).json({ error: 'Kök bulunamadı.' });
  let ak = null;
  try { ak = await AK.root(req.params.root); } catch (e) { console.warn('Açık Kuran kök:', e.message); }
  res.json({
    ...info,
    meaning: ak ? ak.mean : '',
    transcription: ak ? ak.transcription : '',
    derived: ak ? ak.derived : [],
    sourceUrl: `${AK.BASE}/root/${encodeURIComponent(req.params.root)}`,
  });
});
app.get('/api/quran/roots', (req, res) => {
  res.json(Q.searchRoots(String(req.query.q || '')).slice(0, 2000));
});
app.get('/api/quran/search', (req, res) => {
  const raw = String(req.query.q || '').trim();
  const tr = Q.trId(req.query.tr);
  if (!raw) return res.json({ total: 0, results: [] });
  // "2:255" veya "2 255" biçiminde doğrudan ayet
  const ref = raw.match(/^(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/);
  if (ref) {
    const i = verseIndex(+ref[1], +ref[2]);
    return res.json({ total: i < 0 ? 0 : 1, results: i < 0 ? [] : [publicVerse(VERSES[i], tr)] });
  }
  const isArabic = /[؀-ۿ]/.test(raw);
  const terms = (isArabic ? normAr(raw) : normTr(raw)).split(/\s+/).filter(Boolean);
  const surahF = parseInt(req.query.surah, 10) || 0;
  const norm = isArabic ? null : Q.trNorm(tr);
  const hits = VERSES.filter((v) => (!surahF || v.surah === surahF) &&
    terms.every((t) => (isArabic ? v._ar : norm[v.index]).includes(t)));
  res.json({ total: hits.length, results: hits.slice(0, 300).map((v) => publicVerse(v, tr)) });
});

// --- Statik dosyalar ve hata yakalama ----------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    // Service worker her zaman güncel gelsin; diğer dosyalar kısa süre önbellekte kalsın.
    if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Sunucu hatası.' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Kur'an Araştırması çalışıyor: http://localhost:${PORT}`));
}
module.exports = app;
