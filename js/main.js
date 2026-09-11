/**
 * main.js — boot the venue and run the show.
 *
 * Render layering is the one unusual part: the WebGL canvas is transparent and
 * sits above a CSS3D layer holding the YouTube iframe, so the video appears on
 * the LED wall while beams still pass in front of it. See video.js.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { buildStage, deckHeightAt } from "./stage.js";
import { buildRig, OPENING_LOOK } from "./fixtures.js";
import { applyEffects } from "./effects.js";
import { StageScreen } from "./video.js";
import { loadShow, recall, cuesBetween } from "./presets.js";
import { AudioReactor } from "./audio.js";
import { Console } from "./ui.js";

/* ------------------------------------------------------------------ *
 * Renderer
 * ------------------------------------------------------------------ */

const canvas = document.getElementById("webgl");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true, // required: the LED wall shows through from the layer below
    powerPreference: "high-performance",
  });
} catch (err) {
  document.getElementById("fatal").hidden = false;
  console.error("WebGL unavailable:", err);
  throw err;
}

const DPR = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 9, 30);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 6, -2);
controls.minDistance = 6;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor

/* ------------------------------------------------------------------ *
 * Venue + rig
 * ------------------------------------------------------------------ */

const stage = buildStage(scene);
const fixtures = buildRig(scene);
stage.haze.material.uniforms.uDpr.value = DPR;

const screen = new StageScreen(document.getElementById("css3d"), scene);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const show = loadShow();
const audio = new AudioReactor();

const state = {
  master: 1,
  blackout: false,
  haze: true,
  selection: new Set(),
  effect: { name: "none", rate: 0.5, size: 0.4, spread: 0.6 },
  effectScope: "all",
  activeSlot: -1,
  cueArmed: true,
};

// Give the desk something to look at on first load.
recall(OPENING_LOOK, fixtures, 0);
Object.assign(state.effect, OPENING_LOOK.effect);

/* ------------------------------------------------------------------ *
 * Camera views
 * ------------------------------------------------------------------ */

const VIEWS = {
  foh:   { pos: [0, 9, 30],   look: [0, 6, -2] },
  close: { pos: [0, 4.5, 13], look: [0, 4, -4] },
  side:  { pos: [25, 9, 9],   look: [-2, 6, -3] },
  above: { pos: [0, 27, 9],   look: [0, 2, -2] },
  crowd: { pos: [0, 2.4, 23], look: [0, 8, -6] },
};

const camTween = { active: false, pos: new THREE.Vector3(), look: new THREE.Vector3() };

function setView(name) {
  const v = VIEWS[name];
  if (!v) return;
  camTween.pos.fromArray(v.pos);
  camTween.look.fromArray(v.look);
  camTween.active = true;
}

/* ------------------------------------------------------------------ *
 * Console
 * ------------------------------------------------------------------ */

const desk = new Console({ fixtures, screen, state, show, audio, setView });

/* ------------------------------------------------------------------ *
 * Resize
 * ------------------------------------------------------------------ */

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  screen.setSize(innerWidth, innerHeight);
});

/* ------------------------------------------------------------------ *
 * Loop
 * ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let showTime = 0;
let lastVideoTime = 0;
let frames = 0;
let fpsClock = 0;
let fps = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  showTime += dt;

  // --- camera fly-to ---
  if (camTween.active) {
    const k = 1 - Math.exp(-4 * dt);
    camera.position.lerp(camTween.pos, k);
    controls.target.lerp(camTween.look, k);
    if (camera.position.distanceTo(camTween.pos) < 0.05) camTween.active = false;
  }

  // --- cue playback: fire anything the playhead just crossed ---
  if (screen.ready) {
    const t = screen.time;
    if (t < lastVideoTime - 0.25) {
      lastVideoTime = t; // the user scrubbed backwards
    } else if (state.cueArmed && screen.playing) {
      for (const cue of cuesBetween(show.cues, lastVideoTime, t)) {
        desk.recallPreset(cue.slot);
      }
      lastVideoTime = t;
    } else {
      lastVideoTime = t;
    }
  }

  // --- lighting ---
  const bands = audio.enabled ? audio.sample() : audio.bands;
  const scope = state.effectScope === "selection" ? state.selection : null;
  applyEffects(fixtures, state.effect, showTime, scope, bands);

  const master = state.blackout ? 0 : state.master;
  for (const f of fixtures) f.update(dt, showTime, master, deckHeightAt);

  // --- atmosphere ---
  stage.haze.visible = state.haze;
  stage.haze.material.uniforms.uTime.value = showTime;

  // --- the band plays along to the music ---
  stage.band.update(showTime, bands);

  controls.update();
  renderer.render(scene, camera);
  screen.render(camera);

  frames++;
  fpsClock += dt;
  if (fpsClock >= 0.5) {
    fps = Math.round(frames / fpsClock);
    frames = 0;
    fpsClock = 0;
  }
  desk.update(dt, fps);

  requestAnimationFrame(tick);
}

tick();
