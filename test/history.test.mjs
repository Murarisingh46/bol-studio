import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { api } from "../server/api.mjs";

function workspace() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  const db = {
    prepare(query) {
      const stmt = sql.prepare(query);
      return {
        bind(...p) {
          return {
            first: () => stmt.get(...p),
            all: () => ({ results: stmt.all(...p) }),
            run: () => ({ meta: stmt.run(...p) }),
          };
        },
      };
    },
  };
  return (path, method = "GET", data, cookie = "", headers = {}) =>
    api(
      new Request("https://bol.example/api/" + path, {
        method,
        headers: { cookie, "Content-Type": "application/json", ...headers },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      db,
    );
}
async function identity(call) {
  return (await call("workspace")).headers.get("set-cookie").split(";")[0];
}
const example = () => ({
  id: crypto.randomUUID(),
  title: "Planning",
  body: "कल project review है।",
  engine: "Browser Whisper",
  source: "sample",
  seconds: 6,
});

test("Unicode CRUD, idempotent creation and stale revision protection", async () => {
  const call = workspace(),
    owner = await identity(call),
    data = example(),
    path = "sessions/" + data.id;
  assert.equal((await call("sessions", "POST", data, owner)).status, 201);
  assert.equal((await call("sessions", "POST", data, owner)).status, 200);
  const rows = await (await call("sessions", "GET", undefined, owner)).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, data.body);
  const edit = { title: "Review", body: "आगे बढ़ें", revision: 1 };
  const updated = await (await call(path, "PUT", edit, owner)).json();
  assert.equal(updated.revision, 2);
  assert.equal(updated.body, edit.body);
  assert.equal((await call(path, "PUT", edit, owner)).status, 409);
  assert.equal(
    (await call(path, "DELETE", undefined, owner, { "If-Match": "1" })).status,
    409,
  );
  assert.equal(
    (await call(path, "DELETE", undefined, owner, { "If-Match": "2" })).status,
    204,
  );
  assert.equal((await call(path, "GET", undefined, owner)).status, 404);
});

test("Unauthenticated and other-browser access is isolated", async () => {
  const call = workspace(),
    a = await identity(call),
    b = await identity(call),
    data = example();
  assert.equal((await call("sessions")).status, 401);
  await call("sessions", "POST", data, a);
  assert.deepEqual(
    await (await call("sessions", "GET", undefined, b)).json(),
    [],
  );
  const path = "sessions/" + data.id;
  assert.equal((await call(path, "GET", undefined, b)).status, 404);
  assert.equal(
    (await call(path, "PUT", { ...data, revision: 1 }, b)).status,
    404,
  );
  assert.equal(
    (await call(path, "DELETE", undefined, b, { "If-Match": "1" })).status,
    404,
  );
  assert.equal((await call("sessions", "POST", data, b)).status, 409);
});

test("Invalid writes leave the library unchanged", async () => {
  const call = workspace(),
    a = await identity(call),
    data = example();
  for (const change of [
    { title: " " },
    { body: "" },
    { seconds: -1 },
    { engine: "unknown" },
    { id: "invalid" },
  ])
    assert.equal(
      (await call("sessions", "POST", { ...data, ...change }, a)).status,
      422,
    );
  assert.equal(
    (
      await call("sessions", "POST", data, a, {
        Origin: "https://another.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("sessions", "POST", data, a, { "Content-Type": "text/plain" }))
      .status,
    415,
  );
  assert.deepEqual(
    await (await call("sessions", "GET", undefined, a)).json(),
    [],
  );
});
