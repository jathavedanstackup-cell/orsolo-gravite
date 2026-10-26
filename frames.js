// Path-traced sequences rendered in Cycles (blender/watch.py), drawn on a fixed canvas from the first
// pixel down through the movement chapter. Live WebGL takes over afterwards.
//   intro:   plays on load; the watch turns into pose under a sweeping strip light
//   bridge:  scrubbed by scroll from the hero pose to the movement chapter's first pose
//   explode: scrubbed by scroll through the movement chapter
// Every sequence boundary shares a pose with its neighbour, so the hand-offs are seamless.
const SEQUENCES = {
  intro: { count: 48, dir: "frames/intro/" },
  bridge: { count: 16, dir: "frames/bridge/" },
  explode: { count: 72, dir: "frames/explode/" },
  // The camera path after the exploded view, matching SEGMENTS in blender/watch.py.
  reassemble: { count: 12, dir: "frames/path/reassemble/" },
  approach: { count: 24, dir: "frames/path/approach/" },
  hold: { count: 8, dir: "frames/path/hold/" },
  dive: { count: 10, dir: "frames/path/dive/" },
  emerge: { count: 10, dir: "frames/path/emerge/" },
  craft: { count: 36, dir: "frames/path/craft/" },
};
const PATH_SCENES = { reassemble: "tourbillon", approach: "tourbillon", hold: "tourbillon", dive: "tourbillon", emerge: "craft", craft: "craft" };
const OUT_FADE = 0.05; // share of the movement chapter used to hand back to live WebGL
const MIN_ASPECT = 1.25; // renders are 16:10; portrait screens keep the live scene
const LOAD_TIMEOUT_MS = 9000;

export function createFrames({ reduced, onProgress }) {
  const canvas = document.getElementById("frames");
  const ctx = canvas.getContext("2d");
  const images = Object.fromEntries(Object.keys(SEQUENCES).map((k) => [k, []]));
  const fit = { scale: 1, ox: 0, oy: 0, iw: 1280, ih: 800 };
  let anchors = null, drawn = "", lastExplode = -1;
  const enabled = () => !reduced && innerWidth >= 960 && innerWidth / innerHeight >= MIN_ASPECT;

  function fetchSequence(name, order) {
    const { count, dir } = SEQUENCES[name];
    return (order || [...Array(count).keys()]).map((i) => new Promise((done) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => { images[name][i] = img; done(); };
      img.onerror = done;
      img.src = `${dir}f${String(i).padStart(3, "0")}.webp`;
    }));
  }

  // Resolves when the intro is ready to play (or there is nothing to wait for).
  function load() {
    if (!enabled()) return Promise.resolve(false);
    fetch("frames/anchors.json").then((r) => r.json()).then((d) => { anchors = d.anchors; }).catch(() => {});
    const intro = fetchSequence("intro");
    let done = 0;
    intro.forEach((p) => p.then(() => onProgress(++done / intro.length)));
    const introReady = Promise.all(intro);
    introReady.then(() => {
      fetchSequence("bridge");
      const n = SEQUENCES.explode.count;
      Promise.all(fetchSequence("explode", [...Array(n).keys()].sort((a, b) => (a % 8) - (b % 8) || a - b)))
        .then(() => Object.keys(PATH_SCENES).forEach((name) => fetchSequence(name)));
    });
    const timeout = new Promise((r) => setTimeout(r, LOAD_TIMEOUT_MS));
    return Promise.race([introReady, timeout]).then(() => images.intro.filter(Boolean).length > SEQUENCES.intro.count / 2);
  }

  function size() {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    fit.scale = Math.max(canvas.width / fit.iw, canvas.height / fit.ih);
    fit.ox = (canvas.width - fit.iw * fit.scale) / 2;
    fit.oy = (canvas.height - fit.ih * fit.scale) / 2;
    drawn = "";
  }

  function nearest(list, i, count) {
    for (let d = 0; d < count; d++) {
      if (list[i - d]) return list[i - d];
      if (list[i + d]) return list[i + d];
    }
    return null;
  }

  // Draws a fractional frame position, blending into the next frame for smooth scrubbing.
  function draw(name, position) {
    const { count } = SEQUENCES[name];
    const p = Math.min(count - 1, Math.max(0, position));
    const i = Math.floor(p), frac = p - i;
    const key = `${name}:${i}:${frac.toFixed(2)}`;
    if (key === drawn) return true;
    const list = images[name];
    const a = nearest(list, i, count), b = list[Math.min(count - 1, i + 1)];
    if (!a) return false;
    drawn = key;
    const w = fit.iw * fit.scale, h = fit.ih * fit.scale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(a, fit.ox, fit.oy, w, h);
    if (b && frac > 0.02) {
      ctx.globalAlpha = frac;
      ctx.drawImage(b, fit.ox, fit.oy, w, h);
      ctx.globalAlpha = 1;
    }
    return true;
  }

  return {
    load,
    size,
    get active() { return enabled() && images.intro.length > 0; },

    // intro 0..1 (time), hero 0..1 (scroll from top to the movement chapter), movement 0..1,
    // path: { name, u, fade } once the exploded view hands over to the camera path, else null.
    // Returns how much the renders cover the live scene, and which scene they show.
    update({ intro, hero, movement, path }) {
      let cover = 0, scene = "";
      if (enabled()) {
        if (path) {
          scene = PATH_SCENES[path.name];
          lastExplode = -1;
          const ok = draw(path.name, path.u * (SEQUENCES[path.name].count - 1));
          cover = ok ? path.fade : 0;
        } else if (movement > 0) {
          scene = "movement";
          lastExplode = movement;
          // The camera path picks up before the chapter ends; this fade only matters if it failed to load.
          cover = movement >= 1 ? 0 : Math.min(1, (1 - movement) / OUT_FADE);
          if (cover > 0 && !draw("explode", movement * (SEQUENCES.explode.count - 1))) cover = 0;
        } else {
          scene = "hero";
          lastExplode = -1;
          const ok = hero > 0.002 || intro >= 1
            ? draw("bridge", hero * (SEQUENCES.bridge.count - 1)) || draw("intro", SEQUENCES.intro.count - 1)
            : draw("intro", intro * (SEQUENCES.intro.count - 1));
          cover = ok ? 1 : 0;
        }
      }
      canvas.style.opacity = cover.toFixed(3);
      document.documentElement.dataset.scene = cover > 0.5 ? scene : "";
      return cover;
    },

    // Screen position (CSS px) of a caption's part in the current exploded frame, from Blender's projection.
    anchor(caption) {
      if (!anchors || lastExplode < 0) return null;
      const f = anchors[Math.round(Math.min(1, lastExplode) * (SEQUENCES.explode.count - 1))];
      if (!f || !f[caption]) return null;
      const dpr = canvas.width / innerWidth;
      return [(fit.ox + f[caption][0] * fit.iw * fit.scale) / dpr, (fit.oy + f[caption][1] * fit.ih * fit.scale) / dpr];
    },
  };
}
