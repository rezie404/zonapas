// Kelola Berita — helper bersama semua halaman Portal (portal,
// tulis, tulis-artikel, tulis-video, edit, antrean, pengguna,
// aplikasi-pendukung).
// Script klasik: semua nama top-level (const/let/function) hidup di
// lingkungan global dan dipakai script tiap halaman yang dimuat
// sesudah file ini. Fungsi halaman yang tidak ada di halaman yang
// sedang dibuka dipanggil hanya bila typeof-nya 'function'.
// Semua fetch Worker lewat workerApi/workerGet/workerPost (header
// X-GitHub-Token) — fetch mentah tanpa header ditolak 401.
// Dipindah verbatim dari halaman Kelola Berita lama (Nov 2026).
    const GH_API = 'https://api.github.com/repos/rezie404/zonapas';

    const OAUTH_AUTH_URL = 'https://oauth.zonapas.web.id/auth';

    const OAUTH_ORIGIN = 'https://oauth.zonapas.web.id';

    const SITE_URL = 'https://zonapas.web.id';

    const MAX_COVER_BYTES = 2 * 1024 * 1024;


    // Data pulau JSON dibaca secara defensif: bila isinya tidak terbaca,
    // pakai default kosong supaya satu kegagalan data tidak pernah
    // mematikan seluruh script halaman (dan tombol login).
    let kelolaData = {};

    try {
      const raw = document.getElementById('kelola-data');
      kelolaData = raw && raw.textContent ? JSON.parse(raw.textContent) : {};
    } catch (e) {
      console.warn('Data kelola tidak terbaca, memakai default.', e);
    }

    const CATEGORY_COLORS = kelolaData.categoryColors || {};

    const AUTHORS_MAP = kelolaData.authors || {};


    const $ = (id) => document.getElementById(id);

    // Pasang listener hanya bila elemennya ada: satu elemen yang hilang
    // tidak boleh mematikan seluruh script halaman.
    function on(id, event, fn) {
      const el = $(id);
      if (el) el.addEventListener(event, fn);
    }

    const statusEl = $('status');

    const loginBox = $('login-box');

    const appEl = $('app');


    let token = null;

    try { token = sessionStorage.getItem('zonapas-kelola-token') || null; } catch (e) {}

    let articles = [];

    let editing = null;
 // { path, sha, slug, image }
    let pendingCover = null;
 // { dataUrl, name }
    // --- Peran (login terpadu) ---
    let peran = null;
 // 'admin' | 'penyunting' | 'penulis' | null
    // Akses Aplikasi Pendukung (Nov 2026): true bila Administrator, atau
    // akun Google Penulis/Penyunting yang DITUNJUK Administrator
    // (Worker: user.akses_pendamping). Dipakai penjaga halaman pendamping.
    let aksesPendamping = false;
    let sumberLogin = null;
 // 'github' | 'google' | null
    let identitas = null;
 // { nama, peran, email, login, picture }
    let antrean = [];

    let editingAntrean = null;
 // { id, coverAda, breakingSince }
    let pendingGambarIsi = [];
 // antrean: { filename, dataUrl } — ditahan, diunggah saat simpan
    let fotoIsi = null;
 // foto badan narasi terpisah: { baris, nama } — TIDAK tampil di kotak narasi

    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }


    function showStatus(msg, ok) {
      statusEl.textContent = msg;
      statusEl.classList.remove('hidden', 'bg-emerald-100', 'text-emerald-900', 'bg-red-100', 'text-red-900', 'dark:bg-emerald-900/40', 'dark:text-emerald-100', 'dark:bg-red-900/40', 'dark:text-red-100');
      statusEl.classList.add(ok ? 'bg-emerald-100' : 'bg-red-100', ok ? 'text-emerald-900' : 'text-red-900', ok ? 'dark:bg-emerald-900/40' : 'dark:bg-red-900/40', ok ? 'dark:text-emerald-100' : 'dark:text-red-100');
      statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }


    function slugify(text) {
      return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'berita';
    }


    function formatDateShort(iso) {
      const d = new Date(iso + 'T00:00:00');
      if (isNaN(d)) return iso;
      return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    }


    function todayISO() {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }


    function b64encodeUnicode(str) {
      return btoa(unescape(encodeURIComponent(str)));
    }


    function b64decodeUnicode(b64) {
      return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
    }


    function parseFrontmatter(text) {
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!m) return { data: {}, body: text };
      const data = {};
      const lines = m[1].split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if (!key) continue;
        // Skalar blok YAML (mis. ringkasan Decap "summary: >-"): baris-baris
        // terindentasi berikutnya adalah isi nilai, bukan kunci baru. Tanpa
        // ini, "summary: >-" tersimpan harfiah dan isi ringkasan hilang.
        if (val === '>-' || val === '>' || val === '|-' || val === '|') {
          const folded = val.charAt(0) === '>';
          const strip = val.charAt(1) === '-';
          const parts = [];
          let j = i + 1;
          while (j < lines.length && (lines[j].trim() === '' || /^[ \t]/.test(lines[j]))) {
            parts.push(lines[j]);
            j++;
          }
          while (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
          if (folded) {
            // Terlipat: baris isi digabung dengan spasi; baris kosong
            // menjadi pemisah paragraf (newline).
            let out = '';
            let afterBlank = false;
            for (const p of parts) {
              const t = p.trim();
              if (t === '') { out += '\n'; afterBlank = true; continue; }
              if (out !== '' && !afterBlank && !out.endsWith('\n')) out += ' ';
              out += t;
              afterBlank = false;
            }
            val = strip ? out.replace(/\n+$/, '') : (out === '' ? '' : out.replace(/\n*$/, '\n'));
          } else {
            // Literal: baris isi digabung dengan newline.
            val = parts.map((p) => p.trim()).join('\n');
            if (!strip && val !== '') val += '\n';
          }
          data[key] = val;
          i = j - 1;
          continue;
        }
        if (val.startsWith('[') && val.endsWith(']')) {
          try { data[key] = JSON.parse(val); continue; } catch (e) {}
        }
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          try { data[key] = JSON.parse(val); continue; } catch (e) { val = val.slice(1, -1); }
        }
        if (val === 'true') { data[key] = true; continue; }
        if (val === 'false') { data[key] = false; continue; }
        data[key] = val;
      }
      return { data, body: m[2] || '' };
    }


    function sourceBadge(source) {
      if (source === 'jurnalpas') return '<span class="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">JurnalPAS</span>';
      if (source === 'zonapas') return '<span class="ml-2 rounded-full bg-[#0A2540] px-2 py-0.5 text-[11px] font-bold text-white">Artikel ZonaPas</span>';
      return '<span class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Artikel Contoh</span>';
    }


    function catLabel(cat) {
      const color = CATEGORY_COLORS[cat] || '#0A2540';
      return '<span class="text-xs font-bold uppercase tracking-wide" style="color:' + esc(color) + '">' + esc(cat) + '</span>';
    }


    function imageUrl(img) {
      if (!img) return '/images/cover-default.svg';
      if (img.startsWith('http')) return img;
      if (img.startsWith('/')) return SITE_URL + img;
      return SITE_URL + '/' + img;
    }


    // ---------- GitHub API ----------
    async function gh(path, options) {
      const res = await fetch(GH_API + path, {
        ...(options || {}),
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          ...((options && options.headers) || {}),
        },
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) {
        const msg = (data && data.message) || ('GitHub mengembalikan status ' + res.status);
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return data;
    }


    async function ghApi(url, options) {
      const res = await fetch(url, {
        ...(options || {}),
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          ...((options && options.headers) || {}),
        },
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) {
        const msg = (data && data.message) || ('GitHub mengembalikan status ' + res.status);
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return data;
    }


    // ---------- Peran & Worker Redaksi ----------
    // Semua fetch Worker memakai credentials default (cookie same-origin)
    // + header X-GitHub-Token bila login GitHub; POST juga membawa
    // github_token di body sebagai auth alternatif. Token TIDAK PERNAH
    // ditulis ke log/DOM.
    const ROLE_LABEL = { admin: 'Administrator', penyunting: 'Penyunting', penulis: 'Penulis', pembaca: 'Pembaca' };


    async function workerApi(path, options) {
      const opts = options || {};
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['X-GitHub-Token'] = token;
      const res = await fetch(path, {
        ...opts,
        credentials: 'same-origin',
        headers: { ...headers, ...(opts.headers || {}) },
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) {
        const msg = (data && (data.error || data.message)) || ('Worker mengembalikan status ' + res.status);
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return data || {};
    }


    async function workerPost(path, body, opts) {
      const payload = { ...(body || {}) };
      if (token && !(opts && opts.tanpaToken)) payload.github_token = token;
      return workerApi(path, { method: 'POST', body: JSON.stringify(payload) });
    }


    async function workerGet(path) {
      return workerApi(path, { method: 'GET' });
    }


    // Tulis file ke repo lewat Worker — dipakai bila TIDAK ADA token GitHub
    // di browser (Administrator yang masuk lewat Google). Worker menulis
    // dengan GITHUB_TOKEN miliknya; jalurnya dibatasi di server.
    async function githubTulis(path, content, message, sha) {
      const payload = { path, content, message };
      if (sha) payload.sha = sha;
      const res = await workerPost('/redaksi/api/github-tulis', payload);
      if (!res || res.ok !== true) {
        const err = new Error((res && res.error) || 'Worker gagal menulis file.');
        err.status = (res && res.status) || 0;
        throw err;
      }
      return res;
    }


    function labelPeran(r) { return ROLE_LABEL[r] || r || '-'; }


    function terapkanIdentitas(user, sumber) {
      sumberLogin = sumber;
      peran = user.role || null;
      aksesPendamping = peran === 'admin' || user.akses_pendamping === true;
      identitas = {
        nama: user.name || user.login || user.email || (sumber === 'github' ? 'GitHub' : 'Google'),
        peran: user.role || null,
        email: user.email || '',
        login: user.login || '',
        picture: user.picture || '',
      };
    }


    // Boleh membuka Aplikasi Pendukung: Administrator, atau akun Google
    // Penulis/Penyunting yang ditunjuk Administrator.
    function bisaAksesPendamping() {
      return peran === 'admin' || aksesPendamping === true;
    }


    // Terbit langsung (tulis ke GitHub tanpa antrean): Administrator dan
    // Penyunting. Penulis selalu lewat Antrean Persetujuan.
    // Login GitHub SELALU admin (rezie404) — tidak ada peran lain via GitHub.
    function bisaTerbitLangsung() {
      return peran === 'admin' || peran === 'penyunting';
    }


    // Jalur antrean aktif: edit antrean atau Penulis (selalu antrean).
    // Penyunting menulis langsung (bukan antrean), kecuali saat mengedit
    // artikel antrean — jadi tidak masuk di sini.
    function jalurAntreanAktif() {
      if (editingAntrean) return true;
      if (peran === 'penulis') return true;
      return false;
    }


    function terapkanPeran() {
      const btnSave = $('btn-save');
      const btnAntrean = $('btn-antrean');
      if (btnSave) btnSave.classList.toggle('hidden', !bisaTerbitLangsung());
      if (btnAntrean) {
        // admin + penyunting: hanya "Simpan Berita" (terbit langsung);
        // penulis: hanya antrean.
        const tampilAntrean = peran === 'penulis';
        btnAntrean.classList.toggle('hidden', !tampilAntrean);
        btnAntrean.textContent = 'Kirim untuk Persetujuan';
      }
      const antreanSection = $('antrean-section');
      if (antreanSection) antreanSection.classList.toggle('hidden', !(peran === 'admin' || peran === 'penyunting' || peran === 'penulis'));
      const moderasiSection = $('moderasi-section');
      const bisaModerasi = peran === 'admin' || peran === 'penyunting';
      if (moderasiSection) moderasiSection.classList.toggle('hidden', !bisaModerasi);
      const penggunaSection = $('pengguna-section');
      if (penggunaSection) penggunaSection.classList.toggle('hidden', peran !== 'admin');
      // Permohonan Penulis: hanya Administrator yang meninjau.
      const permohonanSection = $('permohonan-section');
      if (permohonanSection) permohonanSection.classList.toggle('hidden', peran !== 'admin');
      // ZonaPasTV: unggah & hapus video hanya Administrator.
      const tvSection = $('zonapastv-section');
      if (tvSection) tvSection.classList.toggle('hidden', peran !== 'admin');
      // CATATAN (Nov 2026): daftar antrean/moderasi/pengguna/permohonan/
      // video TIDAK dimuat dari sini — fungsi-fungsi itu hidup di script
      // modul tiap halaman (bukan global) sehingga typeof di sini selalu
      // 'undefined'. Masing-masing halaman memuat daftarnya lewat hook
      // window.__kelolaSetelahLogin (lihat setLoggedIn).
      renderLists();
      terapkanPenulis();
      // Portal & halaman tulis: kartu/tombol yang tampil mengikuti peran.
      const kartuPengguna = $('kartu-pengguna');
      if (kartuPengguna) kartuPengguna.classList.toggle('hidden', peran !== 'admin');
      const kartuAplikasi = $('kartu-aplikasi-pendukung');
      if (kartuAplikasi) kartuAplikasi.classList.toggle('hidden', !bisaAksesPendamping());
      const tombolAntreanHub = $('tombol-antrean-hub');
      if (tombolAntreanHub) tombolAntreanHub.classList.toggle('hidden', peran === 'penulis');
      const kartuVideo = $('kartu-tulis-video');
      if (kartuVideo) kartuVideo.classList.toggle('hidden', peran !== 'admin');
    }


    // ---------- Status koneksi YouTube (ZonaPasTV) ----------
    let youtubeTerhubung = false;


    // Nama penulis: Penulis/Penyunting memakai nama lengkap dari profil Gmail
    // (tidak bisa diubah); Administrator bebas, default "Rezie". Bila
    // Penyunting sedang mengedit berita milik Penulis lain, nama penulis tetap
    // milik penulis aslinya.
    function terapkanPenulis() {
      const f = $('f-penulis'); if (!f) return;
      const hint = $('f-penulis-hint');
      // Nama penulis dibedakan menurut CARA MASUK, bukan peran: semua yang
      // masuk lewat Google (Penulis, Penyunting, MAUPUN Administrator)
      // memakai nama lengkap Gmail dan tidak bisa mengubahnya; hanya
      // Administrator yang masuk lewat GitHub yang bebas mengganti nama.
      if (sumberLogin !== 'google') {
        f.readOnly = false;
        if (hint) hint.classList.add('hidden');
        return;
      }
      const namaSaya = (identitas && identitas.nama) || '';
      const nilai = (f.value || '').trim();
      const sedangEdit = !!(editing || editingAntrean);
      if (sedangEdit && nilai && nilai !== namaSaya) {
        // sedang mengedit berita orang lain: biarkan nama penulis aslinya
      } else if (namaSaya) {
        f.value = namaSaya;
      }
      f.readOnly = true;
      if (hint) hint.classList.remove('hidden');
    }


    // pesan: error dari Worker (mis. 403 GitHub non-admin) — bila ada,
    // tampilkan apa adanya; bila tidak ada (mis. jalur Google tanpa pesan
    // Worker), biarkan teks baku di panel.
    function tampilkanAksesDitolak(pesan) {
      peran = null; sumberLogin = null; identitas = null;
      loginBox.classList.add('hidden');
      appEl.classList.add('hidden');
      const panel = $('akses-ditolak');
      if (panel) panel.classList.remove('hidden');
      const teks = $('akses-ditolak-pesan');
      if (teks && pesan && String(pesan).indexOf('Worker mengembalikan status') !== 0) {
        teks.textContent = pesan;
      }
    }


    // Ringkasan tidak lagi diisi manual di formulir: diambil otomatis dari
    // awal narasi (teks polos, maks. 160 karakter, dipotong di batas kata).
    // Field ringkasan tetap ditulis ke berkas artikel karena dipakai meta
    // description, JSON-LD, dan RSS — dan skema Astro + validasi Worker
    // mewajibkannya terisi.
    function teksPolosNarasi(teks) {
      return (teks || '')
        .split('\n')
        .filter((b) => !/^\s*!\[.*?\]\(.*?\)\s*$/.test(b))
        .join('\n')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#>|]/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function ringkasanOtomatis(narasi) {
      const teks = teksPolosNarasi(narasi);
      if (teks.length <= 160) return teks;
      const potong = teks.slice(0, 160);
      const spasi = potong.lastIndexOf(' ');
      return (spasi > 100 ? potong.slice(0, spasi) : potong) + '…';
    }


    // Kumpulkan + validasi field formulir (dipakai jalur langsung & antrean).
    function kumpulkanDataForm() {
      const title = normalisasiJudul($('f-judul').value);
      const category = $('f-kategori').value;
      // Kotak narasi hanya berisi narasi: bila ada baris gambar yang ditempel
      // di sana, pindahkan ke foto terpisah (bila belum ada) — total tetap
      // maks. 1 foto, selebihnya ditolak seperti sebelumnya.
      const isi = pisahkanFotoIsi($('f-isi').value);
      const fotoTempel = isi.foto;
      if ((fotoIsi ? 1 : 0) + fotoTempel.length > 1) throw new Error('Foto badan narasi hanya boleh 1 foto. Hapus foto yang ada dulu bila ingin menggantinya.');
      let barisFoto = fotoIsi ? fotoIsi.baris : '';
      if (!barisFoto && fotoTempel.length === 1) { barisFoto = fotoTempel[0]; aturFotoIsi(barisFoto); }
      const body = gabungkanFotoIsi(isi.narasi, barisFoto);
      if (hitungFotoBadan(body) > 1) throw new Error('Foto badan narasi hanya boleh 1 foto. Hapus foto yang lain bila ingin menggantinya.');
      $('f-isi').value = isi.narasi;
      const publishDate = $('f-tanggal').value;
      if (!title || !category || !isi.narasi.trim() || !publishDate) throw new Error('Judul, kategori, tanggal terbit, dan isi berita wajib diisi.');
      const summary = ringkasanOtomatis(isi.narasi);
      const breakingChecked = $('f-breaking').checked;
      let breakingSince = '';
      if (breakingChecked) {
        breakingSince = (editing && editing.breakingSince) || (editingAntrean && editingAntrean.breakingSince) || new Date().toISOString();
      }
      return {
        title, summary, category,
        tags: $('f-tag').value.split(',').map((t) => t.trim()).filter(Boolean),
        author: $('f-penulis').value.trim() || 'Rezie',
        // Foto penulis: dipertahankan dari artikel yang sedang diedit (jalur
        // terbit langsung admin mengedit berita Penulis); bila artikel baru
        // dan masuk lewat Google (peran apa pun) pakai foto profil Google
        // pengguna saat ini; masuk lewat GitHub -> tanpa foto. Jalur antrean
        // dihitung ulang server dari penulis aslinya, jadi nilai ini
        // diabaikan di sana.
        authorImage: (editing && editing.authorImage) || (sumberLogin === 'google' && identitas && identitas.picture ? identitas.picture : ''),
        publish_date: publishDate,
        publishDate,
        imageCaption: $('f-keterangan').value.trim() || 'Dokumentasi kegiatan. (ZonaPas)',
        featured: $('f-featured').checked,
        breaking: breakingChecked,
        breakingSince,
        upt: $('f-upt').value || '',
        body,
      };
    }


    // Jalur antrean: buat dulu via Worker, lalu sampul, lalu gambar isi yang
    // ditahan, lalu kirim bila diminta. TIDAK PERNAH memanggil GitHub langsung.
    async function simpanAntrean(id, kirim) {
      const d = kumpulkanDataForm();
      const adaCoverLama = !!(editingAntrean && editingAntrean.coverAda) || !!(editing && editing.image);
      if (!pendingCover && !adaCoverLama) throw new Error('Foto sampul wajib diunggah.');
      let articleId = id || null;
      if (!articleId) {
        const res = await workerPost('/redaksi/api/berita', d);
        articleId = (res && res.article && res.article.id) || (res && res.id) || (res && res.article_id);
        if (!articleId) throw new Error('Worker tidak mengembalikan id artikel antrean.');
      } else {
        await workerPost('/redaksi/api/berita/' + encodeURIComponent(articleId), d);
      }
      if (pendingCover) {
        await workerPost('/redaksi/api/berita/' + encodeURIComponent(articleId) + '/foto', { dataUrl: pendingCover.dataUrl });
      }
      for (const g of pendingGambarIsi) {
        await workerPost('/redaksi/api/berita/' + encodeURIComponent(articleId) + '/gambar-isi', { dataUrl: g.dataUrl, filename: g.filename });
      }
      if (kirim) {
        await workerPost('/redaksi/api/berita/' + encodeURIComponent(articleId) + '/kirim', {});
      }
      showStatus(kirim ? 'Terkirim ke antrean — menunggu persetujuan.' : 'Berita tersimpan di antrean sebagai draf.', true);
      // hapusDraf/resetForm hidup di modul tulis-artikel, muatAntrean di
      // modul antrean — dipanggil lewat properti window (lihat hook).
      if (typeof window.__kelolaHapusDraf === 'function') window.__kelolaHapusDraf();
      if (typeof window.__kelolaResetForm === 'function') window.__kelolaResetForm();
      const fs = $('form-section');
      if (fs) fs.classList.add('hidden');
      if (typeof window.__kelolaMuatAntrean === 'function') await window.__kelolaMuatAntrean();
    }


    // ---------- Permohonan Penulis (admin) ----------
    function fmtTanggalMs(ms) {
      try { return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
    }


    async function loadArticles() {
      const list = await gh('/contents/src/content/berita?ref=main');
      const files = (Array.isArray(list) ? list : []).filter((f) => f.type === 'file' && f.name.endsWith('.md'));
      const loaded = [];
      for (const f of files) {
        try {
          const file = await gh('/contents/src/content/berita/' + encodeURIComponent(f.name) + '?ref=main');
          const text = b64decodeUnicode(file.content || '');
          const parsed = parseFrontmatter(text);
          const slug = f.name.replace(/\.md$/, '');
          loaded.push({ slug, path: f.path, sha: file.sha, data: parsed.data, body: parsed.body });
        } catch (e) {
          console.warn('Gagal memuat ' + f.name, e);
        }
      }
      loaded.sort((a, b) => String(b.data.publishDate || '').localeCompare(String(a.data.publishDate || '')));
      articles = loaded;
      renderLists();
    }


    // ---------- ZonaPasTV (khusus Administrator) ----------
    // Video YouTube redaksi: data di src/content/video/*.md, video tetap
    // tersimpan di YouTube (tautan watch / youtu.be / Shorts / ID mentah).
    let videos = [];


    // ---------- Render daftar ----------
    function filteredArticles() {
      const qEl = $('q');
      const q = (qEl ? qEl.value : '').toLowerCase().trim();
      const catEl = $('filter-category');
      const cat = catEl ? catEl.value : '';
      return articles.filter((a) => {
        if (cat && a.data.category !== cat) return false;
        if (!q) return true;
        return ((a.data.title || '') + ' ' + (a.data.summary || '') + ' ' + (a.data.category || '')).toLowerCase().includes(q);
      });
    }


    function rowHtml(a) {
      const d = a.data;
      return '<article class="flex gap-3 py-4">' +
        '<a href="/berita/' + esc(a.slug) + '/" target="_blank" rel="noopener" class="shrink-0">' +
        '<img src="' + esc(imageUrl(d.image)) + '" alt="' + esc(d.imageCaption || d.title) + '" loading="lazy" class="h-auto w-28 shrink-0 rounded-lg" onerror="this.onerror=null;this.src=\'/images/cover-default.svg\'" /></a>' +
        '<div class="min-w-0 flex-1"><div>' + catLabel(d.category || '-') + sourceBadge(d.source) + '</div>' +
        '<a href="/berita/' + esc(a.slug) + '/" target="_blank" rel="noopener" class="mt-0.5 block text-sm font-bold leading-snug hover:text-[#92400E] hover:underline">' + esc(d.title || '(tanpa judul)') + '</a>' +
        '<span class="mt-1 block text-xs text-slate-500 dark:text-slate-400">' + esc(formatDateShort(d.publishDate || '')) + (d.upt ? ' · ' + esc(d.upt) : '') + '</span>' +
        '<span data-tayang="' + esc(a.slug) + '" class="mt-1 block text-xs text-slate-500 dark:text-slate-400"></span>' +
        (peran === 'admin'
          ? '<div class="mt-2 flex gap-2">' +
            '<button type="button" data-edit="' + esc(a.slug) + '" class="rounded-md border border-[#0A2540] px-2.5 py-1 text-xs font-bold text-[#0A2540] hover:bg-[#0A2540] hover:text-white dark:text-white">Ubah</button>' +
            '<button type="button" data-delete="' + esc(a.slug) + '" class="rounded-md border border-[#D9232E] px-2.5 py-1 text-xs font-bold text-[#D9232E] hover:bg-[#D9232E] hover:text-white">Hapus</button>' +
            '</div>'
          : '') +
        '</div></article>';
    }


    function renderLists() {
      const list = filteredArticles();
      const countEl = $('count');
      if (countEl) countEl.textContent = list.length + ' dari ' + articles.length + ' berita';
      const featured = list.filter((a) => a.data.featured === true);
      const featEl = $('featured-list');
      if (featEl) {
      if (!featured.length) {
        featEl.innerHTML = '<p class="text-sm text-slate-500">Belum ada artikel yang ditandai sebagai Pilihan Redaksi.</p>';
      } else {
        const hero = featured[0];
        const rest = featured.slice(1);
        let html = '<a href="/berita/' + esc(hero.slug) + '/" target="_blank" rel="noopener" class="group relative block overflow-hidden rounded-2xl">' +
          '<img src="' + esc(imageUrl(hero.data.image)) + '" alt="' + esc(hero.data.imageCaption || hero.data.title) + '" loading="eager" class="h-auto w-full" onerror="this.onerror=null;this.src=\'/images/cover-default.svg\'" />' +
          '<span class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"></span>' +
          '<span class="absolute inset-x-0 bottom-0 p-5"><span class="inline-block rounded bg-[#FACC15] px-2 py-1 text-xs font-bold uppercase tracking-wide text-[#0A2540]">' + esc(hero.data.category || '') + '</span>' + sourceBadge(hero.data.source) +
          '<span class="mt-2 block text-xl font-extrabold leading-tight text-white sm:text-2xl">' + esc(hero.data.title || '') + '</span>' +
          '<span class="mt-2 block text-xs text-slate-300">' + esc(formatDateShort(hero.data.publishDate || '')) + '</span></span></a>';
        if (rest.length) html += '<div class="mt-2 divide-y divide-slate-200 dark:divide-slate-800">' + rest.map(rowHtml).join('') + '</div>';
        featEl.innerHTML = html;
      }
      }
      const latestEl = $('latest-list');
      if (latestEl) latestEl.innerHTML = list.length ? list.map(rowHtml).join('') : '<p class="py-3 text-sm text-slate-500">Tidak ada berita yang cocok dengan pencarian.</p>';
      terapkanStatistik();
      if (!statistikDimuat) muatStatistik();
    }


    // ---------- Statistik tayangan ----------
    let statistikTayang = null;

    let statistikDimuat = false;

    async function muatStatistik() {
      if (statistikDimuat || !peran) return;
      statistikDimuat = true;
      try {
        const res = await workerGet('/redaksi/api/statistik');
        statistikTayang = (res && res.perSlug) || {};
        terapkanStatistik();
        renderTerpopuler((res && res.terpopulerMinggu) || []);
      } catch (err) {
        statistikTayang = {};
      }
    }

    function terapkanStatistik() {
      if (!statistikTayang) return;
      document.querySelectorAll('[data-tayang]').forEach((el) => {
        const s = statistikTayang[el.getAttribute('data-tayang')] || { total: 0, minggu: 0 };
        el.textContent = '👁 ' + s.total + ' kali dibaca' + (s.minggu ? ' · ' + s.minggu + ' minggu ini' : '');
      });
    }

    function renderTerpopuler(daftar) {
      const sec = $('terpopuler-section');
      const el = $('terpopuler-list');
      if (!sec || !el) return;
      if (!daftar.length) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      el.innerHTML = daftar.map((x, i) => {
        const a = articles.find((art) => art.slug === x.slug);
        const judul = a ? a.data.title : x.slug;
        return '<div class="flex items-center gap-3 py-3">' +
          '<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FACC15] text-sm font-black text-[#0A2540]">' + (i + 1) + '</span>' +
          '<div class="min-w-0 flex-1"><a href="/berita/' + esc(x.slug) + '/" target="_blank" rel="noopener" class="block truncate text-sm font-bold hover:underline">' + esc(judul || '(tanpa judul)') + '</a>' +
          '<span class="text-xs text-slate-500 dark:text-slate-400">👁 ' + x.minggu + ' kali dibaca minggu ini · ' + x.total + ' total</span></div></div>';
      }).join('');
    }


    // ---------- Login GitHub (popup + Worker OAuth) ----------
    let popup = null;

    let popupTimer = null;


    // Tombol keluar saat login tinggal di header (posisi tombol Masuk):
    // tautan header bertanda data-header-masuk berubah jadi "Keluar" dan
    // memanggil keluar(); saat keluar, kembali jadi "Masuk" ke /masuk/.
    // Keluar dari Kelola Berita selalu kembali ke menu login (/masuk/),
    // bukan menampilkan kotak login di halaman ini. Akhiri SEMUA sesi:
    // sesi Google (cookie Worker) maupun token GitHub — tanpa ini, sesi
    // Google yang masih hidup di browser yang sama akan dipulihkan
    // otomatis saat halaman dimuat lagi.
    async function keluar(e) {
      if (e) e.preventDefault();
      try { await fetch('/redaksi/logout', { method: 'POST', credentials: 'same-origin' }); } catch (err) {}
      try { sessionStorage.removeItem('zonapas-kelola-token'); } catch (err) {}
      try { localStorage.removeItem('zonapas-aktivitas-terakhir'); } catch (err) {}
      window.location.href = '/masuk/';
    }


    function terapkanTombolHeaderKeluar(aktif) {
      // Hanya di hub /portal/: di sub-halaman, menu profil header
      // (Header.astro) yang mengurus tombol ini — menimpanya akan merusak menu.
      if (window.location.pathname.replace(/\/$/, '') !== '/portal') return;
      document.querySelectorAll('[data-header-masuk]').forEach((el) => {
        if (aktif) {
          el.textContent = 'Keluar';
          el.setAttribute('href', '/portal/');
          el.onclick = keluar;
        } else {
          el.textContent = 'Masuk';
          el.setAttribute('href', '/masuk/');
          el.onclick = null;
        }
      });
    }


    function setLoggedIn(user) {
      // Pembaca TIDAK punya akses Kelola Berita: kembalikan ke beranda.
      if (peran === 'pembaca') {
        showStatus('Akun Anda adalah Pembaca — Kelola Berita hanya untuk Redaksi. Anda dialihkan ke beranda…', false);
        setTimeout(() => { window.location.href = '/'; }, 1500);
        return;
      }
      loginBox.classList.add('hidden');
      const ditolak = $('akses-ditolak');
      if (ditolak) ditolak.classList.add('hidden');
      appEl.classList.remove('hidden');
      terapkanTombolHeaderKeluar(true);
      // Segarkan tombol header (nama + menu profil) seperti halaman lain —
      // di sub-halaman Portal, header diurus Header.astro, bukan di sini.
      // (Di hub /portal/ sendiri hook ini diam, karena tombolnya sengaja
      // jadi "Keluar" lewat terapkanTombolHeaderKeluar di atas.)
      if (typeof window.__segarkanHeaderLogin === 'function') { try { window.__segarkanHeaderLogin(); } catch (e) {} }
      const nama = (identitas && identitas.nama) || user.login || 'GitHub';
      $('user-name').textContent = 'Masuk sebagai ' + nama + (peran ? ' (' + labelPeran(peran) + ')' : '') + ' · ' + (sumberLogin === 'google' ? 'Google' : 'GitHub');
      // Sapaan nama depan di hero hub Portal (/portal/).
      const sapaan = $('portal-nama');
      if (sapaan) sapaan.textContent = String(nama).split(/\s+/)[0] || nama;
      const avatar = $('user-avatar');
      if (user.avatar_url) { avatar.src = user.avatar_url; avatar.alt = user.login || ''; avatar.classList.remove('hidden'); }
      else { avatar.classList.add('hidden'); }
      terapkanPeran();
      // Penjaga halaman: antrean bukan untuk Penulis; halaman pengguna
      // hanya Administrator; aplikasi-pendukung (daftar + semua aplikasi
      // di bawahnya, mis. app-rekap-publish) untuk Administrator dan akun
      // yang ditunjuk; tulis-video hanya Administrator. Dialihkan sebelum
      // daftar dimuat. Halaman aplikasi Rekap menampilkan panel
      // akses-ditolak dulu lalu dialihkan, supaya pesannya terbaca.
      const pathHalaman = window.location.pathname.replace(/\/$/, '');
      if (pathHalaman === '/portal/kelola-berita/antrean' && peran === 'penulis') { window.location.href = '/portal/kelola-berita/'; return; }
      if (pathHalaman === '/portal/kelola-pengguna' && peran !== 'admin') { window.location.href = '/portal/'; return; }
      if (pathHalaman === '/portal/aplikasi-pendukung/app-rekap-publish' && !bisaAksesPendamping()) {
        tampilkanAksesDitolak('Halaman Rekap Laporan Publikasi Harian hanya untuk Administrator dan akun yang ditunjuk Administrator. Anda dialihkan ke Portal…');
        setTimeout(() => { window.location.href = '/portal/'; }, 2500);
        return;
      }
      if ((pathHalaman === '/portal/aplikasi-pendukung' || pathHalaman.indexOf('/portal/aplikasi-pendukung/') === 0) && !bisaAksesPendamping()) { window.location.href = '/portal/'; return; }
      if (pathHalaman === '/portal/kelola-berita/tulis-video' && peran !== 'admin') { window.location.href = '/portal/kelola-berita/'; return; }
      // Hook halaman (script modul) bisa belum jalan saat sesi cookie
      // terverifikasi lebih dulu — tunda sampai DOMContentLoaded bila
      // dokumen masih dimuat (script modul selalu jalan sebelum event itu).
      const jalankanHook = () => { if (typeof window.__kelolaSetelahLogin === 'function') { try { window.__kelolaSetelahLogin(); } catch (e) { console.warn('Hook setelah login gagal.', e); } } };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', jalankanHook, { once: true });
      else jalankanHook();
      showStatus('Masuk sebagai ' + nama + '. Memuat daftar berita…', true);
      loadArticles().then(() => showStatus('Masuk sebagai ' + nama + '.', true)).catch((err) => showStatus('Gagal memuat daftar berita: ' + err.message, false));
      if (window.location.hash === '#antrean') {
        setTimeout(() => { const s = $('antrean-section'); if (s) s.scrollIntoView({ behavior: 'smooth' }); }, 600);
      }
    }


    function setLoggedOut(msg) {
      token = null;
      peran = null; aksesPendamping = false; sumberLogin = null; identitas = null; antrean = []; editingAntrean = null; pendingGambarIsi = [];
      try { sessionStorage.removeItem('zonapas-kelola-token'); } catch (e) {}
      appEl.classList.add('hidden');
      const ditolak = $('akses-ditolak');
      if (ditolak) ditolak.classList.add('hidden');
      loginBox.classList.remove('hidden');
      terapkanTombolHeaderKeluar(false);
      const fs = $('form-section');
      if (fs) fs.classList.add('hidden');
      if (msg) showStatus(msg, false);
    }


    window.addEventListener('message', async (event) => {
      if (event.origin !== OAUTH_ORIGIN) return;
      if (event.data === 'authorizing:github') {
        // Echo ke pengirim (popup, atau tab baru bila login dibuka lewat
        // tautan fallback). Worker menunggu echo ini; tanpa echo, Worker
        // tetap lanjut setelah 3 detik, tapi echo membuat alur langsung.
        const target = (popup && !popup.closed) ? popup : (event.source || null);
        if (target) target.postMessage('authorizing:github', OAUTH_ORIGIN);
        return;
      }
      if (typeof event.data === 'string' && event.data.indexOf('authorization:github:success:') === 0) {
        try {
          const payload = JSON.parse(event.data.slice('authorization:github:success:'.length));
          token = payload.token;
          try { sessionStorage.setItem('zonapas-kelola-token', token); } catch (e) {}
          if (popupTimer) { clearInterval(popupTimer); popupTimer = null; }
          if (popup && !popup.closed) popup.close();
          // Selesaikan peran lewat Worker SEBELUM menampilkan aplikasi,
          // supaya tombol/seksi sesuai peran langsung tampil (tanpa ini
          // peran null dan halaman tampak kosong sampai dimuat ulang).
          const me = await workerPost('/redaksi/api/me', {});
          if (!me || !me.ok || !me.user || !me.user.role) throw Object.assign(new Error('Peran tidak ditemukan.'), { status: 401 });
          terapkanIdentitas(me.user, 'github');
          // Tukarkan token jadi sesi cookie supaya login langsung bertahan
          // di semua tab (tanpa menunggu muat ulang halaman).
          try { await workerPost('/redaksi/api/github-sesi', {}); } catch (e) {}
          const user = await ghApi('https://api.github.com/user');
          setLoggedIn(user);
        } catch (err) {
          if (err && err.status === 403) { tampilkanAksesDitolak(err.message); return; }
          showStatus('Login gagal: ' + err.message, false);
        }
      }
    });


    const btnLogin = $('btn-login');

    if (btnLogin) btnLogin.addEventListener('click', () => {
      // Status tombol yang terlihat: klik harus selalu memberi respon.
      const labelHtml = btnLogin.innerHTML;
      btnLogin.disabled = true;
      btnLogin.textContent = 'Menghubungkan…';
      const restoreBtn = () => { btnLogin.disabled = false; btnLogin.innerHTML = labelHtml; };
      if (popupTimer) { clearInterval(popupTimer); popupTimer = null; }
      popup = window.open(OAUTH_AUTH_URL, 'zonapas-github-login', 'width=640,height=720,popup=1');
      if (!popup) {
        restoreBtn();
        const fb = $('login-fallback');
        if (fb) fb.classList.remove('hidden');
        showStatus('Popup diblokir browser. Izinkan popup untuk situs ini lalu coba lagi, atau buka login GitHub di tab baru lewat tautan di bawah tombol.', false);
        return;
      }
      showStatus('Jendela login GitHub dibuka. Selesaikan otorisasi di jendela tersebut…', true);
      if (popupTimer) clearInterval(popupTimer);
      popupTimer = setInterval(() => {
        if (popup && popup.closed) {
          clearInterval(popupTimer);
          popupTimer = null;
          if (!token) {
            restoreBtn();
            showStatus('Jendela login ditutup sebelum selesai. Klik "Masuk dengan GitHub" untuk mencoba lagi.', false);
          }
        }
      }, 500);
    });


    // ---------- Gambar di badan narasi ----------
    // Foto dipilih -> di-resize seperti sampul -> langsung diunggah ke
    // public/images -> sintaks Markdown ditambahkan di AKHIR narasi (1 baris
    // kosong di antaranya). Hanya boleh 1 foto badan narasi per artikel,
    // juga saat Ubah (isi narasi yang sudah ada tetap utuh). Bila penulis
    // menutup formulir tanpa menyimpan, foto yang sudah terunggah tetap ada
    // di repo (sama seperti media di Decap CMS) — hapus manual bila tidak
    // terpakai.
    function stampId() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + String(d.getMilliseconds()).padStart(3, '0') + String(Math.floor(Math.random() * 900) + 100);
    }


    function cleanAlt(name) {
      const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      return base || 'Foto kegiatan';
    }


    // Foto badan narasi SELALU di akhir narasi (1 baris kosong di antara
    // narasi dan foto) dan posisinya tidak bisa diubah siapa pun — Penulis,
    // Penyunting, maupun Administrator. Fungsi ini memindahkan semua baris
    // gambar Markdown ke akhir isi.
    function normalisasiIsi(teks) {
      const baris = String(teks || '').replace(/\r\n?/g, '\n').split('\n');
      const gambar = [];
      const narasi = [];
      for (const b of baris) {
        if (/^\s*!\[.*\]\(.*\)\s*$/.test(b)) gambar.push(b.trim());
        else narasi.push(b);
      }
      if (!gambar.length) return String(teks || '').replace(/\r\n?/g, '\n');
      // Rapatkan baris kosong berlebih (mis. bekas baris gambar yang dicabut)
      // supaya antarparagraf tetap 1 baris kosong.
      const rapat = [];
      for (const b of narasi) {
        if (b.trim() === '' && rapat.length && rapat[rapat.length - 1].trim() === '') continue;
        rapat.push(b);
      }
      while (rapat.length && rapat[rapat.length - 1].trim() === '') rapat.pop();
      while (rapat.length && rapat[0].trim() === '') rapat.shift();
      if (!rapat.length) return gambar.join('\n');
      return rapat.join('\n') + '\n\n' + gambar.join('\n');
    }


    // Foto badan narasi hanya boleh 1 foto.
    function hitungFotoBadan(teks) {
      return (String(teks || '').match(/^\s*!\[.*\]\(.*\)\s*$/gm) || []).length;
    }


    // Kotak narasi hanya berisi narasi: alamat gambar TIDAK tampil di sana.
    // Foto badan narasi disimpan terpisah (fotoIsi) dan digabung kembali ke
    // akhir isi saat simpan/pratinjau, supaya format tersimpan tidak berubah
    // (server tetap menerima isi dengan 1 baris gambar di akhir).
    function pisahkanFotoIsi(teks) {
      const t = normalisasiIsi(teks);
      const foto = [];
      const narasi = [];
      for (const b of t.split('\n')) {
        if (/^\s*!\[.*\]\(.*\)\s*$/.test(b)) foto.push(b.trim());
        else narasi.push(b);
      }
      return { narasi: narasi.join('\n').trim(), foto };
    }

    function gabungkanFotoIsi(narasi, barisFoto) {
      const n = String(narasi || '').trim();
      if (!barisFoto) return n;
      return n ? n + '\n\n' + barisFoto : barisFoto;
    }

    function namaDariBarisFoto(baris) {
      const m = String(baris || '').match(/\]\(([^)]+)\)/);
      return m ? m[1] : '';
    }

    function tampilkanFotoIsi() {
      const wadah = $('f-isi-foto');
      if (!fotoIsi) {
        wadah.classList.add('hidden');
        wadah.classList.remove('flex');
        $('f-isi-foto-img').src = '';
        $('f-isi-foto-nama').textContent = '';
        return;
      }
      const nama = fotoIsi.nama || namaDariBarisFoto(fotoIsi.baris);
      $('f-isi-foto-img').src = previewImgMap[nama] || nama;
      $('f-isi-foto-nama').textContent = nama;
      wadah.classList.remove('hidden');
      wadah.classList.add('flex');
    }

    function aturFotoIsi(baris, nama) {
      fotoIsi = baris ? { baris, nama: nama || namaDariBarisFoto(baris) } : null;
      tampilkanFotoIsi();
    }


    // Judul artikel: setiap kata diawali huruf kapital lalu huruf kecil.
    // Singkatan resmi tetap kapital semua (UPT, TPP, IIA, ...). Logika SAMA
    // dengan normalisasiJudul di worker.js (server menegakkannya saat simpan).
    const AKRONIM_JUDUL = ['UPT', 'LPP', 'WBP', 'LPKA', 'TPP', 'KPLP', 'IIA', 'IIB', 'BIMTEK', 'FGD', 'KPPN', 'PKBI'];

    function normalisasiJudul(judul) {
      return String(judul || '').trim().replace(/\s+/g, ' ').split(' ').map((kata) => {
        const huruf = kata.replace(/[^A-Za-z]/g, '');
        if (!huruf) return kata;
        if (AKRONIM_JUDUL.includes(huruf.toUpperCase())) return kata.replace(huruf, huruf.toUpperCase());
        const m = kata.match(/^([^A-Za-z]*)([A-Za-z])([\s\S]*)$/);
        if (!m) return kata;
        return m[1] + m[2].toUpperCase() + m[3].toLowerCase();
      }).join(' ');
    }


    // ---------- Pratinjau live isi berita ----------
    // Me-render Markdown narasi menjadi HTML (paragraf, gambar, bold,
    // tautan) di kotak pratinjau di bawah textarea — hanya untuk dilihat,
    // yang disimpan tetap Markdown di textarea. Gambar yang baru diunggah
    // di sesi ini ditampilkan dari dataUrl lokal (previewImgMap) supaya
    // terlihat sebelum rebuild situs.
    const previewImgMap = {};

    function escHtmlPrev(s) {
      return String(s ?? '').split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
    }

    function formatBarisPrev(t) {
      let e = escHtmlPrev(t);
      e = e.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
        const u = previewImgMap[src] || src;
        return '<img src="' + u + '" alt="' + alt + '" loading="lazy">';
      });
      e = e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      e = e.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return e;
    }

    // Me-render Markdown narasi menjadi HTML (paragraf, gambar, bold,
    // tautan). Dipakai modal pratinjau tampilan terbit.
    function isiMarkdownToHtml(md) {
      const lines = String(md || '').split('\n');
      const out = [];
      let buf = [];
      const flush = () => {
        if (!buf.length) return;
        out.push('<p>' + formatBarisPrev(buf.join(' ')) + '</p>');
        buf = [];
      };
      for (const ln of lines) {
        if (ln.trim() === '') flush();
        else buf.push(ln.trim());
      }
      flush();
      return out.join('');
    }

    // ---------- Pratinjau tampilan terbit (modal mata) ----------
    // Merender artikel persis seperti halaman terbit (src/pages/berita/[...slug].astro):
    // breadcrumb, judul, ringkasan (hanya bila tidak menduplikasi awal isi),
    // lencana kategori/UPT/sumber, meta penulis-tanggal-waktu baca, tombol
    // berbagi (visual saja), foto sampul, badan narasi, Baca Juga + Berita
    // Terkait, tag, dan kotak penulis. Hanya membaca nilai formulir saat ini
    // — tidak menyimpan apa pun. Lencana dan tautan dibuat sebagai span
    // (bukan <a>) supaya klik di dalam modal tidak memindahkan halaman dan
    // formulir yang belum disimpan tidak hilang.
    function formatDateLong(iso) {
      const d = new Date((iso || '') + 'T00:00:00');
      if (isNaN(d)) return iso || '';
      return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    }


    function readingMinutesOf(body) {
      const words = String(body || '').split(/\s+/).filter(Boolean).length;
      return Math.max(1, Math.round(words / 200));
    }


    function shareButtonsVisual() {
      return '<div class="flex flex-wrap items-center gap-2" aria-label="Bagikan artikel">' +
        '<span class="mr-1 text-sm font-bold text-slate-600 dark:text-slate-300">Bagikan:</span>' +
        '<span class="rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white">WhatsApp</span>' +
        '<span class="rounded-full bg-[#1877F2] px-3 py-1.5 text-xs font-bold text-white">Facebook</span>' +
        '<span class="rounded-full bg-black px-3 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-black">X</span>' +
        '<span class="rounded-full bg-[#229ED9] px-3 py-1.5 text-xs font-bold text-white">Telegram</span>' +
        '<span class="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200">Salin Link</span></div>';
    }


    // Artikel terkait: kategori sama dulu (+2), lalu tag yang sama (+1 tiap tag).
    function artikelTerkait(kategori, tag, kecualiSlug) {
      return articles.filter((a) => a.slug !== kecualiSlug).map((a) => {
        let score = 0;
        if (a.data.category === kategori) score += 2;
        score += (a.data.tags || []).filter((t) => tag.includes(t)).length;
        return { a, score };
      }).filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score || String(y.a.data.publishDate || '').localeCompare(String(x.a.data.publishDate || '')))
        .slice(0, 3).map((x) => x.a);
    }


    function artikelLainTerbaru(kecualiSlug) {
      const lain = articles.filter((a) => a.slug !== kecualiSlug)
        .sort((x, y) => String(y.data.publishDate || '').localeCompare(String(x.data.publishDate || '')));
      return lain[0] || null;
    }


    function kartuTerkaitHtml(a) {
      const d = a.data;
      const color = CATEGORY_COLORS[d.category] || '#0A2540';
      return '<div class="block overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">' +
        '<img src="' + esc(imageUrl(d.image)) + '" alt="' + esc(d.imageCaption || d.title || '') + '" loading="lazy" class="h-auto w-full" onerror="this.onerror=null;this.src=\'/images/cover-default.svg\'" />' +
        '<span class="block p-4">' +
        '<span class="text-xs font-bold uppercase tracking-wide" style="color:' + esc(color) + '">' + esc(d.category || '') + '</span>' +
        '<span class="mt-1 block text-base font-bold leading-snug">' + esc(d.title || '') + '</span>' +
        '<span class="mt-2 line-clamp-2 block text-sm text-slate-600 dark:text-slate-400">' + esc(d.summary || '') + '</span>' +
        '<span class="mt-3 block text-xs text-slate-500 dark:text-slate-400">' + esc(formatDateShort(d.publishDate || '')) + '</span></span></div>';
    }


    // Ikon penulis pratinjau: foto profil Google bila ada, menutupi lingkaran
    // huruf awal; bila foto gagal dimuat, gambar dihapus dan huruf awal yang
    // tampil (sama seperti halaman artikel terbit).
    function fotoPenulisHtml(nama, foto, besar) {
      const cls = besar
        ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0A2540] text-lg font-black text-white'
        : 'flex h-9 w-9 items-center justify-center rounded-full bg-[#0A2540] text-sm font-black text-white';
      const awal = esc((nama || '?').charAt(0));
      if (!foto) return '<span class="' + cls + '">' + awal + '</span>';
      return '<span class="relative ' + cls + ' overflow-hidden">' + awal + '<img src="' + esc(foto) + '" alt="' + esc(nama || '') + '" class="absolute inset-0 h-full w-full object-cover" loading="lazy" onerror="this.remove()" /></span>';
    }


    function bangunPratinjauTerbit(d) {
      const catColor = CATEGORY_COLORS[d.category] || '#0A2540';
      const authorInfo = AUTHORS_MAP[d.author] || { role: 'Kontributor', bio: '' };
      const bodyPlain = String(d.body || '').replace(/\s+/g, ' ').trim();
      const summaryPlain = String(d.summary || '').replace(/\s+/g, ' ').trim();
      const leadDuplicatesBody = summaryPlain.length > 0 && bodyPlain.startsWith(summaryPlain.slice(0, 100));
      const terkait = artikelTerkait(d.category, d.tags || [], d.kecualiSlug);
      const bacaJuga = terkait[0] || artikelLainTerbaru(d.kecualiSlug);
      const cover = d.image || '/images/cover-default.svg';
      let h = '<article class="mx-auto max-w-[1200px] px-4 pb-10 pt-6"><div class="mx-auto max-w-[760px]">';
      h += '<nav class="text-sm text-slate-500 dark:text-slate-400"><span>Beranda</span><span class="mx-1">/</span><span>' + esc(d.category || '') + '</span><span class="mx-1">/</span><span class="font-semibold text-slate-800 dark:text-slate-200">' + esc(d.title || '(tanpa judul)') + '</span></nav>';
      h += '<h1 class="mt-4 text-3xl font-black leading-tight sm:text-4xl">' + esc(d.title || '(tanpa judul)') + '</h1>';
      if (!leadDuplicatesBody && summaryPlain) {
        h += '<p class="mt-3 text-lg leading-relaxed text-slate-600 dark:text-slate-300">' + esc(d.summary) + '</p>';
      }
      h += '<div class="mt-4 flex flex-wrap items-center gap-2">';
      if (d.category) h += '<span class="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-white" style="background:' + esc(catColor) + '">' + esc(d.category) + '</span>';
      if (d.upt) h += '<span class="rounded-full border border-[#0A2540] px-3 py-1 text-xs font-bold text-[#0A2540] dark:border-slate-400 dark:text-slate-200">' + esc(d.upt) + '</span>';
      h += '<span class="rounded-full bg-[#0A2540] px-3 py-1 text-xs font-bold text-white">Artikel ZonaPas</span></div>';
      h += '<div class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-slate-200 py-3 text-sm dark:border-slate-800">';
      h += fotoPenulisHtml(d.author, d.authorImage, false);
      h += '<span><span class="block font-bold">' + esc(d.author || 'Rezie') + '</span><span class="block text-xs text-slate-500 dark:text-slate-400">' + esc(authorInfo.role || '') + '</span></span>';
      h += '<span class="text-slate-300 dark:text-slate-600">|</span>';
      h += '<span class="text-slate-600 dark:text-slate-300">' + esc(formatDateLong(d.publishDate)) + '</span>';
      h += '<span class="text-slate-300 dark:text-slate-600">|</span>';
      h += '<span class="text-slate-600 dark:text-slate-300">' + readingMinutesOf(d.body) + ' menit baca</span></div>';
      h += '<div class="mt-4">' + shareButtonsVisual() + '</div>';
      h += '<figure class="mt-5"><img src="' + esc(cover) + '" alt="' + esc(d.imageCaption || '') + '" class="h-auto w-full rounded-xl" onerror="this.onerror=null;this.src=\'/images/cover-default.svg\'" />';
      h += '<figcaption class="mt-2 text-sm italic text-slate-500 dark:text-slate-400">' + esc(d.imageCaption || '') + '</figcaption></figure>';
      h += '<div class="article-body mt-6 text-[17px] text-slate-800 dark:text-slate-200">' + (isiMarkdownToHtml(d.body) || '<p class="text-slate-400">Isi berita masih kosong.</p>') + '</div>';
      if (bacaJuga) {
        h += '<aside class="my-6 rounded-xl border-l-4 border-[#D9232E] bg-slate-50 p-4 dark:bg-slate-900" aria-label="Baca juga"><p class="text-xs font-black uppercase tracking-wider text-[#D9232E]">Baca Juga</p><span class="mt-1 block text-lg font-bold leading-snug">' + esc(bacaJuga.data.title || '') + '</span></aside>';
      }
      h += '<div class="mt-8 border-t border-slate-200 pt-5 dark:border-slate-800"><div class="flex flex-wrap items-center gap-2"><span class="text-sm font-bold">Tag:</span>';
      (d.tags || []).forEach((tag) => {
        h += '<span class="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">#' + esc(tag) + '</span>';
      });
      h += '</div><div class="mt-4">' + shareButtonsVisual() + '</div></div>';
      h += '<div class="mt-8 flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">';
      h += fotoPenulisHtml(d.author, d.authorImage, true);
      h += '<div><p class="font-bold">' + esc(d.author || 'Rezie') + '</p><p class="text-sm text-slate-500 dark:text-slate-400">' + esc(authorInfo.role || '') + '</p>';
      if (authorInfo.bio) h += '<p class="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">' + esc(authorInfo.bio) + '</p>';
      h += '</div></div></div>';
      if (terkait.length) {
        h += '<section class="mx-auto mt-10 max-w-[1200px]" aria-label="Berita terkait"><h2 class="mb-4 border-b-2 border-[#0A2540] pb-2 text-xl font-black uppercase dark:border-white">Berita Terkait</h2><div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">' + terkait.map(kartuTerkaitHtml).join('') + '</div></section>';
      }
      h += '</article>';
      return h;
    }


    function isiStatus(msg, isError) {
      const el = $('f-isi-status');
      el.textContent = msg;
      el.classList.remove('hidden');
      el.style.color = isError ? '#B91C1C' : '';
    }


    async function uploadBodyImage(file) {
      const dataUrl = await resizeImage(file);
      const slug = editing ? editing.slug : slugify($('f-judul').value.trim() || 'berita');
      const filename = 'isi-' + slug + '-' + stampId() + '.jpg';
      const base64 = dataUrl.split(',')[1];
      if (token) {
        await gh('/contents/public/images/' + encodeURIComponent(filename), {
          method: 'PUT',
          body: JSON.stringify({ message: 'Unggah gambar isi: ' + filename, content: base64, branch: 'main' }),
        });
      } else {
        // Masuk lewat Google: tidak ada token GitHub di browser — tulis lewat Worker.
        await githubTulis('public/images/' + filename, base64, 'Unggah gambar isi: ' + filename);
      }
      previewImgMap['/images/' + filename] = dataUrl;
      return '/images/' + filename;
    }


    function resizeImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const dataUrl = c.toDataURL('image/jpeg', 0.85);
          const bytes = Math.round(dataUrl.length * 0.75);
          if (bytes > MAX_COVER_BYTES) return reject(new Error('Foto hasil akhir lebih dari 2 MB (' + Math.round(bytes / 1024 / 1024 * 10) / 10 + ' MB). Pilih foto lain yang lebih kecil.'));
          resolve(dataUrl);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File foto tidak bisa dibaca.')); };
        img.src = url;
      });
    }


    function buildMarkdown(d) {
      const q = (v) => JSON.stringify(String(v ?? ''));
      const tags = (d.tags || []).map((t) => JSON.stringify(t)).join(', ');
      const lines = [
        '---',
        'title: ' + q(d.title),
        'summary: ' + q(d.summary),
        'category: ' + q(d.category),
        'tags: [' + tags + ']',
        'author: ' + q(d.author),
        'publishDate: ' + d.publishDate,
        'image: ' + q(d.image),
        'imageCaption: ' + q(d.imageCaption),
        'featured: ' + (d.featured ? 'true' : 'false'),
        'breaking: ' + (d.breaking ? 'true' : 'false'),
      ];
      // Waktu masuk pita Breaking News (ISO): hanya ditulis bila breaking
      // aktif; dipakai aturan kedaluwarsa 2 hari (lihat index.astro).
      if (d.breaking && d.breakingSince) lines.push('breakingSince: ' + q(d.breakingSince));
      if (d.upt) lines.push('upt: ' + q(d.upt));
      // Foto profil penulis (Google) — hanya untuk Penulis/Penyunting;
      // artikel Administrator tidak membawa field ini.
      if (d.authorImage) lines.push('authorImage: ' + q(d.authorImage));
      lines.push('source: "zonapas"', '---', '', d.body.trim() + '', '');
      return lines.join('\n');
    }


    async function uploadCover(slug) {
      if (!pendingCover) return null;
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
      const filename = 'cover-' + slug + '-' + stamp + '.jpg';
      const base64 = pendingCover.dataUrl.split(',')[1];
      if (token) {
        await gh('/contents/public/images/' + encodeURIComponent(filename), {
          method: 'PUT',
          body: JSON.stringify({ message: 'Unggah foto sampul: ' + filename, content: base64, branch: 'main' }),
        });
      } else {
        // Masuk lewat Google: tidak ada token GitHub di browser — tulis lewat Worker.
        await githubTulis('public/images/' + filename, base64, 'Unggah foto sampul: ' + filename);
      }
      return '/images/' + filename;
    }

    on('btn-akses-keluar', 'click', () => {
      try { sessionStorage.removeItem('zonapas-kelola-token'); } catch (e) {}
      token = null;
      const p = $('akses-ditolak');
      if (p) p.classList.add('hidden');
      loginBox.classList.remove('hidden');
    });


    // ---------- Pulihkan sesi: cookie dulu, lalu token GitHub ----------
    // Sesi cookie (Google maupun GitHub yang sudah ditukar) berlaku di
    // semua tab dan tidak hilang saat pindah laman — inilah yang membuat
    // login bertahan. Token GitHub di tab ini hanya jadi cadangan: bila
    // cookie belum ada, token ditukar jadi cookie dulu (github-sesi).
    async function cobaMasukCookie() {
      try {
        const me = await workerPost('/redaksi/api/me', {}, { tanpaToken: true });
        if (me && me.ok && me.user && me.user.role) {
          terapkanIdentitas(me.user, me.user.source === 'github' ? 'github' : 'google');
          let ghUser = null;
          if (token) { try { ghUser = await ghApi('https://api.github.com/user'); } catch (e) {} }
          setLoggedIn(ghUser || { login: me.user.name || me.user.email || 'Google' });
          return true;
        }
      } catch (err) {
        if (err && err.status === 403) { tampilkanAksesDitolak(err.message); return true; }
      }
      return false;
    }

    (async () => {
      const tgl = $('f-tanggal');
      if (tgl) tgl.value = todayISO();
      if (await cobaMasukCookie()) return;
      if (token) {
        // Tukarkan token GitHub jadi sesi cookie supaya login bertahan di
        // semua tab; bila penukaran gagal, token tetap bisa dipakai
        // langsung di tab ini.
        try { await workerPost('/redaksi/api/github-sesi', {}); } catch (e) {}
        if (await cobaMasukCookie()) return;
        try {
          const me = await workerPost('/redaksi/api/me', {});
          if (!me || !me.ok || !me.user || !me.user.role) throw Object.assign(new Error('Peran tidak ditemukan.'), { status: 401 });
          terapkanIdentitas(me.user, 'github');
          let ghUser = null;
          try { ghUser = await ghApi('https://api.github.com/user'); } catch (e) {}
          setLoggedIn(ghUser || { login: me.user.login || me.user.name || 'GitHub' });
        } catch (err) {
          if (err && err.status === 403) { tampilkanAksesDitolak(err.message); return; }
          if (err && err.status === 401) { setLoggedOut('Sesi GitHub sudah berakhir. Silakan masuk lagi.'); return; }
          // Worker tidak bisa dihubungi / peran tidak bisa dipastikan:
          // JANGAN beri akses dari klien tanpa sandaran server. Tampilkan
          // panel login dengan pesan galat (token tetap tersimpan — muat
          // ulang halaman akan mencoba lagi).
          appEl.classList.add('hidden');
          const fsErr = $('form-section');
          if (fsErr) fsErr.classList.add('hidden');
          loginBox.classList.remove('hidden');
          showStatus('Server peran (Worker Redaksi) tidak bisa dihubungi. Periksa koneksi lalu muat ulang halaman untuk mencoba lagi.', false);
        }
        return;
      }
      // Belum login — biarkan panel login tampil.
    })();

    on('btn-keluar', 'click', keluar);

