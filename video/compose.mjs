// compose.mjs — the before/after video's cut list and ffmpeg filter graph. Pure: no I/O.
// Full size per side: halving a 1280-wide page made its text unreadable.
const W = 1280, H = 800, HEAD = 56, SUB = 72, FPS = 25;
const HEADER_BG = { before: "0x52525b", after: "0x15803d" };
const HEADER = { before: "avant", after: "après" };
const SAFE_PATH = /^[A-Za-z0-9/._-]+$/;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Per step: cut dead time, compress to the budget (×4 max, then trim the middle), sync both sides on the slowest. */
export function planCuts(sides, { stepS = 2.5, holdS = 1.5 } = {}) {
  const n = Math.max(0, ...sides.map((x) => x.steps.length));
  const segs = sides.map(() => []);
  const slots = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const cuts = sides.map((x) => {
      const st = x.steps[i];
      if (!st) return null;
      const d = Math.max(0.1, st.end - st.start);
      const keep = Math.min(d, 4 * stepS);
      const from = r3(st.start + (d - keep) / 2);
      const speed = r3(Math.min(4, Math.max(1, keep / stepS)));
      return { from, to: r3(from + keep), speed, shown: r3(keep / speed) };
    });
    const slot = Math.max(...cuts.filter(Boolean).map((c) => c.shown));
    const labelSide = sides.find((x) => x.name === "after" && x.steps[i]) ?? sides.find((x) => x.steps[i]);
    slots.push({ a: r3(t), b: r3(t + slot), label: labelSide.steps[i].label });
    cuts.forEach((c, k) => { if (c) segs[k].push({ ...c, pad: r3(slot - c.shown) }); });
    t += slot;
  }
  const total = r3(t + holdS);
  return {
    total, slots,
    sides: sides.map((x, k) => {
      const used = segs[k].reduce((acc, c) => acc + c.shown + c.pad, 0);
      const f = x.steps.findIndex((st) => !st.ok);
      return { name: x.name, segs: segs[k], tail: r3(total - used), failAt: f < 0 ? null : f };
    }),
  };
}

// font = null: ffmpeg has no drawtext (Homebrew's default build) — coloured bars only, no labels.
export function buildFilter(plan, { textDir, font }) {
  for (const p of [textDir, font ?? textDir]) if (!SAFE_PATH.test(p)) throw new Error(`unsafe path for the filter graph: ${p}`);
  if (plan.sides.some((s) => s.segs.length === 0)) throw new Error("a side has no steps");
  const texts = {};
  const text = (name, content) => { texts[name] = content; return `textfile='${textDir}/${name}'`; };
  // expansion=none: drawtext would otherwise expand %{...} in the (model-authored) label text.
  const dt = (file, extra) => `drawtext=fontfile='${font}':${file}:${extra}:expansion=none`;
  const txt = (...f) => (font ? `,${f.join(",")}` : "");
  const parts = [];
  plan.sides.forEach((side, k) => {
    const m = side.segs.length;
    // Chromium emits a frame only when the page changes, so a webm stops at its last change, short of the timeline:
    // a trim past that end is empty and the half freezes before its banner (Roméo #16). Constant rate + held last frame.
    parts.push(`[${k}:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=120,split=${m}${side.segs.map((_, j) => `[s${k}i${j}]`).join("")}`);
    side.segs.forEach((c, j) => parts.push(
      `[s${k}i${j}]trim=start=${c.from}:end=${c.to},setpts=(PTS-STARTPTS)/${c.speed},fps=${FPS},tpad=stop_mode=clone:stop_duration=${c.pad}[s${k}c${j}]`));
    const last = side.failAt ?? side.segs.length - 1;
    const bannerAt = plan.slots[last]?.a ?? 0;
    const failed = side.failAt !== null;
    const label = HEADER[side.name] ?? side.name;
    // Plain text, not ✓/✗: Liberation Sans (the box font) has neither glyph and would draw empty boxes.
    const banner = `${failed ? "KO" : "OK"} · ${plan.slots[last]?.label ?? ""}`;
    parts.push(`${side.segs.map((_, j) => `[s${k}c${j}]`).join("")}concat=n=${m}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${side.tail},`
      + `scale=${W}:${H},pad=${W}:${H + HEAD}:0:${HEAD}:color=${HEADER_BG[side.name] ?? "0x52525b"},`
      + `drawbox=x=0:y=${HEAD + H - 60}:w=${W}:h=56:color=${failed ? "0xdc2626" : "0x16a34a"}@0.92:t=fill:enable='gte(t,${bannerAt})'`
      + txt(dt(text(`head-${k}.txt`, label), "fontcolor=white:fontsize=28:x=18:y=14"),
        dt(text(`banner-${k}.txt`, banner), `fontcolor=white:fontsize=26:x=18:y=${HEAD + H - 47}:enable='gte(t,${bannerAt})'`)) + `[v${k}]`);
  });
  const two = plan.sides.length > 1;
  const subs = !font ? [] : plan.slots.map((sl, i) => dt(text(`sub-${i}.txt`, sl.label), `fontcolor=white:fontsize=32:x=(w-text_w)/2:y=h-52:enable='between(t,${sl.a},${sl.b})'`));
  parts.push(`${two ? "[v0][v1]hstack=inputs=2," : "[v0]"}${font ? `pad=iw:ih+${SUB}:0:0:color=0x111111` : "null"}${subs.length ? `,${subs.join(",")}` : ""}[out]`);
  return { filter: parts.join(";"), texts, width: two ? 2 * W : W, height: H + HEAD + (font ? SUB : 0) };
}

// card: a still PNG of the output size, shown for cardS seconds before the side-by-side (title + which side is which).
export function ffmpegArgs({ inputs, filter, total, out, crf = 20, card = null, cardS = 3 }) {
  const n = inputs.length;
  const graph = card
    ? `${filter.replace(/\[out\]$/, "[main]")};[${n}:v]fps=${FPS},setsar=1,format=yuv420p[card];[main]setsar=1,format=yuv420p[m];[card][m]concat=n=2:v=1:a=0[out]`
    : filter;
  return ["-y", "-hide_banner", "-loglevel", "error",
    ...inputs.flatMap((i) => ["-protocol_whitelist", "file", "-f", "matroska", "-i", i]),
    ...(card ? ["-loop", "1", "-framerate", String(FPS), "-t", String(cardS), "-i", card] : []),
    "-filter_complex", graph, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", String(crf),
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", String(total + (card ? cardS : 0)), out];
}
