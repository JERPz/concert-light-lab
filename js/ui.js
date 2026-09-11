/**
 * ui.js — the lighting desk.
 *
 * Owns every DOM control and translates it into rig state. The 3D side never
 * reads the DOM; it only reads `state` and the fixtures' programmed values.
 */

import { EFFECTS, rateLabel } from "./effects.js";
import {
  SLOTS, DEFAULT_FADE, capture, recall, addCue, removeCue,
  saveShow, exportShow, importShow,
} from "./presets.js";
import { parseVideoId, formatTime, DEMO_VIDEO } from "./video.js";

const $ = (id) => document.getElementById(id);

const SWATCHES = [
  "#ffffff", "#ffd9a0", "#ff9b45", "#ff3b57", "#ff4fd8",
  "#8a4fff", "#3b6dff", "#22c6ff", "#2bffbe", "#8dff45", "#fff03b",
];

export class Console {
  /**
   * @param {object} deps
   * @param {Fixture[]} deps.fixtures
   * @param {StageScreen} deps.screen
   * @param {object} deps.state    shared mutable rig state
   * @param {object} deps.show     presets + cues, persisted
   * @param {AudioReactor} deps.audio
   * @param {(name: string) => void} deps.setView
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.seekDragging = false;
    this._lampClock = 0;
    this._toastTimer = 0;

    this._buildFixtureList();
    this._buildSwatches();
    this._buildPresetSlots();
    this._bindGroups();
    this._bindAttributes();
    this._bindEffects();
    this._bindMaster();
    this._bindVideo();
    this._bindPresets();
    this._bindCues();
    this._bindViews();
    this._bindKeys();

    $("fixtureCount").textContent = this.fixtures.length;
    this.renderCues();
    this.syncFromState();
    this.refreshSelection();
  }

  /* ---------------------------------------------------------------- *
   * Patch list
   * ---------------------------------------------------------------- */

  _buildFixtureList() {
    const list = $("fixtureList");
    list.innerHTML = "";
    this.lamps = new Map();

    this.fixtures.forEach((f) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.dataset.id = String(f.id);
      btn.innerHTML =
        `<span class="id">${String(f.id).padStart(2, "0")}</span>` +
        `<span class="nm">${f.name}</span>` +
        `<span class="lamp"></span>`;
      btn.addEventListener("click", (e) => this._clickFixture(f.id, e));
      li.appendChild(btn);
      list.appendChild(li);
      this.lamps.set(f.id, { btn, dot: btn.querySelector(".lamp") });
    });
  }

  _clickFixture(id, e) {
    const sel = this.state.selection;
    const ids = this.fixtures.map((f) => f.id);

    if (e.shiftKey && this._lastClicked != null) {
      const a = ids.indexOf(this._lastClicked);
      const b = ids.indexOf(id);
      const [from, to] = a < b ? [a, b] : [b, a];
      for (let i = from; i <= to; i++) sel.add(ids[i]);
    } else if (e.metaKey || e.ctrlKey) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
    } else {
      sel.clear();
      sel.add(id);
    }

    this._lastClicked = id;
    this.refreshSelection();
  }

  _bindGroups() {
    document.querySelectorAll("[data-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.dataset.group;
        const sel = this.state.selection;
        sel.clear();
        if (g === "all") this.fixtures.forEach((f) => sel.add(f.id));
        else if (g === "odd") this.fixtures.forEach((f) => f.id % 2 && sel.add(f.id));
        else if (g === "even") this.fixtures.forEach((f) => f.id % 2 === 0 && sel.add(f.id));
        else if (g !== "none") this.fixtures.filter((f) => f.group === g).forEach((f) => sel.add(f.id));
        this.refreshSelection();
      });
    });
  }

  /** @returns {Fixture[]} */
  selected() {
    const sel = this.state.selection;
    return this.fixtures.filter((f) => sel.has(f.id));
  }

  refreshSelection() {
    const sel = this.state.selection;
    for (const [id, { btn }] of this.lamps) {
      btn.setAttribute("aria-pressed", String(sel.has(id)));
    }

    const n = sel.size;
    $("selCount").textContent = `${n} selected`;

    const controls = ["attrDimmer", "attrPan", "attrTilt", "attrZoom", "attrStrobe", "attrColor"];
    controls.forEach((c) => ($(c).disabled = n === 0));
    document.querySelectorAll("#swatches button").forEach((b) => (b.disabled = n === 0));

    // Mirror the first selected fixture so the sliders show real values.
    const f = this.selected()[0];
    if (f) {
      $("attrDimmer").value = Math.round(f.base.dimmer * 100);
      $("attrPan").value = Math.round(f.base.pan);
      $("attrTilt").value = Math.round(f.base.tilt);
      $("attrZoom").value = Math.round(f.base.zoom);
      $("attrStrobe").value = Math.round(f.base.strobe);
      $("attrColor").value = `#${f.base.color.getHexString()}`;
    }
    this._syncAttrLabels();
  }

  _syncAttrLabels() {
    $("outDimmer").textContent = `${$("attrDimmer").value}%`;
    $("outPan").textContent = `${$("attrPan").value}\u00B0`;
    $("outTilt").textContent = `${$("attrTilt").value}\u00B0`;
    $("outZoom").textContent = `${$("attrZoom").value}\u00B0`;
    const st = Number($("attrStrobe").value);
    $("outStrobe").textContent = st < 0.5 ? "off" : `${st.toFixed(0)} Hz`;
  }

  /* ---------------------------------------------------------------- *
   * Attribute editing
   * ---------------------------------------------------------------- */

  _bindAttributes() {
    const write = (fn) => {
      for (const f of this.selected()) {
        f.holdFade(); // a hand on the desk always wins over a running fade
        fn(f);
      }
      this._syncAttrLabels();
      this.state.activeSlot = -1;
      this.markPresetSlots();
    };

    $("attrDimmer").addEventListener("input", (e) =>
      write((f) => (f.base.dimmer = Number(e.target.value) / 100)));
    $("attrPan").addEventListener("input", (e) =>
      write((f) => (f.base.pan = Number(e.target.value))));
    $("attrTilt").addEventListener("input", (e) =>
      write((f) => (f.base.tilt = Number(e.target.value))));
    $("attrZoom").addEventListener("input", (e) =>
      write((f) => (f.base.zoom = Number(e.target.value))));
    $("attrStrobe").addEventListener("input", (e) =>
      write((f) => (f.base.strobe = Number(e.target.value))));
    $("attrColor").addEventListener("input", (e) =>
      write((f) => f.base.color.set(e.target.value)));
  }

  _buildSwatches() {
    const wrap = $("swatches");
    wrap.innerHTML = "";
    SWATCHES.forEach((hex) => {
      const b = document.createElement("button");
      b.type = "button";
      b.style.background = hex;
      b.title = hex;
      b.setAttribute("aria-label", `Set colour ${hex}`);
      b.addEventListener("click", () => {
        for (const f of this.selected()) {
          f.holdFade();
          f.base.color.set(hex);
        }
        $("attrColor").value = hex;
      });
      wrap.appendChild(b);
    });
  }

  /* ---------------------------------------------------------------- *
   * Effects
   * ---------------------------------------------------------------- */

  _bindEffects() {
    const fx = this.state.effect;

    $("fxName").addEventListener("change", (e) => {
      fx.name = EFFECTS.includes(e.target.value) ? e.target.value : "none";
      const isAudio = fx.name === "audio";
      $("audioNote").hidden = !isAudio;
      $("micBtn").hidden = !isAudio || this.audio.enabled;
    });

    $("fxScope").addEventListener("change", (e) => (this.state.effectScope = e.target.value));

    $("fxRate").addEventListener("input", (e) => {
      fx.rate = Number(e.target.value) / 100;
      $("outRate").textContent = rateLabel(fx.rate);
    });
    $("fxSize").addEventListener("input", (e) => {
      fx.size = Number(e.target.value) / 100;
      $("outSize").textContent = `${e.target.value}%`;
    });
    $("fxSpread").addEventListener("input", (e) => {
      fx.spread = Number(e.target.value) / 100;
      $("outSpread").textContent = `${e.target.value}%`;
    });

    $("micBtn").addEventListener("click", async () => {
      try {
        await this.audio.enable();
        $("micBtn").hidden = true;
        this.toast("Microphone live");
      } catch (err) {
        this.toast(err.message || "Microphone refused");
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * Master
   * ---------------------------------------------------------------- */

  _bindMaster() {
    $("master").addEventListener("input", (e) => {
      this.state.master = Number(e.target.value) / 100;
      $("outMaster").textContent = `${e.target.value}%`;
    });

    $("blackout").addEventListener("click", () => this.toggleBlackout());

    $("haze").addEventListener("click", () => {
      this.state.haze = !this.state.haze;
      $("haze").setAttribute("aria-pressed", String(this.state.haze));
    });
  }

  toggleBlackout() {
    this.state.blackout = !this.state.blackout;
    $("blackout").setAttribute("aria-pressed", String(this.state.blackout));
    this.toast(this.state.blackout ? "Blackout" : "Blackout released");
  }

  /* ---------------------------------------------------------------- *
   * Video transport
   * ---------------------------------------------------------------- */

  _bindVideo() {
    const urlInput = $("ytUrl");

    const load = async (raw) => {
      const id = parseVideoId(raw);
      if (!id) {
        this.toast("That is not a YouTube link");
        return;
      }
      $("ytNote").textContent = "Loading…";
      try {
        await this.screen.load(id);
        this.show.videoId = id;
        saveShow(this.show);
        $("ytNote").textContent = "Press play — the clip runs on the LED wall.";
        this.toast("Clip loaded");
      } catch (err) {
        $("ytNote").textContent = err.message || "Could not load that clip.";
        this.toast("Load failed");
      }
    };

    $("ytLoad").addEventListener("click", () => load(urlInput.value));
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") load(urlInput.value);
    });
    $("ytDemo").addEventListener("click", () => {
      urlInput.value = `https://www.youtube.com/watch?v=${DEMO_VIDEO}`;
      load(DEMO_VIDEO);
    });

    $("ytPlay").addEventListener("click", () => {
      if (!this.screen.toggle()) this.toast("Load a clip first");
    });

    $("ytMute").addEventListener("click", () => {
      this.screen.setMuted(!this.screen.muted);
      $("ytMute").textContent = this.screen.muted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
    });

    const seek = $("ytSeek");
    seek.addEventListener("pointerdown", () => (this.seekDragging = true));
    const release = () => {
      if (!this.seekDragging) return;
      this.seekDragging = false;
      const d = this.screen.duration;
      if (d) this.screen.seek((Number(seek.value) / 1000) * d);
    };
    seek.addEventListener("pointerup", release);
    seek.addEventListener("pointercancel", release);
    seek.addEventListener("change", release);

    if (this.show.videoId) urlInput.value = `https://www.youtube.com/watch?v=${this.show.videoId}`;
  }

  /* ---------------------------------------------------------------- *
   * Presets
   * ---------------------------------------------------------------- */

  _buildPresetSlots() {
    const wrap = $("presetSlots");
    wrap.innerHTML = "";
    this.slotButtons = [];

    for (let i = 0; i < SLOTS; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.slot = String(i);
      b.addEventListener("click", (e) => {
        if (e.shiftKey) this.storePreset(i);
        else this.recallPreset(i);
      });
      wrap.appendChild(b);
      this.slotButtons.push(b);
    }
    this.markPresetSlots();
  }

  markPresetSlots() {
    this.slotButtons.forEach((b, i) => {
      const p = this.show.presets[i];
      b.textContent = p ? p.name : `${i + 1} —`;
      b.title = p ? `Recall "${p.name}" (shift-click to overwrite)` : "Empty — shift-click to store";
      b.classList.toggle("filled", !!p);
      b.classList.toggle("active", this.state.activeSlot === i);
    });
    this._refreshCuePresetOptions();
  }

  storePreset(slot, name) {
    const preset = capture(this.fixtures, {
      name: name || $("presetName").value.trim() || `Look ${slot + 1}`,
      fade: DEFAULT_FADE,
      master: this.state.master,
      effect: this.state.effect,
    });
    this.show.presets[slot] = preset;
    this.state.activeSlot = slot;
    saveShow(this.show);
    this.markPresetSlots();
    this.renderCues();
    this.toast(`Stored "${preset.name}" in ${slot + 1}`);
  }

  recallPreset(slot, fade) {
    const preset = this.show.presets[slot];
    if (!preset) {
      this.toast(`Slot ${slot + 1} is empty — shift-click to store`);
      return;
    }
    const applied = recall(preset, this.fixtures, fade);
    if (applied?.master !== undefined) this.state.master = applied.master;
    if (applied?.effect) Object.assign(this.state.effect, applied.effect);
    this.state.activeSlot = slot;
    this.syncFromState();
    this.markPresetSlots();
    this.refreshSelection();
  }

  /** Push rig state back into the controls after a recall. */
  syncFromState() {
    const fx = this.state.effect;
    $("master").value = Math.round(this.state.master * 100);
    $("outMaster").textContent = `${Math.round(this.state.master * 100)}%`;
    $("fxName").value = fx.name;
    $("fxRate").value = Math.round(fx.rate * 100);
    $("outRate").textContent = rateLabel(fx.rate);
    $("fxSize").value = Math.round(fx.size * 100);
    $("outSize").textContent = `${Math.round(fx.size * 100)}%`;
    $("fxSpread").value = Math.round(fx.spread * 100);
    $("outSpread").textContent = `${Math.round(fx.spread * 100)}%`;
    $("fxScope").value = this.state.effectScope;
    $("audioNote").hidden = fx.name !== "audio";
    $("micBtn").hidden = fx.name !== "audio" || this.audio.enabled;
  }

  _bindPresets() {
    $("presetSave").addEventListener("click", () => {
      const free = this.show.presets.findIndex((p) => !p);
      this.storePreset(free >= 0 ? free : 0);
      $("presetName").value = "";
    });

    $("presetExport").addEventListener("click", () => {
      exportShow(this.show);
      this.toast("Show exported");
    });

    $("presetImport").addEventListener("click", () => $("presetFile").click());
    $("presetFile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const imported = await importShow(file);
        this.show.presets = imported.presets;
        this.show.cues = imported.cues;
        if (imported.videoId) this.show.videoId = imported.videoId;
        saveShow(this.show);
        this.markPresetSlots();
        this.renderCues();
        this.toast("Show imported");
      } catch (err) {
        this.toast(err.message || "Bad show file");
      }
      e.target.value = "";
    });
  }

  /* ---------------------------------------------------------------- *
   * Cues
   * ---------------------------------------------------------------- */

  _bindCues() {
    $("cueArm").addEventListener("click", () => {
      this.state.cueArmed = !this.state.cueArmed;
      $("cueArm").setAttribute("aria-pressed", String(this.state.cueArmed));
      $("cueArm").textContent = this.state.cueArmed ? "Armed" : "Disarmed";
    });

    $("cueAdd").addEventListener("click", () => {
      if (!this.screen.ready) {
        this.toast("Load a clip first");
        return;
      }
      const slot = Number($("cuePreset").value);
      if (!this.show.presets[slot]) {
        this.toast("Store a preset first");
        return;
      }
      addCue(this.show.cues, this.screen.time, slot);
      saveShow(this.show);
      this.renderCues();
      this.toast(`Cue at ${formatTime(this.screen.time)}`);
    });
  }

  _refreshCuePresetOptions() {
    const sel = $("cuePreset");
    const keep = sel.value;
    sel.innerHTML = "";
    this.show.presets.forEach((p, i) => {
      if (!p) return;
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${i + 1}. ${p.name}`;
      sel.appendChild(o);
    });
    if (!sel.options.length) {
      const o = document.createElement("option");
      o.value = "-1";
      o.textContent = "no presets stored";
      sel.appendChild(o);
    }
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }

  renderCues() {
    const list = $("cueList");
    list.innerHTML = "";

    if (!this.show.cues.length) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="empty">Store a preset, then record it against the playhead.</span>`;
      list.appendChild(li);
      this._refreshCuePresetOptions();
      return;
    }

    this.show.cues.forEach((cue) => {
      const p = this.show.presets[cue.slot];
      const li = document.createElement("li");
      li.dataset.id = cue.id;

      const t = document.createElement("button");
      t.type = "button";
      t.className = "t";
      t.textContent = formatTime(cue.time);
      t.title = "Jump here";
      t.addEventListener("click", () => this.screen.seek(cue.time));

      const nm = document.createElement("span");
      nm.textContent = p ? p.name : `slot ${cue.slot + 1} (empty)`;

      const x = document.createElement("button");
      x.type = "button";
      x.className = "x";
      x.textContent = "\u00D7";
      x.setAttribute("aria-label", "Delete cue");
      x.addEventListener("click", () => {
        removeCue(this.show.cues, cue.id);
        saveShow(this.show);
        this.renderCues();
      });

      li.append(t, nm, x);
      list.appendChild(li);
    });
    this._refreshCuePresetOptions();
  }

  /* ---------------------------------------------------------------- *
   * Views + keys
   * ---------------------------------------------------------------- */

  _bindViews() {
    this.viewButtons = [...document.querySelectorAll("[data-view]")];
    this.viewButtons.forEach((b) => {
      b.addEventListener("click", () => {
        this.setView(b.dataset.view);
        this.viewButtons.forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      });
    });

    $("uiToggle").addEventListener("click", () => this.toggleUI());
  }

  toggleUI() {
    document.body.classList.toggle("ui-hidden");
    const hidden = document.body.classList.contains("ui-hidden");
    $("uiToggle").textContent = hidden ? "Show UI" : "Hide UI";
  }

  cycleView() {
    const i = this.viewButtons.findIndex((b) => b.getAttribute("aria-pressed") === "true");
    const next = this.viewButtons[(Math.max(0, i) + 1) % this.viewButtons.length];
    next?.click();
  }

  _bindKeys() {
    addEventListener("keydown", (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const n = Number(e.key);
      if (n >= 1 && n <= SLOTS) {
        e.preventDefault();
        this.recallPreset(n - 1);
        return;
      }

      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          if (!this.screen.toggle()) this.toast("Load a clip first");
          break;
        case "b": this.toggleBlackout(); break;
        case "h": this.toggleUI(); break;
        case "v": this.cycleView(); break;
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * Per-frame refresh
   * ---------------------------------------------------------------- */

  toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove("show"), 1900);
  }

  /**
   * @param {number} dt seconds
   * @param {number} fps smoothed frame rate
   */
  update(dt, fps) {
    $("fps").textContent = fps;

    // --- lamp indicators, throttled: 20 DOM writes at 12 Hz is plenty ---
    this._lampClock += dt;
    if (this._lampClock > 0.08) {
      this._lampClock = 0;
      for (const f of this.fixtures) {
        const dot = this.lamps.get(f.id)?.dot;
        if (!dot) continue;
        const lvl = f.out.dimmer;
        dot.style.background = lvl > 0.004
          ? `#${f.base.color.getHexString()}`
          : "rgba(255,255,255,0.08)";
        dot.style.opacity = String(0.25 + Math.min(1, lvl) * 0.75);
      }
    }

    // --- transport readout ---
    const screen = this.screen;
    if (screen.ready) {
      const t = screen.time;
      const d = screen.duration || 0;
      $("ytTime").textContent = `${formatTime(t)} / ${formatTime(d)}`;
      if (!this.seekDragging && d > 0) $("ytSeek").value = Math.round((t / d) * 1000);
      $("ytPlay").textContent = screen.playing ? "\u23F8" : "\u25B6";
    }

    // --- highlight the cue that fires next ---
    const t = screen.ready ? screen.time : 0;
    const next = this.show.cues.find((c) => c.time > t);
    document.querySelectorAll("#cueList li").forEach((li) => {
      li.classList.toggle("next", !!next && li.dataset.id === next.id);
    });
  }
}
