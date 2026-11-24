// One set of bound SQL queries for Node SQLite and Cloudflare D1.
const uuid =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const fields = "id, title, body, engine, source, seconds, created_at, revision";
const json = (data, status = 200, extra = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
const fail = (message, status) => json({ error: message }, status);

export async function api(request, db, speech = null) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (
    !["GET", "HEAD"].includes(method) &&
    request.headers.has("origin") &&
    request.headers.get("origin") !== url.origin
  )
    return fail("Open the studio on its own origin.", 403);
  const cookie = (request.headers.get("cookie") || "").match(
    /(?:^|;\s*)bol_workspace=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
  if (path === "/api/workspace" && method === "GET") {
    const key =
      cookie ||
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return json({ selfHosted: !!speech }, 200, {
      "Set-Cookie": `bol_workspace=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`,
    });
  }
  if (!cookie) return fail("Reload the page to reconnect this workspace.", 401);
  // Only the hash of the bearer cookie reaches the database.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(cookie),
  );
  const owner = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (path === "/api/speech" && method === "POST")
    return speech
      ? speech(request)
      : fail("Select the browser engine on this host.", 503);
  const match = /^\/api\/sessions(?:\/([a-f0-9-]+))?$/.exec(path);
  if (!match || (match[1] && !uuid.test(match[1])))
    return fail("Unknown route.", 404);
  const id = match[1];
  const lookup = (key) =>
    db
      .prepare(`SELECT ${fields} FROM transcripts WHERE owner=? AND id=?`)
      .bind(owner, key)
      .first();
  if (method === "GET") {
    if (id) {
      const row = await lookup(id);
      return row ? json(row) : fail("Session unavailable.", 404);
    }
    const { results } = await db
      .prepare(
        `SELECT ${fields} FROM transcripts WHERE owner=? ORDER BY created_at DESC, id`,
      )
      .bind(owner)
      .all();
    return json(results);
  }
  if (method === "DELETE" && id) {
    const revision = Number(request.headers.get("If-Match"));
    if (!Number.isSafeInteger(revision) || revision < 1)
      return fail("A revision is required.", 428);
    const result = await db
      .prepare("DELETE FROM transcripts WHERE owner=? AND id=? AND revision=?")
      .bind(owner, id, revision)
      .run();
    return result.meta.changes
      ? new Response(null, { status: 204 })
      : stale(await lookup(id));
  }
  if (!((method === "POST" && !id) || (method === "PUT" && id)))
    return fail("Method unavailable.", 405);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return fail("JSON required.", 415);
  const raw = await request.text();
  if (raw.length > 100000) return fail("Session exceeds the size limit.", 413);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON.", 400);
  }
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  const body = typeof data?.body === "string" ? data.body.trim() : "";
  if (!title || title.length > 100 || !body || body.length > 24000)
    return fail(
      "Use a title of 1–100 characters and a transcript of 1–24,000 characters.",
      422,
    );
  if (id) {
    if (!Number.isSafeInteger(data.revision) || data.revision < 1)
      return fail("A revision is required.", 428);
    const row = await db
      .prepare(
        `UPDATE transcripts SET title=?, body=?, revision=revision+1 WHERE owner=? AND id=? AND revision=? RETURNING ${fields}`,
      )
      .bind(title, body, owner, id, data.revision)
      .first();
    return row ? json(row) : stale(await lookup(id));
  }
  if (
    !uuid.test(data.id) ||
    !["Browser Whisper", "Self-hosted Whisper"].includes(data.engine) ||
    !["microphone", "sample"].includes(data.source) ||
    !Number.isSafeInteger(data.seconds) ||
    data.seconds < 0 ||
    data.seconds > 86400
  )
    return fail("Invalid recording metadata.", 422);
  const row = await db
    .prepare(
      `INSERT INTO transcripts(id,owner,title,body,engine,source,seconds,created_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING ${fields}`,
    )
    .bind(
      data.id,
      owner,
      title,
      body,
      data.engine,
      data.source,
      data.seconds,
      new Date().toISOString(),
    )
    .first();
  if (row) return json(row, 201);
  const existing = await lookup(data.id);
  return existing ? json(existing) : fail("Session ID unavailable.", 409);
}
function stale(row) {
  return row
    ? fail(
        "Another tab changed this session. Reopen it to use the latest version.",
        409,
      )
    : fail("Session unavailable.", 404);
}
