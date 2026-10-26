// Atmosphere and sensory layers around the watch: dust in the light, a cursor lamp,
// the loupe iris, and a synthesized escapement tick.
import * as THREE from "three";

const DUST_COUNT = 360;
const DUST_MAX_PX = 14;
const BEATS_PER_SECOND = 6; // 21,600 vibrations per hour

export function createDust(scene, reduced) {
  const pos = new Float32Array(DUST_COUNT * 3), seed = new Float32Array(DUST_COUNT);
  for (let i = 0; i < DUST_COUNT; i++) {
    pos.set([(Math.random() - 0.4) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 7], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.55 }, uScale: { value: innerHeight / 2 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime, uScale;
      varying float vSeed, vDepth;
      void main() {
        vec3 p = position;
        p.y += mod(uTime * (0.04 + seed * 0.05) + seed * 8.0, 8.0) - 4.0;
        p.x += sin(uTime * 0.2 + seed * 40.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDepth = -mv.z;
        vSeed = seed;
        // Motes far from the focal plane grow and fade, like out-of-focus dust in a lens.
        // Capped so motes near the lens stay specks, not haze over the watch.
        float blur = abs(vDepth - 9.0) * 0.35;
        gl_PointSize = min((1.2 + blur * 1.4) * uScale / vDepth, ${DUST_MAX_PX.toFixed(1)});
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vSeed, vDepth;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * uOpacity * (0.2 + vSeed * 0.8) / (1.0 + abs(vDepth - 9.0) * 0.9);
        gl_FragColor = vec4(vec3(0.82, 0.87, 1.0) * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return {
    update(t, opacity) {
      mat.uniforms.uTime.value = reduced ? 0 : t;
      mat.uniforms.uOpacity.value = opacity;
      mat.uniforms.uScale.value = innerHeight / 2;
    },
  };
}

// A small lamp that follows the cursor in front of the case, sliding reflections across the steel.
export function createLamp(scene) {
  const lamp = new THREE.PointLight(0xfff4e6, 0, 14, 1.6);
  scene.add(lamp);
  return {
    update(px, py, root, strength) {
      lamp.position.set(root.position.x + px * 4.5, root.position.y - py * 3, 3.5);
      lamp.intensity = strength * 9;
    },
  };
}

// Loupe iris: darkness closes around the tourbillon aperture as the camera dives in.
export function createIris() {
  const el = document.getElementById("iris");
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  // close 0..1 shrinks the hole to nothing and deepens the field to solid black.
  return function draw(gl, amount, close = 0) {
    if (!gl || amount < 0.01) { el.style.opacity = "0"; return; }
    el.style.setProperty("--a", (0.94 + close * 0.06).toFixed(3));
    const { root, aperture } = gl.watch;
    a.set(aperture.x, aperture.y, 0.1); root.localToWorld(a).project(gl.camera);
    b.set(aperture.x + aperture.r, aperture.y, 0.1); root.localToWorld(b).project(gl.camera);
    const x = (a.x * 0.5 + 0.5) * innerWidth, y = (-a.y * 0.5 + 0.5) * innerHeight;
    const r = Math.hypot((b.x - a.x) * 0.5 * innerWidth, (b.y - a.y) * 0.5 * innerHeight);
    el.style.setProperty("--x", `${x}px`);
    el.style.setProperty("--y", `${y}px`);
    el.style.setProperty("--r", `${r * (1.25 + (1 - amount) * 2.5) * (1 - close)}px`);
    el.style.opacity = amount.toFixed(3);
  };
}

// Escapement tick, synthesized: a filtered click alternating tick and tock at the real beat.
export function createTicker() {
  let ctx = null, timer = 0, next = 0, beat = 0;
  function click(time, tock) {
    const len = Math.floor(ctx.sampleRate * 0.012);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = tock ? 3200 : 4300;
    band.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.value = tock ? 0.16 : 0.22;
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(time);
  }
  function schedule() {
    while (next < ctx.currentTime + 0.2) {
      click(next, beat % 2 === 1);
      beat += 1;
      next += 1 / BEATS_PER_SECOND;
    }
  }
  return {
    // One ratchet click, only when sound is on (the context is running).
    ratchet() {
      if (ctx && ctx.state === "running") click(ctx.currentTime, true);
    },

    async set(on) {
      if (on) {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume();
        next = ctx.currentTime + 0.05;
        timer = setInterval(schedule, 60);
      } else {
        clearInterval(timer);
        if (ctx) await ctx.suspend();
      }
    },
  };
}
