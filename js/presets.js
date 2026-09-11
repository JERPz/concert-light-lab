/**
 * presets.js — storing looks and cueing them to the music.
 *
 * A preset is a full snapshot of the rig: every fixture's programmed values
 * plus the master and the running effect. A cue is a preset id pinned to a
 * timestamp in the loaded clip; during playback the show runs itself.
 *
 * Everything lives in localStorage so a programmed show survives a reload,
 * and can be exported as JSON to move between machines.
 */

const KEY = "lumen.show.v1";
export const SLOTS = 8;
export const DEFAULT_FADE = 1.2;

/** @returns {{presets: Array, cues: Array, videoId: string|null}} */
export function emptyShow() {
  return { version: 1, presets: new Array(SLOTS).fill(null), cues: [], videoId: null };
}

export function loadShow() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyShow();
    const show = JSON.parse(raw);
    if (!show || !Array.isArray(show.presets)) return emptyShow();

    // Normalise length in case SLOTS changed between versions.
    const presets = new Array(SLOTS).fill(null);
    show.presets.slice(0, SLOTS).forEach((p, i) => (presets[i] = p ?? null));

    return {
      version: 1,
      presets,
      cues: Array.isArray(show.cues) ? show.cues : [],
      videoId: typeof show.videoId === "string" ? show.videoId : null,
    };
  } catch {
    return emptyShow();
  }
}

export function saveShow(show) {
  try {
    localStorage.setItem(KEY, JSON.stringify(show));
    return true;
  } catch {
    // Private browsing or a full quota — the app still works, it just forgets.
    return false;
  }
}

/**
 * Capture the current rig state.
 * @param {Fixture[]} fixtures
 * @param {object} extras { master, effect, name, fade }
 */
export function capture(fixtures, extras) {
  return {
    name: extras.name || "Look",
    fade: extras.fade ?? DEFAULT_FADE,
    master: extras.master ?? 1,
    effect: { ...extras.effect },
    fixtures: fixtures.map((f) => f.snapshot()),
  };
}

/**
 * Push a preset onto the rig.
 * @param {object} preset
 * @param {Fixture[]} fixtures
 * @param {number} [fade] override the preset's own fade time
 */
export function recall(preset, fixtures, fade) {
  if (!preset) return null;
  const t = fade ?? preset.fade ?? DEFAULT_FADE;

  if (Array.isArray(preset.fixtures)) {
    // Snapshots are keyed by fixture id so a reordered rig still recalls.
    const byId = new Map(preset.fixtures.map((s) => [s.id, s]));
    for (const f of fixtures) {
      const s = byId.get(f.id);
      if (s) f.applySnapshot(s, t);
    }
  } else if (preset.fixtures && typeof preset.fixtures === "object") {
    // Group-keyed shorthand, used by the built-in opening look.
    for (const f of fixtures) {
      const s = preset.fixtures[f.group];
      if (s) f.applySnapshot(s, t);
    }
  }

  return { master: preset.master, effect: preset.effect };
}

/* ------------------------------------------------------------------ *
 * Cues
 * ------------------------------------------------------------------ */

/** Insert a cue and keep the list sorted by time. */
export function addCue(cues, time, slot) {
  const cue = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, time, slot };
  cues.push(cue);
  cues.sort((a, b) => a.time - b.time);
  return cue;
}

export function removeCue(cues, id) {
  const i = cues.findIndex((c) => c.id === id);
  if (i >= 0) cues.splice(i, 1);
}

/**
 * Which cues fall in (from, to]? Used each frame while the clip plays.
 * Returns them in order so a rapid burst still lands in sequence.
 */
export function cuesBetween(cues, from, to) {
  if (to <= from) return [];
  return cues.filter((c) => c.time > from && c.time <= to);
}

/* ------------------------------------------------------------------ *
 * Import / export
 * ------------------------------------------------------------------ */

export function exportShow(show) {
  const blob = new Blob([JSON.stringify(show, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lumen-show-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @returns {Promise<object>} a validated show */
export async function importShow(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.presets)) throw new Error("Not a Lumen show file.");

  const presets = new Array(SLOTS).fill(null);
  data.presets.slice(0, SLOTS).forEach((p, i) => (presets[i] = p ?? null));

  return {
    version: 1,
    presets,
    cues: Array.isArray(data.cues) ? data.cues.filter((c) => typeof c.time === "number") : [],
    videoId: typeof data.videoId === "string" ? data.videoId : null,
  };
}
