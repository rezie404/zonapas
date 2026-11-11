#!/usr/bin/env python3
"""Bangun kamus kata bahasa Indonesia untuk fitur cek typo Kelola Berita.

Sumber utama: hunspell-id v2.3.0 (46.905 kata) oleh shuLhan
https://github.com/shuLhan/hunspell-id — lisensi LGPL 3.0.
Ditambah kosakata situs (die ekstrak dari artikel ZonaPas) dan daftar tambahan
istilah pemasyarakatan + kata serapan yang belum ada di hunspell-id.

Keluaran: ~/workspace/zonapas/public/kamus-id.json
Format: {"sumber": "...", "lisensi": "...", "jumlah": N, "kata": [...urut...]}
"""
import json, pathlib, re

DIC = pathlib.Path("/tmp/hunspell-id-master.dic")
ARTIKEL_DIR = pathlib.Path("/home/hatch/workspace/zonapas/src/content/berita")
OUT = pathlib.Path("/home/hatch/workspace/zonapas/public/kamus-id.json")

kata = set()

# 1. hunspell-id: baris pertama = jumlah; tiap baris "kata/BENDERA".
lines = DIC.read_text(encoding="utf-8", errors="replace").splitlines()
for baris in lines[1:]:
    w = baris.split("/")[0].strip().lower()
    if not w or w.startswith("-"):
        continue
    if re.fullmatch(r"[a-z]+(?:-[a-z]+)*", w):
        kata.add(w)
print("hunspell-id:", len(kata))

# 2. Kosakata situs: semua kata dari artikel lokal (nama orang, tempat, UPT,
#    istilah pemasyarakatan — ini yang membuat nama seperti Bengkulu/Curup
#    dan istilah seperti pemasyarakatan tidak ditandai sebagai typo).
n_artikel = 0
for f in ARTIKEL_DIR.glob("*.md"):
    teks = f.read_text(encoding="utf-8", errors="replace")
    teks = re.sub(r"^---.*?^---", " ", teks, flags=re.S | re.M)  # frontmatter
    for w in re.findall(r"[A-Za-z]+", teks):
        w = w.lower()
        if len(w) >= 2:
            kata.add(w)
    n_artikel += 1
print(f"artikel lokal: {n_artikel} file")

# 3. Daftar tambahan: singkatan/istilah dan kata serapan yang belum tentu
#    ada di hunspell-id.
TAMBAHAN = """
ditjenpas kemenimipas kemenkumham lapas rutan bapas lpka lpp rupbasan
kakanwil kalapas karutan kabapas kplp wbp zonapas jurnalpas bimtek fgd
kppn pkbi kanwil ditjen kemenimipas imigrasi narapidana pembinaan
pemasyarakatan pengamanan pelayanan kepegawaian sinergi integrasi remisi
pembimbingan asimilasi rehabilitasi deradikalisasi overkapasitas
online whatsapp instagram facebook website link update live streaming
webinar podcast daring luring hybrid smartphone android google youtube
tiktok zoom meeting ecommerce marketplace marketplace
bengkulu curup manna argamakmur rejang lebong kepahiang kaur seluma
mukomuko bintuhan ketahun lubuk linggau palembang jakarta bandung
surabaya medan padang pekanbaru jambi lampung banten yogyakarta semarang
makassar manado pontianak banjarmasin palangkaraya samarinda balikpapan
mataram kupang ambon jayapura sorong ternate gorontalo palu kendari
mamuju tanjung pinang pangkal banda aceh serang cilegon depok bekasi
bogor tangerang sukabumi cirebon tasikmalaya purwokerto magelang solo
surakarta madiun kediri malang jember denpasar singaraja
rezie novian putra masjuno julianto budhi prasetyono aidil jumidi aris
munandar tatan dirsan atmaja suci winarsih miko andriansyah
""".split()
# 3b. Kata yang pemeriksa typo sempat salah tandai (11 Nov 2026): "royong"
# memang tidak ada di hunspell-id, begitu pula bentuk turunan yang
# pemeriksa lama tidak sanggup urai dan kata serapan/istilah yang dipakai
# artikel ZonaPas. Ditambahkan di sini supaya pembangunan ulang kamus
# tidak menghilangkan mereka lagi.
TAMBAHAN_20261111 = """
royong memperingati peringati peringatan pengecatan wewenang kerjasama
database kasubdit saifullah teleconference bansos tanggungjawab
dipertanggungjawabkan pertanggungjawaban mempertanggungjawabkan
""".split()
kata.update(w.lower() for w in TAMBAHAN_20261111)
print("tambahan 2026-11-11:", len(TAMBAHAN_20261111))
sebelum = len(kata)
kata.update(w.lower() for w in TAMBAHAN)
print("tambahan:", len(kata) - sebelum)

daftar = sorted(kata)
OUT.write_text(json.dumps({
    "sumber": "hunspell-id v2.3.0 oleh shuLhan (https://github.com/shuLhan/hunspell-id), ditambah kosakata artikel ZonaPas dan istilah pemasyarakatan",
    "lisensi": "hunspell-id: LGPL 3.0",
    "jumlah": len(daftar),
    "kata": daftar,
}, ensure_ascii=False), encoding="utf-8")
print("tertulis:", OUT, "jumlah:", len(daftar), "ukuran:", OUT.stat().st_size, "byte")
