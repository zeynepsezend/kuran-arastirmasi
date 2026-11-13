'use strict';
// Veri hazırlama betiği. Uygulama için gerekli dosyalar zaten data/ klasöründe
// hazır gelir; bu betik yalnızca verileri kaynaklarından yeniden üretmek içindir.
//
// Kullanım:
//   node tools/build-data.js <ghoran-translation paket klasörü> <holy-quran-word-by-word-full-data paket klasörü>
//
// Kaynaklar:
//   - npm: @ghoran/translation  (Tanzil Türkçe mealleri, json/tr/*.json)
//   - npm: @kmaslesa/holy-quran-word-by-word-full-data (yedek kelime okunuşları)
//   - Kur'an Arapça Korpusu morfolojisi: data/quranic-corpus-morphology-0.4.txt (değiştirilmeden kopyalanır)

const fs = require('fs');
const path = require('path');

const [ghoranDir, wbwDir] = process.argv.slice(2);
if (!ghoranDir || !wbwDir) {
  console.error('Kullanım: node tools/build-data.js <ghoran-translation> <word-by-word-full-data>');
  process.exit(1);
}
const out = path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(out, 'translations'), { recursive: true });

const IDS = ['diyanet', 'vakfi', 'yazir', 'ates', 'bulac', 'golpinarli', 'ozturk', 'yildirim', 'yuksel', 'transliteration'];
for (const id of IDS) {
  const arr = JSON.parse(fs.readFileSync(path.join(ghoranDir, 'json', 'tr', `tanzil-${id}.json`), 'utf8'));
  if (!Array.isArray(arr) || arr.length !== 6236) throw new Error(`${id}: beklenmeyen biçim`);
  fs.writeFileSync(path.join(out, 'translations', `${id}.json`), JSON.stringify(arr.map((s) => String(s).trim())));
  console.log('meal yazıldı:', id);
}

const pages = JSON.parse(fs.readFileSync(path.join(wbwDir, 'data.json'), 'utf8'));
const wbw = {};
for (const p of pages) {
  for (const a of p.ayahs) {
    for (const w of a.words) {
      if (w.char_type_name !== 'word') continue;
      const k = w.parentAyahVerseKey;
      (wbw[k] = wbw[k] || [])[w.position - 1] = (w.transliteration && w.transliteration.text) || '';
    }
  }
}
fs.writeFileSync(path.join(out, 'wbw.json'), JSON.stringify(wbw));
console.log('kelime verisi yazıldı:', Object.keys(wbw).length, 'ayet');
