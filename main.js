import * as THREE from "three";
import { createStage } from "./stage.js";
import { createCallout, createDimensions, project } from "./overlay.js";
import { createFrames } from "./frames.js";
import { createDust, createLamp, createIris, createTicker } from "./fx.js";
import { createWinding } from "./wind.js";
import { initUi } from "./ui.js";
import { createIntro } from "./intro.js";

const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => t * t * (3 - 2 * t);
const band = (p, a, b, fade = 0.06) => Math.min(clamp01((p - a) / fade), clamp01((b - p) / fade));
if (reduced) document.documentElement.classList.add("rm");

/* ---------- Smooth scroll ---------- */
let lenis = null;
if (!reduced && window.Lenis) {
  lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
const scrollY = () => (lenis ? lenis.scroll : window.scrollY);

/* ---------- Stage ---------- */
const canvas = $("#stage");
const INK = new THREE.Color(0x0a0e18), BLUED = new THREE.Color(0x0d1936);
let gl = null, dust = null, lamp = null;
const flash = { v: 0 }, night = { v: 0 };
const drawIris = createIris();
const ticker = createTicker();
const winding = createWinding({ ticker });
const film = createIntro({ reduced });
const renders = createFrames({ reduced, onProgress: (f) => film.progress(f) });
const introPlay = { t: 0 };
const ui = initUi({
  lenis, reduced,
  onSound: (on) => ticker.set(on),
  onNight: (on) => gsap.to(night, { v: on ? 1 : 0, duration: reduced ? 0 : 1.4, ease: "power2.inOut", overwrite: true }),
  onDial: (name) => {
    if (!gl) return;
    gl.watch.setDial(name);
    // A light sweep across the case marks the change, like turning a watch under a lamp.
    if (!reduced) gsap.fromTo(flash, { v: 0 }, { v: 1, duration: 1.3, ease: "power2.inOut", overwrite: true });
  },
});

function initStage() {
  try {
    gl = createStage(canvas, INK);
    dust = createDust(gl.scene, reduced);
    lamp = createLamp(gl.scene);
  } catch (err) {
    gl = null;
    canvas.remove();
    document.documentElement.classList.add("no-gl");
    $("#glFallback").hidden = false;
  }
}

/* ---------- Scene keyframes pinned to section positions ----------
   ex explode, rx/ry tilt, mx/my model offset, cz camera distance,
   focus macro amount, fx/fy local point to frame, fd macro distance, ox/oy framing offset,
   fade stage opacity, tint background shift toward blued steel */
const KEYS = ["ex", "rx", "ry", "mx", "my", "cz", "focus", "fx", "fy", "fd", "ox", "oy", "fade", "tint"];
const BASE = { ex: 0, rx: 0, ry: 0, mx: 0, my: 0, cz: 9.5, focus: 0, fx: 0, fy: -0.62, fd: 3.4, ox: -0.75, oy: 0.05, fade: 1, tint: 0 };
const TURN = Math.PI * 2, BACK = Math.PI;
let frames = [];
const marks = { irisFrom: 0, irisTo: 1, flyFrom: 0, flyAt: 1, flyTo: 2, mvTop: 1, path: [], pathEnd: 0, pathFadeOut: 1 };

// Which rendered path segment covers scroll position y, and how far through it. After the last
// segment the renders hold their final frame while fading back to the live scene.
function pathAt(y) {
  for (const [name, y0, y1] of marks.path) {
    if (y >= y0 && y < y1) return { name, u: clamp01((y - y0) / Math.max(1, y1 - y0)), fade: 1 };
  }
  const past = y - marks.pathEnd;
  if (marks.path.length && past >= 0 && past < marks.pathFadeOut) return { name: "craft", u: 1, fade: 1 - past / marks.pathFadeOut };
  return null;
}
const isNarrow = () => innerWidth < 960;

function buildFrames() {
  const vh = innerHeight;
  const top = (sel) => $(sel).getBoundingClientRect().top + scrollY();
  const len = (sel) => $(sel).offsetHeight - vh;
  const n = isNarrow();
  const fit = n ? Math.max(1.5, 1.1 / (innerWidth / vh)) : Math.max(1, 1.75 / (innerWidth / vh));
  // `center` keeps the macro subject dead centre on every screen size (used for the fly-through).
  const S = (s) => {
    const f = { ...BASE, ...s };
    return {
      ...f, mx: n ? 0 : f.mx, my: n ? (s.myN ?? 0.85) : f.my, cz: f.cz * fit,
      ox: n || s.center ? 0 : f.ox, oy: s.center ? 0 : n ? -0.62 : f.oy, fd: f.fd * (n ? 1.35 : 1),
    };
  };
  const mv = top("#movement"), tb = top("#tourbillon"), hr = top("#hours"), hl = len("#hours");
  const sp = top("#specs"), sl = len("#specs");
  // The loupe iris closes during the dive into the tourbillon and reopens once it is framed.
  marks.mvTop = Math.max(1, mv);
  marks.irisFrom = tb - vh * 0.2;
  marks.irisTo = tb + len("#tourbillon") * 0.45;
  // Fly-through: dive into the aperture, cut to black, turn the watch over unseen, emerge on the movement side.
  const tbEnd = tb + len("#tourbillon");
  marks.flyFrom = tbEnd;
  marks.flyAt = tbEnd + (hr - tbEnd) * 0.5;
  marks.flyTo = hr;
  const inside = { focus: 1, fx: 0, fy: -0.62, fd: 0.32, center: true, tint: 1, mx: 0.7 };
  // Rendered camera path (desktop): the same keyframe boundaries as below, one sequence per span.
  marks.path = [
    ["reassemble", mv + len("#movement") * 0.95, tb - vh * 0.2],
    ["approach", tb - vh * 0.2, tb + len("#tourbillon") * 0.45],
    ["hold", tb + len("#tourbillon") * 0.45, tbEnd],
    ["dive", tbEnd, marks.flyAt],
    ["emerge", marks.flyAt, hr],
    ["craft", hr, hr + hl],
  ];
  marks.pathEnd = hr + hl;
  marks.pathFadeOut = vh * 0.25;
  // Craft chapter turns the watch over: the movement is shot through the sapphire caseback.
  const macro = { focus: 1, tint: 0.35, fade: 1, ex: 0, rx: 0.3, ry: BACK - 0.35, mx: 1.4 };
  // Specs chapter is a technical drawing: face-on for the diameter, then in profile for the thickness.
  // On phones the watch rides high, clear of the figures below.
  const drawing = { rx: 0, mx: 1.35, cz: 11.5, tint: 0.05, myN: 1.6 };
  frames = [
    [0, S({ rx: 0.24, ry: -0.55, mx: 1.35, cz: 11, myN: 0.95 })],
    [mv, S({ rx: 0.15, ry: -0.35, mx: 1.15, cz: 11 })],
    [mv + len("#movement") * 0.38, S({ ex: 1, rx: 0.55, ry: -1.0, mx: 1.2, cz: 14, myN: 1.15, tint: 0.15 })],
    [mv + len("#movement") * 0.95, S({ ex: 1, rx: 0.42, ry: -1.4, mx: 1.2, cz: 14, myN: 1.15, tint: 0.15 })],
    [tb - vh * 0.2, S({ mx: 0.7, cz: 9, tint: 0.5 })],
    [tb + len("#tourbillon") * 0.45, S({ mx: 0.7, cz: 9, focus: 1, tint: 1 })],
    [tbEnd, S({ mx: 0.7, cz: 9, focus: 1, tint: 1 })],
    [marks.flyAt - 1, S({ ...inside, ry: 0 })],
    [marks.flyAt, S({ ...inside, ry: BACK, rx: 0.3 })],
    // Craft steps: the camera visits the part each step is about.
    [hr, S({ ...macro, fx: 0, fy: 0.15, fd: 5.2, ox: -1.5, oy: -0.7 })],
    // Aimed at the bridges near the centre so no lug intrudes at the frame edge (matches the render).
    [hr + hl * 0.25, S({ ...macro, fx: 0.1, fy: 0.55, fd: 2.6, rx: 0.35, ry: BACK + 0.15, ox: -0.9, oy: -0.45 })],
    [hr + hl * 0.5, S({ ...macro, fx: 0, fy: -0.62, fd: 2.6, rx: 0.25, ry: BACK - 0.15, ox: -0.95, oy: -0.45 })],
    [hr + hl * 0.75, S({ ...macro, ex: 0.75, focus: 0.3, fx: 0, fy: 0, fd: 5, rx: 0.45, ry: BACK - 0.9, ox: -0.9, oy: -0.3 })],
    [hr + hl, S({ ...macro, fx: 0, fy: -0.62, fd: 2.2, rx: 0.1, ry: BACK, ox: -0.85, oy: -0.4 })],
    // Rotation keeps turning forward rather than unwinding back to the dial side.
    [sp, S({ ...drawing, ry: TURN })],
    [sp + sl * 0.42, S({ ...drawing, ry: TURN })],
    [sp + sl * 0.6, S({ ...drawing, ry: TURN + Math.PI / 2 })],
    [sp + sl, S({ ...drawing, ry: TURN + Math.PI / 2 })],
    // Wind chapter: crown turned toward the viewer so the grip sits on it.
    [top("#wind") - vh * 0.1, S({ rx: 0.12, ry: TURN * 2 - 1.05, mx: 1.0, cz: 8.6, myN: 1.6, tint: 0.1 })],
    [top("#wind") + vh * 0.2, S({ rx: 0.12, ry: TURN * 2 - 1.05, mx: 1.0, cz: 8.6, myN: 1.6, tint: 0.1 })],
    [top("#dial") + vh * 0.1, S({ rx: 0.18, ry: TURN * 2 - 0.3, mx: 1.15, cz: 10.5, myN: 1.6 })],
    [top("#finale"), S({ rx: 0.28, ry: TURN * 2 - 0.55, mx: 0, my: 0.85, cz: 13, fade: 0.9, myN: 0.9, tint: 0.2 })],
  ];
}

function sample(y) {
  if (y <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [y1, b] = frames[i];
    if (y <= y1) {
      const [y0, a] = frames[i - 1];
      const t = smooth(clamp01((y - y0) / Math.max(1, y1 - y0)));
      return Object.fromEntries(KEYS.map((k) => [k, a[k] + (b[k] - a[k]) * t]));
    }
  }
  return frames[frames.length - 1][1];
}

/* ---------- Render loop ---------- */
const drawCallout = createCallout();
const drawDims = createDimensions();
const partEls = $$(".part");
const current = {};
const intro = { v: reduced ? 0 : 1 };
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
  pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
}, { passive: true });

const point = new THREE.Vector3(), camWide = new THREE.Vector3(), camMacro = new THREE.Vector3();
const lookWide = new THREE.Vector3(), lookMacro = new THREE.Vector3(), introCam = new THREE.Vector3(), introLook = new THREE.Vector3();
const bg = new THREE.Color();
let lastBg = "";

function resize() {
  if (gl) gl.setSize(innerWidth, innerHeight);
  renders.size();
  ui.sizeHours();
  ScrollTrigger.refresh();
  buildFrames();
}

function placeCamera() {
  const { watch, camera } = gl;
  point.set(current.fx, current.fy, 0.1);
  watch.root.localToWorld(point);
  camWide.set(0, 0, current.cz);
  lookWide.set(0, 0, 0);
  camMacro.set(point.x + current.ox, point.y + current.oy, point.z + current.fd);
  lookMacro.set(point.x + current.ox, point.y + current.oy, point.z);
  const f = smooth(clamp01(current.focus));
  camera.position.lerpVectors(camWide, camMacro, f);
  const look = lookWide.lerp(lookMacro, f);
  let focusDist = camera.position.distanceTo(point), depth = f;

  // Opening shot: start inside the tourbillon in near darkness, pull back as the light comes up.
  if (intro.v > 0.001) {
    point.set(0, -0.62, 0.1);
    watch.root.localToWorld(point);
    introCam.set(point.x + 0.15, point.y + 0.1, point.z + 0.9);
    introLook.copy(point);
    const iv = smooth(intro.v);
    camera.position.lerp(introCam, iv);
    look.lerp(introLook, iv);
    focusDist = camera.position.distanceTo(point);
    depth = Math.max(depth, iv);
  }
  camera.lookAt(look);
  return { focusDist, depth };
}

function tick(_, deltaMs) {
  // While the title sequence fully covers the page, its own WebGL scene has the GPU to itself.
  if (film.opaque) return;
  const dt = Math.min(0.05, (deltaMs || 16) / 1000);
  const { caption, inMovement, specs, movement } = ui.update();
  // Path-traced frames cover the live scene from the hero through the movement chapter (desktop only).
  const cover = renders.update({ intro: introPlay.t, hero: clamp01(scrollY() / marks.mvTop), movement, path: pathAt(scrollY()) });
  if (!gl) { winding.update(null, dt); return; }
  const target = sample(scrollY());
  const k = reduced ? 1 : 1 - Math.pow(0.002, dt);
  KEYS.forEach((key) => { current[key] = current[key] === undefined ? target[key] : current[key] + (target[key] - current[key]) * k; });
  pointer.x += (pointer.tx - pointer.x) * 0.05;
  pointer.y += (pointer.ty - pointer.y) * 0.05;

  const { watch, scene } = gl;
  const sway = reduced ? 0 : Math.sin(performance.now() / 1000 * 0.35) * 0.05;
  const spin = Math.sin(Math.PI * flash.v) * 0.22;
  watch.root.position.set(current.mx, current.my, 0);
  watch.root.rotation.set(current.rx + pointer.y * 0.1, current.ry + sway + spin + pointer.x * 0.16, 0);
  watch.setExplode(current.ex, inMovement ? caption : -1);
  watch.root.updateMatrixWorld();
  const { focusDist, depth } = placeCamera();

  bg.copy(INK).lerp(BLUED, clamp01(current.tint));
  scene.background.copy(bg);
  const hex = `#${bg.getHexString()}`;
  if (hex !== lastBg) { lastBg = hex; document.body.style.backgroundColor = hex; }
  canvas.style.opacity = (current.fade * (1 - cover)).toFixed(3);

  gl.camera.updateMatrixWorld();
  winding.update(gl, dt);
  ui.setCageDeg(Math.floor(watch.update(dt, new Date(), reduced)));
  const showCallout = inMovement && current.ex > 0.85 && !isNarrow();
  const calloutPoint = !showCallout ? null : cover > 0.5 ? renders.anchor(caption) : project(gl, watch.anchorFor(caption));
  drawCallout(partEls[caption], calloutPoint);
  // The drawing needs room; on narrow screens the figures carry the chapter alone.
  drawDims(gl, isNarrow() ? [0, 0] : [band(specs, 0.06, 0.42), band(specs, 0.62, 0.98)]);
  const y = scrollY();
  const dive = clamp01((y - marks.irisFrom) / Math.max(1, marks.irisTo - marks.irisFrom));
  const half = Math.max(1, (marks.flyTo - marks.flyFrom) * 0.5);
  const fly = clamp01(1 - Math.abs(y - marks.flyAt) / half);
  // Fly-through goes fully black at its midpoint so the turn-over never shows.
  const flyClose = smooth(clamp01((fly - 0.35) / 0.5));
  drawIris(gl, reduced ? 0 : Math.max(Math.sin(Math.PI * dive) * 0.92, smooth(fly)), reduced ? 0 : flyClose);

  const dark = night.v, lit = 1 - dark;
  lamp.update(pointer.x, pointer.y, watch.root, isNarrow() || reduced ? 0 : lit * (1 - intro.v));
  dust.update(performance.now() / 1000, 0.32 * lit * (1 - intro.v * 0.6));
  // Lights out: the studio dims and the lume carries the dial. Emissive is boosted against the lower exposure.
  watch.setLume(dark * 16);
  // While the renders fully cover the stage, skip the WebGL frame entirely: the GPU gets a rest.
  if (cover > 0.999) return;
  gl.frame({
    sweep: flash.v,
    focusDist, depth,
    exposure: (1.05 - intro.v * 0.85 + Math.sin(Math.PI * flash.v) * 0.12) * (1 - dark * 0.78),
    keyPower: (1 - intro.v * 0.9 + Math.sin(Math.PI * flash.v) * 0.6) * (1 - dark * 0.95),
  });
  if (intro.v < 0.001) gl.measure(deltaMs || 16);
}

/* ---------- Boot ---------- */
addEventListener("resize", () => { clearTimeout(resize.t); resize.t = setTimeout(resize, 150); });
document.fonts.ready.then(() => {
  initStage();
  resize();
  gsap.ticker.add(tick);
  lenis?.stop();
  // The title sequence plays first. As it opens onto the page, desktop starts the path-traced opening;
  // phones and reduced motion open on the live scene's dive.
  Promise.all([renders.load(), film.load()]).then(([rendered]) => film.play({
    onSound: () => { const toggle = $("#soundToggle"); if (toggle.getAttribute("aria-pressed") !== "true") toggle.click(); },
    onReveal: () => {
      lenis?.start();
      ui.intro(gl ? canvas : null);
      if (rendered) {
        intro.v = 0;
        gsap.to(introPlay, { t: 1, duration: 3.8, ease: "power1.inOut", delay: 0.05 });
      } else if (!reduced && gl) {
        gsap.to(intro, { v: 0, duration: 3.6, ease: "expo.inOut", delay: 0.1 });
      }
    },
  }));
});
