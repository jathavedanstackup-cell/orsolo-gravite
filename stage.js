// Renderer, lights and post-processing. Quality is tiered up front and degrades itself if frames run long.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { createWatch, studioEnvironment } from "./scene.js";

const SLOW_FRAME_MS = 26;
const SAMPLE_FRAMES = 45;
const LOWEST_LEVEL = -1;
const THROTTLED_MS = 250;
const AGX_EXPOSURE = 1.3; // AgX sits darker than ACES at the same exposure

function detectTier() {
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  return innerWidth < 700 || mem <= 4 || cores <= 4 ? "low" : "high";
}

// Passes that re-render the scene for depth or normals must not see the sapphire,
// or ambient occlusion and focus land on the glass instead of the dial beneath it.
function hideGlassDuring(pass, watch) {
  const render = pass.render.bind(pass);
  pass.render = (...args) => { watch.setGlass(false); render(...args); watch.setGlass(true); };
}

export function createStage(canvas, background) {
  const tier = detectTier();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  let dpr = Math.min(devicePixelRatio, tier === "low" ? 1.25 : 1.75);
  renderer.setPixelRatio(dpr);
  // AgX rolls highlights off like film instead of clipping polished steel to flat white; it matches the Cycles renders.
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Debug validation forces a synchronous GPU round trip per program and misreports on some Intel drivers.
  renderer.debug.checkShaderErrors = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = background.clone();
  scene.environment = studioEnvironment(renderer);

  // Key light follows the watch so its shadow frustum stays tight around the case.
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.castShadow = true;
  const size = tier === "low" ? 1024 : 2048;
  key.shadow.mapSize.set(size, size);
  Object.assign(key.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 0.5, far: 20 });
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 5;
  // Rim sits high and behind so it edges the case without flooding the underside of the strap.
  const rim = new THREE.PointLight(0x7b98f2, 9, 20);
  rim.position.set(4, 2.5, -5);
  scene.add(key, key.target, rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
  const watch = createWatch();
  scene.add(watch.root);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.16, distanceExponent: 1.6, thickness: 0.5, scale: 1.1 });
  gtao.blendIntensity = 0.85;
  gtao.enabled = tier === "high";
  hideGlassDuring(gtao, watch);
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 5, aperture: 0, maxblur: 0.009 });
  hideGlassDuring(bokeh, watch);
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.4, 0.97);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Edge anti-aliasing after tone mapping: thin hands, screws and the hairspring stop shimmering.
  const smaa = new SMAAPass(innerWidth * dpr, innerHeight * dpr);
  smaa.enabled = tier === "high";
  composer.addPass(smaa);

  const keyOffset = new THREE.Vector3(-4, 5, 6);
  let frames = 0, total = 0, level = tier === "high" ? 2 : 1;

  function setSize(w, h) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // Drop one quality level at a time: AO first, then resolution, bloom and soft shadows,
  // and as a last resort depth of field and shadows entirely.
  let allowBokeh = true;
  function degrade() {
    level -= 1;
    if (level === 1) { gtao.enabled = false; smaa.enabled = false; }
    if (level === 0) {
      dpr = 1;
      bloom.enabled = false;
      key.shadow.radius = 1;
      setSize(innerWidth, innerHeight);
    }
    if (level === LOWEST_LEVEL) {
      allowBokeh = false;
      key.castShadow = false;
      renderer.shadowMap.enabled = false;
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
  }

  return {
    renderer, scene, camera, watch, composer, key, tier,
    get level() { return level; },
    setSize,

    // focusDist: camera to subject; depth: 0 wide shot, 1 full macro.
    frame({ sweep = 0, focusDist = 5, depth = 0, exposure = 1.05, keyPower = 1 }) {
      key.target.position.copy(watch.root.position);
      key.position.copy(watch.root.position).add(keyOffset).setX(watch.root.position.x - 4 + sweep * 10);
      key.intensity = 1.6 * keyPower;
      renderer.toneMappingExposure = exposure * AGX_EXPOSURE;
      bokeh.enabled = allowBokeh && depth > 0.04;
      bokeh.uniforms.focus.value = focusDist;
      bokeh.uniforms.aperture.value = 0.022 * depth;
      composer.render();
    },

    // Called once per frame after the intro; measures and degrades if the device can't keep up.
    measure(deltaMs) {
      if (level <= LOWEST_LEVEL || document.hidden) return;
      frames += 1;
      total += deltaMs;
      if (frames < SAMPLE_FRAMES) return;
      // Averages beyond THROTTLED_MS mean the browser is throttling a background or covered window,
      // not that the GPU is slow, so they are ignored rather than read as a reason to degrade.
      const avg = total / frames;
      if (avg > SLOW_FRAME_MS && avg < THROTTLED_MS) degrade();
      frames = 0;
      total = 0;
    },
  };
}
