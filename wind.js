// Crown winding: a grip that tracks the 3D crown on screen. Drag it (or use arrow keys) to wind
// the mainspring; the reserve fills toward 72 hours and slowly runs down while you watch.
import * as THREE from "three";

const MAX_HOURS = 72;
const START_HOURS = 18;
const HOURS_PER_PIXEL = 0.09;
const RADIANS_PER_PIXEL = 0.035;
const RADIANS_PER_CLICK = 0.45;
const DRAIN_HOURS_PER_SECOND = 0.008; // slow enough that a long visit still finds the watch running
const KEY_STEP_HOURS = 3;

export function createWinding({ ticker }) {
  const grip = document.getElementById("grip");
  const value = document.getElementById("reserveValue");
  const section = document.getElementById("wind");
  const state = { hours: START_HOURS, turns: 0, lastClick: 0 };
  const v = new THREE.Vector3();
  let dragging = false, lastY = 0, lastX = 0, shown = "";

  function wind(pixels) {
    if (pixels <= 0) return;
    grip.classList.add("is-used");
    state.hours = Math.min(MAX_HOURS, state.hours + pixels * HOURS_PER_PIXEL);
    state.turns += pixels * RADIANS_PER_PIXEL;
    if (state.turns - state.lastClick > RADIANS_PER_CLICK) {
      state.lastClick = state.turns;
      ticker.ratchet();
    }
  }

  grip.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("is-dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // A winding stroke is any thumb movement; both axes count, like rolling a crown under the thumb.
    wind(Math.abs(e.clientY - lastY) + Math.abs(e.clientX - lastX));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const stop = () => { dragging = false; grip.classList.remove("is-dragging"); };
  grip.addEventListener("pointerup", stop);
  grip.addEventListener("pointercancel", stop);
  grip.addEventListener("keydown", (e) => {
    if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    // A crown only winds one way; any arrow adds tension.
    wind(KEY_STEP_HOURS / HOURS_PER_PIXEL);
  });

  return {
    // Called every frame: run the reserve down, feed the model, park the grip over the crown.
    update(gl, dt) {
      state.hours = Math.max(0, state.hours - dt * DRAIN_HOURS_PER_SECOND);
      const hours = Math.round(state.hours);
      const text = String(hours);
      if (text !== shown) {
        shown = text;
        value.textContent = text;
        grip.setAttribute("aria-valuenow", text);
        grip.setAttribute("aria-valuetext", `${text} hours of power reserve`);
      }
      if (!gl) return;
      gl.watch.setWinding(state.turns, state.hours / MAX_HOURS);
      const r = section.getBoundingClientRect();
      const inView = r.top < innerHeight * 0.55 && r.bottom > innerHeight * 0.45;
      grip.classList.toggle("is-shown", inView);
      if (!inView) return;
      v.copy(gl.watch.crownWorld()).project(gl.camera);
      grip.style.transform = `translate3d(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px, 0)`;
    },
  };
}
