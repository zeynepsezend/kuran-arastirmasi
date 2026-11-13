# Kuran Araştırması'nı yayına alma rehberi

Sonuçta herkesle paylaşabileceğiniz bir adres olacak, örneğin:
**https://kuranarastirmasi.duckdns.org**

Gerekenler:
1. **Sunucu** — uygulamanın 7/24 çalıştığı bilgisayar
2. **Adres (alan adı)** — ücretsiz bir alt alan adı yeterli
3. **Kalıcı disk** — veritabanı (`kuran.db`) burada durur

> **Neden "ücretsiz barındırma" servislerinin çoğu olmaz?** Render'ın ücretsiz planında kalıcı disk yoktur
> (her yeniden başlatmada tüm üyeler ve çıkarımlar silinir) ve site 15 dakika boşta kalınca uyur.
> Railway ve Fly.io'nun yeni kullanıcılar için kalıcı ücretsiz planı yoktur.
> Kalıcı ve ücretsiz kalan pratik yol, aşağıdaki **Oracle Cloud "Always Free"** sunucusudur.
> (Ücretsiz planlar sık değişir; başlamadan önce sağlayıcının güncel sayfasına bakın.)

---

## Önerilen yol: Oracle Cloud Always Free + DuckDNS (0 ₺)

### 1. Oracle Cloud hesabı
1. **cloud.oracle.com** → *Sign up*. Kimlik doğrulaması için kredi kartı istenir; Always Free kaynaklar için ücret alınmaz.
2. **Ev bölgesi (home region)** seçimi kalıcıdır; size yakın bir Avrupa bölgesi seçin (ör. Frankfurt, Amsterdam).
3. Önerilir: hesabı **Pay As You Go**'ya yükseltin. Always Free kaynaklar yine ücretsiz kalır,
   ama Oracle'ın uzun süre az kullanılan ücretsiz sunucuları geri alma riskini azaltır.
   Bütçe uyarısı (*Budgets*) kurarak beklenmedik ücretlere karşı önlem alın.

### 2. Sunucuyu oluşturun
1. *Compute → Instances → Create instance*
2. **Image:** Ubuntu 24.04 · **Shape:** *Ampere (VM.Standard.A1.Flex)*, 1 OCPU, 6 GB RAM yeterli
   (bölgede yer yoksa ücretsiz *VM.Standard.E2.1.Micro* da çalışır).
3. *Add SSH keys* → anahtar çiftini indirin (bu dosya sunucuya girme anahtarınızdır, saklayın).
4. Oluşunca **Public IP** adresini not edin.
5. **Portları açın:** *Instance → Subnet → Security List → Add Ingress Rules*:
   kaynak `0.0.0.0/0`, TCP port **80** ve **443**.

### 3. Ücretsiz adres (DuckDNS)
1. **duckdns.org** → Google/GitHub ile giriş.
2. Bir ad yazın (ör. `kuranarastirmasi`) → *add domain* → *current ip* kutusuna sunucunun Public IP'sini yazıp *update ip*.
3. Adresiniz: `kuranarastirmasi.duckdns.org`

> Daha sonra kendi alan adınızı (ör. `.com` veya `.com.tr`) alırsanız, alan adının DNS'inde bir **A kaydı** ile
> aynı IP'yi gösterip aşağıdaki `Caddyfile`'daki adresi değiştirmeniz yeterli.

### 4. Kurulum (sunucuda)
Bilgisayarınızın terminalinden sunucuya bağlanın:
```bash
ssh -i indirdiginiz-anahtar.key ubuntu@SUNUCU_IP
```
Sunucuda sırasıyla:
```bash
# Docker kurulumu
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker

# Ubuntu'nun kendi güvenlik duvarında 80 ve 443'ü açın
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
```
Proje dosyasını bilgisayarınızdan sunucuya kopyalayın (bilgisayarınızın terminalinde):
```bash
scp -i indirdiginiz-anahtar.key kuran-platform.zip ubuntu@SUNUCU_IP:~
```
Sonra sunucuda:
```bash
sudo apt-get install -y unzip && unzip kuran-platform.zip && cd kuran-platform
nano Caddyfile        # "ornek-alanadi.com" yerine kuranarastirmasi.duckdns.org yazın, kaydedin
cp .env.example .env
nano .env             # APP_URL ve e-posta ayarlarını doldurun (aşağıda "E-posta" bölümü)
docker compose up -d --build
```
Birkaç dakika sonra **https://kuranarastirmasi.duckdns.org** açılır. HTTPS sertifikası otomatik alınır.

### 5. İlk kullanım
Siteye girip ilk hesabı kendiniz açın ve grubu oluşturun; grubu kuran kişi yönetici olur.
Davet kodunu Profil → Kodu Paylaş'tan diğer kişilere gönderin.

---

## E-posta (şifremi unuttum için)

"Şifremi unuttum" bağlantısının gidebilmesi için bir e-posta hesabı tanımlanmalıdır. `.env` dosyasında:

**Gmail ile (en kolayı, küçük gruplar için yeterli):**
1. Gmail hesabında **2 adımlı doğrulamayı** açın.
2. Google Hesabı → Güvenlik → **Uygulama şifreleri** → yeni şifre oluşturun (16 haneli).
3. `.env`:
   ```
   APP_URL=https://kuranarastirmasi.duckdns.org
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=adresiniz@gmail.com
   SMTP_PASS=16-haneli-uygulama-sifresi
   MAIL_FROM=Kuran Araştırması <adresiniz@gmail.com>
   ```
4. `docker compose up -d` ile yeniden başlatın.

Üye sayısı büyürse Brevo, Mailgun gibi bir e-posta gönderim servisinin SMTP bilgilerini aynı şekilde girebilirsiniz.
E-posta ayarlanmazsa site çalışır, ama sıfırlama e-postaları gitmez (yalnızca sunucu kaydına yazılır:
`docker compose logs app`).

---

## Yedekleme
Her gece 03:00'te yedek (sunucuda `crontab -e`):
```
0 3 * * * cd ~/kuran-platform && docker compose exec -T app node tools/backup.js /data/backups
```
Son 14 gün saklanır. Ara sıra bir yedeği bilgisayarınıza da indirin:
```bash
docker compose cp app:/data/backups ./yedekler
```

## Güncelleme
Yeni zip'i sunucuya kopyalayıp açın (`.env` ve `Caddyfile`'ınızı koruyun), sonra:
```bash
docker compose up -d --build
```
Veriler ayrı bir diskte (Docker volume) durduğu için korunur.

---

## Ücretli ama kolay alternatifler
Sunucu yönetmek istemezseniz: Railway (kalıcı "Volume" ile), Render (diskli ücretli plan) veya
Hetzner gibi küçük bir VPS. Hepsi aylık birkaç dolar/euro düzeyindedir; güncel fiyatlara bakın.
Railway/Render'da: GitHub'a yükleyin → servisi `Dockerfile` ile oluşturun → `/data`'ya disk bağlayın →
`NODE_ENV=production`, `DB_FILE=/data/kuran.db`, `APP_URL` ve SMTP değişkenlerini girin.

---

## Telefon uygulaması
Platform telefona yüklenebilir (PWA), mağaza gerekmez:
- **Android (Chrome):** siteyi açın → menü (⋮) → **Uygulamayı yükle**
- **iPhone (Safari):** **Paylaş** → **Ana Ekrana Ekle**

Bu yalnızca **https://** ile açılan yayındaki adreste çalışır.
İleride App Store / Google Play için Capacitor veya PWABuilder ile paketlenebilir (mağaza ücretleri ve kuralları için güncel sayfalarına bakın).

---

## Herkese açmadan önce kontrol listesi
- [ ] Site **https://** ile açılıyor
- [ ] Kayıt → yeniden başlatma (`docker compose restart`) → kayıt hâlâ duruyor
- [ ] "Şifremi unuttum" e-postası geliyor (spam klasörüne de bakın)
- [ ] **Aydınlatma metnindeki köşeli parantezleri doldurun:** veri sorumlusu, adres, iletişim e-postası,
      sunucu sağlayıcısı (ör. Oracle, Almanya) ve e-posta servisi (ör. Google). Metin `public/app.js` içinde,
      `viewPrivacy` bölümünde. Sunucu yurt dışındaysa KVKK m. 9 (yurt dışına aktarım) için bir hukukçuya danışın.
- [ ] Gece yedeği çalışıyor
- [ ] Platform **ücretsiz** kalmalı: Tanzil mealleri ticari olmayan kullanım içindir (ücretli üyelik, reklam yok)

## Sorun giderme
- **Site açılmıyor:** `docker compose logs caddy` ve `docker compose logs app`; Oracle'da 80/443 portları
  hem Security List'te hem sunucudaki `iptables`'ta açık mı?
- **`https://ADRES/healthz`** `{"ok":true}` dönmeli.
- **Sunucunun IP'si değişti:** DuckDNS'te IP'yi güncelleyin.
- **Kelime anlamları gelmiyor:** sunucunun `acikkuran.com`'a erişimi yoktur; uygulama yine çalışır.
- **"Çok fazla deneme":** aynı yerden 15 dakikada 20'den fazla giriş denemesi engellenir; bekleyin.
