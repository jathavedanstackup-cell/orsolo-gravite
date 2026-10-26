// Canvas-painted finishes: sunburst dial with printing, Côtes de Genève, perlage, leather grain.
// UVs on extruded caps equal shape coordinates, so each map spans [-span, span] via repeat/offset.
import * as THREE from "three";

function canvasTex(size, draw, span) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (span) {
    tex.repeat.set(1 / (2 * span), 1 / (2 * span));
    tex.offset.set(0.5, 0.5);
  }
  return tex;
}

const DIAL_INK = {
  glacier: { base: "#d7dde5", ink: "#1b2340", accent: "#2a4bb0" },
  nuit: { base: "#1a2c6a", ink: "#e9edf5", accent: "#9fb6ff" },
  saumon: { base: "#d99b80", ink: "#2a1a18", accent: "#2a4bb0" },
};

// Dial radius 1.52, aperture at (0, -0.62) r 0.42, all in model units.
export function dialTexture(name) {
  const R = 1.52;
  const { base, ink, accent } = DIAL_INK[name];
  return canvasTex(2048, (g, s) => {
    const c = s / 2, k = s / (2 * R);
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    // Sunburst: hundreds of fine radial strokes catch light like brushed metal under lacquer.
    for (let i = 0; i < 1440; i++) {
      const a = (i / 1440) * Math.PI * 2;
      const v = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      g.strokeStyle = v > 0 ? `rgba(255,255,255,${0.05 + v * 0.07})` : `rgba(0,0,0,${0.04 - v * 0.06})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a) * s, c + Math.sin(a) * s);
      g.stroke();
    }
    const shade = g.createRadialGradient(c, c * 0.8, 0, c, c, c);
    shade.addColorStop(0, "rgba(255,255,255,0.08)");
    shade.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = shade;
    g.fillRect(0, 0, s, s);
    // Railway minute track.
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 3;
    [1.44, 1.38].forEach((r) => { g.beginPath(); g.arc(c, c, r * k, 0, Math.PI * 2); g.stroke(); });
    for (let m = 0; m < 60; m++) {
      const a = (m / 60) * Math.PI * 2 - Math.PI / 2;
      const r0 = 1.38 * k, r1 = (m % 5 === 0 ? 1.49 : 1.44) * k;
      g.lineWidth = m % 5 === 0 ? 5 : 2.5;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      g.stroke();
    }
    // Printing. Canvas y grows downward; model y grows up, so the dial top is small y here.
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `500 ${0.17 * k}px "Bodoni Moda", serif`;
    g.fillText("ORSOLO", c, c - 0.58 * k);
    g.font = `400 ${0.065 * k}px "Hanken Grotesk", sans-serif`;
    g.fillText("GENÈVE", c, c - 0.42 * k);
    g.fillStyle = accent;
    g.font = `italic 400 ${0.1 * k}px "Bodoni Moda", serif`;
    g.fillText("Gravité", c, c + 0.07 * k);
    g.fillStyle = ink;
    g.font = `500 ${0.048 * k}px "Hanken Grotesk", sans-serif`;
    g.fillText("TOURBILLON  ·  SWISS MADE", c, c + 1.24 * k);
  }, R);
}

export function cotesTexture() {
  return canvasTex(1024, (g, s) => {
    g.fillStyle = "#c9ced6";
    g.fillRect(0, 0, s, s);
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(-Math.PI / 5);
    const band = s / 9;
    for (let x = -s; x < s; x += band) {
      const grad = g.createLinearGradient(x, 0, x + band, 0);
      grad.addColorStop(0, "#9aa1ab");
      grad.addColorStop(0.45, "#f4f6f9");
      grad.addColorStop(0.55, "#e4e8ee");
      grad.addColorStop(1, "#9aa1ab");
      g.fillStyle = grad;
      g.fillRect(x, -s, band, s * 2);
    }
    g.restore();
  }, 1.6);
}

export function perlageTexture() {
  return canvasTex(2048, (g, s) => {
    g.fillStyle = "#a9afb8";
    g.fillRect(0, 0, s, s);
    // Perlage: overlapping swirled circles in staggered rows, each laid over the last like fish scales.
    const r = s / 48, step = r * 0.72;
    for (let y = -r, row = 0; y < s + r; y += step, row++) {
      for (let x = -r + (row % 2) * step * 0.5; x < s + r; x += step) {
        const grad = g.createConicGradient(row * 0.9 + x * 0.01, x, y);
        grad.addColorStop(0, "#f0f3f7");
        grad.addColorStop(0.25, "#a3aab4");
        grad.addColorStop(0.5, "#e2e6ec");
        grad.addColorStop(0.75, "#9aa1ab");
        grad.addColorStop(1, "#f0f3f7");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, 1.6);
}

export function leatherTexture() {
  const tex = canvasTex(512, (g, s) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const v = 100 + Math.random() * 60;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 8);
  return tex;
}
