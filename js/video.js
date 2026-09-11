/**
 * video.js — the stage LED wall.
 *
 * WebGL cannot texture a cross-origin iframe, so the YouTube player is a real
 * DOM element placed in 3D by CSS3DRenderer, sitting *behind* a transparent
 * WebGL canvas. A depth-only blocker mesh (see stage.js) keeps the 3D scene
 * from painting over it. This is the same trick as three.js's css3d_youtube
 * example, and it means beams sweep in front of the video correctly.
 *
 * Playback is driven through the IFrame Player API rather than the video's own
 * controls, because the WebGL canvas sits on top and swallows clicks.
 */

import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import { SCREEN } from "./stage.js";

/** A short Creative Commons clip that is safe to embed for the demo button. */
export const DEMO_VIDEO = "aqz-KE-bpKQ";

/**
 * Pull the 11-character id out of any of the shapes a YouTube link takes.
 * @returns {string|null}
 */
export function parseVideoId(input) {
  if (!input) return null;
  const raw = input.trim();

  // A bare id.
  if (/^[\w-]{11}$/.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) return null;

  const v = url.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;

  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  const m = url.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * IFrame API loader
 * ------------------------------------------------------------------ */

let apiPromise = null;

function loadYouTubeAPI() {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(window.YT);
    };

    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => reject(new Error("Could not reach the YouTube player API."));
    document.head.appendChild(s);

    setTimeout(() => reject(new Error("YouTube player API timed out.")), 12000);
  }).catch((err) => {
    apiPromise = null;
    throw err;
  });

  return apiPromise;
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export class StageScreen {
  /**
   * @param {HTMLElement} mount container for the CSS3D layer
   * @param {THREE.Scene} scene  WebGL scene (only used for the object graph)
   */
  constructor(mount, scene) {
    this.ready = false;      // true once the YT player has fired onReady
    this.videoId = null;
    this.player = null;
    this.duration = 0;
    this.muted = false;
    this._onState = null;

    // --- CSS3D layer ---
    this.cssScene = new THREE.Scene();
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(this.cssRenderer.domElement);

    // --- the screen element ---
    const el = document.createElement("div");
    el.id = "ledScreen";
    el.style.width = `${SCREEN.px.w}px`;
    el.style.height = `${SCREEN.px.h}px`;
    el.innerHTML = `
      <div class="led-idle" id="ledIdle">
        <div class="led-bars"><i style="animation-delay:0s"></i><i style="animation-delay:.15s"></i><i style="animation-delay:.3s"></i><i style="animation-delay:.45s"></i><i style="animation-delay:.6s"></i></div>
        <p>Load a clip</p>
      </div>`;
    this.element = el;
    this.idle = el.querySelector("#ledIdle");

    const object = new CSS3DObject(el);
    object.position.set(...SCREEN.position);
    object.scale.setScalar(SCREEN.scale);
    this.cssScene.add(object);
    this.object = object;
  }

  setSize(w, h) {
    this.cssRenderer.setSize(w, h);
  }

  render(camera) {
    this.cssRenderer.render(this.cssScene, camera);
  }

  /**
   * Load a video, creating the player on first use.
   * @param {string} id 11-character YouTube id
   */
  async load(id) {
    this.videoId = id;

    if (this.player) {
      this.player.loadVideoById(id);
      this.idle.hidden = true;
      return;
    }

    const YT = await loadYouTubeAPI();

    // Build the iframe ourselves so the CSS3DObject keeps a stable DOM node —
    // YT.Player would otherwise replace a plain div and orphan our reference.
    const frame = document.createElement("iframe");
    frame.id = "ytFrame";
    frame.title = "Stage video feed";
    frame.allow = "autoplay; encrypted-media; picture-in-picture";
    frame.allowFullscreen = false;
    const params = new URLSearchParams({
      enablejsapi: "1",
      controls: "0",
      rel: "0",
      modestbranding: "1",
      playsinline: "1",
      iv_load_policy: "3",
      origin: location.origin,
    });
    frame.src = `https://www.youtube.com/embed/${id}?${params}`;
    this.element.appendChild(frame);
    this.idle.hidden = true;

    await new Promise((resolve, reject) => {
      this.player = new YT.Player("ytFrame", {
        events: {
          onReady: () => {
            this.ready = true;
            this.duration = this.player.getDuration?.() || 0;
            resolve();
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) {
              this.duration = this.player.getDuration?.() || this.duration;
            }
            this._onState?.(e.data);
          },
          onError: (e) => reject(new Error(`YouTube refused this clip (code ${e.data}).`)),
        },
      });
      setTimeout(() => (this.ready ? resolve() : reject(new Error("Player never became ready."))), 12000);
    });
  }

  onStateChange(fn) { this._onState = fn; }

  /* --- transport ------------------------------------------------- */

  get playing() {
    // 1 === PLAYING
    return !!this.player && this.player.getPlayerState?.() === 1;
  }

  toggle() {
    if (!this.ready) return false;
    if (this.playing) this.player.pauseVideo();
    else this.player.playVideo();
    return true;
  }

  seek(seconds) {
    if (this.ready) this.player.seekTo(seconds, true);
  }

  setMuted(on) {
    if (!this.ready) return;
    this.muted = on;
    if (on) this.player.mute();
    else this.player.unMute();
  }

  get time() {
    return this.ready ? this.player.getCurrentTime?.() || 0 : 0;
  }
}

/** 83.4 → "1:23" */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
