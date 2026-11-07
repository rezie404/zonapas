// public/olah-video.mjs — Trim + tempel intro/outro ZonaPasTV sebelum unggah ke YouTube.
// Dijalankan di browser dengan ffmpeg.wasm (single-thread, tanpa SharedArrayBuffer).
// Dipakai oleh Kelola Berita; dimuat dinamis hanya saat ada file video yang dipilih.
// Bila olahan gagal (memori HP tidak cukup, wasm gagal dimuat, dsb), pemanggil
// mengunggah file asli apa adanya — jadi kegagalan olahan tidak pernah menggagalkan unggah.
//
// PENTING (pelajaran uji live 07 Nov 2026): skrip @ffmpeg/ffmpeg TIDAK BOLEH
// dimuat dari CDN — Worker browser wajib same-origin, dan muat worker.js dari
// jsDelivr ditolak ("cannot be accessed from origin"). Karena itu paket ESM
// @ffmpeg/ffmpeg di-self-host di /ffmpeg/ (public/ffmpeg/*, file teks kecil).
// Yang tetap dari CDN hanya ffmpeg-core (.js + .wasm 30 MB — melebihi batas
// file 25 MiB Cloudflare Pages, jadi tidak bisa di-self-host); inti itu
// dimuat dari dalam worker lewat import() yang memang mengizinkan lintas origin.
const FFMPEG_LOKAL = "/ffmpeg/index.js";
const CORE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm";

export const INTRO_URL = "/videos/intro-zonapastv.mp4";
export const OUTRO_URL = "/videos/outro-zonapastv.mp4";
export const INTRO_DUR = 3; // detik
export const OUTRO_DUR = 4; // detik

const NORM_V = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p";
const NORM_A = "aresample=48000,aformat=channel_layouts=stereo";

let ffmpeg = null;
let janjiMuat = null;
let logTerkumpul = [];

// fetchFile ala @ffmpeg/util (tanpa dependensi): File/Blob/URL -> Uint8Array.
async function fetchFileLokal(masukan) {
  let buf;
  if (typeof masukan === "string") {
    buf = await (await fetch(masukan)).arrayBuffer();
  } else if (masukan instanceof Blob) {
    buf = await masukan.arrayBuffer();
  } else {
    buf = masukan;
  }
  return new Uint8Array(buf);
}

// Muat ffmpeg.wasm sekali; dipakai ulang untuk unggahan berikutnya.
async function muatFFmpeg(onProgress) {
  if (ffmpeg) return ffmpeg;
  if (!janjiMuat) {
    janjiMuat = (async () => {
      const { FFmpeg } = await import(FFMPEG_LOKAL);
      const ff = new FFmpeg();
      ff.on("log", ({ message }) => { logTerkumpul.push(message); });
      ff.on("progress", ({ progress }) => {
        if (typeof onProgress === "function" && isFinite(progress)) onProgress(Math.max(0, Math.min(1, progress)));
      });
      await ff.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
      ffmpeg = ff;
      ffmpeg.__fetchFile = fetchFileLokal;
      return ff;
    })();
  }
  return janjiMuat;
}

// Periksa apakah file punya trek audio, lewat log "Stream ... Audio:" dari ffmpeg -i.
async function adaAudio(ff, namaFile) {
  logTerkumpul = [];
  try { await ff.exec(["-i", namaFile]); } catch (e) { /* -i tanpa output memang "gagal" */ }
  return logTerkumpul.some((baris) => /Stream #\d+:\d+.*Audio:/.test(baris));
}

function fmtDetik(d) {
  const m = Math.floor(d / 60);
  const s = d - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}

// Olah satu video: potong [awal, akhir] lalu tempel intro + outro.
// file: File/Blob video asli. awal/akhir: detik (0 <= awal < akhir <= durasi).
// onProgress(p): 0..1 selama olahan. Mengembalikan Blob video/mp4 hasil olahan.
export async function olahVideo({ file, awal = 0, akhir = null, onProgress = null }) {
  const ff = await muatFFmpeg(onProgress);
  const fetchFile = ff.__fetchFile;
  const durasi = Math.max(0.1, (akhir == null ? file.size : akhir) - awal);
  const namaMasuk = "masukan" + (/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name || "") ? file.name.slice(file.name.lastIndexOf(".")) : ".mp4");

  try {
    if (typeof onProgress === "function") onProgress(0);
    const [introBuf, outroBuf] = await Promise.all([
      fetch(INTRO_URL).then((r) => { if (!r.ok) throw new Error("Intro tidak ditemukan (" + r.status + ")"); return r.arrayBuffer(); }),
      fetch(OUTRO_URL).then((r) => { if (!r.ok) throw new Error("Outro tidak ditemukan (" + r.status + ")"); return r.arrayBuffer(); }),
    ]);
    await ff.writeFile("intro.mp4", await fetchFile(new Blob([introBuf])));
    await ff.writeFile("outro.mp4", await fetchFile(new Blob([outroBuf])));
    await ff.writeFile(namaMasuk, await fetchFile(file));

    const punyaAudio = await adaAudio(ff, namaMasuk);
    const args = ["-i", "intro.mp4", "-ss", String(awal), "-t", String(durasi), "-i", namaMasuk, "-i", "outro.mp4"];
    let fc;
    if (punyaAudio) {
      fc = "[0:v]" + NORM_V + "[v0];[0:a]" + NORM_A + "[a0];"
        + "[1:v]" + NORM_V + "[v1];[1:a]" + NORM_A + "[a1];"
        + "[2:v]" + NORM_V + "[v2];[2:a]" + NORM_A + "[a2];"
        + "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]";
    } else {
      // Video tanpa audio: pasang trek hening sepanjang potongan.
      args.push("-f", "lavfi", "-t", String(durasi), "-i", "anullsrc=r=48000:cl=stereo");
      fc = "[0:v]" + NORM_V + "[v0];[0:a]" + NORM_A + "[a0];"
        + "[1:v]" + NORM_V + "[v1];[3:a]" + NORM_A + "[a1];"
        + "[2:v]" + NORM_V + "[v2];[2:a]" + NORM_A + "[a2];"
        + "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[outv][outa]";
    }
    args.push("-filter_complex", fc, "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-movflags", "+faststart", "hasil.mp4");
    await ff.exec(args);

    const data = await ff.readFile("hasil.mp4");
    if (!data || !data.length) throw new Error("Hasil olahan kosong");
    return new Blob([data.buffer], { type: "video/mp4" });
  } finally {
    for (const n of ["intro.mp4", "outro.mp4", namaMasuk, "hasil.mp4"]) {
      try { await ff.deleteFile(n); } catch (e) { /* sudah tidak ada */ }
    }
  }
}

export function tulisDurasi(d) { return fmtDetik(d); }

window.__olahVideo = { olahVideo, tulisDurasi, INTRO_URL, OUTRO_URL, INTRO_DUR, OUTRO_DUR };
