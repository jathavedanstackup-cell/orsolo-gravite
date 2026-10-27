// DOM side of the page: navigation, section progress, headline reveals, dial picker, form, clock.
const { gsap, ScrollTrigger } = window;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function sectionProgress(el) {
  const r = el.getBoundingClientRect();
  return clamp01(-r.top / Math.max(1, el.offsetHeight - innerHeight));
}

function split(el) {
  const text = el.textContent.trim();
  el.setAttribute("aria-label", text);
  el.textContent = "";
  text.split(/\s+/).forEach((w, i, all) => {
    const outer = document.createElement("span");
    outer.className = "w";
    outer.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span");
    inner.textContent = w;
    outer.appendChild(inner);
    el.appendChild(outer);
    if (i < all.length - 1) el.appendChild(document.createTextNode(" "));
  });
  return el.querySelectorAll(".w > span");
}

function initAnchors(lenis) {
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { duration: 1.8 });
      else target.scrollIntoView();
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });
}

function initNav() {
  const nav = $("#nav");
  ScrollTrigger.create({ start: 80, onToggle: (s) => nav.classList.toggle("is-scrolled", s.isActive) });
  ["#movement", "#tourbillon", "#hours", "#dial"].forEach((id) => {
    const link = $(`.nav__links a[href="${id}"]`);
    ScrollTrigger.create({ trigger: id, start: "top 50%", end: "bottom 50%", onToggle: (s) => link.classList.toggle("is-active", s.isActive) });
  });
}

function initDial(onDial) {
  const swatches = $$("#swatches [role=radio]");
  const pick = (btn) => {
    swatches.forEach((b) => {
      const on = b === btn;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    onDial(btn.dataset.dial);
  };
  swatches.forEach((b, i) => {
    b.tabIndex = i === 0 ? 0 : -1;
    b.addEventListener("click", () => pick(b));
    b.addEventListener("keydown", (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const next = swatches[(i + dir + swatches.length) % swatches.length];
      next.focus();
      pick(next);
    });
  });
}

// Two-state buttons share one pattern: aria-pressed carries the state, the label names it.
function initToggle(btn, labels, onChange) {
  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(on));
    const label = btn.querySelector(".sound__label") || btn;
    label.textContent = labels[on ? 1 : 0];
    onChange(on);
  });
}

// Each rail entry scrolls to the point in the movement chapter where that part is captioned.
function initRail(lenis) {
  const movement = $("#movement");
  $$(".rail button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const p = 0.1 + ((i + 0.5) / 7) * 0.86;
      const y = movement.getBoundingClientRect().top + scrollY + p * (movement.offsetHeight - innerHeight);
      if (lenis) lenis.scrollTo(y, { duration: 1.4 });
      else scrollTo(0, y);
    });
  });
}

// Counts a figure's leading number up from zero, keeping its unit span and thousands separator.
function countUp(dd) {
  const node = dd.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const target = Number(node.textContent.replace(/,/g, ""));
  if (!Number.isFinite(target)) return;
  const fmt = new Intl.NumberFormat("en-US");
  const state = { v: 0 };
  gsap.to(state, {
    v: target, duration: 1.6, ease: "expo.out",
    onUpdate: () => { node.textContent = fmt.format(Math.round(state.v)); },
  });
}

export function initUi({ lenis, reduced, onDial, onSound, onNight }) {
  initAnchors(lenis);
  initRail(lenis);
  initToggle($("#soundToggle"), ["Sound off", "Sound on"], onSound);
  initToggle($("#lightsToggle"), ["Lights out", "Lights on"], onNight);
  initNav();
  initDial(onDial);

  const parts = $$(".part"), rail = $$(".rail li");
  const movement = $("#movement"), hours = $("#hours"), track = $("#hoursTrack"), cageDeg = $("#cageDeg");
  const specs = $("#specs"), figures = $$(".specs__figures > div");
  const hourCards = $$(".hour");
  let active = -1, activeHour = -1, lastDeg = -1;

  return {
    sizeHours() {
      if (reduced) return;
      const travel = Math.max(0, track.scrollWidth - innerWidth);
      hours.style.height = `${travel + innerHeight * 2.2}px`;
    },

    update() {
      const p = sectionProgress(movement);
      const idx = Math.min(6, Math.floor(clamp01((p - 0.1) / 0.86) * 7));
      if (idx !== active) {
        active = idx;
        parts.forEach((el, i) => el.classList.toggle("is-active", i === idx));
        rail.forEach((el, i) => el.classList.toggle("is-active", i === idx));
      }
      if (!reduced) {
        const hp = sectionProgress(hours);
        const travel = Math.max(0, track.scrollWidth - innerWidth);
        track.style.transform = `translate3d(${-hp * travel}px,0,0)`;
        const h = Math.min(4, Math.round(hp * 4));
        if (h !== activeHour) { activeHour = h; hourCards.forEach((c, i) => c.classList.toggle("is-active", i === h)); }
      }
      const sp = sectionProgress(specs);
      figures.forEach((el, i) => {
        const lit = reduced || sp > 0.05 + i * 0.12;
        if (lit && !el.classList.contains("is-lit") && !reduced) countUp(el.querySelector("dd"));
        el.classList.toggle("is-lit", lit);
      });
      return { caption: idx, inMovement: p > 0.02 && p < 0.995, specs: sp, movement: p };
    },

    setCageDeg(deg) {
      if (deg !== lastDeg) { lastDeg = deg; cageDeg.textContent = String(deg); }
    },

    intro(canvas) {
      if (reduced) return;
      const heroWords = split($(".hero__title"));
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      if (canvas) tl.from(canvas, { opacity: 0, duration: 1.2 }, 0);
      tl.from(heroWords, { yPercent: 110, duration: 1.5, stagger: 0.07 }, canvas ? 1.6 : 0.2)
        .from(".hero .reveal", { opacity: 0, y: 18, filter: "blur(6px)", duration: 1.2, stagger: 0.12 }, 2.1)
        .from("#nav", { opacity: 0, y: -12, duration: 1 }, 2.4);
      const tbWords = split($(".tourbillon__title"));
      gsap.from(tbWords, {
        yPercent: 110, duration: 1.2, stagger: 0.05, ease: "expo.out",
        scrollTrigger: { trigger: "#tourbillon", start: "top 20%", toggleActions: "play none none reverse" },
      });
    },
  };
}
