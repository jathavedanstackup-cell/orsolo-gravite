// Title sequence, its own world: ORSOLO in extruded chrome and gold, standing in a bright ivory studio.
// The letters drop in on the tick, the three O's spin like a tourbillon cage, lock face-on, and the
// middle O's counter becomes a window cut through the canvas: the dark site shows inside the ring,
// and the camera dives through it.
import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { GLYPHS, CAP_HEIGHT } from "./glyphs.js";

const WORD = "ORSOLO";
const PORTAL = 3; // the middle O
const SPIN_AXES = { 0: [0, 1, 0], 3: [1, 0, 0], 5: [1, 1, 0] };
const IVORY = 0xf1ece3;
const DPR_CAP = 1.75;
const FOV = 30;
const EXTRUDE = { depth: 0.16, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.009, bevelSegments: 4, curveSegments: 18 };
const T = { drop: 0.35, dropGap: 0.2, spin: 1.9, lock: 5.0, reveal: 5.25, dive: 5.95, diveLen: 1.15, match: 5.95, matchLen: 1.25, iris: 1.0 };

const smooth = (t) => t * t * (3 - 2 * t);

// What the chrome reflects: a pale set with black flags beside and below the word and a hot softbox
// overhead. On a white set, chrome only reads as chrome if something dark is there for it to mirror.
function studioReflections() {
  const env = new THREE.Scene();
  const panel = (w, h, color, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  env.add(new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: 0xcfc8bc, side: THREE.BackSide })));
  panel(7, 9, 0x050505, 1, [-5.5, 1, 0.5], [0, 0, 0]);       // flag, left
  panel(7, 9, 0x050505, 1, [5.5, 1, 0.5], [0, 0, 0]);        // flag, right
  panel(14, 2.4, 0x080808, 1, [0, -2.2, 5], [0, 0, 0]);      // low front card: dark band along the faces
  panel(16, 2.6, 0x060606, 1, [0, 0.9, 9.5], [0, 0.9, 0]);   // card behind the lens: the horizon band face-on
  panel(10, 3.5, 0xffffff, 9, [0, 5.5, 1], [0, 0, 0]);       // softbox overhead
  panel(2.2, 8, 0xfff0d8, 5, [3.5, 1.5, -5], [0, 0, 0]);     // warm strip, back right
  panel(1.4, 6, 0xffffff, 4, [-3.2, 0.5, 4.5], [0, 0, 0]);   // kicker, front left
  return env;
}

function glyphShapes(ch) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${GLYPHS[ch].d}"/></svg>`;
  return new SVGLoader().parse(svg).paths.flatMap((p) => SVGLoader.createShapes(p));
}

export function createIntro({ reduced }) {
  const root = document.getElementById("intro");
  const canvas = document.getElementById("introFilm");
  const $ = (s) => root.querySelector(s);
  const st = { orbit: 0, lift: 1, close: 0, dive: 0, portal: 0, spin: 0, lock: 0, match: 0, others: 0, melt: 0, iris: 0 };
  let three = null, timeline = null, started = false, targetFn = null, matchTo = null;

  document.documentElement.classList.add("is-intro");
  const inertables = ["#nav", "#main", ".foot"].map((s) => document.querySelector(s)).filter(Boolean);
  inertables.forEach((el) => { el.inert = true; });

  function showProgress(f) {
    $("#introBar").style.transform = `scaleX(${f})`;
    $("#introProgress").textContent = f < 1 ? `${Math.round(f * 100)}` : "";
  }

  // ---------- scene ----------
  function build() {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, DPR_CAP));
    renderer.setClearColor(IVORY, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const reflections = studioReflections();
    scene.environment = pmrem.fromScene(reflections, 0.02).texture;
    reflections.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    pmrem.dispose();

    const chrome = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f8, metalness: 1, roughness: 0.05, envMapIntensity: 1.1 });
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xe0ac4c, metalness: 1, roughness: 0.16, envMapIntensity: 1.2 });

    // Lay the word out in em units, centred, baseline on the studio floor.
    const advances = [...WORD].map((ch) => GLYPHS[ch].advance);
    const width = advances.reduce((a, b) => a + b, 0);
    const word = new THREE.Group();
    scene.add(word);
    const letters = [];
    let pen = -width / 2;
    [...WORD].forEach((ch, i) => {
      const shapes = glyphShapes(ch);
      const geo = new THREE.ExtrudeGeometry(shapes, EXTRUDE);
      geo.computeBoundingBox();
      const c = new THREE.Vector3();
      geo.boundingBox.getCenter(c);
      geo.translate(-c.x, -c.y, -c.z);
      const mesh = new THREE.Mesh(geo, [chrome, gold]);
      mesh.scale.y = -1; // SVG outlines are y-down
      mesh.castShadow = true;
      const pivot = new THREE.Group();
      pivot.add(mesh);
      const home = new THREE.Vector3(pen + c.x, -c.y, 0);
      pivot.position.copy(home);
      word.add(pivot);
      letters.push({ pivot, home, shapes, fall: new THREE.Euler((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.4) });
      pen += advances[i];
    });

    // The middle O's counter: a mesh that writes transparent pixels, so the page shows through the ring.
    const hole = letters[PORTAL].shapes[0].holes[0];
    const portalGeo = new THREE.ShapeGeometry(new THREE.Shape(hole.getPoints(48)));
    const portalMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, depthWrite: false });
    const portal = new THREE.Mesh(portalGeo, portalMat);
    const oMesh = letters[PORTAL].pivot.children[0];
    // The O keeps its own materials, so the other letters can fade out around it during the match cut.
    const oChrome = chrome.clone(), oGold = gold.clone();
    oMesh.material = [oChrome, oGold];
    [chrome, gold, oChrome, oGold].forEach((m) => { m.transparent = true; });
    const oBox = oMesh.geometry.boundingBox;
    const oHalf = new THREE.Vector2((oBox.max.x - oBox.min.x) / 2, (oBox.max.y - oBox.min.y) / 2);
    // Same y-down space and centring as the O itself: reuse the extrude's offset.
    const oShapeGeo = new THREE.ExtrudeGeometry(letters[PORTAL].shapes, EXTRUDE);
    oShapeGeo.computeBoundingBox();
    const oc = new THREE.Vector3();
    oShapeGeo.boundingBox.getCenter(oc);
    oShapeGeo.dispose();
    portal.position.set(-oc.x, -oc.y, 0);
    portal.renderOrder = 10;
    portal.scale.setScalar(0.0001);
    oMesh.add(portal);

    // Seamless ivory cyclorama: the floor only shows shadow, so white meets white with no horizon.
    const floorY = -CAP_HEIGHT / 2;
    word.position.y = floorY; // baseline on the floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.receiveShadow = true;
    scene.add(floor);

    const key = new THREE.DirectionalLight(0xfff3e2, 2.4);
    key.position.set(-2.2, 4.5, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 3, bottom: -3, near: 0.5, far: 14 });
    scene.add(key, new THREE.HemisphereLight(0xffffff, 0xe9dfcf, 0.9));

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.004, 60);
    return { renderer, scene, camera, word, letters, portal, width, floorY, floor, chrome, gold, oChrome, oGold, oHalf };
  }

  // Distance at which the word fills the given share of the frame width.
  function fitDistance(share) {
    const { camera, width } = three;
    const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    return (width / share) / 2 / (half * camera.aspect);
  }

  function resize() {
    if (!three) return;
    if (matchTo) matchTo = targetFn?.() || matchTo;
    three.renderer.setSize(innerWidth, innerHeight, false);
    three.camera.aspect = innerWidth / innerHeight;
    three.camera.updateProjectionMatrix();
  }

  const focus = new THREE.Vector3(), from = new THREE.Vector3(), into = new THREE.Vector3(), normal = new THREE.Vector3();
  const spinQ = new THREE.Quaternion(), axis = new THREE.Vector3();

  function render() {
    const { renderer, scene, camera, letters, portal } = three;
    // Portrait pulls back further: once the camera centres on the middle O, the word sits off-centre.
    const portrait = innerWidth / innerHeight < 0.8;
    const dist = fitDistance(portrait ? 0.74 : 0.7);

    // Letters: drop in from above with a slight tumble, then the O's spin on their own axes.
    letters.forEach((l, i) => {
      const k = l.drop ?? 0; // 0 airborne .. 1 landed
      l.pivot.position.set(l.home.x, l.home.y + (1 - k) * 2.4 + (l.bounce ?? 0), l.home.z);
      l.pivot.rotation.set(l.fall.x * (1 - k), l.fall.y * (1 - k), l.fall.z * (1 - k));
      if (SPIN_AXES[i]) {
        // Whole turns for every O, so all three come to rest square on.
        axis.fromArray(SPIN_AXES[i]).normalize();
        spinQ.setFromAxisAngle(axis, st.spin * (i === PORTAL ? 1 : i === 0 ? -1 : 1.5) * Math.PI * 2);
        l.pivot.quaternion.multiply(spinQ);
      }
    });

    // Camera: low orbit around the word, then square on to the middle O and through it.
    const az = THREE.MathUtils.lerp(-0.42, 0.5, smooth(st.orbit)) * (1 - st.close);
    const el = THREE.MathUtils.lerp(0.32, 0.06, smooth(st.orbit)) * (1 - st.close);
    const r = dist * THREE.MathUtils.lerp(1.08, 0.86, smooth(st.orbit));
    focus.set(0, (1 - st.close) * 0.02, 0);
    from.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r + three.floorY * 0.2, Math.cos(az) * Math.cos(el) * r).add(focus);
    // Square on to the portal O, at a distance that keeps the whole word framed.
    letters[PORTAL].pivot.getWorldPosition(into);
    normal.set(0, 0, 1);
    const face = into.clone().addScaledVector(normal, dist * (portrait ? 1.22 : 0.9));
    camera.position.lerpVectors(from, face, smooth(st.close));
    // The dive: straight down the O's axis until the counter fills the frame.
    const d = st.dive * st.dive * st.dive;
    if (d > 0) camera.position.lerpVectors(face, into.clone().addScaledVector(normal, 0.012), d);
    camera.fov = FOV + d * 14;
    camera.updateProjectionMatrix();
    const look = focus.clone().lerp(into, smooth(st.close));
    // Match cut: square on, at the distance and offset that lay the O's outer edge over the watch case
    // on the page, stretched to the case's proportion. The studio then dissolves around it.
    if (st.match > 0 && matchTo) {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const dz = three.oHalf.y * (innerHeight / 2) / (matchTo.ry * tanHalf);
      const offX = ((matchTo.x - innerWidth / 2) / (innerWidth / 2)) * dz * tanHalf * camera.aspect;
      const offY = (-(matchTo.y - innerHeight / 2) / (innerHeight / 2)) * dz * tanHalf;
      camera.position.lerp(new THREE.Vector3(into.x - offX, into.y - offY, into.z + dz), st.match);
      look.lerp(new THREE.Vector3(into.x - offX, into.y - offY, into.z), st.match);
      const stretch = (matchTo.rx / matchTo.ry) / (three.oHalf.x / three.oHalf.y);
      letters[PORTAL].pivot.scale.x = 1 + (stretch - 1) * st.match;
    }
    // The other letters and their shadows fall away; the O then melts into the real case beneath it.
    three.chrome.opacity = three.gold.opacity = 1 - st.others;
    three.floor.material.opacity = 0.16 * (1 - st.others);
    three.oChrome.opacity = three.oGold.opacity = 1 - st.melt;
    // The studio irises outward from the watch: first to just past the case (hidden under the O),
    // so the real case is already there when the O melts, then out to the corners.
    if (st.iris > 0 && matchTo) {
      const r0 = Math.min(matchTo.rx, matchTo.ry) * 0.6, rCase = Math.max(matchTo.rx, matchTo.ry) * 1.1;
      const r1 = Math.hypot(innerWidth, innerHeight) * 1.1;
      const r = st.iris <= 0.25 ? r0 + (rCase - r0) * (st.iris / 0.25) : rCase + (r1 - rCase) * ((st.iris - 0.25) / 0.75);
      const soft = 24 + r * 0.22;
      const mask = `radial-gradient(circle at ${matchTo.x}px ${matchTo.y}px, transparent ${r}px, #000 ${r + soft}px)`;
      canvas.style.webkitMaskImage = canvas.style.maskImage = mask;
    }
    camera.lookAt(look);

    portal.scale.setScalar(Math.max(0.0001, st.portal));
    renderer.render(scene, camera);
  }

  // ---------- sequence ----------
  function sequence(onReveal) {
    const { letters } = three;
    const tl = gsap.timeline({ paused: true, onUpdate: render });
    // Each letter drops and lands on the tick, with a small rebound off the floor.
    letters.forEach((l, i) => {
      const at = T.drop + i * T.dropGap;
      l.drop = 0;
      tl.to(l, { drop: 1, duration: 0.55, ease: "power3.in" }, at);
      tl.fromTo(l, { bounce: 0 }, { keyframes: [{ bounce: 0.06, duration: 0.12, ease: "power2.out" }, { bounce: 0, duration: 0.2, ease: "power2.in" }], immediateRender: false }, at + 0.55);
    });
    // The O's spin up and wind down to rest square on, two full turns, while the camera orbits.
    tl.to(st, { orbit: 1, duration: T.lock - 0.6, ease: "none" }, 0.6);
    tl.to(st, { spin: 2, duration: T.lock - T.spin, ease: "power2.inOut" }, T.spin);
    tl.to(st, { close: 1, duration: 1.1, ease: "expo.inOut" }, T.lock - 0.3);
    tl.fromTo("#introSub", { opacity: 0, y: 12, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.8, ease: "expo.out" }, T.lock + 0.1);
    if (matchTo) {
      // Desktop: the O travels onto the watch case, its counter opens onto the real dial,
      // the other letters fall away, and the studio dissolves into the page.
      tl.to("#introSub", { opacity: 0, y: -8, duration: 0.3, ease: "power2.in" }, T.match - 0.3);
      tl.call(() => onReveal(), null, T.match - 0.15);
      tl.to(st, { others: 1, duration: 0.55, ease: "power2.in" }, T.match);
      tl.to(st, { match: 1, duration: T.matchLen, ease: "expo.inOut" }, T.match);
      tl.to(st, { portal: 1, duration: 0.9, ease: "expo.out" }, T.match + 0.25);
      tl.to("#introSkip", { opacity: 0, duration: 0.3 }, T.match);
      const landed = T.match + T.matchLen - 0.05;
      tl.to(st, { iris: 0.25, duration: 0.3, ease: "power2.out" }, landed);
      tl.to(st, { melt: 1, duration: 0.45, ease: "power2.inOut" }, landed + 0.25);
      tl.to(st, { iris: 1, duration: T.iris, ease: "power2.in" }, landed + 0.5);
      tl.call(finish, null, landed + 0.5 + T.iris);
      return tl;
    }
    // Phones: night opens inside the ring, and the camera dives through it into the page.
    tl.call(() => onReveal(), null, T.reveal - 0.15);
    tl.to(st, { portal: 1, duration: 0.7, ease: "expo.out" }, T.reveal);
    tl.to("#introSub", { opacity: 0, y: -8, duration: 0.3, ease: "power2.in" }, T.dive - 0.25);
    tl.to(st, { dive: 1, duration: T.diveLen, ease: "none" }, T.dive);
    tl.to("#introSkip", { opacity: 0, duration: 0.3 }, T.dive);
    tl.call(finish, null, T.dive + T.diveLen);
    return tl;
  }

  function finish() {
    if (root.hidden) return;
    timeline?.kill();
    gsap.ticker.remove(render);
    removeEventListener("keydown", onKey);
    removeEventListener("resize", resize);
    inertables.forEach((el) => { el.inert = false; });
    document.documentElement.classList.remove("is-intro");
    root.hidden = true;
    // Free the second WebGL context: the page keeps its own.
    if (three) {
      three.scene.traverse((o) => { o.geometry?.dispose(); });
      [three.chrome, three.gold, three.oChrome, three.oGold].forEach((m) => m.dispose());
      three.scene.environment?.dispose();
      three.renderer.dispose();
      three.renderer.forceContextLoss();
      three = null;
    }
  }

  function skip() {
    if (!timeline || timeline.time() >= T.reveal - 0.2) return;
    three.letters.forEach((l) => { l.drop = 1; l.bounce = 0; });
    timeline.seek(T.reveal - 0.2, true);
  }

  function onKey(e) {
    if (e.key === "Escape" || ((e.key === " " || e.key === "Enter") && $(".intro__gate").hidden)) skip();
  }

  return {
    // True while the running film fully covers the page, so the page can skip rendering underneath.
    // Before Enter the page keeps rendering, so its shaders are compiled by the time the ring opens.
    get opaque() { return started && !root.hidden && st.portal === 0; },

    progress(f) { showProgress(f); },

    load() {
      const font = document.fonts.load(`500 1rem "Bodoni Moda"`).catch(() => {});
      return font;
    },

    // Shows the gate, then plays. onReveal fires as the page should begin its own opening.
    // target() gives the hero watch case on screen (CSS px) for the match cut, or null to dive instead.
    play({ onReveal, target }) {
      targetFn = target;
      try {
        if (!reduced) { three = build(); resize(); render(); }
      } catch (err) {
        three = null; // no WebGL: the gate leads straight into the page
      }
      if (reduced || !three) {
        onReveal();
        gsap.to(root, { opacity: 0, duration: 0.5, onComplete: finish });
        return;
      }
      addEventListener("resize", resize);
      showProgress(1);
      // No gate choice: once loaded, the loading card fades straight into the film.
      const gate = $(".intro__gate");
      started = true;
      matchTo = targetFn?.() || null;
      timeline = sequence(onReveal);
      gsap.to(gate, { opacity: 0, duration: 0.6, delay: 0.25, ease: "power2.out", onComplete: () => { gate.hidden = true; } });
      $("#introSkip").hidden = false;
      gsap.from("#introSkip", { opacity: 0, duration: 0.8, delay: 1 });
      addEventListener("keydown", onKey);
      gsap.delayedCall(0.25, () => timeline.play(0));
      $("#introSkip").addEventListener("click", skip);
    },
  };
}
