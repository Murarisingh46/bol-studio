import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./api.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const data = process.env.BOL_DATA || resolve(root, ".data");
await mkdir(data, { recursive: true });
const sql = new DatabaseSync(resolve(data, "studio.sqlite"));
sql.exec("PRAGMA journal_mode=WAL");
sql.exec(await readFile(resolve(root, "server/schema.sql"), "utf8"));
const db = {
  prepare(query) {
    const stmt = sql.prepare(query);
    return {
      bind(...params) {
        return {
          first: () => stmt.get(...params),
          all: () => ({ results: stmt.all(...params) }),
          run: () => ({ meta: stmt.run(...params) }),
        };
      },
    };
  },
};
const files = resolve(root, "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};
const upstream = process.env.BOL_WHISPER_URL;
async function speech(req) {
  try {
    const res = await fetch(upstream, {
      method: "POST",
      body: await req.arrayBuffer(),
      signal: AbortSignal.timeout(120000),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "Whisper is offline. Start the speech service or select Browser Whisper.",
      },
      { status: 503 },
    );
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 600000) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const result = await api(request, db, upstream ? speech : null);
      res
        .writeHead(result.status, Object.fromEntries(result.headers))
        .end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    const path = resolve(
      files,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!path.startsWith(files + sep)) {
      res.writeHead(404).end();
      return;
    }
    const bytes = await readFile(path);
    res
      .writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      })
      .end(bytes);
  } catch (err) {
    const missing = ["ENOENT", "EISDIR"].includes(err.code);
    if (!missing) console.error(err.message);
    res
      .writeHead(missing ? 404 : 500, { "Content-Type": "application/json" })
      .end(
        JSON.stringify({
          error: missing
            ? "File unavailable."
            : "Request failed. Please try again.",
        }),
      );
  }
});
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () =>
  console.log(`Bol Studio · http://${host}:${port}`),
);
