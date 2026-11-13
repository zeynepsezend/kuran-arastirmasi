'use strict';
// Açık Kuran (https://acikkuran.com) bağlantısı.
// Bir ayetin kelime verisi (Türkçe kelime anlamları, okunuş, kök) ve Türkçe mealleri ile
// bir kökün Türkçe anlamı, ilk ihtiyaç duyulduğunda Açık Kuran'dan alınır ve yerel veritabanında
// saklanır. Böylece her ayet siteden en fazla bir kez istenir.

const BASE = 'https://acikkuran.com';
const TIMEOUT_MS = 12000;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90; // 90 gün sonra yenile

let db;
const inflight = new Map();

function init(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ak_cache (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
}

async function fetchNextData(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'KuranArastirmasi/1.0 (+self-hosted study app)', Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`Açık Kuran ${res.status}`);
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('Açık Kuran sayfa verisi okunamadı');
    return JSON.parse(m[1]).props.pageProps;
  } finally {
    clearTimeout(timer);
  }
}

// Önbellekten getir; yoksa (veya eskiyse) indir. İndirme başarısız olursa eski kayıt kullanılır.
async function cached(key, loader) {
  const row = db.prepare('SELECT json, fetched_at FROM ak_cache WHERE key = ?').get(key);
  if (row && Date.now() - row.fetched_at < MAX_AGE_MS) return JSON.parse(row.json);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await loader();
      db.prepare(`INSERT INTO ak_cache (key, json, fetched_at) VALUES (?, ?, ?)
                  ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`)
        .run(key, JSON.stringify(data), Date.now());
      return data;
    } catch (e) {
      if (row) return JSON.parse(row.json);
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function slimRoot(r) {
  if (!r) return null;
  return { latin: r.latin, arabic: r.arabic, transcription: r.transcription, mean: r.mean || '', count: r.count || null };
}

async function verse(surah, ayah) {
  return cached(`v:${surah}:${ayah}`, async () => {
    const pp = await fetchNextData(`/${surah}/${ayah}`);
    const words = (pp.words || []).slice().sort((a, b) => a.sort_number - b.sort_number).map((w) => ({
      arabic: w.arabic,
      transcription: w.transcription_tr || '',
      meaning: cleanText(w.translation_tr),
      details: (w.details || []).flat().map((d) => d && d.tr).filter(Boolean),
      root: slimRoot(w.root),
    }));
    const all = [pp.translation, ...(pp.translations || [])].filter(Boolean);
    const seen = new Set();
    const translations = [];
    for (const t of all) {
      if (!t.author || t.author.language !== 'tr' || seen.has(t.author.id)) continue;
      seen.add(t.author.id);
      translations.push({
        id: t.author.id,
        name: t.author.name,
        description: t.author.description || '',
        text: cleanText(t.text),
        footnotes: (t.footnotes || []).map((f) => ({ number: f.number, text: cleanText(f.text) })),
      });
    }
    translations.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return {
      transcription: (pp.verse && pp.verse.transcription) || '',
      words,
      translations,
    };
  });
}

async function root(latin) {
  return cached(`r:${latin}`, async () => {
    const pp = await fetchNextData(`/root/${encodeURIComponent(latin)}`);
    const r = (pp.roots || [])[0];
    if (!r) throw new Error('Kök bulunamadı');
    return {
      ...slimRoot(r),
      derived: (r.diffs || []).map((d) => ({ arabic: d.diff, count: d.count, meaning: cleanText(d.translation), transcription: d.transcription })),
    };
  });
}

module.exports = { init, verse, root, BASE };
