// Sound for the title sequence, synthesized: a low drone, escapement ticks, a boom on the title,
// and a filtered-noise riser into the fly-through. Silent until start() runs inside a user gesture.
const MASTER_GAIN = 0.9;

export function createScore() {
  let ctx = null, out = null, drone = null;

  function noise(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function envelope(peak, attack, decay, at = ctx.currentTime) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  }

  const live = () => ctx && ctx.state === "running";

  return {
    start() {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume();
      out = ctx.createGain();
      out.gain.value = MASTER_GAIN;
      out.connect(ctx.destination);
    },

    // Two detuned low sines under a slow filter: room tone for a dark stage.
    drone(on) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (on && !drone) {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.07, now + 2.2);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 320;
        const oscs = [55, 82.41, 110.3].map((f, i) => {
          const o = ctx.createOscillator();
          o.type = i === 2 ? "triangle" : "sine";
          o.frequency.value = f;
          o.detune.value = (i - 1) * 6;
          o.connect(filter);
          o.start(now);
          return o;
        });
        filter.connect(gain).connect(out);
        drone = { gain, oscs };
      } else if (!on && drone) {
        drone.gain.gain.cancelScheduledValues(now);
        drone.gain.gain.setValueAtTime(drone.gain.gain.value, now);
        drone.gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
        drone.oscs.forEach((o) => o.stop(now + 1.7));
        drone = null;
      }
    },

    // A pallet striking the escape wheel: a short band-passed click, tock pitched lower.
    tick(tock) {
      if (!live()) return;
      const src = noise(0.03);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = tock ? 3100 : 4400;
      band.Q.value = 7;
      src.connect(band).connect(envelope(tock ? 0.5 : 0.65, 0.001, 0.05)).connect(out);
      src.start();
    },

    // Sub drop with a soft noise body.
    boom() {
      if (!live()) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(72, now);
      o.frequency.exponentialRampToValueAtTime(32, now + 1.4);
      o.connect(envelope(0.85, 0.01, 1.8)).connect(out);
      o.start(now);
      o.stop(now + 2);
      const body = noise(1.2);
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 180;
      body.connect(low).connect(envelope(0.35, 0.005, 0.9)).connect(out);
      body.start(now);
    },

    // Noise swept upward into the fly-through, then released as air rushing past.
    rise() {
      if (!live()) return;
      const now = ctx.currentTime;
      const src = noise(2.4);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.4;
      band.frequency.setValueAtTime(260, now);
      band.frequency.exponentialRampToValueAtTime(5200, now + 0.9);
      band.frequency.exponentialRampToValueAtTime(900, now + 2.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.32, now + 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.3);
      src.connect(band).connect(g).connect(out);
      src.start(now);
    },
  };
}
