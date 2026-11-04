// Cloudflare Worker: proxy OAuth kecil untuk login Decap CMS ke GitHub.
// Dipakai oleh portal berita ZonaPas (https://zonapas.web.id/admin).
//
// Cara kerja:
//   1. CMS membuka popup ke GET /auth
//   2. Worker mengarahkan ke GitHub untuk otorisasi
//   3. GitHub mengarahkan kembali ke GET /callback?code=...&state=...
//   4. Worker menukar code dengan access_token, lalu mengirim token
//      kembali ke jendela CMS lewat window.opener.postMessage
//      sesuai pola provider OAuth Decap CMS, dan menutup popup.
//
// Kredensial TIDAK ditulis di file ini. Client ID dan client secret
// dibaca dari environment variables Worker:
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
// (diatur lewat dashboard Cloudflare atau `wrangler secret put`).

const REDIRECT_URI = "https://oauth.zonapas.web.id/callback";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

function randomState() {
  // Nilai acak yang aman untuk URL (state), dikembalikan apa adanya.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function errorPage(message) {
  const safe = String(message).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Login gagal</title></head>" +
      "<body><h1>Login gagal</h1><p>" + safe + "</p>" +
      "<p>Silakan tutup jendela ini dan coba lagi.</p></body></html>",
    { status: 500, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function successPage(token) {
  // Pola provider OAuth Decap CMS:
  //   window.opener.postMessage('authorization:github:success:' + JSON.stringify({ token }), ...)
  // lalu window.close().
  const payload = JSON.stringify({ token });
  return new Response(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Login berhasil</title></head><body>" +
      "<p>Login berhasil. Jendela ini akan tertutup.</p>" +
      "<script>" +
      "window.opener.postMessage('authorization:github:success:' + " + JSON.stringify(payload) + ", '*');" +
      "window.close();" +
      "</script></body></html>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // GET /auth — redirect (302) ke GitHub untuk otorisasi.
    if (url.pathname === "/auth" && request.method === "GET") {
      const state = randomState();
      const authorize = new URL(GITHUB_AUTHORIZE_URL);
      authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", REDIRECT_URI);
      authorize.searchParams.set("scope", "repo");
      authorize.searchParams.set("state", state);
      return Response.redirect(authorize.toString(), 302);
    }

    // GET /callback — tukar code dengan access_token.
    if (url.pathname === "/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) {
        return errorPage("GitHub tidak mengembalikan kode otorisasi.");
      }

      let data;
      try {
        const res = await fetch(GITHUB_TOKEN_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI,
          }),
        });
        data = await res.json();
      } catch (err) {
        return errorPage("Tidak dapat menghubungi GitHub: " + err.message);
      }

      if (data.error || !data.access_token) {
        return errorPage(
          "GitHub menolak otorisasi: " + (data.error_description || data.error || "tidak diketahui")
        );
      }

      return successPage(data.access_token);
    }

    // Path lain.
    return new Response("Not found", { status: 404 });
  },
};
