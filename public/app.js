'use strict';
/* Kur'an Araştırması — tek sayfalık istemci */

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
const $app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<span class="icon ${cls}" aria-hidden="true">${name}</span>`;
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const PERIOD = { sabah: 'Sabah', aksam: 'Akşam' };

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const today = () => localDate();
function addDays(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return localDate(d); }
function trDate(ds) { if (!ds) return ''; const [y, m, d] = ds.split('-').map(Number); return `${d} ${AYLAR[m - 1]} ${y}`; }
function trDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yok say */ } }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* boş */ }
  if (res.status === 401 && !url.startsWith('/auth/')) {
    state.me = null;
    go('#/giris');
    throw new Error('Oturum açmanız gerekiyor.');
  }
  if (!res.ok) throw new Error((data && data.error) || 'Bir hata oluştu.');
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b || {});
const PATCH = (u, b) => api('PATCH', u, b || {});
const PUT = (u, b) => api('PUT', u, b || {});
const DEL = (u, b) => api('DELETE', u, b);

// Modal pencere: alanlar verilirse form olarak çalışır.
function modal({ title, html = '', fields = [], ok = 'Kaydet', cancel = 'Vazgeç', danger = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const fieldHtml = fields.map((f, i) => {
      const id = 'mf' + i;
      if (f.type === 'select') {
        return `<div class="field"><label for="${id}">${esc(f.label)}</label><select class="select" id="${id}">${
          f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'textarea') return `<div class="field"><label for="${id}">${esc(f.label)}</label><textarea class="textarea" id="${id}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></div>`;
      return `<div class="field"><label for="${id}">${esc(f.label)}</label><input class="input" id="${id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.attrs || ''}></div>`;
    }).join('');
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${html}${fieldHtml}
      <div class="err" id="m-err"></div>
      <div class="actions">${cancel ? `<button class="btn text" data-x>${esc(cancel)}</button>` : ''}<button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button></div></div>`;
    document.body.appendChild(back);
    const close = (v) => { back.remove(); resolve(v); };
    const first = back.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    const x = back.querySelector('[data-x]');
    if (x) x.onclick = () => close(null);
    const submit = () => {
      const vals = fields.map((f, i) => back.querySelector('#mf' + i).value);
      close(fields.length ? vals : true);
    };
    back.querySelector('[data-ok]').onclick = submit;
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit();
    });
  });
}
// Açık Kuran metinlerindeki <br>, <strong> gibi basit biçimleri güvenli şekilde gösterir.
function richText(s) {
  return esc(s)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&lt;(\/?)(strong|b|em|i)&gt;/gi, '<$1$2>');
}
const AK_LINK = (url, text = 'Açık Kuran') => `<a href="${esc(url)}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(text)}</a>`;

const confirmBox = (title, html, ok = 'Evet', danger = true) => modal({ title, html, ok, danger });

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------
const state = {
  me: null,          // { user, groups, activeGroupId, translations }
  group: null,       // aktif grup detayları
  surahs: null,
  tags: null,
};
const gid = () => state.me && state.me.activeGroupId;
const G = (p = '') => `/g/${gid()}${p}`;
const tr = () => (state.me && state.me.user.translation) || 'diyanet';
const showTl = () => !!(state.me && state.me.user.showTransliteration);
const trName = (id) => ((state.me && state.me.translations) || []).find((t) => t.id === id)?.name || id;
const isAdmin = () => !!(state.group && state.group.isAdmin);
const authorLabel = (n) => (n.mine ? 'Sen' : n.author || 'Grup üyesi');
const adminOnly = (title) => `<div class="page">${topbar({ title })}<div class="empty">Bu bölüm yalnızca grup yöneticisine açıktır.</div></div>`;
const prefArabicDaily = () => lsGet('arabicDaily', false);

async function loadMe() {
  state.me = await GET('/me');
  state.group = null;
  state.tags = null;
  return state.me;
}
async function loadGroup(force) {
  if (!gid()) return null;
  if (!state.group || force || state.group.id !== gid()) state.group = await GET(G(qs({ today: today() })));
  return state.group;
}
async function loadTags(force) {
  if (!state.tags || force) state.tags = await GET(G('/tags'));
  return state.tags;
}
async function loadSurahs() {
  if (!state.surahs) state.surahs = await GET('/quran/surahs');
  return state.surahs;
}
async function setTranslation(id) {
  state.me.user.translation = id;
  await PATCH('/me', { translation: id });
}

// ---------------------------------------------------------------------------
// Ortak parçalar
// ---------------------------------------------------------------------------
function topbar({ title = '', back = '#/', center = false, sub = '', right = '' }) {
  const backBtn = back ? `<button class="icon-btn" data-back="${esc(back)}" aria-label="Geri">${icon(back === 'close' ? 'close' : 'arrow_back')}</button>` : '';
  const t = center
    ? `<div class="center"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`
    : `<h1>${esc(title)}</h1>`;
  return `<div class="topbar">${backBtn}${t}<div class="right">${right}</div></div>`;
}
function bindCommon(root = $app) {
  root.querySelectorAll('[data-back]').forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.back;
      if (history.length > 1 && t !== '#/') history.back();
      else go(t === 'close' ? '#/' : t);
    };
  });
  root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); go(b.dataset.go); }; });
}
function mealPicker(id = 'meal') {
  const list = (state.me && state.me.translations) || [];
  return `<label class="meal-pick">${icon('translate', 'sm')}<select id="${id}" class="select" aria-label="Meal seçimi">${
    list.map((t) => `<option value="${t.id}" ${t.id === tr() ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`;
}
function bindMealPicker(onChange, id = 'meal') {
  const s = document.getElementById(id);
  if (s) s.onchange = async () => { await setTranslation(s.value); toast(`Meal: ${trName(s.value)}`); onChange(); };
}
function tagChip(n) {
  if (!n.tagName) return '';
  return `<span class="tag-chip" style="color:${esc(n.tagColor || '#3d6b45')}">${esc(n.tagName)}</span>`;
}
function noteHtml(n, { showVerse = false } = {}) {
  return `<div class="note" data-note="${n.id}">
    ${tagChip(n)}
    ${showVerse ? `<div class="verse-ref"><a href="#/ayet/${n.surah}/${n.ayah}"><b>${esc(n.surahName)} ${n.surah}:${n.ayah}</b> — ${esc(n.verseText)}</a></div>` : ''}
    <div class="body">${esc(n.body)}</div>
    <div class="foot"><span>${esc(authorLabel(n))}</span>
      <span class="acts">${n.canEdit ? `<button class="icon-btn" data-edit-note="${n.id}" aria-label="Düzenle">${icon('edit', 'sm o')}</button>
        <button class="icon-btn" data-del-note="${n.id}" aria-label="Sil">${icon('delete', 'sm o')}</button>` : ''}
        <span style="margin-left:6px">${trDateTime(n.createdAt)}${n.updatedAt ? ' (düzenlendi)' : ''}</span></span></div>
  </div>`;
}
function bindNotes(root, reload) {
  root.querySelectorAll('[data-edit-note]').forEach((b) => { b.onclick = () => go(`#/cikarim-duzenle/${b.dataset.editNote}`); });
  root.querySelectorAll('[data-del-note]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmBox('Çıkarımı sil', '<p>Bu çıkarım kalıcı olarak silinecek.</p>', 'Sil'))) return;
      try { await DEL(G(`/notes/${b.dataset.delNote}`)); toast('Çıkarım silindi'); reload(); } catch (e) { toast(e.message); }
    };
  });
}
const ayahNum = (n) => `<span class="ayah-num" aria-hidden="true"><span>${n}</span></span>`;
function verseRow(v, { href, showArabic = true, extra = '', hl = false } = {}) {
  return `<a class="verse-row ${hl ? 'hl' : ''}" href="${href}" id="v${v.ayah}">
    ${ayahNum(v.ayah)}
    <div class="vr-body">
      ${showArabic ? `<div class="ar">${esc(v.arabic)}</div>` : ''}
      <div class="tr">${esc(v.text)}</div>
      ${showTl() ? `<div class="tl">${esc(v.transliteration)}</div>` : ''}
      <div class="ref"><span>${esc(v.surahName)} ${v.surah}:${v.ayah}</span>${extra}</div>
    </div>
  </a>`;
}
function loading() { $app.innerHTML = '<div class="page"><div class="loading">Yükleniyor…</div></div>'; }

// ---------------------------------------------------------------------------
// Yönlendirme
// ---------------------------------------------------------------------------
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [p, query] = h.split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query || '') };
}

const ROUTES = {
  '': viewHome,
  giris: viewAuth,
  kayit: viewAuth,
  'sifremi-unuttum': viewForgot,
  'sifre-sifirla': viewReset,
  gizlilik: viewPrivacy,
  gunluk: viewDaily,
  ayet: viewVerse,
  'cikarim-ekle': viewNoteForm,
  'cikarim-duzenle': viewNoteForm,
  sureler: viewSurahs,
  sure: viewSurah,
  devam: viewContinue,
  cikarimlar: viewNotes,
  arama: viewSearch,
  kok: viewRoot,
  etiketler: viewTags,
  istatistikler: viewStats,
  gorevler: viewTasks,
  profil: viewProfile,
  uyeler: viewMembers,
  gruplar: viewGroups,
  ayarlar: viewSettings,
};

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const { parts, query } = parseHash();
  const name = parts[0] || '';
  const isAuth = ['giris', 'kayit', 'sifremi-unuttum', 'sifre-sifirla'].includes(name);
  const isPublic = name === 'gizlilik';
  try {
    if (!state.me && !isAuth) {
      try { await loadMe(); } catch { if (!isPublic) return go('#/giris'); }
    }
    if (state.me && isAuth && name !== 'sifre-sifirla') return go('#/');
    if (state.me && state.me.user.consentRequired && !isPublic) {
      loading(); await viewConsent(); bindCommon(); return;
    }
    if (state.me && !gid() && !isAuth && !isPublic && !['gruplar', 'profil', 'ayarlar'].includes(name)) return go('#/gruplar');
    const view = ROUTES[name] || viewHome;
    loading();
    await view(parts.slice(1), query, () => seq !== renderSeq);
    bindCommon();
    if (!query.get('a')) window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    $app.innerHTML = `<div class="page">${topbar({ title: 'Hata' })}<div class="empty">${esc(e.message)}</div></div>`;
    bindCommon();
  }
}
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------------------
// Giriş / Kayıt
// ---------------------------------------------------------------------------
async function viewAuth(_, __) {
  const isReg = parseHash().parts[0] === 'kayit';
  $app.innerHTML = `<div class="auth-wrap"><div class="auth">
    <div class="brand"><div class="auth-emblem">${icon('menu_book')}</div><div class="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div><h1>Kuran Araştırması</h1>
      <div class="muted">${isReg ? 'Yeni hesap oluşturun' : 'Hesabınıza giriş yapın'}</div></div>
    <form id="f">
      ${isReg ? '<div class="field"><label for="n">Ad Soyad</label><input class="input" id="n" autocomplete="name" required></div>' : ''}
      <div class="field"><label for="e">E-posta</label><input class="input" id="e" type="email" autocomplete="email" required></div>
      <div class="field"><label for="p">Şifre</label><input class="input" id="p" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" required minlength="6"></div>
      ${isReg ? `<label class="consent"><input type="checkbox" id="c" class="check">
        <span><a href="#/gizlilik" target="_blank" rel="noopener">Aydınlatma metnini</a> okudum; kişisel verilerimin bu metinde anlatılan şekilde işlenmesini kabul ediyorum.</span></label>`
        : '<div style="text-align:right;margin-top:-6px"><a class="small-link" href="#/sifremi-unuttum">Şifremi unuttum</a></div>'}
      <div class="err" id="err"></div>
      <div class="actions"><button class="btn" type="submit">${isReg ? 'Kayıt Ol' : 'Giriş Yap'}</button></div>
    </form>
    <div class="switch">${isReg ? 'Hesabınız var mı? <a href="#/giris">Giriş yapın</a>' : 'Hesabınız yok mu? <a href="#/kayit">Kayıt olun</a>'}</div>
    <div class="switch" style="margin-top:6px"><a class="small-link" href="#/gizlilik">Aydınlatma metni ve gizlilik</a></div>
  </div></div>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const body = { email: document.getElementById('e').value, password: document.getElementById('p').value };
    if (isReg) {
      body.name = document.getElementById('n').value;
      body.consent = document.getElementById('c').checked;
      if (!body.consent) { document.getElementById('err').textContent = 'Devam etmek için aydınlatma metnini onaylayın.'; return; }
    }
    try {
      await POST(isReg ? '/auth/register' : '/auth/login', body);
      await loadMe();
      go(gid() ? '#/' : '#/gruplar');
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

function authShell(title, sub, inner) {
  return `<div class="auth-wrap"><div class="auth">
    <div class="brand"><div class="auth-emblem">${icon('lock_reset')}</div><h1 style="margin-top:8px">${esc(title)}</h1>
      <div class="muted">${sub}</div></div>${inner}
    <div class="switch"><a href="#/giris">Girişe dön</a></div></div></div>`;
}
async function viewForgot() {
  $app.innerHTML = authShell('Şifremi unuttum', 'Hesabınızın e-posta adresini yazın; şifre sıfırlama bağlantısı gönderelim.',
    `<form id="f"><div class="field"><label for="e">E-posta</label><input class="input" id="e" type="email" autocomplete="email" required></div>
      <div class="err" id="err"></div><div class="actions"><button class="btn" type="submit">Bağlantı gönder</button></div></form>`);
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await POST('/auth/forgot', { email: document.getElementById('e').value });
      document.getElementById('f').outerHTML = `<div class="panel" style="text-align:center">${icon('mark_email_read')}
        <p>Bu adrese kayıtlı bir hesap varsa birkaç dakika içinde bir e-posta gelecek. Bağlantı <b>1 saat</b> geçerlidir.</p>
        <p class="muted">E-posta gelmezse istenmeyen (spam) klasörüne de bakın.</p></div>`;
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}
async function viewReset(_, query) {
  const token = query.get('t') || '';
  $app.innerHTML = authShell('Yeni şifre', 'Hesabınız için yeni bir şifre belirleyin.',
    `<form id="f">
      <div class="field"><label for="p1">Yeni şifre (en az 6 karakter)</label><input class="input" id="p1" type="password" autocomplete="new-password" required minlength="6"></div>
      <div class="field"><label for="p2">Yeni şifre (tekrar)</label><input class="input" id="p2" type="password" autocomplete="new-password" required minlength="6"></div>
      <div class="err" id="err"></div><div class="actions"><button class="btn" type="submit">Şifreyi kaydet</button></div></form>`);
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = document.getElementById('p1').value, p2 = document.getElementById('p2').value;
    if (p1 !== p2) { document.getElementById('err').textContent = 'Şifreler aynı değil.'; return; }
    try {
      await POST('/auth/reset', { token, password: p1 });
      state.me = null; await loadMe();
      toast('Şifreniz değiştirildi'); go(gid() ? '#/' : '#/gruplar');
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}
async function viewConsent() {
  $app.innerHTML = `<div class="auth-wrap"><div class="auth" style="max-width:520px">
    <div class="brand"><div class="auth-emblem">${icon('verified_user')}</div><h1 style="margin-top:8px">Aydınlatma metni</h1>
      <div class="muted">Devam etmeden önce kişisel verilerinizin nasıl işlendiğini anlatan metni okuyup onaylamanız gerekiyor.</div></div>
    <p style="text-align:center;margin:16px 0"><a class="btn outline" href="#/gizlilik" target="_blank" rel="noopener">${icon('description', 'sm')} Metni oku</a></p>
    <label class="consent"><input type="checkbox" id="c" class="check"><span>Aydınlatma metnini okudum; kişisel verilerimin bu metinde anlatılan şekilde işlenmesini kabul ediyorum.</span></label>
    <div class="err" id="err"></div>
    <div class="actions" style="justify-content:space-between"><button class="btn text" id="out">Çıkış yap</button><button class="btn" id="ok">Onayla ve devam et</button></div>
  </div></div>`;
  document.getElementById('ok').onclick = async () => {
    if (!document.getElementById('c').checked) { document.getElementById('err').textContent = 'Devam etmek için onay kutusunu işaretleyin.'; return; }
    await POST('/me/consent', { consent: true }); state.me.user.consentRequired = false; render();
  };
  document.getElementById('out').onclick = async () => { await POST('/auth/logout'); state.me = null; go('#/giris'); };
}
async function viewPrivacy() {
  $app.innerHTML = `<div class="page">${topbar({ title: 'Aydınlatma Metni', back: state.me ? '#/profil' : '#/giris' })}
  <article class="legal">
    <p class="muted">Sürüm: Kasım 2026 · Bu metin 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) 10. maddesi uyarınca hazırlanmıştır.</p>

    <h2>1. Veri sorumlusu</h2>
    <p>[Veri sorumlusunun adı / kurum adı], [adres]. İletişim: [e-posta adresi].</p>

    <h2>2. Hangi verileri işliyoruz?</h2>
    <ul>
      <li><b>Hesap bilgileri:</b> ad soyad, e-posta adresi, şifreniz (geri çevrilemez biçimde şifrelenerek; şifrenizin kendisini kimse göremez).</li>
      <li><b>Grup bilgileri:</b> üye olduğunuz gruplar, rolünüz ve yöneticinin verdiği alt grup/görev bilgisi.</li>
      <li><b>Yazdıklarınız:</b> ayetlere yazdığınız çıkarımlar, kök açıklamaları ve bunların tarihleri.</li>
      <li><b>Kullanım bilgileri:</b> seçtiğiniz meal, kaldığınız ayet, size atanan görevlerin durumu.</li>
      <li><b>Teknik bilgiler:</b> oturumunuzu açık tutan zorunlu çerez; güvenlik için giriş denemelerinde IP adresiniz (yalnızca 15 dakika, bellekte, kaydedilmeden).</li>
    </ul>

    <h2>3. Neden işliyoruz? (amaç ve hukuki sebep)</h2>
    <ul>
      <li>Hesabınızı oluşturmak ve grup çalışmasını yürütmek — hizmetin sunulması (KVKK m. 5/2-c).</li>
      <li>Şifre sıfırlama e-postası göndermek — hizmetin sunulması (KVKK m. 5/2-c).</li>
      <li>Hesapları yetkisiz girişe karşı korumak — meşru menfaat (KVKK m. 5/2-f).</li>
    </ul>
    <p>Verileriniz reklam, pazarlama veya profilleme için kullanılmaz ve kimseye satılmaz.</p>

    <h2>4. Kimler görebilir?</h2>
    <ul>
      <li><b>Grup yöneticisi:</b> adınızı, alt grubunuzu, çıkarımlarınızın sizin tarafınızdan yazıldığını ve size atanan görevleri görür.</li>
      <li><b>Diğer grup üyeleri:</b> çıkarımlarınızın metnini görür, ancak kimin yazdığını göremez.</li>
      <li><b>Hizmet sağlayıcılar:</b> platformun çalıştığı sunucu sağlayıcısı [sağlayıcı adı, ülkesi] ve e-posta gönderim servisi [sağlayıcı adı, ülkesi]. Sağlayıcı yurt dışındaysa aktarım KVKK m. 9 kapsamında yapılır.</li>
      <li><b>Google Fonts:</b> sayfadaki yazı tipleri Google sunucularından yüklenir; bu sırada IP adresiniz Google’a iletilir.</li>
      <li>Kelime anlamları <a href="https://acikkuran.com" target="_blank" rel="noopener">Açık Kuran</a>’dan alınır; bu sırada hiçbir kişisel veriniz gönderilmez.</li>
    </ul>

    <h2>5. Ne kadar saklıyoruz?</h2>
    <p>Verileriniz hesabınız açık olduğu sürece saklanır. Hesabınızı sildiğinizde hesap bilgileriniz, üyelikleriniz ve kişisel tercihleriniz silinir; gruplara yazdığınız çıkarımlar grubun ortak çalışmasının parçası olduğu için metin olarak kalır, ancak adınız “Silinmiş üye” olarak değiştirilir. Güvenlik yedekleri en fazla 14 gün saklanır.</p>

    <h2>6. Haklarınız (KVKK m. 11)</h2>
    <p>Verilerinizin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltilmesini veya silinmesini isteme, aktarıldığı kişileri öğrenme, itiraz etme ve zarara uğramanız hâlinde tazminat isteme haklarına sahipsiniz.</p>
    <ul>
      <li><b>Verilerimi indir:</b> Profil sayfasından hakkınızda tutulan tüm verileri bir dosya olarak indirebilirsiniz.</li>
      <li><b>Düzeltme:</b> Adınızı Profil sayfasından değiştirebilirsiniz.</li>
      <li><b>Silme:</b> Profil sayfasındaki “Hesabımı Sil” ile hesabınızı kalıcı olarak silebilirsiniz.</li>
      <li>Diğer talepleriniz için [e-posta adresi] adresine yazabilirsiniz; en geç 30 gün içinde yanıtlanır.</li>
    </ul>

    <h2>7. Çerezler</h2>
    <p>Yalnızca oturumunuzu açık tutmak için zorunlu bir çerez kullanılır. Reklam veya ziyaret ölçümü çerezi kullanılmaz.</p>

    <h2>8. Ücretsiz kullanım</h2>
    <p>Kuran Araştırması ücretsiz ve ticari olmayan bir platformdur. Mealler <a href="https://tanzil.net/trans/" target="_blank" rel="noopener">Tanzil.net</a>’in ticari olmayan kullanım şartıyla, dilbilgisi çözümlemesi <a href="https://corpus.quran.com" target="_blank" rel="noopener">Quranic Arabic Corpus</a> (GNU GPL) ile, kelime anlamları ve kökler <a href="https://acikkuran.com" target="_blank" rel="noopener">Açık Kuran</a>’dan kaynak gösterilerek kullanılmaktadır.</p>
  </article></div>`;
}

// ---------------------------------------------------------------------------
// Ana sayfa
// ---------------------------------------------------------------------------
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Hayırlı geceler' : h < 11 ? 'Hayırlı sabahlar' : h < 17 ? 'Hayırlı günler' : h < 21 ? 'Hayırlı akşamlar' : 'Hayırlı geceler';
}
async function viewHome() {
  const g = await loadGroup();
  const tile = (href, ic, text, sub = '', tone = '') => `<a class="tile" href="${href}"><span class="ti ${tone}">${icon(ic)}</span>
    <span class="grow"><span class="tt">${esc(text)}</span>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</span>${icon('chevron_right', 'chev')}</a>`;
  const s = g.schedule;
  const firstName = (state.me.user.name || '').split(' ')[0];
  $app.innerHTML = `<div class="page">
    <section class="hero">
      <div class="hero-top">
        <div><div class="hero-kicker">${esc(greeting())}${firstName ? `, ${esc(firstName)}` : ''}</div>
          <div class="hero-title">Kuran Araştırması</div></div>
        <a class="hero-group" href="#/profil" title="Profil ve gruplar">${icon('groups', 'sm')}<span>${esc(g.name)}</span>${icon('person', 'sm')}</a>
      </div>
      <div class="hero-besmele"><div class="ar">بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ</div>
        <div class="tr">Rahmân ve Rahîm olan Allah'ın adıyla.</div></div>
    </section>

    <div class="section-title"><h2>Bugün</h2><div class="meta"><span class="date-pill">${icon('calendar_today', 'sm o')} ${trDate(today())}</span>
      <a class="icon-btn" href="#/ayarlar" aria-label="Günlük ayet ayarları" title="Günlük ayet ayarları">${icon('tune', 'sm')}</a></div></div>
    <div class="today-grid">
      <a class="today-card morning" href="#/gunluk/sabah/${today()}">
        <span class="tc-icon">${icon('wb_sunny')}</span>
        <span class="tc-title">Sabah Ayetleri</span>
        <span class="tc-sub">${s.morning ? `${s.morning} ayet · ${esc(s.todayStart.surahName)} ${s.todayStart.surah}:${s.todayStart.ayah}'den` : 'Kapalı'}</span>
        <span class="tc-go">Oku ${icon('arrow_forward', 'sm')}</span>
      </a>
      <a class="today-card evening" href="#/gunluk/aksam/${today()}">
        <span class="tc-icon">${icon('dark_mode')}</span>
        <span class="tc-title">Akşam Ayetleri</span>
        <span class="tc-sub">${s.evening ? `${s.evening} ayet` : 'Kapalı'}</span>
        <span class="tc-go">Oku ${icon('arrow_forward', 'sm')}</span>
      </a>
    </div>

    <div class="section-title"><h2>Oku</h2></div>
    <div class="tile-grid two">
      ${tile('#/sureler', 'menu_book', 'Sûreler', '114 sure', 'green')}
      ${tile('#/devam', 'bookmark', 'Kaldığım Yerden Devam Et', 'Son okuduğun ayet', 'gold')}
    </div>

    <div class="section-title"><h2>Çalışmalar</h2></div>
    <div class="tile-grid">
      ${tile('#/cikarimlar', 'edit_note', 'Çıkarımlar', 'Ayetlere yazılan notlar', 'green')}
      ${tile('#/arama', 'search', 'Ayet Arama', 'Mealde veya Arapçada', 'blue')}
      ${tile('#/arama?mod=kok', 'account_tree', 'Kökler', 'Kelime kökleri ve anlamları', 'gold')}
      ${g.isAdmin ? '' : tile('#/gorevler', 'task_alt', 'Görevlerim', 'Bana verilen görevler', 'violet')}
    </div>
    ${g.isAdmin ? `<div class="section-title"><h2>Yönetim</h2><div class="meta">Yalnızca yöneticiler görür</div></div>
    <div class="tile-grid">
      ${tile('#/uyeler', 'groups', 'Üyeler', 'Katılımcılar, roller, davet kodu', 'blue')}
      ${tile('#/gorevler', 'task_alt', 'Görev Dağılımı', 'Çıkarım düzenleme görevleri', 'violet')}
      ${tile('#/etiketler', 'sell', 'Etiketler', 'Etiket ekle ve düzenle', 'rose')}
      ${tile('#/istatistikler', 'insights', 'İstatistikler', 'İlerleme ve katkılar', 'green')}
      ${tile('#/ayarlar', 'calendar_month', 'Okuma Planı', 'Sabah ve akşam ayet sayıları', 'gold')}
    </div>` : ''}
    <div class="footer-note"><span class="star">۞</span><br>Mealler: <a href="https://tanzil.net/trans/" target="_blank" rel="noopener">Tanzil.net</a> ·
      Kelime anlamları ve kökler: <a href="https://acikkuran.com" target="_blank" rel="noopener">Açık Kuran</a> ·
      Dilbilgisi çözümlemesi: <a href="https://corpus.quran.com" target="_blank" rel="noopener">Quranic Arabic Corpus</a><br>
      <a href="#/gizlilik">Aydınlatma metni ve gizlilik</a> · Ücretsiz ve ticari olmayan bir platformdur</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Günlük ayetler
// ---------------------------------------------------------------------------
async function viewDaily([period, date]) {
  period = period === 'aksam' ? 'aksam' : 'sabah';
  date = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today();
  const d = await GET(G(`/daily${qs({ date, period, tr: tr() })}`));
  const prev = period === 'aksam' ? `#/gunluk/sabah/${date}` : `#/gunluk/aksam/${addDays(date, -1)}`;
  const next = period === 'sabah' ? `#/gunluk/aksam/${date}` : `#/gunluk/sabah/${addDays(date, 1)}`;
  const showAr = prefArabicDaily();
  const refs = d.verses.map((v) => `${v.surah}:${v.ayah}`).join(',');
  $app.innerHTML = `<div class="page">
    ${topbar({ back: '#/', right: `
      <button class="icon-btn" id="share" aria-label="Paylaş" title="Paylaş">${icon('share')}</button>
      <a class="icon-btn" href="#/cikarimlar${qs({ refs, baslik: `${trDate(date)} ${PERIOD[period]}` })}" aria-label="Bu ayetlerin çıkarımları" title="Bu ayetlerin çıkarımları">${icon('rate_review', 'o')}</a>` })}
    <div class="day-nav">
      <a class="icon-btn" href="${prev}" aria-label="Önceki">${icon('skip_previous')}</a>
      <div class="mid"><div>${trDate(date)}</div><div class="p">${PERIOD[period]}</div></div>
      <a class="icon-btn" href="${next}" aria-label="Sonraki">${icon('skip_next')}</a>
    </div>
    <div class="daily-tools">${mealPicker()}
      <button class="chip ${showAr ? 'on' : ''}" id="tgl-ar">${icon('translate', 'sm')} Arapça</button>
      <button class="chip ${showTl() ? 'on' : ''}" id="tgl-tl">${icon('record_voice_over', 'sm')} Okunuş</button>
      ${date !== today() ? `<a class="chip" href="#/gunluk/${period}/${today()}">${icon('today', 'sm')} Bugün</a>` : ''}
    </div>
    <div>${d.verses.length ? d.verses.map((v) => verseRow(v, {
      href: `#/ayet/${v.surah}/${v.ayah}${qs({ d: date, p: period })}`, showArabic: showAr,
      extra: v.noteCount ? `<span class="badge">${icon('chat_bubble', 'sm')}${v.noteCount}</span>` : '',
    })).join('') : '<div class="empty">Bu vakit için ayet ayarlanmamış. Ayarlardan ayet sayısını belirleyebilirsiniz.</div>'}</div>
  </div>`;
  bindMealPicker(render);
  document.getElementById('tgl-ar').onclick = () => { lsSet('arabicDaily', !showAr); render(); };
  document.getElementById('tgl-tl').onclick = async () => { state.me.user.showTransliteration = !showTl(); await PATCH('/me', { showTransliteration: showTl() }); render(); };
  document.getElementById('share').onclick = async () => {
    const text = `${trDate(date)} — ${PERIOD[period]} Ayetleri\n\n` +
      d.verses.map((v) => `${v.text} (${v.surahName} ${v.surah}:${v.ayah})`).join('\n\n');
    try {
      if (navigator.share) await navigator.share({ title: `${PERIOD[period]} Ayetleri`, text });
      else { await navigator.clipboard.writeText(text); toast('Ayetler panoya kopyalandı'); }
    } catch { /* iptal */ }
  };
}

// ---------------------------------------------------------------------------
// Ayet detayı (mealler, kelimeler/kökler, çıkarımlar)
// ---------------------------------------------------------------------------
async function viewVerse([s, a], query) {
  s = parseInt(s, 10); a = parseInt(a, 10);
  const [v, notes] = await Promise.all([
    GET(`/quran/verse/${s}/${a}${qs({ tr: tr() })}`),
    GET(G(`/notes${qs({ surah: s, ayah: a, sort: 'verse', tr: tr() })}`)),
  ]);
  PUT(G('/bookmark'), { surah: s, ayah: a }).catch(() => {});
  const ctxD = query.get('d'), ctxP = query.get('p');
  const ctxQs = qs({ d: ctxD, p: ctxP });
  const openWords = lsGet('openWords', false);
  const openCompare = lsGet('openCompare', false);
  $app.innerHTML = `<div class="page">
    ${topbar({ title: `${v.surahName} ${v.surah}:${v.ayah}`, center: true, sub: `Cüz ${v.juz} · ${v.ayah}/${v.surahVerseCount}`,
      right: ctxD ? `<div style="text-align:right;font-size:12px;line-height:1.3">${trDate(ctxD)}<br><span class="muted">${PERIOD[ctxP] || ''}</span></div>`
        : `<a class="icon-btn" href="#/sure/${s}?a=${a}" aria-label="Surede göster" title="Surede göster">${icon('menu_book', 'o')}</a>` })}
    <div class="verse-hero">
      <div class="ar">${esc(v.arabic)}</div>
      <div class="tr">${esc(v.text)}</div>
      ${showTl() ? `<div class="tl">${esc(v.transliteration)}</div>` : ''}
      <div class="src">${esc(trName(v.translation))} meali</div>
      <div class="toolbar">
        ${mealPicker()}
        <button class="chip ${openCompare ? 'on' : ''}" id="t-compare">${icon('library_books', 'sm')} Tüm Mealler</button>
        <button class="chip ${openWords ? 'on' : ''}" id="t-words">${icon('account_tree', 'sm')} Kelimeler ve Kökler</button>
        <button class="chip ${showTl() ? 'on' : ''}" id="t-tl">${icon('record_voice_over', 'sm')} Okunuş</button>
      </div>
      <div class="toolbar">
        <a class="icon-btn" ${v.prev ? `href="#/ayet/${v.prev.surah}/${v.prev.ayah}"` : 'aria-disabled="true" style="opacity:.3"'} aria-label="Önceki ayet">${icon('chevron_left')}</a>
        <button class="btn" id="add-note">${icon('add_comment', 'sm')} Çıkarım Ekle</button>
        <a class="icon-btn" ${v.next ? `href="#/ayet/${v.next.surah}/${v.next.ayah}"` : 'aria-disabled="true" style="opacity:.3"'} aria-label="Sonraki ayet">${icon('chevron_right')}</a>
      </div>
    </div>
    <div id="compare"></div>
    <div id="words"></div>
    <div id="notes">${notes.length ? notes.map((n) => noteHtml(n)).join('') : '<div class="empty">Bu ayete henüz çıkarım eklenmemiş.</div>'}</div>
  </div>`;
  bindMealPicker(render);
  bindNotes($app, render);
  document.getElementById('add-note').onclick = () => go(`#/cikarim-ekle/${s}/${a}${ctxQs}`);
  document.getElementById('t-tl').onclick = async () => { state.me.user.showTransliteration = !showTl(); await PATCH('/me', { showTransliteration: showTl() }); render(); };

  const compareEl = document.getElementById('compare');
  const renderCompare = async (open) => {
    if (!open) { compareEl.innerHTML = ''; return; }
    compareEl.innerHTML = `<div class="panel compare"><h3>Mealler</h3>${v.translations.map((t) => `
      <div class="item ${t.id === v.translation ? 'cur' : ''}"><div class="name">${esc(t.name)}</div><div>${esc(t.text)}</div></div>`).join('')}
      ${v.transliteration ? `<div class="item"><div class="name">Okunuş</div><div class="muted" style="font-size:14px;font-style:italic">${esc(v.transliteration)}</div></div>` : ''}</div>
      <div id="ak-tr"><div class="panel"><div class="muted">Açık Kuran'daki diğer mealler yükleniyor…</div></div></div>`;
    const box = document.getElementById('ak-tr');
    try {
      const x = await GET(`/quran/extra/${s}/${a}`);
      if (!box.isConnected) return;
      box.innerHTML = `<div class="panel compare"><h3>Açık Kuran'daki Türkçe mealler (${x.translations.length})</h3>
        ${x.translations.map((t) => `<div class="item"><div class="name">${esc(t.name)}${t.description ? ` — <span style="text-transform:none">${esc(t.description)}</span>` : ''}</div>
          <div>${esc(t.text)}</div>
          ${t.footnotes.length ? `<div class="muted" style="margin-top:4px">${t.footnotes.map((f) => `[${f.number}] ${esc(f.text)}`).join('<br>')}</div>` : ''}</div>`).join('')}
        <div class="muted" style="margin-top:8px">Kaynak: ${AK_LINK(x.sourceUrl)}</div></div>`;
    } catch (e) {
      if (box.isConnected) box.innerHTML = `<div class="panel"><div class="muted">${esc(e.message)}</div></div>`;
    }
  };
  renderCompare(openCompare);
  document.getElementById('t-compare').onclick = (e) => {
    const open = !lsGet('openCompare', false); lsSet('openCompare', open);
    e.currentTarget.classList.toggle('on', open); renderCompare(open);
  };

  const wordsEl = document.getElementById('words');
  const renderWords = async (open) => {
    if (!open) { wordsEl.innerHTML = ''; return; }
    wordsEl.innerHTML = '<div class="panel"><div class="muted">Kelimeler yükleniyor…</div></div>';
    const data = await GET(`/quran/words/${s}/${a}`);
    const words = data.words;
    wordsEl.innerHTML = `<div class="panel"><h3>Kelimeler ve Kökler</h3>
      <div class="muted" style="margin-bottom:10px">Bir kelimeye dokunarak dilbilgisi çözümlemesini, köke dokunarak kökün Kur'an'daki tüm kullanımlarını görebilirsiniz.</div>
      <div class="words">${words.map((w, i) => `<div class="word" data-w="${i}" tabindex="0">
        <div class="w-ar">${esc(w.arabic)}</div>
        <div class="w-tl">${esc(w.transliteration)}</div>
        ${w.meaning ? `<div class="w-en">${esc(w.meaning)}</div>` : ''}
        ${w.root ? `<div class="w-root">${esc(w.rootArabic)}</div>` : '<div class="w-root muted" style="font-family:inherit;font-size:11px">kök yok</div>'}
        <div class="w-pos">${esc(w.label)}</div></div>`).join('')}</div>
      <div id="wdetail"></div>
      <div class="muted" style="margin-top:10px">${data.source === 'acikkuran'
        ? `Kelime anlamları ve kök açıklamaları: ${AK_LINK(data.sourceUrl)} · Dilbilgisi: Quranic Arabic Corpus`
        : `Türkçe kelime anlamları için Açık Kuran'a şu an ulaşılamadı; dilbilgisi çözümlemesi gösteriliyor.`}</div></div>`;
    const det = document.getElementById('wdetail');
    wordsEl.querySelectorAll('[data-w]').forEach((el) => {
      el.onclick = () => {
        const w = words[+el.dataset.w];
        wordsEl.querySelectorAll('.word').forEach((x) => x.classList.toggle('open', x === el));
        det.innerHTML = `<div class="word-detail">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div><span style="font-family:var(--arabic);font-size:28px">${esc(w.arabic)}</span>
              <span class="muted" style="margin-left:8px">${esc(w.transliteration)}${w.meaning ? ` — “${esc(w.meaning)}”` : ''}</span></div>
            ${w.root ? `<a class="btn outline" href="#/kok/${encodeURIComponent(w.root)}">${icon('account_tree', 'sm')} Kök: <span style="font-family:var(--arabic);font-size:18px">${esc(w.rootArabic)}</span> · ${w.rootCount} kez</a>` : ''}
          </div>
          ${w.lemma ? `<div class="muted" style="margin:6px 0">Lemma (sözlük biçimi): <span style="font-family:var(--arabic);font-size:18px;color:var(--text)">${esc(w.lemma)}</span> — Kur'an'da ${w.lemmaCount} kez</div>` : ''}
          ${w.rootMeaning ? `<div class="panel" style="background:var(--bg);margin:10px 0;box-shadow:none;border:1px solid var(--line)">
            <h3>Kökün anlamı <span style="font-family:var(--arabic);font-size:18px">${esc(w.rootArabic)}</span>${w.rootTranscription ? ` <span class="muted">(${esc(w.rootTranscription)})</span>` : ''}</h3>
            <div style="font-size:13.5px">${richText(w.rootMeaning)}</div></div>` : ''}
          ${w.segments.map((sg) => `<div class="seg"><div class="s-ar">${esc(sg.arabic)}</div>
            <div><div class="s-lbl">${esc(sg.label)}</div>${sg.details.length ? `<div class="s-det">${esc(sg.details.join(' · '))}</div>` : ''}</div></div>`).join('')}
        </div>`;
      };
      el.onkeydown = (e) => { if (e.key === 'Enter') el.click(); };
    });
  };
  renderWords(openWords);
  document.getElementById('t-words').onclick = (e) => {
    const open = !lsGet('openWords', false); lsSet('openWords', open);
    e.currentTarget.classList.toggle('on', open); renderWords(open);
  };
}

// ---------------------------------------------------------------------------
// Çıkarım ekle / düzenle
// ---------------------------------------------------------------------------
async function viewNoteForm(params, query) {
  await loadGroup();
  const editing = parseHash().parts[0] === 'cikarim-duzenle';
  let note = null, s, a;
  if (editing) { note = await GET(G(`/notes/${params[0]}`)); s = note.surah; a = note.ayah; }
  else { s = parseInt(params[0], 10); a = parseInt(params[1], 10); }
  const [v, tags] = await Promise.all([GET(`/quran/verse/${s}/${a}${qs({ tr: tr() })}`), loadTags(true)]);
  $app.innerHTML = `<div class="page">
    ${topbar({ title: editing ? 'Çıkarımı Düzenle' : 'Çıkarım Ekle', back: 'close' })}
    <div class="verse-hero" style="padding-bottom:14px">
      <div class="ar" style="font-size:26px">${esc(v.arabic)}</div><div class="tr" style="font-size:14px">${esc(v.text)}</div>
      <div class="src">${esc(v.surahName)} ${s}:${a}</div></div>
    <div class="field"><label for="tag">Etiket</label>
      <select class="select" id="tag"><option value="">Etiket seçiniz</option>
        ${tags.map((t) => `<option value="${t.id}" ${note && note.tagId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        ${isAdmin() ? '<option value="__new">+ Yeni etiket oluştur…</option>' : ''}</select>
      ${isAdmin() ? '' : '<div class="muted" style="margin:6px 4px 0">Etiketleri grup yöneticisi belirler.</div>'}</div>
    <div class="field"><textarea class="textarea" id="body" placeholder="Notlarım" style="min-height:160px">${esc(note ? note.body : '')}</textarea></div>
    <div class="err" id="err"></div>
    <div class="actions"><button class="btn text" id="save">${icon('save')} Kaydet</button></div>
  </div>`;
  const sel = document.getElementById('tag');
  sel.onchange = async () => {
    if (sel.value !== '__new') return;
    const r = await modal({ title: 'Yeni Etiket', fields: [{ label: 'Etiket adı' }, { label: 'Renk', type: 'color', value: '#3d6b45', attrs: 'style="height:46px;padding:4px"' }], ok: 'Oluştur' });
    if (!r || !r[0].trim()) { sel.value = ''; return; }
    try {
      const { id } = await POST(G('/tags'), { name: r[0], color: r[1] });
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = r[0].trim();
      sel.insertBefore(opt, sel.lastElementChild);
      sel.value = String(id);
      state.tags = null;
    } catch (e) { toast(e.message); sel.value = ''; }
  };
  document.getElementById('save').onclick = async () => {
    const body = { body: document.getElementById('body').value, tagId: sel.value && sel.value !== '__new' ? sel.value : null };
    try {
      if (editing) await PATCH(G(`/notes/${note.id}`), body);
      else await POST(G('/notes'), { ...body, surah: s, ayah: a, contextDate: query.get('d'), contextPeriod: query.get('p') });
      toast('Çıkarım kaydedildi');
      history.length > 1 ? history.back() : go(`#/ayet/${s}/${a}`);
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

// ---------------------------------------------------------------------------
// Sureler
// ---------------------------------------------------------------------------
async function viewSurahs() {
  const surahs = await loadSurahs();
  $app.innerHTML = `<div class="page">
    ${topbar({ title: 'Sûreler' })}
    <div class="search"><input id="q" placeholder="Ara" aria-label="Sure ara">${icon('search', 'sm')}</div>
    <div id="list"></div></div>`;
  const list = document.getElementById('list');
  const norm = (x) => String(x).toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/['’\-\s]/g, '');
  const draw = (term) => {
    const t = norm(term);
    const rows = surahs.filter((s) => !t || norm(s.name).includes(t) || norm(s.transliteration).includes(t) || String(s.number) === term.trim());
    list.innerHTML = rows.map((s) => `<a class="row" href="#/sure/${s.number}"><span class="grow">${s.number}. ${esc(s.name)}</span>
      <span class="meta">${s.type} · ${s.verseCount} ayet</span><span style="font-family:var(--arabic);font-size:18px;min-width:70px;text-align:right">${esc(s.arabic)}</span>${icon('chevron_right', 'chev')}</a>`).join('')
      || '<div class="empty">Sonuç yok.</div>';
  };
  draw('');
  document.getElementById('q').oninput = (e) => draw(e.target.value);
}

async function viewSurah([n], query) {
  const s = await GET(`/quran/surah/${n}${qs({ tr: tr() })}`);
  const target = parseInt(query.get('a'), 10);
  const bm = await GET(G('/bookmark'));
  $app.innerHTML = `<div class="page">
    ${topbar({ title: `${s.number}. ${s.name}`, center: true, sub: `${s.type} · ${s.verseCount} ayet`, back: '#/sureler',
      right: `<span style="font-family:var(--arabic);font-size:22px">${esc(s.arabic)}</span>` })}
    <div class="daily-tools">${mealPicker()}
      <button class="chip ${showTl() ? 'on' : ''}" id="tgl-tl">${icon('record_voice_over', 'sm')} Okunuş</button></div>
    ${s.number !== 1 && s.number !== 9 ? '<div class="besmele"><div class="ar">بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ</div></div>' : ''}
    <div>${s.verses.map((v) => verseRow(v, {
      href: `#/ayet/${v.surah}/${v.ayah}`, hl: v.ayah === target,
      extra: bm && bm.surah === v.surah && bm.ayah === v.ayah ? `<span class="badge">${icon('bookmark', 'sm')} Kaldığım yer</span>` : '',
    })).join('')}</div>
    <div class="actions" style="justify-content:space-between">
      ${s.number > 1 ? `<a class="btn text" href="#/sure/${s.number - 1}">${icon('chevron_left')} Önceki sure</a>` : '<span></span>'}
      ${s.number < 114 ? `<a class="btn text" href="#/sure/${s.number + 1}">Sonraki sure ${icon('chevron_right')}</a>` : ''}
    </div></div>`;
  bindMealPicker(render);
  document.getElementById('tgl-tl').onclick = async () => { state.me.user.showTransliteration = !showTl(); await PATCH('/me', { showTransliteration: showTl() }); render(); };
  if (target) setTimeout(() => { const el = document.getElementById('v' + target); if (el) el.scrollIntoView({ block: 'center' }); }, 30);
}

async function viewContinue() {
  const bm = await GET(G('/bookmark'));
  if (!bm) {
    $app.innerHTML = `<div class="page">${topbar({ title: 'Kaldığım Yerden Devam Et' })}
      <div class="empty">Henüz bir ayet okumadınız. Bir ayeti açtığınızda kaldığınız yer otomatik kaydedilir.<br><br>
      <a class="btn" href="#/sure/1">Fâtiha'dan başla</a></div></div>`;
    return;
  }
  location.replace(`#/sure/${bm.surah}?a=${bm.ayah}`);
}

// ---------------------------------------------------------------------------
// Çıkarımlar
// ---------------------------------------------------------------------------
async function viewNotes(_, query) {
  await loadGroup();
  const [tags, members, surahs] = await Promise.all([loadTags(true), isAdmin() ? GET(G('/members')) : [], loadSurahs()]);
  const f = {
    tag: query.get('tag') || '', user: query.get('user') || '', mine: query.get('mine') || '', q: query.get('q') || '', sort: query.get('sort') || '',
    surahFrom: query.get('surahFrom') || '', surahTo: query.get('surahTo') || '',
  };
  const refs = query.get('refs');
  const title = query.get('baslik');
  let notes = await GET(G(`/notes${qs({ ...f, tr: tr() })}`));
  if (refs) { const set = new Set(refs.split(',')); notes = notes.filter((n) => set.has(`${n.surah}:${n.ayah}`)); }
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`;
  $app.innerHTML = `<div class="page">
    ${topbar({ title: title ? `Çıkarımlar — ${title}` : 'Çıkarımlar' })}
    ${refs ? '' : `<div class="form-row">
      <div class="field"><label>Etiket</label><select class="select" id="f-tag">${opt('', 'Tümü', f.tag)}${opt('none', 'Etiketsiz', f.tag)}${tags.map((t) => opt(t.id, t.name, f.tag)).join('')}</select></div>
      ${isAdmin()
        ? `<div class="field"><label>Kişi</label><select class="select" id="f-user">${opt('', 'Herkes', f.user)}${members.map((m) => opt(m.id, m.name, f.user)).join('')}</select></div>`
        : `<div class="field"><label>Göster</label><select class="select" id="f-mine">${opt('', 'Tüm çıkarımlar', f.mine)}${opt('1', 'Sadece benimkiler', f.mine)}</select></div>`}
      <div class="field"><label>Sure</label><select class="select" id="f-surah">${opt('', 'Tümü', f.surahFrom === f.surahTo ? f.surahFrom : '')}${surahs.map((s) => opt(s.number, `${s.number}. ${s.name}`, f.surahFrom === f.surahTo ? f.surahFrom : '')).join('')}</select></div>
      <div class="field"><label>Sıralama</label><select class="select" id="f-sort">${opt('', 'En yeni', f.sort)}${opt('verse', 'Mushaf sırası', f.sort)}</select></div>
    </div>
    <div class="search"><input id="f-q" placeholder="Notlarda ara" value="${esc(f.q)}">${icon('search', 'sm')}</div>
    ${f.surahFrom && f.surahTo && f.surahFrom !== f.surahTo ? `<div class="muted">Sure aralığı: ${f.surahFrom}–${f.surahTo}</div>` : ''}`}
    <div class="muted" style="margin:8px 4px">${notes.length} çıkarım</div>
    <div id="list">${notes.length ? notes.map((n) => noteHtml(n, { showVerse: true })).join('') : '<div class="empty">Çıkarım bulunamadı.</div>'}</div>
  </div>`;
  bindNotes($app, render);
  if (refs) return;
  const apply = () => {
    const sv = document.getElementById('f-surah').value;
    go('#/cikarimlar' + qs({
      tag: document.getElementById('f-tag').value,
      user: isAdmin() ? document.getElementById('f-user').value : '',
      mine: isAdmin() ? '' : document.getElementById('f-mine').value,
      sort: document.getElementById('f-sort').value, q: document.getElementById('f-q').value.trim(),
      surahFrom: sv || (f.surahFrom !== f.surahTo ? f.surahFrom : ''), surahTo: sv || (f.surahFrom !== f.surahTo ? f.surahTo : ''),
    }));
  };
  ['f-tag', 'f-user', 'f-mine', 'f-sort', 'f-surah'].forEach((id) => { const el = document.getElementById(id); if (el) el.onchange = apply; });
  document.getElementById('f-q').onkeydown = (e) => { if (e.key === 'Enter') apply(); };
}

// ---------------------------------------------------------------------------
// Arama (meal / Arapça / kök)
// ---------------------------------------------------------------------------
function highlight(text, terms) {
  let out = esc(text);
  if (!terms.length) return out;
  // Türkçe karakterlere duyarsız basit vurgulama
  const fold = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  const plain = esc(text);
  const folded = fold(plain);
  const marks = [];
  for (const t of terms) {
    const ft = fold(esc(t));
    if (!ft) continue;
    let i = folded.indexOf(ft);
    while (i >= 0) { marks.push([i, i + ft.length]); i = folded.indexOf(ft, i + ft.length); }
  }
  if (!marks.length || folded.length !== plain.length) return out;
  marks.sort((x, y) => x[0] - y[0]);
  out = ''; let pos = 0;
  for (const [st, en] of marks) { if (st < pos) continue; out += plain.slice(pos, st) + '<mark class="w">' + plain.slice(st, en) + '</mark>'; pos = en; }
  return out + plain.slice(pos);
}

async function viewSearch(_, query) {
  const mode = query.get('mod') === 'kok' ? 'kok' : 'ayet';
  const term = query.get('q') || '';
  const surahF = query.get('sure') || '';
  const surahs = await loadSurahs();
  $app.innerHTML = `<div class="page">
    ${topbar({ title: mode === 'kok' ? 'Kökler' : 'Ayet Arama' })}
    <div class="tabs"><a class="chip ${mode === 'ayet' ? 'on' : ''}" href="#/arama">${icon('search', 'sm')} Meal / Arapça</a>
      <a class="chip ${mode === 'kok' ? 'on' : ''}" href="#/arama?mod=kok">${icon('account_tree', 'sm')} Kök</a></div>
    <form class="search" id="sf"><input id="q" value="${esc(term)}" placeholder="${mode === 'kok'
      ? 'Arapça kök harfleri (ör. رحم veya ر ح م) — boş bırakırsanız tüm kökler'
      : 'Kelime, ifade veya 2:255 gibi ayet numarası'}" ${mode === 'kok' ? 'dir="auto"' : ''}><button class="icon-btn" type="submit" aria-label="Ara">${icon('search', 'sm')}</button></form>
    ${mode === 'ayet' ? `<div class="daily-tools" style="justify-content:flex-start">${mealPicker()}
      <select class="select" id="sure" style="width:auto;border-radius:999px;padding:5px 28px 5px 12px;font-size:12px">
        <option value="">Tüm sureler</option>${surahs.map((s) => `<option value="${s.number}" ${String(s.number) === surahF ? 'selected' : ''}>${s.number}. ${esc(s.name)}</option>`).join('')}</select></div>` : ''}
    <div id="res"></div></div>`;
  const res = document.getElementById('res');
  const submit = () => {
    const v = document.getElementById('q').value.trim();
    go('#/arama' + qs({ mod: mode === 'kok' ? 'kok' : '', q: v, sure: mode === 'ayet' ? document.getElementById('sure').value : '' }));
  };
  document.getElementById('sf').onsubmit = (e) => { e.preventDefault(); submit(); };
  if (mode === 'ayet') {
    bindMealPicker(render);
    document.getElementById('sure').onchange = submit;
    if (!term) { res.innerHTML = '<div class="empty">Seçili mealde ya da Arapça metinde arama yapabilirsiniz.<br>Arapça harflerle yazarsanız Arapça metinde arar (harekesiz yazabilirsiniz).</div>'; return; }
    res.innerHTML = '<div class="loading">Aranıyor…</div>';
    const r = await GET(`/quran/search${qs({ q: term, tr: tr(), surah: surahF })}`);
    const isAr = /[؀-ۿ]/.test(term);
    const terms = isAr ? [] : term.split(/\s+/).filter(Boolean);
    res.innerHTML = `<div class="muted" style="margin:8px 4px">${r.total} sonuç${r.total > r.results.length ? ` (ilk ${r.results.length} gösteriliyor)` : ''}</div>` +
      r.results.map((v) => `<a class="verse-row" href="#/ayet/${v.surah}/${v.ayah}">
        ${isAr ? `<div class="ar">${esc(v.arabic)}</div>` : ''}
        <div class="tr">${highlight(v.text, terms)}</div>
        <div class="ref"><span>${esc(v.surahName)} ${v.surah}:${v.ayah}</span></div></a>`).join('');
  } else {
    res.innerHTML = '<div class="loading">Yükleniyor…</div>';
    const roots = await GET(`/quran/roots${qs({ q: term })}`);
    const noted = await GET(G('/root-notes')).catch(() => []);
    const notedSet = new Map(noted.map((r) => [r.root, r.count]));
    res.innerHTML = `${!term && noted.length ? `<div class="label">Grubunuzun açıklama yazdığı kökler</div>
        <div class="lemma-list">${noted.map((r) => `<a class="lemma" href="#/kok/${encodeURIComponent(r.root)}"><div class="l-ar">${esc(r.rootArabic)}</div><div class="l-meta">${r.count} açıklama</div></a>`).join('')}</div>` : ''}
      <div class="label">${term ? `${roots.length} kök bulundu` : `Tüm kökler (${roots.length}) — kullanım sıklığına göre`}</div>
      <div class="lemma-list">${roots.map((r) => `<a class="lemma" href="#/kok/${encodeURIComponent(r.root)}">
        <div class="l-ar">${esc(r.rootArabic)}</div><div class="l-meta">${r.count} kez${notedSet.has(r.root) ? ` · ${notedSet.get(r.root)} açıklama` : ''}</div></a>`).join('')
        || '<div class="empty">Bu harflerle bir kök bulunamadı. Kök harflerini Arapça yazın (ör. علم).</div>'}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Kök sayfası
// ---------------------------------------------------------------------------
function markWords(arabic, positions) {
  // Arapça metni kelimelere ayırıp ilgili konumdaki kelimeleri vurgular (durak işaretleri sayılmaz).
  const tokens = arabic.split(' ');
  let n = 0;
  return tokens.map((t) => {
    if (/^[ۖ-ۭـ]+$/.test(t)) return esc(t);
    n++;
    return positions.includes(n) ? `<mark class="w">${esc(t)}</mark>` : esc(t);
  }).join(' ');
}
async function viewRoot([root], query) {
  const page = Math.max(1, parseInt(query.get('s'), 10) || 1);
  const [info, notes] = await Promise.all([
    GET(`/quran/root/${encodeURIComponent(root)}${qs({ tr: tr() })}`),
    GET(G(`/root-notes/${encodeURIComponent(root)}`)),
  ]);
  const PER = 40;
  const pages = Math.ceil(info.verses.length / PER);
  const slice = info.verses.slice((page - 1) * PER, page * PER);
  const pager = pages > 1 ? `<div class="pager">
      ${page > 1 ? `<a class="btn text" href="#/kok/${encodeURIComponent(root)}?s=${page - 1}">${icon('chevron_left')}</a>` : ''}
      <span>${page} / ${pages}</span>
      ${page < pages ? `<a class="btn text" href="#/kok/${encodeURIComponent(root)}?s=${page + 1}">${icon('chevron_right')}</a>` : ''}</div>` : '';
  $app.innerHTML = `<div class="page">
    ${topbar({ title: 'Kök', center: true, sub: `${info.count} kez · ${info.verseCount} ayette`, right: `<a class="icon-btn" href="#/arama?mod=kok" aria-label="Tüm kökler">${icon('account_tree', 'o')}</a>` })}
    <div class="root-big">${esc(info.rootArabic)}</div>
    ${info.transcription ? `<div style="text-align:center" class="muted">${esc(info.transcription)}</div>` : ''}
    ${info.meaning ? `<div class="panel"><h3>Kökün anlamı</h3><div style="font-size:14px">${richText(info.meaning)}</div>
      <div class="muted" style="margin-top:8px">Kaynak: ${AK_LINK(info.sourceUrl)}</div></div>` : ''}
    ${info.derived.length ? `<div class="panel"><h3>Türeyen kelimeler ve anlamları</h3>
      <div class="lemma-list">${info.derived.map((d) => `<div class="lemma"><div class="l-ar">${esc(d.arabic)}</div>
        <div class="l-meta">${d.count} kez · <i>${esc(d.transcription || '')}</i>${d.meaning ? ` — “${esc(d.meaning)}”` : ''}</div></div>`).join('')}</div></div>`
    : `<div class="panel"><h3>Türetilen kelimeler (lemmalar)</h3>
      <div class="lemma-list">${info.lemmas.map((l) => `<div class="lemma"><div class="l-ar">${esc(l.lemma)}</div>
        <div class="l-meta">${l.count} kez · <i>${esc(l.transliteration || '')}</i></div></div>`).join('')}</div></div>`}
    <div class="panel"><h3>Grup açıklamaları</h3>
      <div class="muted">Bu kökün anlamı ve Kur'an'daki kullanımı hakkında grubunuzla paylaşmak istediğiniz açıklamaları yazın.</div>
      <div id="rnotes">${notes.map((n) => `<div class="note"><div class="body">${esc(n.body)}</div>
        <div class="foot"><span>${esc(authorLabel(n))}</span><span class="acts">${n.canEdit ? `
          <button class="icon-btn" data-edit-rn="${n.id}" aria-label="Düzenle">${icon('edit', 'sm o')}</button>
          <button class="icon-btn" data-del-rn="${n.id}" aria-label="Sil">${icon('delete', 'sm o')}</button>` : ''}
          <span style="margin-left:6px">${trDateTime(n.createdAt)}</span></span></div></div>`).join('')}</div>
      <div class="field"><textarea class="textarea" id="rn-body" placeholder="Kök açıklaması (ör. anlamı, türevleri, dikkat çeken kullanımlar)" style="min-height:90px"></textarea></div>
      <div class="actions"><button class="btn text" id="rn-save">${icon('save')} Açıklama Ekle</button></div></div>
    <div class="section-title"><h2 style="font-size:20px">Geçtiği ayetler</h2>${mealPicker()}</div>
    ${pager}
    <div>${slice.map((v) => `<a class="verse-row" href="#/ayet/${v.surah}/${v.ayah}">
      <div class="ar">${markWords(v.arabic, v.words)}</div><div class="tr">${esc(v.text)}</div>
      <div class="ref"><span>${esc(v.surahName)} ${v.surah}:${v.ayah}</span><span style="font-family:var(--arabic);font-size:16px">${esc(v.wordForms.join('، '))}</span></div></a>`).join('')}</div>
    ${pager}</div>`;
  bindMealPicker(render);
  document.getElementById('rn-save').onclick = async () => {
    const body = document.getElementById('rn-body').value;
    try { await POST(G(`/root-notes/${encodeURIComponent(root)}`), { body }); toast('Açıklama eklendi'); render(); } catch (e) { toast(e.message); }
  };
  $app.querySelectorAll('[data-edit-rn]').forEach((b) => {
    b.onclick = async () => {
      const n = notes.find((x) => String(x.id) === b.dataset.editRn);
      const r = await modal({ title: 'Açıklamayı düzenle', fields: [{ label: 'Açıklama', type: 'textarea', value: n.body }] });
      if (!r) return;
      try { await PATCH(G(`/root-note/${n.id}`), { body: r[0] }); render(); } catch (e) { toast(e.message); }
    };
  });
  $app.querySelectorAll('[data-del-rn]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmBox('Açıklamayı sil', '<p>Bu açıklama silinecek.</p>', 'Sil'))) return;
      try { await DEL(G(`/root-note/${b.dataset.delRn}`)); render(); } catch (e) { toast(e.message); }
    };
  });
}

// ---------------------------------------------------------------------------
// Etiketler
// ---------------------------------------------------------------------------
async function viewTags() {
  await loadGroup();
  if (!isAdmin()) { $app.innerHTML = adminOnly('Etiketler'); return; }
  const tags = await loadTags(true);
  $app.innerHTML = `<div class="page">
    ${topbar({ title: 'Etiketler' })}
    <div class="panel"><h3>Yeni etiket</h3>
      <div class="form-row" style="align-items:center">
        <div class="field" style="flex:3 1 200px"><label for="tn">Etiket adı</label><input class="input" id="tn" placeholder="ör. Karakter Analizi"></div>
        <input type="color" class="color-input" id="tc" value="#3d6b45" aria-label="Renk">
        <div class="field" style="flex:4 1 220px"><label for="td">Açıklama (isteğe bağlı)</label><input class="input" id="td"></div>
        <button class="btn" id="tadd" style="flex:0 0 auto">${icon('add', 'sm')} Ekle</button>
      </div></div>
    <div>${tags.length ? tags.map((t) => `<div class="row" data-open="${t.id}">
      <span class="dot" style="background:${esc(t.color)}"></span>
      <span class="grow">${esc(t.name)}${t.description ? `<div class="muted">${esc(t.description)}</div>` : ''}</span>
      <span class="meta">${t.note_count} çıkarım</span>
      <button class="icon-btn" data-edit="${t.id}" aria-label="Düzenle">${icon('edit', 'sm o')}</button>
      <button class="icon-btn" data-del="${t.id}" aria-label="Sil">${icon('delete', 'sm o')}</button>
    </div>`).join('') : '<div class="empty">Henüz etiket yok.</div>'}</div></div>`;
  document.getElementById('tadd').onclick = async () => {
    try {
      await POST(G('/tags'), { name: document.getElementById('tn').value, color: document.getElementById('tc').value, description: document.getElementById('td').value });
      toast('Etiket eklendi'); state.tags = null; render();
    } catch (e) { toast(e.message); }
  };
  document.getElementById('tn').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('tadd').click(); };
  $app.querySelectorAll('[data-open]').forEach((r) => { r.onclick = (e) => { if (!e.target.closest('button')) go(`#/cikarimlar?tag=${r.dataset.open}`); }; });
  $app.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = async () => {
      const t = tags.find((x) => String(x.id) === b.dataset.edit);
      const r = await modal({ title: 'Etiketi düzenle', fields: [
        { label: 'Etiket adı', value: t.name }, { label: 'Renk', type: 'color', value: t.color, attrs: 'style="height:46px;padding:4px"' },
        { label: 'Açıklama', value: t.description }] });
      if (!r) return;
      try { await PATCH(G(`/tags/${t.id}`), { name: r[0], color: r[1], description: r[2] }); state.tags = null; render(); } catch (e) { toast(e.message); }
    };
  });
  $app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const t = tags.find((x) => String(x.id) === b.dataset.del);
      if (!(await confirmBox('Etiketi sil', `<p><b>${esc(t.name)}</b> etiketi silinecek. Bu etiketteki ${t.note_count} çıkarım silinmez, etiketsiz kalır.</p>`, 'Sil'))) return;
      try { await DEL(G(`/tags/${t.id}`)); state.tags = null; render(); } catch (e) { toast(e.message); }
    };
  });
}

// ---------------------------------------------------------------------------
// İstatistikler
// ---------------------------------------------------------------------------
async function viewStats() {
  await loadGroup();
  if (!isAdmin()) { $app.innerHTML = adminOnly('İstatistikler'); return; }
  const s = await GET(G(`/stats${qs({ today: today() })}`));
  const bars = (rows, color) => {
    const max = Math.max(1, ...rows.map((r) => r.c));
    return `<div class="bars">${rows.map((r) => `<div class="bar-row"><span class="n" title="${esc(r.name)}">${esc(r.name)}</span>
      <div class="track"><div class="fill" style="width:${(r.c / max) * 100}%;${color ? `background:${esc(r.color || color)}` : ''}"></div></div><span class="c">${r.c}</span></div>`).join('')}</div>`;
  };
  $app.innerHTML = `<div class="page">
    ${topbar({ title: 'İstatistikler' })}
    <div class="stats-grid">
      <div class="stat"><div class="v">${s.total}</div><div class="k">Toplam çıkarım</div></div>
      <div class="stat"><div class="v">${s.mine}</div><div class="k">Benim çıkarımlarım</div></div>
      <div class="stat"><div class="v">${s.verses}</div><div class="k">Çıkarım yapılan ayet</div></div>
      <div class="stat"><div class="v">${s.members}</div><div class="k">Üye</div></div>
    </div>
    <div class="panel"><h3>Günlük okuma ilerlemesi</h3>
      <div class="muted">Bugünkü okuma Kur'an'ın %${s.progress.percent}'lik kısmından başlıyor.</div>
      <div class="progress"><div style="width:${s.progress.percent}%"></div></div></div>
    <div class="panel"><h3>Çıkarım kapsamı</h3>
      <div class="muted">${s.coverage.total} ayetin ${s.verses} tanesine çıkarım yazıldı (%${s.coverage.percent}).</div>
      <div class="progress"><div style="width:${Math.max(s.coverage.percent, s.verses ? 0.5 : 0)}%"></div></div></div>
    ${s.byTag.length ? `<div class="panel"><h3>Etiketlere göre</h3>${bars(s.byTag, true)}</div>` : ''}
    ${s.byMember.length ? `<div class="panel"><h3>Üyelere göre</h3>${bars(s.byMember)}</div>` : ''}
    ${s.bySurah.length ? `<div class="panel"><h3>En çok çıkarım yapılan sureler</h3>${bars(s.bySurah)}</div>` : ''}
    ${s.last30.length ? `<div class="panel"><h3>Son 30 gün</h3>${bars(s.last30.map((d) => ({ name: trDate(d.day), c: d.c })))}</div>` : ''}
    ${!s.total ? '<div class="empty">Çıkarım eklendikçe istatistikler burada görünecek.</div>' : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// Çıkarım düzenleme görevleri
// ---------------------------------------------------------------------------
async function taskForm(task, members, tags, surahs) {
  const t = task || {};
  const r = await modal({
    title: task ? 'Görevi düzenle' : 'Yeni görev',
    fields: [
      { label: 'Başlık', value: t.title, placeholder: 'ör. Bakara 1-50 çıkarımlarını gözden geçir' },
      { label: 'Açıklama', type: 'textarea', value: t.description },
      { label: 'Atanan kişi', type: 'select', value: t.assigneeId || '', options: [{ value: '', label: '— Atanmadı —' }, ...members.map((m) => ({ value: m.id, label: m.name }))] },
      { label: 'Etiket', type: 'select', value: t.tagId || '', options: [{ value: '', label: '— Tümü —' }, ...tags.map((x) => ({ value: x.id, label: x.name }))] },
      { label: 'Başlangıç suresi', type: 'select', value: t.surahFrom || '', options: [{ value: '', label: '— Yok —' }, ...surahs.map((s) => ({ value: s.number, label: `${s.number}. ${s.name}` }))] },
      { label: 'Bitiş suresi', type: 'select', value: t.surahTo || '', options: [{ value: '', label: '— Aynı —' }, ...surahs.map((s) => ({ value: s.number, label: `${s.number}. ${s.name}` }))] },
      { label: 'Son tarih', type: 'date', value: t.dueDate || '' },
    ],
  });
  if (!r) return null;
  return { title: r[0], description: r[1], assigneeId: r[2], tagId: r[3], surahFrom: r[4], surahTo: r[5] || r[4], dueDate: r[6] };
}
async function viewTasks(_, query) {
  const filter = query.get('f') || 'acik';
  await loadGroup();
  const adm = isAdmin();
  const [tasks, members, tags, surahs] = await Promise.all([GET(G('/tasks')), adm ? GET(G('/members')) : [], loadTags(true), loadSurahs()]);
  const me = state.me.user.id;
  const shown = tasks.filter((t) => (filter === 'acik' ? t.status === 'open' : filter === 'bana' ? t.assigneeId === me && t.status === 'open' : filter === 'biten' ? t.status === 'done' : true));
  $app.innerHTML = `<div class="page">
    ${topbar({ title: adm ? 'Görev Dağılımı' : 'Görevlerim', right: adm ? `<button class="icon-btn" id="new" aria-label="Yeni görev" title="Yeni görev">${icon('add')}</button>` : '' })}
    <div class="tabs">${(adm ? [['acik', 'Açık'], ['bana', 'Bana atanan'], ['biten', 'Tamamlanan'], ['tumu', 'Tümü']] : [['acik', 'Yapılacak'], ['biten', 'Tamamlanan']]).map(([k, l]) =>
      `<a class="chip ${filter === k ? 'on' : ''}" href="#/gorevler?f=${k}">${l}</a>`).join('')}</div>
    <div>${shown.length ? shown.map((t) => `<div class="task ${t.status === 'done' ? 'done' : ''}">
      <input type="checkbox" class="check" data-toggle="${t.id}" ${t.status === 'done' ? 'checked' : ''} ${t.canToggle ? '' : 'disabled'} aria-label="Tamamlandı">
      <div style="flex:1;min-width:0">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">
          ${adm ? `<span>${icon('person', 'sm o')} ${esc(t.assigneeName || 'Atanmadı')}</span>` : ''}
          ${t.surahFrom ? `<span>${icon('menu_book', 'sm o')} ${esc(t.surahFromName)}${t.surahTo && t.surahTo !== t.surahFrom ? ` – ${esc(t.surahToName)}` : ''}</span>` : ''}
          ${t.tagName ? `<span style="color:${esc(t.tagColor)}">${icon('label', 'sm')} ${esc(t.tagName)}</span>` : ''}
          ${t.dueDate ? `<span>${icon('event', 'sm o')} ${trDate(t.dueDate)}</span>` : ''}
        </div>
        ${t.description ? `<div class="t-desc">${esc(t.description)}</div>` : ''}
        <div class="actions" style="justify-content:flex-start;margin-top:4px">
          <a class="btn text" href="#/cikarimlar${qs({ tag: t.tagId, surahFrom: t.surahFrom, surahTo: t.surahTo, sort: 'verse' })}">${icon('list', 'sm')} İlgili çıkarımlar</a>
          ${t.canEdit ? `<button class="btn text" data-edit="${t.id}">${icon('edit', 'sm')} Düzenle</button><button class="btn danger" data-del="${t.id}">${icon('delete', 'sm')} Sil</button>` : ''}
        </div>
      </div></div>`).join('') : '<div class="empty">Bu listede görev yok.</div>'}</div></div>`;
  const newBtn = document.getElementById('new');
  if (newBtn) newBtn.onclick = async () => {
    const body = await taskForm(null, members, tags, surahs);
    if (!body) return;
    try { await POST(G('/tasks'), body); toast('Görev oluşturuldu'); render(); } catch (e) { toast(e.message); }
  };
  $app.querySelectorAll('[data-toggle]').forEach((c) => {
    c.onchange = async () => { try { await PATCH(G(`/tasks/${c.dataset.toggle}`), { status: c.checked ? 'done' : 'open' }); render(); } catch (e) { toast(e.message); } };
  });
  $app.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = async () => {
      const t = tasks.find((x) => String(x.id) === b.dataset.edit);
      const body = await taskForm(t, members, tags, surahs);
      if (!body) return;
      try { await PATCH(G(`/tasks/${t.id}`), body); render(); } catch (e) { toast(e.message); }
    };
  });
  $app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmBox('Görevi sil', '<p>Bu görev silinecek.</p>', 'Sil'))) return;
      try { await DEL(G(`/tasks/${b.dataset.del}`)); render(); } catch (e) { toast(e.message); }
    };
  });
}

// ---------------------------------------------------------------------------
// Profil, üyeler, gruplar, ayarlar
// ---------------------------------------------------------------------------
async function shareCode(g) {
  const text = `"${g.name}" grubuna Kuran Araştırması'nda katılmak için grup kodu: ${g.code}\n${location.origin}`;
  await modal({ title: 'Grup Kodu', html: `<p class="muted">Bu kodu paylaştığınız kişiler, giriş yaptıktan sonra "Gruba Katıl" ekranından gruba katılabilir.</p>
    <div class="code-box">${esc(g.code)}</div>`, ok: 'Kopyala', cancel: 'Kapat' }).then(async (ok) => {
    if (!ok) return;
    try {
      if (navigator.share) await navigator.share({ title: 'Grup Kodu', text });
      else { await navigator.clipboard.writeText(text); toast('Kod panoya kopyalandı'); }
    } catch { /* iptal */ }
  });
}

async function viewProfile() {
  await loadMe();
  const { user, groups, activeGroupId } = state.me;
  const active = groups.find((g) => g.id === activeGroupId);
  const others = groups.filter((g) => g.id !== activeGroupId);
  $app.innerHTML = `<div class="page">
    ${topbar({ title: 'Profil', right: `<button class="icon-btn" id="logout" aria-label="Çıkış yap" title="Çıkış yap">${icon('logout')}</button>` })}
    <div class="profile-head"><div data-initial="${esc((user.name || '?').trim().charAt(0).toLocaleUpperCase('tr'))}"><div class="name">${esc(user.name)}</div><div class="email">${esc(user.email)}</div></div>
      <button class="icon-btn" id="edit-name" aria-label="Adı düzenle">${icon('edit')}</button></div>
    ${active ? `<div class="label">Grup</div>
    <div class="group-card">
      <div class="top"><div><div class="gname">${esc(active.name)}</div>
        <div class="sub">Alt Grup / Görev: ${esc(active.subgroup || '-')}${active.role === 'admin' ? ' · Yönetici' : ''}</div></div>
        ${active.role === 'admin' ? `<button class="mini-btn" id="edit-sub">${icon('edit', 'sm')} Düzenle</button>` : ''}</div>
      ${active.role === 'admin' ? `<div class="bottom"><a class="mini-btn" href="#/uyeler">${icon('group', 'sm')} Üyeler (${active.member_count})</a>
        <button class="mini-btn" id="share-code">${icon('share', 'sm')} Kodu Paylaş</button></div>` : '<div style="height:8px"></div>'}
    </div>` : '<div class="empty">Henüz bir gruba üye değilsiniz.</div>'}
    ${others.length ? `<div class="label">Diğer Gruplar</div>
      ${others.map((g) => `<button class="tile" data-switch="${g.id}" title="Bu gruba geç"><span class="grow" style="text-transform:uppercase">${esc(g.name)}
        <div class="sub" style="text-transform:none">${g.role === 'admin' ? `Yönetici · ${g.member_count} üye` : 'Üye'}${g.subgroup ? ` · ${esc(g.subgroup)}` : ''}</div></span>${icon('login')}</button>`).join('')}` : ''}
    <a class="link-btn" href="#/gruplar">Gruba Katıl / Grup Oluştur</a>
    <hr class="divider">
    <a class="link-btn" href="#/ayarlar">Okuma ve Meal Ayarları</a>
    <button class="link-btn" id="pw">Şifre Değiştir</button>
    <a class="link-btn" href="/api/me/export" download>Verilerimi indir</a>
    <a class="link-btn" href="#/gizlilik">Aydınlatma metni ve gizlilik</a>
    ${active && active.role !== 'admin' ? `<button class="link-btn danger" id="leave-g">"${esc(active.name)}" grubundan ayrıl</button>` : ''}
    <br>
    <button class="link-btn danger" id="del">Hesabımı Sil</button>
  </div>`;
  document.getElementById('logout').onclick = async () => { await POST('/auth/logout'); state.me = null; go('#/giris'); };
  document.getElementById('edit-name').onclick = async () => {
    const r = await modal({ title: 'Ad Soyad', fields: [{ label: 'Ad Soyad', value: user.name }] });
    if (!r) return;
    try { await PATCH('/me', { name: r[0] }); render(); } catch (e) { toast(e.message); }
  };
  if (active && active.role === 'admin') {
    document.getElementById('edit-sub').onclick = async () => {
      const r = await modal({ title: 'Alt Grup / Görev', fields: [{ label: 'Alt grup veya görev', value: active.subgroup, placeholder: 'ör. Bakara ekibi, Editör' }] });
      if (!r) return;
      try { await PATCH(`/g/${active.id}/members/${user.id}`, { subgroup: r[0] }); render(); } catch (e) { toast(e.message); }
    };
    document.getElementById('share-code').onclick = () => shareCode(active);
  }
  $app.querySelectorAll('[data-switch]').forEach((b) => {
    b.onclick = async () => {
      await POST('/me/active-group', { groupId: +b.dataset.switch });
      await loadMe();
      toast(`Aktif grup: ${groups.find((g) => g.id === +b.dataset.switch).name}`);
      go('#/');
    };
  });
  const lg = document.getElementById('leave-g');
  if (lg) lg.onclick = async () => {
    if (!(await confirmBox('Gruptan ayrıl', `<p><b>${esc(active.name)}</b> grubundan ayrılacaksınız. Tekrar katılmak için grup kodu gerekir.</p>`, 'Ayrıl'))) return;
    try { await POST(`/g/${active.id}/leave`); await loadMe(); go('#/profil'); } catch (e) { toast(e.message); }
  };
  document.getElementById('pw').onclick = async () => {
    const r = await modal({ title: 'Şifre Değiştir', fields: [{ label: 'Mevcut şifre', type: 'password' }, { label: 'Yeni şifre (en az 6 karakter)', type: 'password' }], ok: 'Değiştir' });
    if (!r) return;
    try { await POST('/me/password', { current: r[0], next: r[1] }); toast('Şifreniz değiştirildi'); } catch (e) { toast(e.message); }
  };
  document.getElementById('del').onclick = async () => {
    const r = await modal({ title: 'Hesabımı Sil', html: '<p>Hesabınız ve üyelikleriniz kalıcı olarak silinecek. Gruplara yazdığınız çıkarımların metni grupta kalır, adınız “Silinmiş üye” olarak değiştirilir.</p>',
      fields: [{ label: 'Onaylamak için şifreniz', type: 'password' }], ok: 'Hesabı Sil', danger: true });
    if (!r) return;
    try { await DEL('/me', { password: r[0] }); state.me = null; go('#/giris'); } catch (e) { toast(e.message); }
  };
}

async function viewMembers() {
  const g = await loadGroup(true);
  if (!g.isAdmin) { $app.innerHTML = adminOnly('Üyeler'); return; }
  const members = await GET(G('/members'));
  const me = state.me.user.id;
  $app.innerHTML = `<div class="page">
    ${topbar({ title: `Üyeler — ${g.name}`, back: '#/profil', right: `<button class="icon-btn" id="share" aria-label="Kodu paylaş">${icon('share')}</button>` })}
    <div>${members.map((m) => `<div class="row" style="cursor:default">${icon(m.role === 'admin' ? 'shield_person' : 'person', 'o')}
      <span class="grow">${esc(m.name)}${m.id === me ? ' (siz)' : ''}<div class="muted">${m.role === 'admin' ? 'Yönetici' : 'Üye'}${m.subgroup ? ` · ${esc(m.subgroup)}` : ''} · ${m.note_count} çıkarım</div></span>
      <a class="icon-btn" href="#/cikarimlar?user=${m.id}" aria-label="Çıkarımları" title="Çıkarımları">${icon('list')}</a>
      ${g.isAdmin || m.id === me ? `<button class="icon-btn" data-sub="${m.id}" aria-label="Alt grup / görev" title="Alt grup / görev">${icon('edit', 'o')}</button>` : ''}
      ${g.isAdmin && m.id !== me ? `<button class="icon-btn" data-role="${m.id}" title="${m.role === 'admin' ? 'Yöneticiliği kaldır' : 'Yönetici yap'}" aria-label="Rol">${icon(m.role === 'admin' ? 'remove_moderator' : 'add_moderator', 'o')}</button>
        <button class="icon-btn" data-remove="${m.id}" aria-label="Gruptan çıkar" title="Gruptan çıkar">${icon('person_remove', 'o')}</button>` : ''}
    </div>`).join('')}</div>
    ${g.isAdmin ? `<div class="panel"><h3>Grup yönetimi</h3>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn text" id="rename">${icon('edit', 'sm')} Grup adını değiştir</button>
        <button class="btn text" id="newcode">${icon('autorenew', 'sm')} Yeni kod oluştur</button>
        <button class="btn danger" id="delgroup">${icon('delete', 'sm')} Grubu sil</button></div></div>` : ''}
    <button class="link-btn danger" id="leave">Gruptan Ayrıl</button>
  </div>`;
  document.getElementById('share').onclick = () => shareCode(g);
  $app.querySelectorAll('[data-sub]').forEach((b) => {
    b.onclick = async () => {
      const m = members.find((x) => String(x.id) === b.dataset.sub);
      const r = await modal({ title: `${m.name} — Alt Grup / Görev`, fields: [{ label: 'Alt grup veya görev', value: m.subgroup }] });
      if (!r) return;
      try { await PATCH(G(`/members/${m.id}`), { subgroup: r[0] }); render(); } catch (e) { toast(e.message); }
    };
  });
  $app.querySelectorAll('[data-role]').forEach((b) => {
    b.onclick = async () => {
      const m = members.find((x) => String(x.id) === b.dataset.role);
      try { await PATCH(G(`/members/${m.id}`), { role: m.role === 'admin' ? 'member' : 'admin' }); render(); } catch (e) { toast(e.message); }
    };
  });
  $app.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = async () => {
      const m = members.find((x) => String(x.id) === b.dataset.remove);
      if (!(await confirmBox('Üyeyi çıkar', `<p><b>${esc(m.name)}</b> gruptan çıkarılacak. Çıkarımları grupta kalır.</p>`, 'Çıkar'))) return;
      try { await DEL(G(`/members/${m.id}`)); render(); } catch (e) { toast(e.message); }
    };
  });
  if (g.isAdmin) {
    document.getElementById('rename').onclick = async () => {
      const r = await modal({ title: 'Grup adı', fields: [{ label: 'Grup adı', value: g.name }] });
      if (!r) return;
      try { await PATCH(G(), { name: r[0] }); await loadMe(); render(); } catch (e) { toast(e.message); }
    };
    document.getElementById('newcode').onclick = async () => {
      if (!(await confirmBox('Yeni kod', '<p>Eski kod geçersiz olacak. Mevcut üyeler etkilenmez.</p>', 'Yenile', false))) return;
      try { const { code } = await POST(G('/code')); toast(`Yeni kod: ${code}`); state.group = null; render(); } catch (e) { toast(e.message); }
    };
    document.getElementById('delgroup').onclick = async () => {
      const r = await modal({ title: 'Grubu sil', html: `<p><b>${esc(g.name)}</b> grubu; tüm çıkarımları, etiketleri ve görevleriyle birlikte kalıcı olarak silinecek. Onaylamak için grup adını yazın.</p>`,
        fields: [{ label: 'Grup adı' }], ok: 'Grubu Sil', danger: true });
      if (!r) return;
      if (r[0].trim() !== g.name) return toast('Grup adı eşleşmedi.');
      try { await DEL(G()); await loadMe(); go('#/profil'); } catch (e) { toast(e.message); }
    };
  }
  document.getElementById('leave').onclick = async () => {
    if (!(await confirmBox('Gruptan ayrıl', `<p><b>${esc(g.name)}</b> grubundan ayrılacaksınız. Tekrar katılmak için grup kodu gerekir.</p>`, 'Ayrıl'))) return;
    try { await POST(G('/leave')); await loadMe(); go('#/profil'); } catch (e) { toast(e.message); }
  };
}

async function viewGroups() {
  const has = state.me.groups.length > 0;
  $app.innerHTML = `<div class="page">
    ${topbar({ title: 'Gruba Katıl / Grup Oluştur', back: has ? '#/profil' : '' , right: has ? '' : `<button class="icon-btn" id="logout" aria-label="Çıkış">${icon('logout')}</button>` })}
    ${has ? '' : `<p class="muted" style="margin:4px">Hoş geldiniz, ${esc(state.me.user.name)}. Başlamak için bir gruba katılın ya da yeni grup oluşturun. Her grubun kendi günlük ayetleri, etiketleri ve çıkarımları vardır.</p>`}
    <div class="panel"><h3>${icon('login', 'sm')} Koda göre gruba katıl</h3>
      <div class="field"><label for="code">Grup kodu</label><input class="input" id="code" placeholder="ör. K7M2QX" style="text-transform:uppercase;letter-spacing:.15em" maxlength="12"></div>
      <div class="actions"><button class="btn" id="join">Katıl</button></div></div>
    <div class="panel"><h3>${icon('group_add', 'sm')} Yeni grup oluştur</h3>
      <div class="field"><label for="gname">Grup adı</label><input class="input" id="gname" placeholder="ör. DUHA NİSA"></div>
      <div class="muted">Grubu oluşturan kişi yönetici olur; grup kodunu paylaşarak başkalarını davet edebilirsiniz.</div>
      <div class="actions"><button class="btn" id="create">Oluştur</button></div></div>
  </div>`;
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async () => { await POST('/auth/logout'); state.me = null; go('#/giris'); };
  document.getElementById('join').onclick = async () => {
    try {
      const r = await POST('/groups/join', { code: document.getElementById('code').value });
      await loadMe(); toast(`"${r.name}" grubuna katıldınız`); go('#/');
    } catch (e) { toast(e.message); }
  };
  document.getElementById('create').onclick = async () => {
    try {
      await POST('/groups', { name: document.getElementById('gname').value, today: today() });
      await loadMe(); toast('Grup oluşturuldu'); go('#/');
    } catch (e) { toast(e.message); }
  };
}

async function viewSettings() {
  const g = gid() ? await loadGroup(true) : null;
  const surahs = await loadSurahs();
  const user = state.me.user;
  $app.innerHTML = `<div class="page">
    ${topbar({ title: 'Ayarlar' })}
    <div class="panel"><h3>Okuma tercihlerim</h3>
      <div class="field"><label for="meal-s">Varsayılan meal</label><select class="select" id="meal-s">${state.me.translations.map((t) =>
        `<option value="${t.id}" ${t.id === user.translation ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <label class="row" style="cursor:pointer;padding:8px 4px;border:0"><input type="checkbox" class="check" id="tl" ${user.showTransliteration ? 'checked' : ''}><span class="grow">Latin harfleriyle okunuşu göster</span></label>
      <label class="row" style="cursor:pointer;padding:8px 4px;border:0"><input type="checkbox" class="check" id="ar" ${prefArabicDaily() ? 'checked' : ''}><span class="grow">Günlük ayetlerde Arapça metni göster</span></label>
      <div class="muted">Mealleri ayet sayfalarındaki seçiciden de istediğiniz an değiştirebilirsiniz.</div></div>
    ${g ? `<div class="panel"><h3>Günlük ayetler — ${esc(g.name)}</h3>
      <div class="muted" style="margin-bottom:6px">Ayetler Kur'an sırasıyla otomatik ilerler: her gün önce sabah, sonra akşam ayetleri gelir; ertesi gün kalınan yerden devam edilir.
        Bugün ${esc(g.schedule.todayStart.surahName)} ${g.schedule.todayStart.surah}:${g.schedule.todayStart.ayah}'den başlıyor.</div>
      ${g.isAdmin ? '' : '<div class="muted"><b>Bu ayarları yalnızca grup yöneticisi değiştirebilir.</b></div>'}
      <div class="form-row">
        <div class="field"><label for="m">Sabah ayet sayısı</label><input class="input" id="m" type="number" min="0" max="300" value="${g.schedule.morning}" ${g.isAdmin ? '' : 'disabled'}></div>
        <div class="field"><label for="e">Akşam ayet sayısı</label><input class="input" id="e" type="number" min="0" max="300" value="${g.schedule.evening}" ${g.isAdmin ? '' : 'disabled'}></div>
      </div>
      ${g.isAdmin ? `<label class="row" style="cursor:pointer;padding:8px 4px;border:0"><input type="checkbox" class="check" id="restart"><span class="grow">Bugünden itibaren belirli bir ayetten başlat</span></label>
      <div class="form-row" id="restart-box" style="display:none">
        <div class="field"><label for="rs">Sure</label><select class="select" id="rs">${surahs.map((s) => `<option value="${s.number}">${s.number}. ${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ra">Ayet</label><input class="input" id="ra" type="number" min="1" value="1"></div>
      </div>
      <div class="muted">Değişiklikler bugünden itibaren geçerli olur; geçmiş günlerin ayetleri değişmez.</div>` : ''}
    </div>` : ''}
    <div class="actions"><button class="btn" id="save">${icon('save', 'sm')} Kaydet</button></div>
  </div>`;
  if (g && g.isAdmin) {
    const rb = document.getElementById('restart');
    rb.onchange = () => { document.getElementById('restart-box').style.display = rb.checked ? 'flex' : 'none'; };
  }
  document.getElementById('save').onclick = async () => {
    try {
      await PATCH('/me', { translation: document.getElementById('meal-s').value, showTransliteration: document.getElementById('tl').checked });
      lsSet('arabicDaily', document.getElementById('ar').checked);
      if (g && g.isAdmin) {
        const restart = document.getElementById('restart').checked
          ? { surah: document.getElementById('rs').value, ayah: document.getElementById('ra').value } : null;
        await PUT(G('/schedule'), { morning: document.getElementById('m').value, evening: document.getElementById('e').value, restart, today: today() });
      }
      await loadMe();
      toast('Ayarlar kaydedildi');
      go('#/');
    } catch (e) { toast(e.message); }
  };
}

render();

// Telefona "uygulama olarak" yüklenebilmesi ve çevrimdışı açılabilmesi için
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
