# ZonaPas — Portal Berita Pemasyarakatan

Portal berita pemasyarakatan — **zonapas.web.id**.
Tagline: **Melihat Pemasyarakatan Lebih Dekat**.
Dibangun dengan **Astro 5 + Tailwind CSS 4** (static export), di-host di **Cloudflare Pages**.

ZonaPas meliput pembinaan, pengamanan, pelayanan, integrasi dan remisi, serta
kegiatan Unit Pelaksana Teknis (UPT) Pemasyarakatan di lingkungan Kantor Wilayah
Direktorat Jenderal Pemasyarakatan Bengkulu.

> **PENTING:** 24 dari 30 artikel di `src/content/berita/` adalah **contoh/placeholder**
> yang ditulis untuk keperluan demo dan struktur (ditandai `source: "contoh"`).
> 6 artikel lainnya adalah artikel asli dari **JurnalPAS**
> (`jurnalpas.wordpress.com`, ditandai `source: "jurnalpas"` beserta tautan
> aslinya). Ganti artikel contoh dengan foto dan narasi Anda sendiri sebelum
> situs diterbitkan. Foto sampul artikel contoh berupa ilustrasi SVG orisinal
> (gradien), bukan foto asli.

## Kategori (8)

Pembinaan, Pengamanan, Pelayanan, Integrasi & Remisi, Kepegawaian, Sinergi,
Kegiatan UPT, Profil UPT. Daftar kategori ada di `src/data/site.ts`.

## UPT (9)

Kanwil Ditjenpas Bengkulu, Lapas Kelas IIA Bengkulu, Lapas Kelas IIA Curup,
Lapas Kelas IIB Arga Makmur, Lapas Perempuan Kelas IIB Bengkulu,
LPKA Kelas II Bengkulu, Rutan Kelas IIB Bengkulu, Rutan Kelas IIB Manna,
Bapas Kelas I Bengkulu. Daftar UPT ada di `src/data/upt.ts`; setiap artikel
ditandai UPT-nya lewat field `upt`, dan ada halaman daftar UPT (`/upt/`)
serta halaman per UPT (`/upt/<slug>/`).

## Artikel dari JurnalPAS

6 artikel asli diambil dari `jurnalpas.wordpress.com` lewat WP REST API
(`https://public-api.wordpress.com/wp/v2/sites/jurnalpas.wordpress.com/posts`):
sidang TPP di Rutan Bengkulu, pertemuan bersama Wamen Imipas, evaluasi dan
penguatan tugas pengamanan (Pamintel), apel pagi Kabagtum tentang disiplin,
rakor Kasatker/Ka-UPT, dan pisah sambut Kakanwil (Aris Munandar ke Masjuno).
Judul, isi lengkap, tanggal, dan foto aslinya diambil apa adanya; setiap
artikel menampilkan kotak atribusi **"Sumber: JurnalPAS"** dengan tautan ke
artikel asli. Foto-foto asli diunduh ke `public/images/jurnalpas-*.jpg`.

Untuk menambah artikel JurnalPAS baru, buat file Markdown seperti artikel
lainnya dengan `source: "jurnalpas"` dan `sourceUrl` berisi tautan artikel
asli di JurnalPAS.

## Logo

Logo lingkaran "ZonaPas" (perisai, mercusuar, garis sirkuit) adalah logo
milik pengelola, dipotong dari file asli `logo-zonapas-asli.jpg`
(`public/images/`). Hasil potongan lingkaran dipakai sebagai favicon
(`public/favicon.png`) dan logo header (`public/images/logo-zonapas.png`).
Jangan menggambar ulang logo dari nol dan jangan memakai logo lain.

## Menjalankan lokal

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # hasil statis di dist/
npm run preview  # pratinjau hasil build
```

## Cara menambah / mengganti artikel

1. Buat file baru di `src/content/berita/` dengan nama `<slug>.md` (huruf kecil, tanda hubung).
2. Isi frontmatter di bagian atas file, lalu tulis isi artikel dalam Markdown di bawahnya.

```markdown
---
title: "Judul Berita"
summary: "Ringkasan 1-2 kalimat yang tampil di kartu dan hasil pencarian."
category: "Pembinaan"
tags: ["tag-satu", "tag-dua"]
author: "Andi Pratama"
publishDate: 2026-11-04
image: "/images/nama-foto.jpg"
imageCaption: "Keterangan foto. (ZonaPas)"
featured: false
breaking: false
upt: "Lapas Kelas IIA Bengkulu"
source: "contoh"
---
```

Keterangan field:

| Field | Keterangan |
|---|---|
| `title` | Judul artikel (tampil di H1, kartu, SEO). |
| `summary` | Ringkasan 1–2 kalimat. |
| `category` | Salah satu dari 8 kategori Pemasyarakatan (lihat di atas). |
| `tags` | Daftar tag (dipakai halaman tag & pencarian). |
| `author` | Nama penulis. Daftar penulis ada di `src/data/authors.ts` (tambah di sana untuk bio & jabatan). |
| `publishDate` | Tanggal terbit `YYYY-MM-DD`. |
| `image` | Path foto sampul, relatif dari `public/` (mis. `/images/foto.jpg`). |
| `imageCaption` | Keterangan foto di bawah foto utama. |
| `featured` | `true` = artikel tampil sebagai headline utama di beranda. |
| `breaking` | `true` = artikel tampil di ticker "Berita Terkini". |
| `upt` | Nama UPT terkait (salah satu dari 9 UPT di `src/data/upt.ts`). |
| `source` | `"jurnalpas"` untuk artikel asli JurnalPAS, `"contoh"` untuk artikel contoh. |
| `sourceUrl` | Tautan artikel asli (wajib diisi bila `source: "jurnalpas"`). |

## Cara mengganti foto

1. Simpan file foto (JPG/PNG/WebP) ke folder `public/images/`.
2. Ubah field `image` di frontmatter artikel ke path baru, mis. `/images/foto-kegiatan.jpg`, dan sesuaikan `imageCaption`.
3. Foto sampul SVG bawaan bisa dihapus setelah diganti foto asli. Generator cover SVG ada di `scripts/generate-covers.mjs` (hanya untuk contoh).

## Struktur proyek

```
src/
  content/berita/*.md     Artikel (Markdown + frontmatter)
  content.config.ts       Skema validasi koleksi berita
  data/site.ts            Daftar kategori, warna, dan info situs
  data/authors.ts         Daftar penulis
  data/upt.ts             Daftar 9 UPT Bengkulu
  layouts/BaseLayout.astro  Kerangka halaman + SEO (meta, OG, JSON-LD)
  components/             Header, Footer, NewsCard, Ticker, ShareButtons
  pages/
    index.astro           Beranda
    [category].astro      Halaman 8 kategori
    upt/index.astro       Daftar Profil UPT
    upt/[upt].astro       Halaman per UPT
    berita/[...slug].astro Halaman artikel
    tag/[tag].astro       Halaman tag
    cari.astro            Pencarian (indeks JSON di /search-index.json)
    *.astro               Halaman statis: tentang, redaksi, pedoman-media-siber,
                          info-iklan, kontak, kebijakan-privasi
    sitemap.xml.ts        Sitemap SEO
    robots.txt.ts         robots.txt
    rss.xml.ts            Feed RSS
public/
  images/                 Foto/cover artikel + logo ZonaPas
  favicon.png             Favicon (logo lingkaran ZonaPas)
```

## SEO

Setiap halaman punya meta description, Open Graph, dan canonical. Setiap artikel punya JSON-LD `NewsArticle` + `BreadcrumbList`. Tersedia `sitemap.xml`, `robots.txt`, dan `rss.xml`.

## CMS admin (Decap CMS) — isi berita dari website

Halaman admin ada di `/admin` (`public/admin/index.html`, konfigurasi di
`public/admin/config.yml`). Redaktur login dengan akun GitHub, lalu menulis
berita lewat formulir (judul, ringkasan, kategori, tag, penulis, tanggal,
foto sampul, keterangan foto, UPT, isi berita). Artikel yang disimpan masuk
sebagai file Markdown di `src/content/berita/` dengan `source: "zonapas"`
dan tampil dengan lencana "Artikel ZonaPas" di halaman artikel.

CMS tidak memakai workflow draf/review (`editorial_workflow: false`):
menyimpan berarti langsung commit ke branch `main`, lalu Cloudflare Pages
membangun ulang situs otomatis dan berita langsung tayang.

Yang masih harus disiapkan sebelum login bisa dipakai (langkah penyambungan,
saat tahap deploy):
1. Repositori GitHub berisi kode sumber situs ini.
2. GitHub OAuth App (Homepage URL `https://zonapas.web.id`, callback
   `https://oauth.zonapas.web.id/callback`).
3. Proxy OAuth kecil di Cloudflare Workers (gratis) di
   `oauth.zonapas.web.id` — Decap CMS backend `github` butuh server OAuth,
   GitHub tidak menerima login langsung dari browser tanpa itu.
4. Isi nilai sebenarnya di `public/admin/config.yml`: `repo`, `base_url`,
   dan `app_id` (Client ID OAuth App). Client Secret hanya disimpan di
   environment Worker, tidak pernah ditulis di file konfigurasi.

Sampai langkah itu selesai, cara menambah berita tetap lewat file Markdown
(lihat "Cara menambah / mengganti artikel" di atas) atau kirim ke Jarvis.

## Deploy (nanti, setelah dinyatakan final)

Build statis (`npm run build`) di-deploy ke Cloudflare Pages dan dihubungkan ke domain `zonapas.web.id`. Jangan deploy sebelum pemilik menyatakan "final".
