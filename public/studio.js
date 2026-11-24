import { Recording } from "./recording.js";

const $ = (id) => document.getElementById(id);
const icons = {
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  save: '<path d="M5 3h12l3 3v15H4V3zm2 0v6h9V3M8 21v-8h8v8"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
  folder: '<path d="M3 6h7l2 3h9v10H3z"/><path d="M4 6V4h6l2 2h7v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  page: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h6"/>',
};
const icon = (n) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[n]}</svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const el = (tag, cls, txt) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt !== undefined) node.textContent = txt;
  return node;
};
const empty = $("draft").firstElementChild;
const time = (s) =>
  [Math.floor(s / 60), Math.floor(s % 60)]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
let sessions = [],
  workspace = false,
  historyError = "",
  current = null,
  recording = false,
  retry = false,
  editor = null,
  action = null,
  loading = false,
  searchSeq = 0;
let draft = null,
  seconds = 0,
  timer;
function notify(msg) {
  $("notice").textContent = msg;
  clearTimeout(timer);
  timer = setTimeout(() => ($("notice").textContent = ""), 3500);
}
async function request(path, options) {
  const r = await fetch("/api/" + path, options);
  if (r.status === 204) return null;
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || "Request failed. Try again.");
  return value;
}
function status(name, msg) {
  $("status").lastChild.textContent = name;
  $("status").classList.toggle(
    "on",
    ["Recording", "Playing sample", "Retrying"].includes(name),
  );
  $("hint").textContent = msg;
  $("record").disabled = ["Finishing", "Retrying"].includes(name);
}
function controls() {
  const label = recording ? "Stop" : retry ? "Retry phrase" : "Start recording";
  $("record").innerHTML = icon(recording ? "stop" : "mic");
  $("record").append(el("span", "", label));
  $("record").disabled = loading;
  $("sample").disabled = recording || loading;
  $("engine").disabled = recording || loading;
  $("save").disabled = recording || !draft?.body.trim() || !workspace;
}
function showDraft() {
  const text = draft?.body || "";
  if (text) {
    let node = $("draft").querySelector(".drafttext");
    if (!node) {
      $("draft").replaceChildren((node = el("p", "drafttext")));
      node.setAttribute("aria-live", "polite");
    }
    node.textContent = text;
    $("draft").scrollTop = $("draft").scrollHeight;
  } else $("draft").replaceChildren(empty);
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  $("count").textContent = words + " " + (words === 1 ? "word" : "words");
  $("draftstate").textContent = draft?.saved
    ? "Saved to library"
    : text
      ? "Unsaved draft"
      : recording
        ? "Capturing audio"
        : "No active draft";
  controls();
}
const canvas = $("scope"),
  ctx = canvas.getContext("2d");
const bars = Array(84).fill(0);
function wave(live = false) {
  const dpr = Math.min(devicePixelRatio || 1, 2),
    w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (w < 1) return;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#bdd5a744";
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  const step = w / bars.length;
  bars.forEach((v, i) => {
    const envelope =
      Math.exp(-((i - 24) ** 2) / 109) +
      0.6 * Math.exp(-((i - 53) ** 2) / 76) +
      0.35 * Math.exp(-((i - 69) ** 2) / 24);
    const amp = live
      ? v
      : envelope *
        (0.23 + 0.75 * Math.abs(Math.sin(i * 2.1) * Math.cos(i * 0.23)));
    const height = Math.max(2, Math.min(1, amp) * h * 0.94);
    ctx.fillStyle = live ? "#dcfa85" : "#a2c68c";
    ctx.fillRect(
      i * step,
      h / 2 - height / 2,
      Math.max(1, step * 0.48),
      height,
    );
  });
}
new ResizeObserver(() => wave(recording)).observe(canvas);
function confirmAction(title, message, label, fn) {
  $("confirmtitle").textContent = title;
  $("confirmtext").textContent = message;
  $("accept").textContent = label;
  action = fn;
  $("confirm").showModal();
}
$("accept").onclick = () => {
  const fn = action;
  $("confirm").close();
  action = null;
  void fn?.();
};
$("cancel").onclick = () => $("confirm").close();
function begin(source) {
  if ((draft?.body && !draft.saved) || retry) {
    confirmAction(
      "Replace this draft?",
      "Starting a new session clears the current draft and any queued audio.",
      "Replace draft",
      () => start(source),
    );
  } else void start(source);
}
async function start(source) {
  const engine = $("engine").value;
  draft = {
    id: crypto.randomUUID(),
    source,
    engine,
    body: "",
    title: source === "sample" ? "Team check-in" : "",
    saved: false,
  };
  seconds = 0;
  retry = false;
  recording = true;
  bars.fill(0);
  $("clock").textContent = "00:00";
  showDraft();
  current = new Recording(engine, source, {
    status,
    level(level, s) {
      seconds = s;
      $("db").textContent =
        Math.max(-90, Math.round(20 * Math.log10(Math.max(level, 0.00001)))) +
        " dBFS";
      $("clock").textContent = time(s);
      bars.shift();
      bars.push(Math.min(1, level * 9));
      wave(true);
    },
    text(text) {
      draft.saved = false;
      draft.body += (draft.body ? " " : "") + text;
      showDraft();
    },
    done(err, canRetry) {
      recording = false;
      retry = canRetry;
      $("db").textContent = "Input idle";
      status(
        err ? "Needs attention" : "Standby",
        err ||
          (draft.body
            ? "Review the transcript, then save your session."
            : "No speech captured. Try speaking closer to the microphone."),
      );
      showDraft();
      wave();
    },
  });
  await current.start();
}
$("record").onclick = () => {
  if (recording) {
    void current.stop();
    return;
  }
  if (retry) {
    recording = true;
    controls();
    void current.retry();
    return;
  }
  begin("microphone");
};
$("sample").onclick = () => begin("sample");
$("engine").onchange = () => {
  if (!retry) status("Standby", engineHint());
};
function engineHint() {
  return $("engine").value === "Browser Whisper"
    ? "Audio stays in this browser. First use downloads about 250 MB."
    : "Audio is processed by the self-hosted Whisper service.";
}
function openEditor(row = null) {
  editor = row;
  const saved = !!row;
  $("formerror").textContent = "";
  $("dialogtitle").textContent = saved ? "Edit session" : "Save session";
  $("submit").textContent = saved ? "Save changes" : "Save session";
  $("remove").hidden = !saved;
  $("title").value = row?.title || draft.title || "Untitled session";
  $("body").value = row?.body || draft.body;
  const d = row || draft;
  $("details").textContent =
    `${d.engine} · ${d.source === "sample" ? "Audio sample" : "Microphone"} · ${time(row?.seconds ?? seconds)}`;
  $("editor").showModal();
  $("title").focus();
}
$("save").onclick = () =>
  openEditor(
    draft.revision ? { ...draft, seconds: Math.round(seconds) } : null,
  );
$("close").onclick = () => $("editor").close();
function setFormBusy(b) {
  for (const id of ["submit", "remove", "close"]) $(id).disabled = b;
}
$("form").onsubmit = async (e) => {
  e.preventDefault();
  setFormBusy(true);
  $("formerror").textContent = "";
  try {
    const edit = !!editor,
      data = edit
        ? { revision: editor.revision }
        : {
            id: draft.id,
            source: draft.source,
            engine: draft.engine,
            seconds: Math.round(seconds),
          };
    data.title = $("title").value;
    data.body = $("body").value;
    const saved = await request(edit ? "sessions/" + editor.id : "sessions", {
      method: edit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (draft?.id === saved.id) {
      Object.assign(draft, {
        saved: true,
        revision: saved.revision,
        title: saved.title,
        body: saved.body,
      });
      showDraft();
    }
    $("editor").close();
    notify(edit ? "Changes saved" : "Session saved");
    await refresh();
  } catch (err) {
    $("formerror").textContent = err.message;
  } finally {
    setFormBusy(false);
  }
};
$("remove").onclick = () =>
  confirmAction(
    "Delete this session?",
    `“${editor.title}” will be permanently removed from your library.`,
    "Delete session",
    async () => {
      setFormBusy(true);
      try {
        await request("sessions/" + editor.id, {
          method: "DELETE",
          headers: { "If-Match": String(editor.revision) },
        });
        if (draft?.id === editor.id) {
          draft = null;
          seconds = 0;
          $("clock").textContent = "00:00";
          showDraft();
        }
        $("editor").close();
        notify("Session deleted");
        await refresh();
      } catch (err) {
        $("formerror").textContent = err.message;
      } finally {
        setFormBusy(false);
      }
    },
  );
function drawLibrary() {
  const query = $("search").value.trim().toLocaleLowerCase();
  const found = sessions.filter((r) =>
    (r.title + " " + r.body).toLocaleLowerCase().includes(query),
  );
  const box = $("records");
  box.replaceChildren();
  if (historyError || !found.length) {
    const panel = el("div", "emptylist"),
      glyph = el("span", "emptyicon"),
      message = el("div");
    glyph.innerHTML = icon(historyError ? "page" : "folder");
    message.append(
      el(
        "strong",
        "",
        historyError
          ? "Library unavailable"
          : query
            ? "No matches"
            : "No saved sessions yet",
      ),
      el(
        "p",
        "",
        historyError ||
          (query
            ? "Try a different title or phrase."
            : "Save a transcript to read, edit, or revisit it here."),
      ),
    );
    panel.append(glyph, message);
    if (historyError) {
      const b = el("button", "", "Retry");
      b.onclick = () => void connect();
      panel.append(b);
    }
    box.append(panel);
    return;
  }
  for (const row of found) {
    const item = el("button", "row");
    const glyph = el("span", "emptyicon");
    glyph.innerHTML = icon("page");
    const body = el("div");
    body.append(el("strong", "", row.title), el("p", "", row.body));
    const meta = el(
      "small",
      "",
      new Date(row.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
    meta.append(el("span", "", time(row.seconds)));
    item.append(glyph, body, meta);
    item.onclick = async () => {
      try {
        openEditor(await request("sessions/" + row.id));
      } catch (err) {
        notify(err.message);
        await refresh();
      }
    };
    box.append(item);
  }
}
async function refresh() {
  const seq = ++searchSeq;
  try {
    const rows = await request("sessions");
    if (seq !== searchSeq) return;
    sessions = rows;
    historyError = "";
  } catch (err) {
    if (seq !== searchSeq) return;
    historyError = err.message;
  }
  drawLibrary();
}
$("search").oninput = drawLibrary;
async function connect() {
  loading = true;
  controls();
  try {
    const cfg = await request("workspace");
    workspace = true;
    if (cfg.selfHosted && $("engine").options.length === 1) {
      $("engine").add(
        new Option("Self-hosted Whisper", "Self-hosted Whisper", true, true),
      );
    }
    if (!recording) status("Standby", engineHint());
    await refresh();
  } catch (err) {
    workspace = false;
    historyError = err.message;
    drawLibrary();
    status(
      "Offline",
      "The library is offline. You can still try Browser Whisper.",
    );
  } finally {
    loading = false;
    controls();
  }
}
function selectTab() {
  document
    .querySelectorAll("nav a")
    .forEach((a) =>
      a.classList.toggle("active", a.hash === (location.hash || "#studio")),
    );
}
window.addEventListener("hashchange", selectTab);
selectTab();
window.addEventListener("beforeunload", (e) => {
  if (recording || (draft?.body && !draft.saved)) {
    e.preventDefault();
    e.returnValue = "";
  }
});
void connect();
