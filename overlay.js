// SVG drawn over the WebGL stage: caption callouts and technical-drawing dimensions, both projected from 3D.
import * as THREE from "three";

const $ = (s) => document.querySelector(s);
const SVG = "http://www.w3.org/2000/svg";
const v = new THREE.Vector3();

function toScreen(local, root, camera) {
  v.copy(local);
  root.localToWorld(v);
  v.project(camera);
  return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
}

// World point to CSS pixels.
export function project(gl, world) {
  v.copy(world).project(gl.camera);
  return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
}

// point: [x, y] in CSS px, from the live scene (project) or the rendered frames (Blender's projection).
export function createCallout() {
  const svg = $("#callout"), path = svg.querySelector("path"), dot = svg.querySelector("circle");
  return function draw(partEl, point) {
    if (!partEl || !point) { svg.style.opacity = "0"; return; }
    const box = partEl.getBoundingClientRect();
    const [x1, y1] = point;
    const x0 = box.left + Math.min(box.width, 460) + 24, y0 = box.top + 22, xm = x0 + Math.max(24, (x1 - x0) * 0.35);
    path.setAttribute("d", `M${x0} ${y0} H${xm} L${x1} ${y1}`);
    dot.setAttribute("cx", x1);
    dot.setAttribute("cy", y1);
    svg.style.opacity = "1";
  };
}

// Each dimension: two measured points, the extension direction (local), its length, and a label.
const DIMENSIONS = [
  { a: [-1.84, 0, 0.1], b: [1.84, 0, 0.1], ext: [0, -1, 0], len: 2.25, label: "41 mm" },
  { a: [0, -1.55, -0.38], b: [0, -1.55, 0.42], ext: [0, -1, 0], len: 0.75, label: "11.4 mm" },
];

export function createDimensions() {
  const svg = $("#dims");
  const parts = DIMENSIONS.map((d) => {
    const g = document.createElementNS(SVG, "g");
    const path = document.createElementNS(SVG, "path");
    const text = document.createElementNS(SVG, "text");
    text.textContent = d.label;
    text.setAttribute("text-anchor", "middle");
    g.append(path, text);
    svg.appendChild(g);
    const a = new THREE.Vector3(...d.a), b = new THREE.Vector3(...d.b);
    const off = new THREE.Vector3(...d.ext).multiplyScalar(d.len);
    return { g, path, text, a, b, a2: a.clone().add(off), b2: b.clone().add(off) };
  });

  return function draw(gl, weights) {
    if (!gl) return;
    parts.forEach((p, i) => {
      const w = weights[i] || 0;
      p.g.style.opacity = w.toFixed(3);
      if (w < 0.01) return;
      const { root } = gl.watch;
      const [ax, ay] = toScreen(p.a, root, gl.camera), [bx, by] = toScreen(p.b, root, gl.camera);
      const [cx, cy] = toScreen(p.a2, root, gl.camera), [dx, dy] = toScreen(p.b2, root, gl.camera);
      const ang = Math.atan2(dy - cy, dx - cx), tick = 7;
      const tx = Math.cos(ang + Math.PI / 4) * tick, ty = Math.sin(ang + Math.PI / 4) * tick;
      // Extension lines, the dimension line itself, and architectural 45° ticks at both ends.
      p.path.setAttribute("d",
        `M${ax} ${ay} L${cx} ${cy} M${bx} ${by} L${dx} ${dy} M${cx} ${cy} L${dx} ${dy}` +
        ` M${cx - tx} ${cy - ty} L${cx + tx} ${cy + ty} M${dx - tx} ${dy - ty} L${dx + tx} ${dy + ty}`);
      const mx = (cx + dx) / 2, my = (cy + dy) / 2;
      p.text.setAttribute("x", mx);
      p.text.setAttribute("y", my + 26);
    });
  };
}
