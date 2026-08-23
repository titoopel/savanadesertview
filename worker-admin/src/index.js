const ALLOWED_ORIGINS = new Set([
  "https://savanadesertview.com",
  "https://www.savanadesertview.com",
]);

const GH_OWNER = "titoopel";
const GH_REPO = "savanadesertview";
const GH_BRANCH = "main";
const GH_PATH = "images/general/welcome.PNG";
const MAX_BYTES = 15 * 1024 * 1024;

function cors(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors(origin),
    },
  });
}

async function secureEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a ?? ""))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b ?? ""))),
  ]);
  const aa = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function isPng(bytes) {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

async function github(path, env, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "savana-welcome-admin-worker",
      ...(init.headers || {}),
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method !== "POST") return json({ ok: false, error: "Not found" }, 404, origin);
    if (!ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);
    if (!env.ADMIN_PIN || !env.GITHUB_TOKEN) {
      return json({ ok: false, error: "Worker secrets are not configured" }, 500, origin);
    }

    if (url.pathname === "/auth") {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: "Invalid request" }, 400, origin); }

      const valid = await secureEqual(body.pin, env.ADMIN_PIN);
      if (!valid) {
        await new Promise(r => setTimeout(r, 700));
        return json({ ok: false, error: "Incorrect PIN" }, 401, origin);
      }
      return json({ ok: true }, 200, origin);
    }

    if (url.pathname === "/publish") {
      let form;
      try { form = await request.formData(); }
      catch { return json({ ok: false, error: "Invalid form data" }, 400, origin); }

      const pin = form.get("pin");
      const file = form.get("image");
      const valid = await secureEqual(pin, env.ADMIN_PIN);

      if (!valid) {
        await new Promise(r => setTimeout(r, 700));
        return json({ ok: false, error: "Incorrect PIN" }, 401, origin);
      }

      if (!(file instanceof File)) return json({ ok: false, error: "No image received" }, 400, origin);
      if (file.size <= 0 || file.size > MAX_BYTES) {
        return json({ ok: false, error: "PNG must be smaller than 15 MB" }, 400, origin);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isPng(bytes)) return json({ ok: false, error: "Please upload a real PNG image" }, 400, origin);

      const encodedPath = GH_PATH.split("/").map(encodeURIComponent).join("/");
      const contentEndpoint = `/repos/${GH_OWNER}/${GH_REPO}/contents/${encodedPath}`;

      const currentRes = await github(`${contentEndpoint}?ref=${encodeURIComponent(GH_BRANCH)}`, env);
      if (!currentRes.ok) {
        const details = await currentRes.text();
        return json({ ok: false, error: `Could not read current welcome.PNG (${currentRes.status})`, details }, 502, origin);
      }

      const current = await currentRes.json();

      const updateRes = await github(contentEndpoint, env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Update welcome image via admin panel - ${new Date().toISOString()}`,
          content: bytesToBase64(bytes),
          sha: current.sha,
          branch: GH_BRANCH,
        }),
      });

      if (!updateRes.ok) {
        const details = await updateRes.text();
        return json({ ok: false, error: `GitHub update failed (${updateRes.status})`, details }, 502, origin);
      }

      const result = await updateRes.json();

      return json({
        ok: true,
        path: GH_PATH,
        commit: result?.commit?.sha || null,
        publishedAt: new Date().toISOString(),
        note: "GitHub Pages may take a short time to publish the new image.",
      }, 200, origin);
    }

    return json({ ok: false, error: "Not found" }, 404, origin);
  },
};
