/**
 * effects.js — the effect engine.
 *
 * Effects never touch programmed values. They write offsets into each
 * fixture's `fx` slot, which the fixture adds to its base on the way out, so
 * you can run a sweep and still edit a pan without the two fighting.
 */

const TAU = Math.PI * 2;

export const EFFECTS = ["none", "sweep", "fan", "chase", "pulse", "circle", "audio"];

/** Reset every offset to neutral. */
function clear(fixtures) {
  for (const f of fixtures) {
    f.fx.dimmer = 1;
    f.fx.pan = 0;
    f.fx.tilt = 0;
    f.fx.zoom = 0;
  }
}

/**
 * @param {Fixture[]} fixtures  the whole rig
 * @param {object} cfg   { name, rate (Hz), size 0..1, spread 0..1 }
 * @param {number} time  show clock in seconds
 * @param {Set<number>} scope fixture ids the effect applies to; empty = all
 * @param {object} audio { level, bass, mid, high } all 0..1
 */
export function applyEffects(fixtures, cfg, time, scope, audio) {
  clear(fixtures);
  if (cfg.name === "none") return;

  const active = scope && scope.size
    ? fixtures.filter((f) => scope.has(f.id))
    : fixtures;
  if (!active.length) return;

  const phase = time * cfg.rate * TAU;
  const n = active.length;

  active.forEach((f, i) => {
    // Offset each fixture along the effect so it travels across the rig.
    const step = n > 1 ? i / (n - 1) : 0;      // 0..1 across the group
    const centred = step * 2 - 1;              // -1..1, for symmetric fans
    const off = step * cfg.spread * TAU;

    switch (cfg.name) {
      case "sweep":
        f.fx.pan = Math.sin(phase + off) * cfg.size * 120;
        break;

      case "fan":
        // A static spread that breathes: classic "fan out" look.
        f.fx.tilt = centred * cfg.spread * 45 + Math.sin(phase) * cfg.size * 18;
        f.fx.pan = centred * cfg.size * 40;
        break;

      case "chase": {
        // One fixture at a time, with a short tail.
        const pos = (time * cfg.rate * n) % n;
        const dist = Math.min(Math.abs(i - pos), n - Math.abs(i - pos));
        const tail = 0.4 + cfg.size * 2.2;
        f.fx.dimmer = Math.max(1 - cfg.size, Math.max(0, 1 - dist / tail));
        break;
      }

      case "pulse":
        f.fx.dimmer = 1 - cfg.size * (0.5 - 0.5 * Math.cos(phase + off));
        break;

      case "circle":
        f.fx.pan = Math.sin(phase + off) * cfg.size * 90;
        f.fx.tilt = Math.cos(phase + off) * cfg.size * 45;
        break;

      case "audio": {
        // Bass drives level, mids nudge the beams, highs open the zoom.
        const punch = audio.bass * cfg.size;
        f.fx.dimmer = Math.min(1, 1 - cfg.size + punch * 1.6);
        f.fx.pan = Math.sin(phase + off) * audio.mid * cfg.size * 60;
        f.fx.tilt = centred * audio.mid * cfg.spread * 24;
        f.fx.zoom = audio.high * cfg.size * 14;
        break;
      }
    }
  });
}

/** Human-readable label for the rate slider. */
export function rateLabel(rate) {
  return `${rate.toFixed(2)} Hz`;
}
