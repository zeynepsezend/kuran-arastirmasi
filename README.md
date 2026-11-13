# Kuran Araştırması

Gruplar halinde Kur'an okuma ve araştırma platformu.

## Özellikler

- **Üyelik:** E-posta + şifre ile kayıt/giriş, şifre değiştirme, hesap silme.
- **Gruplar:** Grup oluşturma, 6 haneli **kodla gruba katılma**, birden fazla gruba üyelik ve profil sayfasından gruplar arası geçiş.
  Her grubun günlük ayetleri, etiketleri, çıkarımları, kök açıklamaları ve görevleri ayrıdır. Üyelere "Alt Grup / Görev" verilebilir; yönetici üye çıkarabilir, kod yenileyebilir.
- **Bugün — Sabah / Akşam Ayetleri:** Yönetici sabah ve akşam kaç ayet okunacağını ayarlar; ayetler her gün Kur'an sırasıyla otomatik ilerler.
  İstenirse belirli bir sure/ayetten yeniden başlatılır. Ayar değişikliği geçmiş günleri bozmaz. Önceki/sonraki gün gezinme ve paylaşma vardır.
- **Mealler:** 9 Türkçe meal (Diyanet İşleri, Diyanet Vakfı, Elmalılı Hamdi Yazır, Süleyman Ateş, Ali Bulaç, Abdülbaki Gölpınarlı, Yaşar Nuri Öztürk, Suat Yıldırım, Edip Yüksel).
  Her ekrandaki seçiciden anında değiştirilir; ayet sayfasında "Tüm Mealler" ile karşılaştırılır. Latin harfli okunuş açılıp kapatılabilir.
- **Kelimeler ve Kökler:** Her ayette kelime kelime Arapça çözümleme: **Türkçe kelime anlamı**, Türkçe okunuş, kök,
  **kökün Türkçe anlamı**, lemma ve Türkçe dilbilgisi açıklaması (fiil/isim, kalıp/bab, zaman, şahıs, i'rab hali, ön ve son ekler).
  Köke dokununca kökün anlamı, türeyen kelimeler ve Türkçe karşılıkları, Kur'an'daki tüm geçtiği yerler (vurgulu) ve grubun
  o köke yazdığı açıklamalar görünür. "Kökler" ekranından kök araması yapılır.
- **Tüm Mealler:** 9 yerleşik meale ek olarak Açık Kuran'daki ~25 Türkçe meal (Çantay, Muhammed Esed, Mehmet Okuyan,
  Mustafa İslamoğlu, Bayraktar Bayraklı, Erhan Aktaş, Süleymaniye Vakfı…) dipnotlarıyla birlikte karşılaştırılır.
- **Çıkarımlar:** Her ayete etiket seçip not yazma, düzenleme, silme. Etiket, kişi, sure ve metne göre filtreleme.
- **Etiketler:** Renkli etiket ekleme/düzenleme/silme (yeni gruplarda örnek etiketler hazır gelir; not yazarken de yeni etiket oluşturulabilir).
- **Sûreler / Kaldığım Yerden Devam Et / Ayet Arama** (meal veya Arapça metinde, ya da `2:255` gibi numarayla).
- **İstatistikler** ve **Çıkarım Düzenleme Görevleri** (kişiye, sure aralığına ve etikete göre görev atama).

## Kurulum

Node.js **22.13 veya üzeri** gerekir (yerleşik SQLite kullanılır, ayrıca veritabanı kurmanız gerekmez).

```bash
npm install
npm start
```

Ardından tarayıcıda `http://localhost:3000` adresini açın. Port için `PORT=8080 npm start`, veritabanı dosyası için `DB_FILE=/yol/kuran.db` kullanılabilir.
Veriler varsayılan olarak `data/kuran.db` dosyasında tutulur.

### Yayına alma

Herkesin kullanabilmesi için sunucuya kurulum, alan adı, telefona yükleme (PWA) ve yedekleme adımları
**[YAYINLAMA.md](YAYINLAMA.md)** dosyasında anlatılıyor.

### İnternet bağlantısı

Türkçe kelime anlamları, kök anlamları ve ek mealler [Açık Kuran](https://acikkuran.com)'dan alınır: bir ayet ilk kez
açıldığında sunucu o ayetin verisini Açık Kuran'dan çeker ve veritabanında saklar (90 günde bir yenilenir). Bu nedenle sunucunun
internete erişimi olmalıdır. Erişim yoksa uygulama çalışmaya devam eder; kelimelerde yalnızca dilbilgisi çözümlemesi gösterilir.

Başkalarının kullanabilmesi için bir sunucuya (ör. Render, Railway, bir VPS) kurmanız ve kalıcı disk ayırmanız yeterlidir.

## Veri kaynakları

- Arapça metin ve sure adları: [quran-json](https://github.com/risan/quran-json) (Tanzil Uthmani metni)
- Türkçe mealler ve okunuş: [Tanzil.net](https://tanzil.net/trans/) — ticari olmayan kullanım ve kaynak gösterme şartıyla
- Kelime çözümlemesi ve kökler: [Quranic Arabic Corpus](https://corpus.quran.com) 0.4 (GNU GPL; dosya değiştirilmeden `data/` içinde)
- Türkçe kelime anlamları, okunuşlar, kök anlamları ve ek mealler: [Açık Kuran](https://acikkuran.com) — her ekranda kaynak bağlantısı verilir
- Yedek kelime okunuşları (Açık Kuran'a ulaşılamadığında): `@kmaslesa/holy-quran-word-by-word-full-data`

`tools/build-data.js` bu verileri kaynak paketlerden yeniden üretmek için kullanılır; normal kullanımda gerekmez.
