# Orsolo Gravité T1

A scroll-driven product film for a fictional flying tourbillon, built as a design and engineering study.

**Live:** https://orsolo-gravite.vercel.app · mirror: https://jathavedanstackup-cell.github.io/orsolo-gravite/

## What it does

- **Path-traced on desktop.** The opening, the exploded movement and the macro dive into the tourbillon cage are Blender Cycles frame sequences, scrubbed by scroll with crossfades between frames.
- **Live 3D after that.** From the technical drawing onward, the same watch is a procedural Three.js model with ambient occlusion, depth of field, bloom and AgX tone mapping. The renders and the live scene share camera math, so the handover does not jump.
- **Interactive chapters.** Drag the crown to wind the mainspring (with a synthesized ratchet and escapement tick), switch dial enamels, and turn the lights out to see the lume.
- **Graceful on every device.** Phones get the live model with tuned framing. Frame rate is watched and effects step down on slow GPUs. A still render stands in if WebGL is unavailable, and reduced motion is respected.

## Stack

Vanilla JavaScript modules, no build step: Three.js r160, GSAP ScrollTrigger, Lenis. Blender 5 for the renders.

| File | Role |
| --- | --- |
| `main.js` | Scroll keyframes, camera path, chapter wiring |
| `stage.js` | Renderer, post-processing, adaptive quality |
| `scene.js`, `textures.js` | Procedural watch model and canvas textures |
| `frames.js` | Render-sequence loader and player |
| `overlay.js`, `fx.js`, `wind.js`, `ui.js` | Callouts, ambience, crown interaction, UI |
| `blender/watch.py` | Rebuilds the watch in Blender and renders every sequence |

## Run locally

It is a static site with no build step, but it needs a server (ES modules don't load from `file://`). Use one that serves requests in parallel, since the page streams a few hundred frames:

```bash
npx serve .
```

Then open the address it prints. In VS Code, the Live Server extension works too. Python's built-in `http.server` handles one request at a time and stalls on the frame sequences.

| Script | What it does |
| --- | --- |
| `build-dist.ps1` | Copies only what the site serves into `orsolo-gravite/` for deployment |
| `render-hd.ps1` | Re-renders every sequence at 1920x1200 in Blender (CPU, several hours) |

---

Orsolo and the Gravité T1 are fictional.
