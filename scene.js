// Procedural model of the Gravité T1. Every part is built from geometry, no downloaded assets.
// The watch faces +z. One world unit is roughly 12.8 mm (case radius 1.6 = 20.5 mm).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { dialTexture, cotesTexture, perlageTexture, leatherTexture } from "./textures.js";

export const DIAL_NAMES = ["glacier", "nuit", "saumon"];
const APERTURE = { x: 0, y: -0.62, r: 0.42 };
const TAU = Math.PI * 2;

// A dark studio with softbox strips: the long reflections on polished steel are what read as "product shot".
export function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x03050a);
  const box = (w, h, power, pos, tint = 0xffffff) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(power), side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  box(14, 1.6, 4, [0, 7, 5]);
  box(1.4, 10, 3, [-8, 1, 4]);
  box(1.2, 10, 3.5, [8, -1, 2], 0xc8d6ff);
  box(16, 1, 2.2, [0, -6, 6]);
  box(6, 6, 1.6, [2, 2, -9], 0x7b98f2);
  box(3, 3, 2.5, [-3, 4, 9]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

function materials() {
  // Dial maps are 2048px canvases; paint the default now and the others when the browser is idle.
  const dialCache = {};
  const dialMap = (n) => (dialCache[n] ??= dialTexture(n));
  const leather = leatherTexture();
  return {
    dialMap,
    slot: new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.6 }),
    // Brushed grade 5 titanium: anisotropy stretches highlights along the grain.
    titanium: new THREE.MeshPhysicalMaterial({ color: 0xcfd2d8, metalness: 1, roughness: 0.3, anisotropy: 0.75, side: THREE.DoubleSide }),
    // Applied markers carry a lume inlay that only shows when the lights go out.
    lume: new THREE.MeshPhysicalMaterial({ color: 0xeef1f6, metalness: 0.7, roughness: 0.1, emissive: 0x8fe3ff, emissiveIntensity: 0 }),
    polished: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, metalness: 1, roughness: 0.05, side: THREE.DoubleSide }),
    bridge: new THREE.MeshPhysicalMaterial({ map: cotesTexture(), metalness: 1, roughness: 0.3, clearcoat: 0.5 }),
    plate: new THREE.MeshPhysicalMaterial({ map: perlageTexture(), metalness: 1, roughness: 0.42 }),
    gold: new THREE.MeshPhysicalMaterial({ color: 0xe6bf7a, metalness: 1, roughness: 0.2 }),
    blued: new THREE.MeshPhysicalMaterial({ color: 0x1a339a, metalness: 0.85, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 }),
    ruby: new THREE.MeshPhysicalMaterial({ color: 0xc0122f, roughness: 0.04, clearcoat: 1, emissive: 0x3a0008, flatShading: true }),
    dial: new THREE.MeshPhysicalMaterial({ map: dialMap("glacier"), metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 }),
    leather: new THREE.MeshPhysicalMaterial({
      color: 0x0f1628, roughness: 0.7, bumpMap: leather, bumpScale: 0.5, envMapIntensity: 0.5,
      sheen: 0.35, sheenColor: new THREE.Color(0x3a4a78), sheenRoughness: 0.6,
    }),
    thread: new THREE.MeshStandardMaterial({ color: 0xd9dde6, roughness: 0.8 }),
    sapphire: new THREE.MeshPhysicalMaterial({
      color: 0xe4ecff, roughness: 0.0, transparent: true, opacity: 0.12,
      clearcoat: 1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.5,
      // Anti-reflective coating: a faint blue-violet bloom in the reflections, as on real sapphire.
      iridescence: 0.7, iridescenceIOR: 1.5, iridescenceThicknessRange: [180, 420],
    }),
  };
}

function lathe(profile, mat, segments = 160) {
  const geo = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, mat);
}

function extrude(shape, depth, mat, bevel = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 64,
  });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, mat);
}

function circlePath(x, y, r) {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, TAU, true);
  return p;
}

function capsuleShape(ax, ay, bx, by, w) {
  const ang = Math.atan2(by - ay, bx - ax);
  const s = new THREE.Shape();
  s.absarc(ax, ay, w, ang + Math.PI / 2, ang + Math.PI * 1.5, false);
  s.absarc(bx, by, w, ang - Math.PI / 2, ang + Math.PI / 2, false);
  s.closePath();
  return s;
}

function gearShape(r, teeth, holes = 5) {
  const s = new THREE.Shape();
  const depth = Math.min(0.06, r * 0.12);
  const step = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    [[r - depth, a0], [r, a0 + step * 0.2], [r, a0 + step * 0.45], [r - depth, a0 + step * 0.65]].forEach(([rad, a], j) => {
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
    });
  }
  s.closePath();
  if (r > 0.2) {
    for (let i = 0; i < holes; i++) {
      const a = (i / holes) * TAU;
      s.holes.push(circlePath(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.26));
    }
  }
  s.holes.push(circlePath(0, 0, r * 0.08));
  return s;
}

// Olive-cut ruby in a polished chaton. `back` flips it to face the caseback side.
function jewel(m, x, y, z, back = false) {
  const g = new THREE.Group();
  g.add(lathe([[0, 0.024], [0.016, 0.024], [0.03, 0.017], [0.046, 0.005], [0.05, -0.01], [0, -0.01]], m.ruby, 12));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 10, 40), m.polished));
  g.position.set(x, y, z);
  if (back) g.rotation.x = Math.PI;
  return g;
}

// Heat-blued screw with a cut slot, set at a random turn like a real assembled movement.
function screw(m, x, y, z, back = false) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.046, 0.026, 28), m.blued);
  head.rotation.x = Math.PI / 2;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.013, 0.02), m.slot);
  slot.position.z = 0.008;
  slot.rotation.z = Math.random() * Math.PI;
  g.add(head, slot);
  g.position.set(x, y, z);
  if (back) g.rotation.x = Math.PI;
  return g;
}

// Leather strap: a segmented slab bent along a curve that leaves the lugs and falls away behind the case.
function buildStrap(m, dir) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.95, -0.12), new THREE.Vector3(0, 2.55, -0.32), new THREE.Vector3(0, 3.05, -0.95),
    new THREE.Vector3(0, 3.3, -1.9), new THREE.Vector3(0, 3.25, -3.0), new THREE.Vector3(0, 2.95, -4.1),
  ]);
  const len = 120, thick = 0.13;
  const geo = new THREE.BoxGeometry(1, 1, thick, 1, len, 1);
  const pos = geo.attributes.position;
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) + 0.5;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    nrm.set(0, -tan.z, tan.y).normalize();
    const width = 1.48 - t * 0.3;
    pos.setXYZ(i, pos.getX(i) * width, p.y + nrm.y * pos.getZ(i), p.z + nrm.z * pos.getZ(i));
  }
  geo.computeVertexNormals();
  const strap = new THREE.Group();
  strap.add(new THREE.Mesh(geo, m.leather));
  const stitches = 2 * 46;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.05, 0.02), m.thread, stitches);
  const o = new THREE.Object3D();
  for (let i = 0; i < stitches; i++) {
    const side = i % 2 ? 1 : -1, t = 0.04 + (Math.floor(i / 2) / 46) * 0.9;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    nrm.set(0, -tan.z, tan.y).normalize();
    o.position.set(side * ((1.48 - t * 0.3) / 2 - 0.08), p.y + nrm.y * (thick / 2), p.z + nrm.z * (thick / 2));
    o.lookAt(o.position.clone().add(tan));
    o.rotateX(Math.PI / 2);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
  }
  strap.add(inst);
  if (dir < 0) strap.scale.y = -1;
  return strap;
}

function buildCase(m) {
  const g = new THREE.Group();
  g.add(lathe([[1.6, -0.3], [1.72, -0.29], [1.8, -0.18], [1.84, -0.02], [1.82, 0.14], [1.75, 0.25], [1.6, 0.28]], m.titanium));
  g.add(lathe([[1.6, 0.28], [1.6, -0.3]], m.titanium));
  const lugGeo = new RoundedBoxGeometry(0.3, 0.62, 0.3, 5, 0.1);
  [[-0.86, 1.75], [0.86, 1.75], [-0.86, -1.75], [0.86, -1.75]].forEach(([x, y]) => {
    const lug = new THREE.Mesh(lugGeo, m.titanium);
    lug.position.set(x, y, -0.08);
    lug.rotation.x = Math.sign(y) * -0.22;
    g.add(lug);
  });
  const crown = lathe([[0, -0.16], [0.21, -0.16], [0.23, -0.12], [0.23, 0.12], [0.21, 0.16], [0, 0.16]], m.polished, 36);
  crown.material = m.polished.clone();
  crown.material.flatShading = true;
  crown.rotation.set(0, Math.PI / 2, 0);
  crown.position.set(1.98, 0, 0);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 16), m.polished);
  stem.rotation.z = Math.PI / 2;
  stem.position.set(1.84, 0, 0);
  g.add(crown, stem, buildStrap(m, 1), buildStrap(m, -1));
  g.userData.crown = crown;
  return g;
}

function buildBezel(m) {
  return lathe([[1.56, 0.28], [1.8, 0.29], [1.77, 0.35], [1.66, 0.41], [1.57, 0.42]], m.polished);
}

function buildCrystal(m) {
  const R = 8, rim = 1.58, theta = Math.asin(rim / R);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 10, 0, TAU, 0, theta), m.sapphire);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = 0.41 - R * Math.cos(theta);
  return dome;
}

function buildDial(m) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.absarc(0, 0, 1.52, 0, TAU, false);
  s.holes.push(circlePath(APERTURE.x, APERTURE.y, APERTURE.r));
  g.add(extrude(s, 0.04, m.dial));
  // Applied, faceted batons: the bevel gives each one a bright ridge.
  const baton = (w, h) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); sh.closePath();
    return new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.016, bevelSegments: 1 });
  };
  const short = baton(0.035, 0.2), tall = baton(0.03, 0.24);
  for (let h = 0; h < 12; h++) {
    if (h >= 5 && h <= 7) continue;
    const a = (h / 12) * TAU;
    (h === 0 ? [-0.05, 0.05] : [0]).forEach((off) => {
      const b = new THREE.Mesh(h === 0 ? tall : short, m.lume);
      const r = 1.2;
      b.position.set(Math.sin(a) * r + Math.cos(a) * off, Math.cos(a) * r - Math.sin(a) * off, 0.02);
      b.rotation.z = -a;
      g.add(b);
    });
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(APERTURE.r + 0.025, 0.022, 16, 128), m.polished);
  ring.position.set(APERTURE.x, APERTURE.y, 0.03);
  g.add(ring);
  return g;
}

function handShape(len, w, tail) {
  const s = new THREE.Shape();
  s.moveTo(0, -tail);
  s.quadraticCurveTo(w, len * 0.35, w * 0.25, len);
  s.lineTo(0, len + 0.05);
  s.lineTo(-w * 0.25, len);
  s.quadraticCurveTo(-w, len * 0.35, 0, -tail);
  return s;
}

// Breguet-style hands: faceted lance, open "moon" ring near the tip, counterweight on the minute tail.
function breguetHand(m, len, w, tail, ring) {
  const g = new THREE.Group();
  g.add(extrude(handShape(len, w, tail), 0.012, m.blued, 0.009));
  const moon = new THREE.Mesh(new THREE.TorusGeometry(ring, ring * 0.24, 12, 48), m.blued);
  moon.position.y = len * 0.72;
  g.add(moon);
  return g;
}

function buildHands(m) {
  const g = new THREE.Group();
  const hour = breguetHand(m, 0.8, 0.07, 0.12, 0.06);
  const minute = breguetHand(m, 1.26, 0.055, 0.2, 0.048);
  const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.014, 32), m.blued);
  weight.rotation.x = Math.PI / 2;
  weight.position.y = -0.2;
  minute.add(weight);
  minute.position.z = 0.035;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 32), m.polished);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.04;
  g.add(hour, minute, cap);
  return { group: g, hour, minute };
}

function buildCage(m) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.012, 12, 128), m.polished));
  // Lyre-shaped upper cage bridge: three slim, bevelled arms swept off-axis, each pinned by a blued screw.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    const ex = Math.cos(a) * 0.35, ey = Math.sin(a) * 0.35;
    const mx = Math.cos(a - 0.45) * 0.17, my = Math.sin(a - 0.45) * 0.17;
    const arm = new THREE.Group();
    // Brushed faces with polished bevels: a mirror finish alone reflects the dark studio and reads black.
    arm.add(extrude(capsuleShape(0, 0, mx, my, 0.02), 0.014, [m.titanium, m.polished], 0.008));
    arm.add(extrude(capsuleShape(mx, my, ex, ey, 0.018), 0.014, [m.titanium, m.polished], 0.008));
    arm.position.z = 0.03;
    spin.add(arm, screw(m, ex, ey, 0.045));
  }
  const escape = extrude(gearShape(0.085, 15, 0), 0.012, m.polished, 0.003);
  escape.position.set(0.19, 0.06, -0.01);
  const fork = extrude(capsuleShape(0.09, 0.12, -0.02, 0.2, 0.014), 0.012, m.polished, 0.004);
  fork.position.z = -0.012;
  spin.add(escape, fork);
  const balance = new THREE.Group();
  balance.add(new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.02, 12, 128), m.gold));
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.018, 0.012), m.gold);
    spoke.rotation.z = (i / 3) * Math.PI;
    balance.add(spoke);
  }
  // Timing screws around the balance rim, used to poise and regulate it.
  const screwGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.04, 10);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    const s = new THREE.Mesh(screwGeo, m.gold);
    s.position.set(Math.cos(a) * 0.285, Math.sin(a) * 0.285, 0);
    s.rotation.z = a - Math.PI / 2;
    balance.add(s);
  }
  const pts = [];
  for (let i = 0; i <= 300; i++) {
    const t = i / 300, a = t * TAU * 7, r = 0.035 + t * 0.15;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.03));
  }
  balance.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 500, 0.0035, 5), m.blued));
  balance.position.z = -0.03;
  spin.add(balance, jewel(m, 0, 0, 0.05));
  g.add(spin);
  g.position.set(APERTURE.x, APERTURE.y, 0);
  return { group: g, spin, balance };
}

function buildBridges(m) {
  const g = new THREE.Group();
  // Bridges sit on the caseback side: jewels and screws face back. Faces carry Côtes de Genève;
  // the bevelled edges (extrude side group) are mirror-polished anglage.
  [[-1.15, 0.25, 1.05, 0.95, 0.2], [-0.95, 1.05, 0.35, -0.05, 0.17], [0.45, 1.25, 1.2, 0.35, 0.15]].forEach(([ax, ay, bx, by, w]) => {
    const lerp = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
    g.add(
      extrude(capsuleShape(ax, ay, bx, by, w), 0.05, [m.bridge, m.polished], 0.03),
      jewel(m, ax, ay, -0.06, true), jewel(m, bx, by, -0.06, true),
      screw(m, ...lerp(0.3), -0.06, true), screw(m, ...lerp(0.7), -0.06, true),
    );
  });
  return g;
}

function buildPlate(m) {
  const s = new THREE.Shape();
  s.absarc(0, 0, 1.55, 0, TAU, false);
  s.holes.push(circlePath(APERTURE.x, APERTURE.y, APERTURE.r + 0.02));
  return extrude(s, 0.05, [m.plate, m.polished], 0.01);
}

function buildTrain(m) {
  const g = new THREE.Group();
  const wheels = [
    { r: 0.5, t: 64, x: 0, y: 0.18, speed: 1 / 360 },
    { r: 0.3, t: 40, x: 0.86, y: 0.42, speed: -1 / 90 },
    { r: 0.28, t: 36, x: -0.78, y: 0.55, speed: -1 / 120 },
    { r: 0.18, t: 15, x: -0.45, y: -0.3, speed: 1 / 6 },
  ].map((d) => {
    const w = extrude(gearShape(d.r, d.t), 0.03, m.gold, 0.006);
    w.position.set(d.x, d.y, 0);
    const pinion = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12), m.polished);
    pinion.rotation.x = Math.PI / 2;
    pinion.position.set(d.x, d.y, 0);
    g.add(w, pinion);
    return { mesh: w, speed: d.speed };
  });
  return { group: g, wheels };
}

function buildBarrel(m) {
  const g = new THREE.Group();
  const wheel = extrude(gearShape(0.52, 84, 6), 0.06, m.gold, 0.008);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.16, 64, 1, true), m.polished);
  drum.rotation.x = Math.PI / 2;
  drum.position.z = -0.08;
  g.add(wheel, drum);
  g.position.set(0.62, 0.78, 0);
  return { group: g, wheel };
}

function buildCaseback(m) {
  const g = new THREE.Group();
  g.add(lathe([[1.6, -0.3], [1.66, -0.36], [1.2, -0.38], [1.12, -0.36]], m.titanium));
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1.14, 96), m.sapphire);
  glass.position.z = -0.37;
  glass.rotation.y = Math.PI;
  g.add(glass);
  return g;
}

export function createWatch() {
  const m = materials();
  const root = new THREE.Group();
  const hands = buildHands(m), cage = buildCage(m), train = buildTrain(m), barrel = buildBarrel(m);
  const caseGroup = buildCase(m), crown = caseGroup.userData.crown;
  const wind = { turns: 0, amplitude: 2.4 };
  const crownTip = new THREE.Vector3();

  // object, resting z, z travel when exploded, sideways fan [x, y], arc lift, stagger, caption index
  const layers = [
    [buildCrystal(m), 0, 2.7, [0, 0.35], 0.6, 0.0, 0],
    [buildBezel(m), 0, 2.2, [0, 0.15], 0.45, 0.02, 0],
    [hands.group, 0.3, 1.8, [0.25, 0.1], 0.5, 0.05, 1],
    [buildDial(m), 0.2, 1.3, [0, 0], 0.35, 0.08, 2],
    [cage.group, 0.1, 0.85, [0.45, -0.35], 0.4, 0.11, 2],
    // Real stacking order, dial side to back: mainplate, wheels, barrel, bridges (seen through the caseback).
    [buildPlate(m), 0.14, 0.55, [0, -0.1], 0.3, 0.13, 3],
    [train.group, 0.02, -0.3, [0.3, 0.2], 0.3, 0.16, 4],
    [barrel.group, -0.03, -0.75, [0.55, 0.4], 0.45, 0.19, 5],
    [buildBridges(m), -0.13, -1.15, [-0.3, 0.15], 0.3, 0.22, 3],
    [caseGroup, 0, 0, [0, 0], 0, 0, 6],
    [buildCaseback(m), 0, -1.8, [0, -0.2], 0.5, 0.26, 6],
  ].map(([obj, z, travel, fan, arc, delay, caption]) => {
    obj.position.z = z;
    root.add(obj);
    return { obj, base: obj.position.clone(), z, travel, fan, arc, delay, caption, pop: 0 };
  });
  const glass = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.material !== m.sapphire;
    o.receiveShadow = true;
    if (o.material === m.sapphire) glass.push(o);
  });
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
  DIAL_NAMES.forEach((n) => idle(() => m.dialMap(n)));

  // Anchor per caption: the layer a callout line should point at.
  const anchorLayer = [0, 2, 3, 8, 6, 7, 9].map((i) => layers[i]);

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const ease = (t) => t * t * (3 - 2 * t);
  const anchor = new THREE.Vector3();

  return {
    root,
    aperture: APERTURE,

    setExplode(amount, activeCaption) {
      layers.forEach((l) => {
        const a = ease(clamp01((amount - l.delay) / 0.7));
        l.pop += ((activeCaption === l.caption ? 1 : 0) - l.pop) * 0.08;
        const push = l.travel === 0 ? 0 : Math.sign(l.travel) * l.pop * 0.35 * a;
        const lift = Math.sin(Math.PI * a) * l.arc;
        l.obj.position.set(l.base.x + l.fan[0] * a, l.base.y + l.fan[1] * a + lift, l.z + l.travel * a + push);
        l.obj.rotation.set(l.fan[1] * a * 0.5, -l.fan[0] * a * 0.5, l.pop * a * 0.12);
      });
    },

    // World position for the callout of a caption, offset to the part's outer edge.
    anchorFor(caption) {
      const l = anchorLayer[caption];
      if (!l) return null;
      anchor.set(caption === 6 ? -1.82 : -0.9, caption === 6 ? -0.4 : 0.5, 0);
      return l.obj.localToWorld(anchor);
    },

    // turns: crown rotation in radians; tension 0..1 is the mainspring's state of wind.
    setWinding(turns, tension) {
      wind.turns = turns;
      wind.amplitude = 1.1 + tension * 1.6;
    },

    // World position of the crown's outer face, for placing the on-screen grip.
    crownWorld() {
      crownTip.set(2.14, 0, 0);
      return caseGroup.localToWorld(crownTip);
    },

    setLume(glow) {
      m.lume.emissiveIntensity = glow;
    },

    setGlass(visible) {
      glass.forEach((g) => { g.visible = visible; });
    },

    setDial(name) {
      if (DIAL_NAMES.includes(name)) { m.dial.map = m.dialMap(name); m.dial.needsUpdate = true; }
    },

    update(dt, now, still) {
      const h = now.getHours() % 12, min = now.getMinutes(), sec = now.getSeconds() + now.getMilliseconds() / 1000;
      hands.minute.rotation.z = -((min + sec / 60) / 60) * TAU;
      hands.hour.rotation.z = -((h + min / 60) / 12) * TAU;
      // The cage really does turn once every 60 seconds, locked to the clock.
      cage.spin.rotation.z = -(sec / 60) * TAU;
      if (!still) {
        // Amplitude follows mainspring tension: a freshly wound watch swings wider.
        cage.balance.rotation.z = Math.sin((performance.now() / 1000) * TAU * 3) * wind.amplitude;
        train.wheels.forEach((w) => { w.mesh.rotation.z += w.speed * TAU * dt * 6; });
      }
      barrel.wheel.rotation.z = -wind.turns * 0.12 - performance.now() / 50000;
      crown.rotation.set(wind.turns, Math.PI / 2, 0);
      return (sec / 60) * 360;
    },
  };
}
