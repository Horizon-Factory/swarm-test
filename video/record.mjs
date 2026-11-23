// record.mjs — films one before/after script on each side, then composes <outDir>/video.mp4 with ffmpeg.
// Run from the directory where
// Playwright is installed (the dir you run `npx playwright test` from):
//   node <skill>/video/record.mjs <script.mjs> <outDir> [--storage=<storageState.json>] [--slowmo=<ms>] before=<url> after=<url>
// One side only (after=<url>) = the script check, and a one-sided video when no "before" server exists.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildFilter, ffmpegArgs, planCuts } from "./compose.mjs";

export const SIZE = { width: 1280, height: 800 };
const MAX_SIDE_MS = 60_000;
const HOLD_MS = 1500;
const SETTLE_MS = 700;
const firstLine = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 300);
const cleanLabel = (l) => String(l).replace(/[\u0000-\u001f\u007f]+/g, (m) => (/[\n\r\t]/.test(m) ? " " : "")).slice(0, 120);

/**
 * step(label, fn): times fn; a throw is recorded and rethrown as STOP so the rest of the script is skipped.
 * settle runs after a passed step, inside its timing: an action's result (a re-render, a list closing) lands as the
 * step ends, and the cut keeps only the step — without it the video never showed the state a step produced.
 */
export function makeStepper(now = Date.now, settle = async () => {}) {
  const t0 = now();
  const STOP = Symbol("stop");
  const steps = [];
  let failed = null;
  const sec = () => (now() - t0) / 1000;
  async function step(label, fn) {
    const start = sec();
    try {
      await fn();
      await settle();
      steps.push({ label: cleanLabel(label), start, end: sec(), ok: true });
    } catch (e) {
      failed = e instanceof Error ? e : new Error(String(e));
      steps.push({ label: cleanLabel(label), start, end: sec(), ok: false, error: firstLine(e) });
      throw STOP;
    }
  }
  return { step, steps, failed: () => failed, STOP };
}

// A dot that glides to each pointer position, and a ripple on press. Drawn by the page, so it is in the video.
export const CURSOR_SCRIPT = `addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;left:-50px;top:-50px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(79,79,208,.85);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none;z-index:2147483647;transition:left .25s ease-out,top .25s ease-out,transform .08s";
  document.documentElement.appendChild(c);
  addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", (e) => {
    c.style.transform = "scale(.7)";
    const r = document.createElement("div");
    r.style.cssText = "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid rgba(79,79,208,.9);pointer-events:none;z-index:2147483646;transition:transform .45s ease-out,opacity .45s ease-out";
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 500);
  }, true);
  addEventListener("mouseup", () => { c.style.transform = ""; }, true);
  // A native <select> list is drawn by the OS, outside the page: no recording shows it. Draw our own under the
  // select on press; it stays open until a value is chosen (a failing step then shows what the list lacks).
  let list = null;
  const close = () => { if (list) { list.remove(); list = null; } };
  addEventListener("mousedown", (e) => {
    const sel = e.target instanceof Element ? e.target.closest("select") : null;
    close();
    if (!sel) return;
    const b = sel.getBoundingClientRect();
    list = document.createElement("div");
    list.setAttribute("data-qa-select-list", "");
    list.style.cssText = "position:fixed;left:" + b.left + "px;top:" + (b.bottom + 4) + "px;min-width:" + b.width + "px;background:#fff;color:#1a1816;border:1px solid rgba(0,0,0,.15);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;font:13px system-ui,sans-serif;pointer-events:none;z-index:2147483646";
    for (const o of sel.options) {
      const row = document.createElement("div");
      row.textContent = o.label;
      row.style.cssText = "padding:6px 10px;border-radius:6px;white-space:nowrap";
      list.appendChild(row);
    }
    document.documentElement.appendChild(list);
    sel.addEventListener("change", () => {
      const row = list && list.children[sel.selectedIndex];
      if (row) { row.setAttribute("data-qa-selected", ""); row.style.background = "rgba(79,79,208,.15)"; row.style.fontWeight = "600"; }
      setTimeout(close, 600);
    }, { once: true });
  }, true);
});`;

// Playwright comes from the project being tested, not from this skill's directory.
function loadPlaywright() {
  const req = createRequire(join(process.cwd(), "noop.js"));
  try { const t = req("@playwright/test"); return { chromium: t.chromium, expect: t.expect }; }
  catch { return { chromium: req("playwright").chromium, expect: req("playwright/test").expect }; }
}

export async function recordSide({ chromium, expect }, script, { name, baseUrl, outDir, email, password, slowMo, storage }) {
  const dir = join(outDir, name);
  await mkdir(dir, { recursive: true });
  const out = { name, ok: false, error: null, steps: [] };
  const browser = await chromium.launch({ slowMo });
  try {
    let state = storage;
    if (!state) {
      const anon = await browser.newContext({ viewport: SIZE, baseURL: baseUrl });
      try {
        const p = await anon.newPage();
        await p.goto("/");
        if (typeof script.login === "function") await script.login({ page: p, email, password });
        state = await anon.storageState();
      } catch (e) {
        out.error = `login failed: ${firstLine(e)}`;
        return out;
      } finally { await anon.close().catch(() => {}); }
    }

    const ctx = await browser.newContext({ viewport: SIZE, baseURL: baseUrl, storageState: state, recordVideo: { dir, size: SIZE } });
    await ctx.addInitScript(CURSOR_SCRIPT);
    const page = await ctx.newPage();
    // A missing element is the bug on the before side: fail in seconds, not Playwright's 30 s, so the side stays short.
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(30_000); // a dev server compiles a route on first hit
    const st = makeStepper(Date.now, () => page.waitForTimeout(SETTLE_MS));
    let timer;
    try {
      await Promise.race([
        (async () => {
          await page.goto(typeof script.start === "string" ? script.start : "/");
          // A dev server hydrates and compiles slowly: let the page settle before the 5 s steps start. Cut from the video.
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
          await script.default({ page, step: st.step, expect });
        })(),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("side timed out after 60 s")), MAX_SIDE_MS); }),
      ]);
    } catch (e) { if (e !== st.STOP) out.error = firstLine(e); } finally { clearTimeout(timer); }
    if (st.failed()) await page.waitForTimeout(HOLD_MS).catch(() => {});
    await page.screenshot({ path: join(dir, "last.png") }).catch(() => {});
    out.steps = st.steps;
    out.ok = !out.error && !st.failed() && st.steps.length > 0;
    const video = page.video();
    await ctx.close();
    if (video) await rename(await video.path(), join(dir, "video.webm"));
    return out;
  } finally {
    await writeFile(join(dir, "timeline.json"), JSON.stringify({ ok: out.ok, error: out.error, steps: out.steps }));
    await browser.close().catch(() => {});
  }
}

const FONTS = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"];

// An ffmpeg with drawtext draws the labels; Homebrew's default build has none, its keg-only ffmpeg-full does.
function findFfmpeg() {
  const has = (bin) => { try { return / drawtext /.test(execFileSync(bin, ["-hide_banner", "-filters"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { return null; } };
  const cands = [process.env.FFMPEG, "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "/usr/local/opt/ffmpeg-full/bin/ffmpeg", "ffmpeg"].filter(Boolean);
  for (const bin of cands) if (has(bin)) return { bin, text: true };
  for (const bin of cands) if (has(bin) === false) return { bin, text: false };
  return null;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The opening card, drawn by the browser so it needs no drawtext: what to look at, and which side is which.
async function renderCard(chromium, file, { width, height, title, sides }) {
  const chip = (bg, label) => `<span style="display:inline-flex;align-items:center;gap:12px"><i style="width:22px;height:22px;border-radius:6px;background:${bg}"></i>${label}</span>`;
  const legend = sides.length > 1
    ? `${chip("#52525b", "À gauche : avant")}${chip("#15803d", "À droite : après")}`
    : chip("#15803d", "Après le changement");
  const html = `<body style="margin:0;width:${width}px;height:${height}px;display:flex;flex-direction:column;justify-content:center;gap:48px;padding:0 120px;box-sizing:border-box;background:#111;color:#fff;font-family:system-ui,-apple-system,sans-serif">
    ${title ? `<h1 style="margin:0;font-size:56px;line-height:1.2;font-weight:700;max-width:1800px">${esc(title)}</h1>` : ""}
    <p style="margin:0;display:flex;gap:56px;font-size:34px;color:#d4d4d8">${legend}</p>
    <p style="margin:0;font-size:26px;color:#a1a1aa">Bandeau vert : l’étape passe · bandeau rouge : elle échoue</p></body>`;
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width, height } });
    await p.setContent(html);
    await p.screenshot({ path: file });
  } finally { await b.close(); }
}

async function compose(outDir, results, { chromium, title }) {
  const filmed = results.filter((r) => r.steps.length && existsSync(join(outDir, r.name, "video.webm")));
  const after = filmed.find((r) => r.name === "after");
  // The video exists to show the change working: an "after" side that did not pass every step shows nothing.
  if (!after || after.steps.some((s) => !s.ok)) return "no video: the after side did not pass every step";
  const ff = findFfmpeg();
  if (!ff) return "no video: ffmpeg not found (brew install ffmpeg-full)";
  const fontSrc = ff.text && (process.env.QA_VIDEO_FONT || FONTS.find((f) => existsSync(f)));
  // Relative paths with cwd = outDir: the filter graph forbids spaces and quotes in paths.
  await rm(join(outDir, "txt"), { recursive: true, force: true });
  await mkdir(join(outDir, "txt"));
  if (fontSrc) await copyFile(fontSrc, join(outDir, "txt", "font.ttf"));
  const plan = planCuts(filmed);
  const { filter, texts, width, height } = buildFilter(plan, { textDir: "txt", font: fontSrc ? "txt/font.ttf" : null });
  for (const [n, t] of Object.entries(texts)) await writeFile(join(outDir, "txt", n), t);
  await renderCard(chromium, join(outDir, "txt", "card.png"), { width, height, title, sides: filmed.map((r) => r.name) });
  execFileSync(ff.bin, ffmpegArgs({ inputs: filmed.map((r) => `${r.name}/video.webm`), filter, total: plan.total, out: "video.mp4", card: "txt/card.png" }), { cwd: outDir, stdio: "inherit" });
  return `video: ${join(outDir, "video.mp4")}${fontSrc ? "" : " (no labels: this ffmpeg has no drawtext — brew install ffmpeg-full)"}`;
}

async function main(argv) {
  const opt = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const [scriptPath, outDir, ...pairs] = argv.filter((a) => !a.startsWith("--"));
  const sides = pairs.map((p) => ({ name: p.slice(0, p.indexOf("=")), baseUrl: p.slice(p.indexOf("=") + 1) }));
  if (!scriptPath || !outDir || !sides.length || sides.some((s) => !["before", "after"].includes(s.name) || !/^https?:\/\/[^\s]+$/.test(s.baseUrl))) {
    console.error("usage: node record.mjs <script.mjs> <outDir> [--storage=<file>] [--slowmo=<ms>] [before=<url>] after=<url>");
    process.exit(2);
  }
  const slowmoArg = opt("slowmo");
  const slowmoMs = slowmoArg ? Number(slowmoArg) : NaN;
  const slowMo = Math.min(1000, Math.max(0, Number.isNaN(slowmoMs) ? 250 : slowmoMs));
  const storage = opt("storage") && resolve(opt("storage"));
  const pw = loadPlaywright();
  const script = await import(pathToFileURL(resolve(scriptPath)).href);
  if (typeof script.default !== "function") { console.error("the script has no default export"); process.exit(2); }
  const login = process.env.QA_LOGIN ?? "";
  const i = login.indexOf(":");
  const [email, password] = i < 0 ? ["", ""] : [login.slice(0, i), login.slice(i + 1)];
  const results = await Promise.all(sides.map((s) => recordSide(pw, script, { ...s, outDir, email, password, slowMo, storage })));
  for (const r of results) {
    const bad = r.steps.find((s) => !s.ok);
    console.log(`${r.name}: ${r.ok ? "ok" : `FAILED — ${r.error ?? `${bad?.label}: ${bad?.error}`}`}`);
  }
  if (sides.length === 2 || argv.includes("--video")) console.log(await compose(outDir, results, { chromium: pw.chromium, title: typeof script.title === "string" ? script.title.slice(0, 200) : "" }));
  process.exit(results.find((r) => r.name === "after")?.ok ? 0 : 1);
}

// realpath: the skill is reached through the ~/.claude/skills symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(firstLine(e)); process.exit(1); });
}
