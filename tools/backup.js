'use strict';
// Veritabanının tutarlı bir kopyasını alır (uygulama çalışırken de güvenlidir).
//
// Kullanım:
//   node tools/backup.js [yedek-klasörü]
//
// Varsayılan klasör: ./backups  — Son 14 yedek tutulur, daha eskileri silinir.
// Docker ile:
//   docker compose exec app node tools/backup.js /data/backups

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'kuran.db');
const dir = process.argv[2] || path.join(__dirname, '..', 'backups');
const KEEP = 14;

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const target = path.join(dir, `kuran-${stamp}.db`);

const db = new DatabaseSync(DB_FILE);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log('Yedek alındı:', target);

const old = fs.readdirSync(dir).filter((f) => /^kuran-.*\.db$/.test(f)).sort().reverse().slice(KEEP);
for (const f of old) fs.unlinkSync(path.join(dir, f));
if (old.length) console.log('Eski yedekler silindi:', old.length);
