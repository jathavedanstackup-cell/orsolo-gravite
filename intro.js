// Title sequence. ORSOLO has three O's, and an O is a dial: the word cuts in one letter per escapement
// tick, its letterforms become windows onto path-traced macro footage, and the camera flies through
// the O nearest the watch into the page. Drawn on one 2D canvas; the site renders live underneath.
import { FRAME_VERSION } from "./frames.js";
import { createScore } from "./score.js";

const WORD = "ORSOLO";
const O_INDEXES = [0, 3, 5];
const DPR_CAP = 1.5;
const LOAD_TIMEOUT_MS = 12000;
const STEEL = { dark: "#2b3243", mid: "#8a93a6", light: "#f3f4f7" };
// Hard cuts inside the letterforms, one per pair of ticks. Frames are scrubbed with crossfades.
const SHOTS = [
  { dir: "frames/path/emerge/", from: 0, to: 9, caption: "Calibre OR-01" },
  { dir: "frames/path/dive/", from: 2, to: 9, caption: "23 rubies" },
  { dir: "frames/path/craft/", from: 0, to: 11, caption: "Every edge bevelled by hand" },
  { dir: "frames/explode/", from: 28, to: 50, step: 2, caption: "340 hours, one pair of hands" },
];
const T = { letters: 0.45, tick: 0.36, streak: 2.55, footage: 3.2, shot: 0.8, title: 6.4, zoom: 7.35, zoomLen: 1.45 };

const frameUrl = (dir, i) => `${dir}f${String(i).padStart(3, "0")}.webp?v=${FRAME_VERSION}`;
const smooth = (t) => t * t * (3 - 2 * t);

export function createIntro({ reduced }) {
  const root = document.getElementById("intro");
  const canvas = document.getElementById("introFilm");
  const ctx = canvas.getContext("2d");
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d");
  const $ = (s) => root.querySelector(s);
  const shots = SHOTS.map((s) => ({ ...s, images: [] }));
  const st = { shown: 0, flash: 0, sheen: -0.4, footage: 0, shot: 0, shotT: 0, push: 1, zoom: 0, hole: 0, title: 0 };
  const layout = { size: 0, x: [], y: 0, width: 0, counter: { rx: 0, ry: 0 }, target: null };
  const score = createScore();
  let progress = { site: 0, film: 0 }, timeline = null, soundOn = false;

  document.documentElement.classList.add("is-intro");
  const inertables = ["#nav", "#main", ".foot"].map((s) => document.querySelector(s)).filter(Boolean);
  inertables.forEach((el) => { el.inert = true; });

  function showProgress() {
    const f = (progress.site + progress.film) / 2;
    $("#introBar").style.transform = `scaleX(${f})`;
    $("#introProgress").textContent = f < 1 ? `${Math.round(f * 100)}` : "";
  }

  function loadFootage() {
    const jobs = [];
    shots.forEach((shot) => {
      for (let i = shot.from, k = 0; i <= shot.to; i += shot.step || 1, k++) {
        jobs.push(new Promise((done) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => { shot.images[k] = img; done(); };
          img.onerror = done;
          img.src = frameUrl(shot.dir, i);
        }));
      }
    });
    let n = 0;
    jobs.forEach((p) => p.then(() => { progress.film = ++n / jobs.length; showProgress(); }));
    return Promise.all(jobs);
  }

  // Word metrics in CSS px: letter origins, and the inner counter of the O as an ellipse.
  function measure() {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio, DPR_CAP);
    canvas.width = mask.width = Math.round(w * dpr);
    canvas.height = mask.height = Math.round(h * dpr);
    const font = (px) => `500 ${px}px "Bodoni Moda", Didot, serif`;
    // Portrait screens stack the word as ORS / OLO, so it reads as a poster rather than a thin line.
    const rows = w / h < 0.8 ? [WORD.slice(0, 3), WORD.slice(3)] : [WORD];
    ctx.font = font(100);
    const widest = Math.max(...rows.map((r) => ctx.measureText(r).width));
    const size = Math.min((w * (rows.length > 1 ? 0.8 : 0.84)) / widest * 100, h * (rows.length > 1 ? 0.22 : 0.42));
    ctx.font = font(size);
    const m = ctx.measureText("O");
    const cap = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent;
    const lineGap = cap * 1.18;
    layout.size = size;
    layout.x = [];
    layout.base = [];
    rows.forEach((row, r) => {
      const x0 = (w - ctx.measureText(row).width) / 2;
      const base = h * 0.5 + cap / 2 + (r - (rows.length - 1) / 2) * lineGap;
      [...row].forEach((_, i) => { layout.x.push(x0 + ctx.measureText(row.slice(0, i)).width); layout.base.push(base); });
    });
    layout.left = Math.min(...layout.x);
    layout.width = Math.max(...rows.map((row) => ctx.measureText(row).width));
    layout.oWidth = m.width;
    layout.cap = cap;
    layout.counter = counterOf(font(size), m);
  }

  // Scan the rendered glyph outward from its centre to find where the stroke begins.
  function counterOf(font, m) {
    const s = document.createElement("canvas");
    const w = Math.ceil(m.width) + 4, h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 4;
    s.width = w; s.height = h;
    const c = s.getContext("2d");
    c.font = font;
    c.fillText("O", 2, m.actualBoundingBoxAscent + 2);
    const data = c.getImageData(0, 0, w, h).data;
    const cx = Math.round(w / 2), cy = Math.round(h / 2);
    const alpha = (x, y) => data[(y * w + x) * 4 + 3];
    let rx = 0, ry = 0;
    while (cx + rx < w - 1 && alpha(cx + rx, cy) < 96) rx++;
    while (cy + ry < h - 1 && alpha(cx, cy + ry) < 96) ry++;
    return { rx: rx * 0.96, ry: ry * 0.96 };
  }

  const centreOf = (i) => ({ x: layout.x[i] + layout.oWidth / 2, y: layout.base[i] - layout.cap / 2 });

  // The O whose centre sits nearest the watch on screen; the camera flies through that one.
  function chooseO(target) {
    let best = O_INDEXES[0], bestD = Infinity;
    O_INDEXES.forEach((i) => {
      const c = centreOf(i);
      const d = Math.hypot(c.x - target.x, c.y - target.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function cover(img, scale) {
    const w = canvas.width, h = canvas.height;
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * scale;
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    return [(w - dw) / 2, (h - dh) / 2, dw, dh];
  }

  // Footage frame at a fractional position, blended with its neighbour so 12 fps reads as motion.
  function drawShot(c, shot, t, scale) {
    const list = shot.images, n = list.length;
    if (!n) return false;
    const p = Math.min(n - 1, Math.max(0, t * (n - 1)));
    const i = Math.floor(p), frac = p - i;
    const a = list[i] || list.find(Boolean), b = list[i + 1];
    if (!a) return false;
    // Dark steel behind the footage keeps the letterforms legible where a shot falls to black.
    c.fillStyle = "#1e2534";
    c.fillRect(0, 0, mask.width, mask.height);
    c.globalAlpha = 1;
    c.filter = "brightness(1.35) contrast(1.08)";
    c.drawImage(a, ...cover(a, scale));
    if (b && frac > 0.02) { c.globalAlpha = frac; c.drawImage(b, ...cover(b, scale)); c.globalAlpha = 1; }
    c.filter = "none";
    return true;
  }

  function letters(c, count, style) {
    c.font = `500 ${layout.size}px "Bodoni Moda", Didot, serif`;
    c.fillStyle = style;
    for (let i = 0; i < count; i++) c.fillText(WORD[i], layout.x[i], layout.base[i]);
  }

  function steel() {
    const g = ctx.createLinearGradient(layout.left, 0, layout.left + layout.width, 0);
    const s = st.sheen;
    g.addColorStop(0, STEEL.mid);
    g.addColorStop(Math.min(1, Math.max(0, s - 0.16)), STEEL.mid);
    g.addColorStop(Math.min(1, Math.max(0, s)), STEEL.light);
    g.addColorStop(Math.min(1, Math.max(0, s + 0.16)), STEEL.dark);
    g.addColorStop(1, STEEL.mid);
    return g;
  }

  function render() {
    const dpr = canvas.width / innerWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#06080e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Camera: fly through the chosen O. Its centre travels to the watch while the word scales past the lens.
    const o = layout.o ?? 3;
    const oc = centreOf(o);
    const z = st.zoom, e = z * z * z;
    const reach = Math.hypot(innerWidth, innerHeight) / Math.min(layout.counter.rx, layout.counter.ry);
    const scale = 1 + (reach * 1.15 - 1) * e;
    const tgt = layout.target || oc;
    const cx = oc.x + (tgt.x - oc.x) * smooth(Math.min(1, z * 1.4)), cy = oc.y + (tgt.y - oc.y) * smooth(Math.min(1, z * 1.4));
    const toWord = (c) => c.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (cx - oc.x * scale), dpr * (cy - oc.y * scale));

    // Letters: polished steel, or windows onto the footage.
    toWord(ctx);
    ctx.font = `500 ${layout.size}px "Bodoni Moda", Didot, serif`;
    if (st.footage > 0 && shots[st.shot]) {
      // Stencil first, then the footage atop it: per-letter destination-in would erase every earlier letter.
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.globalCompositeOperation = "source-over";
      mctx.clearRect(0, 0, mask.width, mask.height);
      toWord(mctx);
      letters(mctx, st.shown, "#fff");
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.globalCompositeOperation = "source-atop";
      if (drawShot(mctx, shots[st.shot], st.shotT, st.push)) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = st.footage;
        ctx.drawImage(mask, 0, 0);
        ctx.restore();
      }
    }
    if (st.footage < 1) {
      // Letters darken as they pass the lens, so the fly-through reads as a dark aperture, not a grey slab.
      const passing = 1 - smooth(Math.min(1, Math.max(0, (z - 0.25) / 0.45)));
      ctx.globalAlpha = (1 - st.footage) * passing;
      letters(ctx, st.shown, steel());
      ctx.globalAlpha = 1;
    }
    // Each letter lands with a brief overexposure, like a strobe on polished metal.
    if (st.flash > 0 && st.shown > 0) {
      ctx.globalAlpha = st.flash;
      ctx.fillStyle = "#fff";
      ctx.fillText(WORD[st.shown - 1], layout.x[st.shown - 1], layout.base[st.shown - 1]);
      ctx.globalAlpha = 1;
    }
    // Hairline edge keeps the letterforms crisp over dark footage.
    if (st.footage > 0) {
      ctx.lineWidth = 0.6 / scale;
      ctx.strokeStyle = `rgba(232, 234, 239, ${0.28 * st.footage})`;
      for (let i = 0; i < st.shown; i++) ctx.strokeText(WORD[i], layout.x[i], layout.base[i]);
    }
    // The counter of the chosen O opens onto the page beneath.
    if (st.hole > 0) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = st.hole;
      ctx.beginPath();
      ctx.ellipse(oc.x, oc.y, layout.counter.rx, layout.counter.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    $("#introTc").textContent = timecode(timeline ? timeline.time() : 0);
  }

  function timecode(t) {
    const f = Math.floor(t * 24);
    const pad = (n) => String(n).padStart(2, "0");
    return `00:00:${pad(Math.floor(f / 24))}:${pad(f % 24)}`;
  }

  function caption(text) {
    const el = $("#introSuper");
    if (el.textContent === text) return;
    gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.45, ease: "expo.out", onStart: () => { el.textContent = text; } });
  }

  function build(onReveal) {
    const tl = gsap.timeline({ paused: true, onUpdate: render });
    tl.call(() => score.drone(true), null, 0.05);
    // ORSOLO, one letter per tick.
    [...WORD].forEach((_, i) => {
      const at = T.letters + i * T.tick;
      tl.call(() => { st.shown = i + 1; score.tick(i % 2 === 1); }, null, at);
      tl.fromTo(st, { flash: 0.85 }, { flash: 0, duration: 0.3, ease: "power2.out", immediateRender: false }, at);
    });
    // A specular sweep and an anamorphic streak cross the finished word.
    tl.fromTo(st, { sheen: -0.4 }, { sheen: 1.4, duration: 1.1, ease: "power2.inOut" }, T.streak);
    tl.fromTo(".intro__streak", { scaleX: 0, opacity: 0, xPercent: -30 },
      { keyframes: [{ scaleX: 1, opacity: 1, xPercent: 0, duration: 0.45, ease: "expo.out" }, { opacity: 0, xPercent: 30, duration: 0.6, ease: "power2.in" }] }, T.streak + 0.1);
    // The letterforms become windows: four hard cuts on the tick, with a slow push-in.
    tl.to(st, { footage: 1, duration: 0.12, ease: "none" }, T.footage);
    tl.fromTo(st, { push: 1.12 }, { push: 1, duration: SHOTS.length * T.shot, ease: "none" }, T.footage);
    SHOTS.forEach((shot, i) => {
      const at = T.footage + i * T.shot;
      tl.call(() => { st.shot = i; score.tick(false); caption(shot.caption); }, null, at);
      tl.fromTo(st, { shotT: 0 }, { shotT: 1, duration: T.shot, ease: "none", immediateRender: false }, at);
    });
    // Cut back to steel on a low boom; the model name sets beneath.
    tl.call(() => { score.boom(); caption(""); }, null, T.title);
    tl.to(st, { footage: 0, duration: 0.08, ease: "none" }, T.title);
    tl.fromTo(st, { sheen: -0.4 }, { sheen: 1.4, duration: 1.4, ease: "power2.inOut", immediateRender: false }, T.title);
    tl.fromTo("#introSub", { opacity: 0, y: 14, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.9, ease: "expo.out" }, T.title + 0.15);
    // Fly through the O. The page starts its own opening as the counter opens onto it.
    tl.call(() => score.rise(), null, T.zoom - 0.5);
    tl.to("#introSub", { opacity: 0, y: -10, duration: 0.35, ease: "power2.in" }, T.zoom - 0.35);
    tl.call(() => onReveal(), null, T.zoom);
    tl.to(st, { hole: 1, duration: 0.25, ease: "none" }, T.zoom);
    tl.to(st, { zoom: 1, duration: T.zoomLen, ease: "none" }, T.zoom);
    tl.to(".intro__bar--top", { yPercent: -100, duration: 0.9, ease: "expo.inOut" }, T.zoom + 0.55);
    tl.to(".intro__bar--bottom", { yPercent: 100, duration: 0.9, ease: "expo.inOut" }, T.zoom + 0.55);
    tl.to(["#introSkip", "#introTc"], { opacity: 0, duration: 0.3 }, T.zoom + 0.3);
    tl.call(finish, null, T.zoom + T.zoomLen);
    return tl;
  }

  function finish() {
    if (root.hidden) return;
    score.drone(false);
    timeline?.kill();
    removeEventListener("keydown", onKey);
    removeEventListener("resize", onResize);
    inertables.forEach((el) => { el.inert = false; });
    document.documentElement.classList.remove("is-intro");
    root.hidden = true;
  }

  function skip() {
    if (!timeline || timeline.time() >= T.zoom - 0.4) return;
    st.shown = WORD.length; st.footage = 0; st.flash = 0;
    gsap.set("#introSub", { opacity: 1, y: 0, filter: "blur(0px)" });
    timeline.seek(T.zoom - 0.4, true);
  }

  function onKey(e) {
    if (e.key === "Escape" || ((e.key === " " || e.key === "Enter") && !root.querySelector(".intro__gate:not([hidden])"))) skip();
  }

  function onResize() {
    measure();
    layout.target = layout.targetFn?.() || null;
    layout.o = chooseO(layout.target || { x: innerWidth / 2, y: innerHeight / 2 });
    render();
  }

  return {
    progress(f) { progress.site = f; showProgress(); },

    // Resolves once the font and footage are ready (or the wait times out).
    load() {
      const font = document.fonts.load(`500 100px "Bodoni Moda"`).catch(() => {});
      const work = Promise.all([font, reduced ? Promise.resolve() : loadFootage()]);
      return Promise.race([work, new Promise((r) => setTimeout(r, LOAD_TIMEOUT_MS))]).then(() => { progress.film = 1; showProgress(); });
    },

    // Shows the gate, then plays the sequence. onReveal fires as the page should begin its own opening.
    // target() gives the watch's screen position, so the camera flies through the O into it.
    play({ onReveal, onSound, target }) {
      layout.targetFn = target;
      if (reduced) {
        onReveal();
        gsap.to(root, { opacity: 0, duration: 0.4, onComplete: finish });
        return;
      }
      measure();
      onResize();
      addEventListener("resize", onResize);
      const gate = $(".intro__gate"), enter = $(".intro__enter");
      enter.hidden = false;
      gsap.from(enter.children, { opacity: 0, y: 10, duration: 0.8, stagger: 0.08, ease: "expo.out" });
      enter.querySelector("button").focus({ preventScroll: true });
      enter.addEventListener("click", (e) => {
        const button = e.target.closest("button");
        if (!button) return;
        soundOn = button.dataset.sound === "on";
        if (soundOn) score.start();
        timeline = build(() => { onReveal(); if (soundOn) onSound(); });
        gsap.to(gate, { opacity: 0, duration: 0.5, ease: "power2.out", onComplete: () => { gate.hidden = true; } });
        $("#introSkip").hidden = false;
        gsap.from(["#introSkip", "#introTc"], { opacity: 0, duration: 0.8, delay: 0.6 });
        addEventListener("keydown", onKey);
        timeline.play(0);
      });
      $("#introSkip").addEventListener("click", skip);
    },
  };
}
