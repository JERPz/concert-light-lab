/**
 * fixtures.js — a moving-head lighting fixture and the rig that holds them.
 *
 * Each fixture owns:
 *   • a yoke/head model so you can see where it is pointing
 *   • two nested cones that fake a haze-lit beam (additive, no lighting cost)
 *   • a glow sprite at the lens
 *   • a floor pool: the ellipse of light where the beam lands
 *
 * Attributes are split in three layers so effects and preset fades can coexist:
 *   base   — what the user programmed (this is what presets store)
 *   target — where a fading preset is heading
 *   out    — base + effect offsets, what actually gets rendered
 */

import * as THREE from "three";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * Shared resources — built once, reused by every fixture.
 * ------------------------------------------------------------------ */

/** Unit cone: apex at the origin, opening downward to y = -1. */
function unitBeamGeometry() {
  const g = new THREE.ConeGeometry(1, 1, 28, 1, true);
  g.translate(0, -0.5, 0); // apex to origin
  return g;
}

const BEAM_GEO = unitBeamGeometry();
/* Pools are a flat quad carrying the same soft radial gradient as the lens
   glow. A hard-edged circle reads as a painted shape; a gradient reads as
   light, which matters most for the wide blinder washes. */
const POOL_GEO = new THREE.PlaneGeometry(2, 2);
POOL_GEO.rotateX(-Math.PI / 2); // lie flat on the floor

const beamVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-viewPos.xyz);
    gl_Position = projectionMatrix * viewPos;
  }
`;

const beamFrag = /* glsl */ `
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uFalloff;

  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;

  void main() {
    // uv.y is 1 at the lens and 0 at the far end, so this fades with throw.
    float along = pow(clamp(vUv.y, 0.0, 1.0), uFalloff);

    // A real beam in haze is brightest through its middle, because that is
    // where the eye looks through the most lit air. On the cone's surface the
    // normal faces the camera near the middle of the silhouette, so |n·v|
    // reproduces that gradient and keeps the edges soft.
    float body = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 1.35);

    float a = along * body * uIntensity;
    if (a < 0.002) discard;

    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** Soft radial sprite used for the lens glow. */
function glowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.45)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let GLOW_TEX = null;

/* ------------------------------------------------------------------ *
 * Fixture
 * ------------------------------------------------------------------ */

export class Fixture {
  /**
   * @param {object} spec
   * @param {number} spec.id        1-based channel number
   * @param {string} spec.name      label in the patch list
   * @param {string} spec.group     'back' | 'front' | 'floor' | 'blinder'
   * @param {number[]} spec.position world position [x, y, z]
   * @param {boolean} [spec.up]     mount upside down (floor units fire upward)
   * @param {number} [spec.throw_]  maximum beam length in world units
   */
  constructor(spec) {
    this.id = spec.id;
    this.name = spec.name;
    this.group = spec.group;
    this.up = !!spec.up;
    this.maxThrow = spec.throw_ ?? 34;

    this.base = {
      dimmer: 0,
      pan: 0,
      tilt: spec.tilt ?? 0,
      zoom: spec.zoom ?? 14,
      strobe: 0,
      color: new THREE.Color(0xffffff),
    };
    this.target = { ...this.base, color: this.base.color.clone() };
    this.fadeLeft = 0;

    // Written by the effect engine every frame, then consumed by update().
    this.fx = { dimmer: 1, pan: 0, tilt: 0, zoom: 0 };

    this.out = { dimmer: 0, pan: 0, tilt: 0, zoom: 14 };
    this.strobePhase = Math.random() * TAU;

    this._build(spec.position);
  }

  _build([x, y, z]) {
    if (!GLOW_TEX) GLOW_TEX = glowTexture();

    const root = new THREE.Group();
    root.position.set(x, y, z);
    if (this.up) root.rotation.z = Math.PI; // flip so "down" becomes "up"
    this.root = root;

    const body = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.65, metalness: 0.5 });

    // Clamp bracket + base.
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.46), body);
    base.position.y = 0.08;
    root.add(base);

    // The yoke pans about Y.
    const yoke = new THREE.Group();
    root.add(yoke);
    this.yoke = yoke;

    const arms = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.1), body);
    arms.position.y = -0.16;
    yoke.add(arms);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.3), body);
      arm.position.set(side * 0.245, -0.36, 0);
      yoke.add(arm);
    }

    // The head tilts about X.
    const head = new THREE.Group();
    head.position.y = -0.42;
    yoke.add(head);
    this.head = head;

    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.44, 18), body);
    shell.position.y = -0.14;
    head.add(shell);

    // --- beam: a wide soft cone with a brighter core inside it ---
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uIntensity: { value: 0 },
        uFalloff: { value: 1.7 },
      },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.coreMat = this.beamMat.clone();
    this.coreMat.uniforms.uFalloff.value = 1.1;

    this.beam = new THREE.Mesh(BEAM_GEO, this.beamMat);
    this.core = new THREE.Mesh(BEAM_GEO, this.coreMat);
    this.beam.position.y = -0.34;
    this.core.position.y = -0.34;
    this.beam.frustumCulled = false;
    this.core.frustumCulled = false;
    head.add(this.beam, this.core);

    // --- lens glow ---
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW_TEX,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.glow.position.y = -0.36;
    head.add(this.glow);

    // --- floor pool (world space, so it is not parented to the head) ---
    this.pool = new THREE.Mesh(POOL_GEO, new THREE.MeshBasicMaterial({
      map: GLOW_TEX,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.pool.visible = false;
    this.pool.renderOrder = -1;
  }

  addTo(scene) {
    scene.add(this.root);
    scene.add(this.pool);
    return this;
  }

  /** Snapshot of the programmed state, for presets. */
  snapshot() {
    const b = this.base;
    return {
      id: this.id,
      dimmer: +b.dimmer.toFixed(4),
      pan: +b.pan.toFixed(2),
      tilt: +b.tilt.toFixed(2),
      zoom: +b.zoom.toFixed(2),
      strobe: +b.strobe.toFixed(2),
      color: `#${b.color.getHexString()}`,
    };
  }

  /** Aim at a snapshot, optionally crossfading over `fade` seconds. */
  applySnapshot(s, fade = 0) {
    const dst = fade > 0 ? this.target : this.base;
    if (s.dimmer !== undefined) dst.dimmer = s.dimmer;
    if (s.pan !== undefined) dst.pan = s.pan;
    if (s.tilt !== undefined) dst.tilt = s.tilt;
    if (s.zoom !== undefined) dst.zoom = s.zoom;
    if (s.strobe !== undefined) dst.strobe = s.strobe;
    if (s.color !== undefined) dst.color.set(s.color);
    this.fadeLeft = fade;
    if (fade <= 0) {
      // Keep target in step so a later fade starts from the right place.
      Object.assign(this.target, this.base);
      this.target.color.copy(this.base.color);
    }
  }

  /** Cancel an in-progress fade — called when the user grabs a control. */
  holdFade() {
    this.fadeLeft = 0;
    Object.assign(this.target, this.base);
    this.target.color.copy(this.base.color);
  }

  /**
   * @param {number} dt    seconds since the last frame
   * @param {number} time  running show clock, for strobe phase
   * @param {number} master grand master 0..1
   * @param {(x: number, z: number) => number} heightAt surface height lookup
   */
  update(dt, time, master, heightAt) {
    // --- preset crossfade ---
    if (this.fadeLeft > 0) {
      const k = Math.min(1, dt / this.fadeLeft);
      const b = this.base, t = this.target;
      b.dimmer += (t.dimmer - b.dimmer) * k;
      b.pan += (t.pan - b.pan) * k;
      b.tilt += (t.tilt - b.tilt) * k;
      b.zoom += (t.zoom - b.zoom) * k;
      b.strobe += (t.strobe - b.strobe) * k;
      b.color.lerp(t.color, k);
      this.fadeLeft -= dt;
    }

    // --- compose base + effect ---
    const pan = this.base.pan + this.fx.pan;
    const tilt = THREE.MathUtils.clamp(this.base.tilt + this.fx.tilt, -150, 150);
    const zoom = THREE.MathUtils.clamp(this.base.zoom + this.fx.zoom, 2, 60);
    let level = THREE.MathUtils.clamp(this.base.dimmer * this.fx.dimmer, 0, 1) * master;

    // --- strobe: hard square wave, each fixture offset a little ---
    if (this.base.strobe > 0.05 && level > 0) {
      const on = Math.sin(time * this.base.strobe * TAU + this.strobePhase) > 0;
      if (!on) level = 0;
    }

    this.out.dimmer = level;
    this.out.pan = pan;
    this.out.tilt = tilt;
    this.out.zoom = zoom;

    this.yoke.rotation.y = pan * DEG;
    this.head.rotation.x = tilt * DEG;

    // --- how far can the beam travel before it hits the deck? ---
    this.head.updateWorldMatrix(true, false);
    const origin = this.head.getWorldPosition(_v1);
    const dir = _v2.set(0, -1, 0).applyQuaternion(this.head.getWorldQuaternion(_q)).normalize();

    let length = this.maxThrow;
    let hit = null;
    let hitY = 0;

    if (dir.y < -0.02) {
      // First guess against the ground, then re-solve against whatever surface
      // is actually under that point (deck or riser) so beams stop on the set.
      const solve = (y) => (y - origin.y) / dir.y;
      let t = solve(0);
      if (t > 0) {
        const surface = heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
        if (surface > 0) {
          const t2 = solve(surface);
          if (t2 > 0.3) {
            t = t2;
            hitY = surface;
          }
        }
      }
      if (t > 0.3 && t < length) {
        length = t;
        hit = _v3.copy(dir).multiplyScalar(t).add(origin);
      }
    }

    const radius = Math.max(0.05, length * Math.tan(zoom * 0.5 * DEG));

    // Wider beams spread the same lumens over more air, so they look thinner.
    const density = 0.36 / Math.max(0.25, radius * 0.34);
    const intensity = level * density;

    this.beam.scale.set(radius, length, radius);
    this.core.scale.set(radius * 0.42, length, radius * 0.42);
    this.beamMat.uniforms.uIntensity.value = intensity * 0.85;
    this.coreMat.uniforms.uIntensity.value = intensity * 1.5;
    this.beamMat.uniforms.uColor.value.copy(this.base.color);
    this.coreMat.uniforms.uColor.value.copy(this.base.color).lerp(_white, 0.35);
    this.beam.visible = this.core.visible = level > 0.002;

    // --- lens glow ---
    const glowScale = 0.5 + zoom * 0.014;
    this.glow.scale.setScalar(glowScale * (0.7 + level * 0.6));
    this.glow.material.color.copy(this.base.color);
    this.glow.material.opacity = Math.min(1, level * 1.1);
    this.glow.visible = level > 0.002;

    // --- floor pool ---
    if (hit && level > 0.004) {
      this.pool.visible = true;
      this.pool.position.set(hit.x, hitY + 0.014, hit.z);
      // Grazing beams smear into a long ellipse; scale across the throw axis.
      const stretch = THREE.MathUtils.clamp(1 / Math.max(0.12, Math.abs(dir.y)), 1, 6);
      this.pool.scale.set(radius * 1.15, 1, radius * 1.15 * stretch);
      this.pool.rotation.y = Math.atan2(dir.x, dir.z);
      this.pool.material.color.copy(this.base.color);
      // The same output spread over more floor is dimmer per square metre.
      const spread = Math.max(1, radius * radius * stretch * 0.06);
      this.pool.material.opacity = Math.min(0.9, (level * 2.6 * Math.abs(dir.y) + level * 0.3) / spread);
    } else {
      this.pool.visible = false;
    }
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _white = new THREE.Color(0xffffff);

/* ------------------------------------------------------------------ *
 * The rig
 * ------------------------------------------------------------------ */

/**
 * Builds a small but complete festival rig: a back truss of narrow-beam
 * movers, a front truss of washes, floor uplights and two blinders.
 */
export function buildRig(scene) {
  const fixtures = [];
  let id = 0;

  // Back truss — 8 narrow movers, the workhorses for aerial looks.
  const backX = [-13, -9.3, -5.6, -1.9, 1.9, 5.6, 9.3, 13];
  backX.forEach((x, i) => {
    fixtures.push(new Fixture({
      id: ++id,
      name: `Mover ${i + 1}`,
      group: "back",
      position: [x, 10.4, -5.4],
      tilt: 28,
      zoom: 9,
      throw_: 40,
    }));
  });

  // Front truss — 6 washes aimed back at the performers.
  const frontX = [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5];
  frontX.forEach((x, i) => {
    fixtures.push(new Fixture({
      id: ++id,
      name: `Wash ${i + 1}`,
      group: "front",
      position: [x, 11.2, 6.6],
      tilt: -26,
      zoom: 26,
      throw_: 34,
    }));
  });

  // Floor uplights — dramatic vertical shafts behind the band.
  [-12.4, -7.2, 7.2, 12.4].forEach((x, i) => {
    fixtures.push(new Fixture({
      id: ++id,
      name: `Floor ${i + 1}`,
      group: "floor",
      position: [x, 0.5, -4.2],
      up: true,
      tilt: 0,
      zoom: 7,
      throw_: 30,
    }));
  });

  // Blinders — wide warm audience hits.
  [-4.2, 4.2].forEach((x, i) => {
    fixtures.push(new Fixture({
      id: ++id,
      name: `Blinder ${i + 1}`,
      group: "blinder",
      position: [x, 8.2, 3.4],
      tilt: -68,
      zoom: 46,
      throw_: 30,
    }));
  });

  fixtures.forEach((f) => f.addTo(scene));
  return fixtures;
}

/** Opening look so the stage is not black on first paint. */
export const OPENING_LOOK = {
  name: "Opening",
  fade: 0,
  master: 1,
  // size/spread are normalised 0..1, matching what the console stores.
  effect: { name: "sweep", rate: 0.18, size: 0.34, spread: 0.7 },
  fixtures: {
    back: { dimmer: 0.85, tilt: 34, zoom: 8, color: "#4aa8ff" },
    front: { dimmer: 0.42, tilt: -28, zoom: 28, color: "#ffb066" },
    floor: { dimmer: 0.7, tilt: 6, zoom: 6, color: "#ff4f7b" },
    blinder: { dimmer: 0, tilt: -68, zoom: 46, color: "#ffd9a0" },
  },
};
