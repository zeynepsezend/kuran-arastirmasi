'use strict';
// Kur'an verisi: Arapça metin, Türkçe mealler, kelime kelime morfoloji ve kökler.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Normalizasyon
// ---------------------------------------------------------------------------
function normTr(s) {
  return String(s || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[’'`]/g, "'");
}
function normAr(s) {
  return String(s || '')
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '')
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

// ---------------------------------------------------------------------------
// Sureler ve ayetler
// ---------------------------------------------------------------------------
const QURAN = JSON.parse(fs.readFileSync(path.join(DATA, 'quran_tr.json'), 'utf8'));

const JUZ_STARTS = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41],
  [9, 93], [11, 6], [12, 53], [15, 1], [17, 1], [18, 75], [21, 1], [23, 1], [25, 21], [27, 56],
  [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1],
];

const VERSES = [];
const SURAHS = QURAN.map((s) => ({
  number: s.id,
  name: s.translation,
  arabic: s.name,
  transliteration: s.transliteration,
  type: s.type === 'meccan' ? 'Mekkî' : 'Medenî',
  verseCount: s.total_verses,
  startIndex: 0,
}));
QURAN.forEach((s, si) => {
  SURAHS[si].startIndex = VERSES.length;
  for (const v of s.verses) {
    VERSES.push({ index: VERSES.length, surah: s.id, ayah: v.id, surahName: s.translation, arabic: v.text, _ar: normAr(v.text) });
  }
});
const TOTAL = VERSES.length;
for (const v of VERSES) {
  let j = 1;
  for (let i = 0; i < JUZ_STARTS.length; i++) {
    const [s, a] = JUZ_STARTS[i];
    if (v.surah > s || (v.surah === s && v.ayah >= a)) j = i + 1;
  }
  v.juz = j;
}

function verseIndex(surah, ayah) {
  const s = SURAHS[surah - 1];
  if (!s || !(ayah >= 1) || ayah > s.verseCount) return -1;
  return s.startIndex + ayah - 1;
}

// ---------------------------------------------------------------------------
// Mealler (Tanzil)
// ---------------------------------------------------------------------------
const TRANSLATIONS = [
  { id: 'diyanet', name: 'Diyanet İşleri' },
  { id: 'vakfi', name: 'Diyanet Vakfı' },
  { id: 'yazir', name: 'Elmalılı Hamdi Yazır' },
  { id: 'ates', name: 'Süleyman Ateş' },
  { id: 'bulac', name: 'Ali Bulaç' },
  { id: 'golpinarli', name: 'Abdülbaki Gölpınarlı' },
  { id: 'ozturk', name: 'Yaşar Nuri Öztürk' },
  { id: 'yildirim', name: 'Suat Yıldırım' },
  { id: 'yuksel', name: 'Edip Yüksel' },
];
const DEFAULT_TR = 'diyanet';
const TR_TEXT = {};
for (const t of TRANSLATIONS) TR_TEXT[t.id] = JSON.parse(fs.readFileSync(path.join(DATA, 'translations', `${t.id}.json`), 'utf8'));
const TRANSLIT = JSON.parse(fs.readFileSync(path.join(DATA, 'translations', 'transliteration.json'), 'utf8'));
const TR_NORM = {}; // arama için tembel üretilir
function trId(id) { return TR_TEXT[id] ? id : DEFAULT_TR; }
function trNorm(id) {
  if (!TR_NORM[id]) TR_NORM[id] = TR_TEXT[id].map(normTr);
  return TR_NORM[id];
}

function publicVerse(v, tr, opts = {}) {
  const id = trId(tr);
  const out = {
    index: v.index, surah: v.surah, ayah: v.ayah, surahName: v.surahName, juz: v.juz,
    arabic: v.arabic, text: TR_TEXT[id][v.index], translation: id,
    transliteration: TRANSLIT[v.index],
  };
  if (opts.all) out.translations = TRANSLATIONS.map((t) => ({ id: t.id, name: t.name, text: TR_TEXT[t.id][v.index] }));
  return out;
}

// ---------------------------------------------------------------------------
// Morfoloji — Kur'an Arapça Korpusu (corpus.quran.com), sürüm 0.4
// ---------------------------------------------------------------------------
const BW = {
  "'": 'ء', '>': 'أ', '&': 'ؤ', '<': 'إ', '}': 'ئ', A: 'ا', b: 'ب', p: 'ة', t: 'ت', v: 'ث', j: 'ج', H: 'ح', x: 'خ',
  d: 'د', '*': 'ذ', r: 'ر', z: 'ز', s: 'س', $: 'ش', S: 'ص', D: 'ض', T: 'ط', Z: 'ظ', E: 'ع', g: 'غ', _: 'ـ',
  f: 'ف', q: 'ق', k: 'ك', l: 'ل', m: 'م', n: 'ن', h: 'ه', w: 'و', Y: 'ى', y: 'ي',
  F: 'ً', N: 'ٌ', K: 'ٍ', a: 'َ', u: 'ُ', i: 'ِ', '~': 'ّ', o: 'ْ', '^': 'ٓ', '#': 'ٔ', '`': 'ٰ', '{': 'ٱ',
  ':': 'ۜ', '@': '۟', '"': '۠', '[': 'ۢ', ';': 'ۣ', ',': 'ۥ', '.': 'ۦ', '!': 'ۨ', '-': '۪', '+': '۫', '%': '۬', ']': 'ۭ',
};
const bw2ar = (s) => String(s || '').split('').map((c) => (BW[c] !== undefined ? BW[c] : '')).join('');

// Etiketlerin Türkçe karşılıkları
const POS_TR = {
  N: 'İsim', PN: 'Özel isim', ADJ: 'Sıfat', IMPN: 'Fiil ismi', PRON: 'Zamir', DEM: 'İşaret ismi', REL: 'İsm-i mevsûl (ilgi zamiri)',
  T: 'Zaman zarfı', LOC: 'Mekân zarfı', V: 'Fiil', P: 'Harf-i cer', EMPH: 'Tekit (pekiştirme) lâmı', IMPV: 'Emir lâmı',
  PRP: 'Ta\'lil (amaç) lâmı', CONJ: 'Atıf harfi (bağlaç)', SUB: 'Masdar harfi', ACC: 'Nasb harfi', AMD: 'İstidrâk (düzeltme) harfi',
  ANS: 'Cevap harfi', AVR: 'Kaçınma (redʿ) harfi', CAUS: 'Sebep harfi', CERT: 'Tahkik harfi', CIRC: 'Hal vâvı', COM: 'Maiyyet vâvı',
  COND: 'Şart edatı', EQ: 'Eşitlik (tesviye) harfi', EXH: 'Teşvik (tahdîd) harfi', EXL: 'Tafsil harfi', EXP: 'İstisna edatı',
  FUT: 'Gelecek zaman harfi (sa/sevfe)', INC: 'Başlangıç (ibtidâ) harfi', INT: 'Tefsir harfi', INTG: 'Soru edatı', NEG: 'Olumsuzluk edatı',
  PREV: 'Kâffe (engelleyici) harfi', PRO: 'Nehiy (yasaklama) harfi', REM: 'İstinâf (devam) harfi', RES: 'Kasr (sınırlama) edatı',
  RET: 'İdrâb (geri dönüş) harfi', RSLT: 'Netice (sonuç) harfi', SUP: 'Zâid (fazladan) harf', SUR: 'Mufâcee (sürpriz) harfi',
  VOC: 'Nida (seslenme) harfi', INL: 'Hurûf-ı mukattaa', DET: 'Belirlilik takısı (el-)',
};
const PREFIX_TR = {
  'Al+': ['DET', 'Belirlilik takısı (el-)'], 'bi+': ['P', 'Harf-i cer (bi-)'], 'ka+': ['P', 'Teşbih harfi (ke-)'], 'ta+': ['P', 'Yemin harfi (te-)'],
  'sa+': ['FUT', 'Gelecek zaman harfi (se-)'], 'ya+': ['VOC', 'Nida harfi (yâ)'], 'ha+': ['VOC', 'Tenbih harfi (hâ)'],
  'A:INTG+': ['INTG', 'Soru hemzesi (e-)'], 'A:EQ+': ['EQ', 'Tesviye hemzesi'],
  'w:CONJ+': ['CONJ', 'Atıf vâvı (ve)'], 'w:REM+': ['REM', 'İstinâf vâvı'], 'w:CIRC+': ['CIRC', 'Hal vâvı'], 'w:SUP+': ['SUP', 'Zâid vâv'],
  'w:P+': ['P', 'Yemin vâvı'], 'w:COM+': ['COM', 'Maiyyet vâvı'],
  'f:CONJ+': ['CONJ', 'Atıf fâsı (fe)'], 'f:REM+': ['REM', 'İstinâf fâsı'], 'f:RSLT+': ['RSLT', 'Netice fâsı'], 'f:SUP+': ['SUP', 'Zâid fâ'],
  'f:CAUS+': ['CAUS', 'Sebebiyet fâsı'],
  'l:P+': ['P', 'Harf-i cer (li-)'], 'l:EMPH+': ['EMPH', 'Tekit lâmı'], 'l:PRP+': ['PRP', 'Ta\'lil lâmı'], 'l:IMPV+': ['IMPV', 'Emir lâmı'],
};
const FORMS = { I: 'I', II: 'II', III: 'III', IV: 'IV', V: 'V', VI: 'VI', VII: 'VII', VIII: 'VIII', IX: 'IX', X: 'X', XI: 'XI', XII: 'XII' };
const BAB = {
  I: 'sülasi mücerred', II: 'tef\'îl babı', III: 'mufâale babı', IV: 'if\'âl babı', V: 'tefa\'ul babı', VI: 'tefâul babı',
  VII: 'infiâl babı', VIII: 'ifti\'âl babı', IX: 'if\'ilâl babı', X: 'istif\'âl babı', XI: 'if\'îlâl babı', XII: 'if\'î\'âl babı',
};
function pgn(code) {
  // ör. 3MS, 2MP, 1S, MS, FP, M, F, 3D
  const m = String(code).match(/^([123])?([MF])?([SDP])?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const parts = [];
  if (m[1]) parts.push(`${m[1]}. şahıs`);
  if (m[2]) parts.push(m[2] === 'M' ? 'eril (müzekker)' : 'dişil (müennes)');
  if (m[3]) parts.push({ S: 'tekil', D: 'ikil (tesniye)', P: 'çoğul' }[m[3]]);
  return parts.join(' ');
}
const SP_TR = { 'kaAn': 'kâne ve kardeşleri', 'kaAd': 'kâde ve kardeşleri', '<in~': 'inne ve kardeşleri' };

function describeStem(features) {
  const f = features;
  const out = [];
  const pos = (f.find((x) => x.startsWith('POS:')) || '').slice(4);
  const isVerb = pos === 'V';
  if (isVerb) {
    if (f.includes('PERF')) out.push('mâzi (geçmiş zaman)');
    if (f.includes('IMPF')) out.push('muzâri (geniş/şimdiki zaman)');
    if (f.includes('IMPV')) out.push('emir');
  }
  const form = f.find((x) => /^\((I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\)$/.test(x));
  if (form) { const r = form.slice(1, -1); out.push(`${FORMS[r]}. kalıp (${BAB[r]})`); }
  else if (isVerb) out.push(`I. kalıp (${BAB.I})`);
  if (f.includes('PASS') && !f.includes('PCPL')) out.push('edilgen (meçhul)');
  if (f.includes('PCPL')) out.push(f.includes('PASS') ? 'ism-i mef\'ûl (edilgen sıfat-fiil)' : 'ism-i fâil (etken sıfat-fiil)');
  if (f.includes('VN')) out.push('masdar (fiil kökünden isim)');
  for (const x of f) { const p = pgn(x); if (p) out.push(p); }
  if (f.includes('INDEF')) out.push('nekre (belirsiz)');
  if (f.includes('NOM')) out.push('merfû (ötre hali)');
  if (f.includes('ACC')) out.push(isVerb ? '' : 'mansûb (üstün hali)');
  if (f.includes('GEN')) out.push('mecrûr (esre hali)');
  const mood = f.find((x) => x.startsWith('MOOD:'));
  if (mood) out.push(mood === 'MOOD:SUBJ' ? 'mansûb (nasb edilmiş)' : mood === 'MOOD:JUS' ? 'meczûm (cezm edilmiş)' : '');
  const sp = f.find((x) => x.startsWith('SP:'));
  if (sp) out.push(SP_TR[sp.slice(3)] || '');
  return out.filter(Boolean);
}

// words[verseIndex] = [{ ar, translit, en, root, lemma, pos, segments:[{ar, tag, label, details[]}] }]
const WORDS = Array.from({ length: TOTAL }, () => []);
const ROOTS = new Map(); // rootBw -> [{ i: verseIndex, w: wordPos }]
const LEMMAS = new Map(); // lemmaBw -> count

(function loadMorphology() {
  const lines = fs.readFileSync(path.join(DATA, 'quranic-corpus-morphology-0.4.txt'), 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\((\d+):(\d+):(\d+):(\d+)\)\t([^\t]*)\t([^\t]*)\t([^\t\r]*)/);
    if (!m) continue;
    const vi = verseIndex(+m[1], +m[2]);
    const wpos = +m[3];
    const form = m[5], tag = m[6];
    const feats = m[7].split('|');
    const list = WORDS[vi];
    let w = list[wpos - 1];
    if (!w) w = list[wpos - 1] = { pos: wpos, bw: '', root: null, lemma: null, tag: null, segments: [] };
    w.bw += form;
    const seg = { ar: bw2ar(form), tag, kind: feats[0], label: '', details: [] };
    if (feats[0] === 'PREFIX') {
      const key = feats[1];
      const pr = PREFIX_TR[key];
      seg.label = pr ? pr[1] : (POS_TR[tag] || tag);
    } else if (feats[0] === 'SUFFIX') {
      const pron = feats.find((x) => x.startsWith('PRON:'));
      if (pron) { seg.label = 'Bitişik zamir'; const p = pgn(pron.slice(5)); if (p) seg.details.push(p); }
      else if (feats.includes('+VOC')) seg.label = 'Nida eki';
      else if (feats.includes('+n:EMPH')) seg.label = 'Tekit nunu';
      else seg.label = POS_TR[tag] || tag;
    } else {
      seg.label = POS_TR[tag] || tag;
      seg.details = describeStem(feats);
      const lem = feats.find((x) => x.startsWith('LEM:'));
      const root = feats.find((x) => x.startsWith('ROOT:'));
      if (lem) { w.lemma = lem.slice(4); LEMMAS.set(w.lemma, (LEMMAS.get(w.lemma) || 0) + 1); }
      if (root) {
        w.root = root.slice(5);
        if (!ROOTS.has(w.root)) ROOTS.set(w.root, []);
        ROOTS.get(w.root).push({ i: vi, w: wpos });
      }
      w.tag = tag;
    }
    w.segments.push(seg);
  }
})();

const WBW = JSON.parse(fs.readFileSync(path.join(DATA, 'wbw.json'), 'utf8'));

function rootAr(bw) { return bw ? bw2ar(bw).split('').join(' ') : null; }

function verseWords(vi) {
  const v = VERSES[vi];
  const extra = WBW[v.surah + ':' + v.ayah] || [];
  return WORDS[vi].map((w, k) => ({
    pos: w.pos,
    arabic: bw2ar(w.bw),
    transliteration: extra[k] || '',
    root: w.root,
    rootArabic: rootAr(w.root),
    rootCount: w.root ? ROOTS.get(w.root).length : 0,
    lemma: w.lemma ? bw2ar(w.lemma) : null,
    lemmaCount: w.lemma ? LEMMAS.get(w.lemma) : 0,
    tag: w.tag,
    label: w.tag ? (POS_TR[w.tag] || w.tag) : '',
    segments: w.segments.map((s) => ({ arabic: s.ar, label: s.label, details: s.details, kind: s.kind })),
  }));
}

function rootInfo(rootBw, tr) {
  const occ = ROOTS.get(rootBw);
  if (!occ) return null;
  const lemmas = new Map();
  const verses = new Map();
  for (const o of occ) {
    const w = WORDS[o.i][o.w - 1];
    const key = w.lemma || '';
    if (!lemmas.has(key)) lemmas.set(key, { lemma: bw2ar(key), count: 0 });
    const L = lemmas.get(key);
    L.count++;
    if (L.transliteration === undefined) {
      L.transliteration = (WBW[VERSES[o.i].surah + ':' + VERSES[o.i].ayah] || [])[o.w - 1] || '';
    }
    if (!verses.has(o.i)) verses.set(o.i, []);
    verses.get(o.i).push(o.w);
  }
  return {
    root: rootBw,
    rootArabic: rootAr(rootBw),
    count: occ.length,
    verseCount: verses.size,
    lemmas: [...lemmas.values()].sort((a, b) => b.count - a.count),
    verses: [...verses.entries()].map(([i, ws]) => ({ ...publicVerse(VERSES[i], tr), words: ws, wordForms: ws.map((p) => bw2ar(WORDS[i][p - 1].bw)) })),
  };
}

function searchRoots(qs) {
  const s = normAr(qs).replace(/\s+/g, '');
  const out = [];
  for (const [bw, occ] of ROOTS) {
    if (!s || normAr(bw2ar(bw)) === s || bw === qs) out.push({ root: bw, rootArabic: rootAr(bw), count: occ.length });
  }
  return out.sort((a, b) => b.count - a.count);
}

module.exports = {
  SURAHS, VERSES, TOTAL, TRANSLATIONS, DEFAULT_TR, TR_TEXT,
  verseIndex, publicVerse, trId, trNorm, normTr, normAr, verseWords, rootInfo, searchRoots, ROOTS,
};
