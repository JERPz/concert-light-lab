/**
 * stage.js — the venue: deck, trusses, LED wall frame, haze and a crowd.
 *
 * Nothing here is interactive; it exists to give the beams something to land
 * on and to make the space read as a stage rather than empty air.
 */

import * as THREE from "three";

export const SCREEN = {
  // The LED wall is a DOM element in the CSS3D layer. It is authored at this
  // pixel size and scaled down into world units, so the two layers agree.
  px: { w: 1280, h: 720 },
  scale: 0.0115,
  position: [0, 7.2, -7.6],
};

SCREEN.width = SCREEN.px.w * SCREEN.scale;   // ≈ 14.7
SCREEN.height = SCREEN.px.h * SCREEN.scale;  // ≈  8.3

/* Footprints of the solid surfaces a beam can land on. Kept as plain numbers
   (rather than raycasting real geometry) because every fixture needs this
   every frame and the venue is a handful of boxes. */
const DECK = { x: 15, zMin: -9.5, zMax: 6.5, top: 0.5 };
const RISER = { x: 3.5, zMin: -7.5, zMax: -2.5, top: 1.055 };

/**
 * Height of the walkable surface under a point — ground, deck or drum riser.
 * Without this, pools from the back truss would be drawn at y=0 and hidden
 * underneath the raised deck.
 */
export function deckHeightAt(x, z) {
  if (Math.abs(x) <= RISER.x && z >= RISER.zMin && z <= RISER.zMax) return RISER.top;
  if (Math.abs(x) <= DECK.x && z >= DECK.zMin && z <= DECK.zMax) return DECK.top;
  return 0;
}

export function buildStage(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0b10, roughness: 0.9, metalness: 0.05 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.45, metalness: 0.8 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.45, metalness: 0.25 });

  // --- ground: a big dark plane the beams pool on ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), dark);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // --- stage deck ---
  const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 16), deckMat);
  deck.position.set(0, 0.25, -1.5);
  deck.receiveShadow = true;
  group.add(deck);

  // Riser for the drum kit.
  const riser = new THREE.Mesh(new THREE.BoxGeometry(7, 0.55, 5), deckMat);
  riser.position.set(0, 0.78, -5);
  group.add(riser);

  // --- LED wall frame around the video ---
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN.width + 0.5, SCREEN.height + 0.5, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x0b0c11, roughness: 0.8, metalness: 0.3 })
  );
  frame.position.set(SCREEN.position[0], SCREEN.position[1], SCREEN.position[2] - 0.22);
  group.add(frame);

  /* The blocker: same size and place as the CSS3D screen, but it only writes
     depth. That stops WebGL from painting over the iframe underneath while
     still hiding anything that is genuinely behind the wall.

     renderOrder matters a lot here. Three sorts opaque objects front-to-back,
     so without this the ground plane — which is nearer the camera — would draw
     its dark colour across the screen region before the depth hole existed,
     leaving the video invisible. Drawing the blocker first means every later
     fragment behind it fails the depth test. */
  const blocker = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN.width, SCREEN.height),
    new THREE.MeshBasicMaterial({ colorWrite: false })
  );
  blocker.position.set(...SCREEN.position);
  blocker.renderOrder = -1000;
  group.add(blocker);

  // --- trusses ---
  group.add(truss(metal, { x: 0, y: 11.1, z: -5.4, span: 30 }));
  group.add(truss(metal, { x: 0, y: 11.9, z: 6.6, span: 26 }));

  // Vertical hangs so the trusses do not float.
  for (const [x, z, y] of [[-14.6, -5.4, 11.1], [14.6, -5.4, 11.1], [-12.6, 6.6, 11.9], [12.6, 6.6, 11.9]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 24, 10), metal);
    post.position.set(x, 12, z);
    group.add(post);
  }

  // --- PA stacks ---
  for (const side of [-1, 1]) {
    const stack = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7, 2), dark);
    stack.position.set(side * 17.5, 3.5, -2);
    group.add(stack);
  }

  // --- the band: skeleton musicians on the deck and riser ---
  const band = buildBand();
  group.add(band.group);

  // --- a suggestion of a crowd: dark bodies in front of the stage ---
  const crowd = crowdField(700);
  group.add(crowd);

  // --- haze: drifting dust that makes the air feel thick ---
  const haze = hazeField(2600);
  group.add(haze);

  // --- practical lights so the deck is not pitch black ---
  scene.add(new THREE.AmbientLight(0x223046, 0.5));
  const key = new THREE.DirectionalLight(0x8fa8d0, 0.16);
  key.position.set(6, 18, 14);
  scene.add(key);

  return { group, haze, crowd, ground, band };
}

/** A boxy truss: two chords plus zig-zag webbing, cheap but readable. */
function truss(material, { x, y, z, span }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);

  for (const dy of [0.32, -0.32]) {
    for (const dz of [0.24, -0.24]) {
      const chord = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, span, 8), material);
      chord.rotation.z = Math.PI / 2;
      chord.position.set(0, dy, dz);
      g.add(chord);
    }
  }

  const steps = Math.floor(span / 1.1);
  for (let i = 0; i <= steps; i++) {
    const px = -span / 2 + (i / steps) * span;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.78, 6), material);
    strut.position.set(px, 0, 0.24);
    strut.rotation.x = i % 2 ? 0.7 : -0.7;
    g.add(strut);
  }
  return g;
}

/* ------------------------------------------------------------------ *
 * The band — skeleton musicians.
 *
 * Each figure is a little armature of "bones": a pale, faintly emissive
 * material so the skeletons catch beams and glow under the wash. They are
 * assembled from primitives (skull, ribcage, spine, limb segments) grouped
 * into shoulder/elbow/hip pivots so the update() below can make them play.
 * ------------------------------------------------------------------ */

const BONE = new THREE.MeshStandardMaterial({
  color: 0xe9e6dc,
  roughness: 0.6,
  metalness: 0.05,
  emissive: 0x1a1a20,
  emissiveIntensity: 0.4,
});

/** A capsule "bone" pointing along +Y, its base at the group origin. */
function bone(len, r = 0.05) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), BONE);
  m.position.y = len / 2;
  m.castShadow = true;
  const pivot = new THREE.Group();
  pivot.add(m);
  return pivot;
}

/**
 * One skeleton, standing at the group origin. Returns the pivots the animator
 * needs (neck + both arms) alongside the assembled group.
 */
function skeleton() {
  const g = new THREE.Group();

  // Spine + pelvis + ribcage.
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.2), BONE);
  pelvis.position.y = 1.02;
  pelvis.castShadow = true;
  g.add(pelvis);

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.62, 8), BONE);
  spine.position.y = 1.4;
  spine.castShadow = true;
  g.add(spine);

  const ribs = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.28, 4, 10), BONE);
  ribs.scale.set(1.15, 1, 0.7);
  ribs.position.y = 1.5;
  ribs.castShadow = true;
  g.add(ribs);

  // Head on a neck pivot so it can bob.
  const neck = new THREE.Group();
  neck.position.y = 1.72;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), BONE);
  skull.position.y = 0.16;
  skull.scale.set(1, 1.1, 1.05);
  skull.castShadow = true;
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.14), BONE);
  jaw.position.set(0, 0.05, 0.02);
  neck.add(skull, jaw);
  g.add(neck);

  // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm.
  function arm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.22, 1.62, 0);
    const upper = bone(0.34, 0.045);
    upper.rotation.z = side * 0.15;
    const elbow = new THREE.Group();
    elbow.position.y = 0.34;
    const fore = bone(0.32, 0.04);
    elbow.add(fore);
    upper.add(elbow);
    shoulder.add(upper);
    g.add(shoulder);
    shoulder.rotation.x = Math.PI; // hang arms down by default
    return { shoulder, elbow };
  }
  const armL = arm(-1);
  const armR = arm(1);

  // Legs: hip pivot -> thigh -> knee -> shin, planted so the figure stands.
  function leg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.12, 1.0, 0);
    const thigh = bone(0.44, 0.055);
    const knee = new THREE.Group();
    knee.position.y = 0.44;
    const shin = bone(0.42, 0.05);
    knee.add(shin);
    thigh.add(knee);
    hip.add(thigh);
    hip.rotation.x = Math.PI; // point legs down
    g.add(hip);
    return { hip, knee };
  }
  const legL = leg(-1);
  const legR = leg(1);

  return { group: g, neck, armL, armR, legL, legR };
}

/**
 * Place the skeletons and give them instruments + parts to play. Returns
 * { group, update(t, bands) } so the render loop animates them to the music.
 */
function buildBand() {
  const group = new THREE.Group();
  const players = [];

  const DECK_TOP = 0.5;
  const RISER_TOP = 1.055;

  const guitarMat = new THREE.MeshStandardMaterial({ color: 0x7a1f2b, roughness: 0.5, metalness: 0.3 });
  const bassMat = new THREE.MeshStandardMaterial({ color: 0x1f3a7a, roughness: 0.5, metalness: 0.3 });
  const micMat = new THREE.MeshStandardMaterial({ color: 0x222227, roughness: 0.4, metalness: 0.6 });
  const drumMat = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.5, metalness: 0.4 });

  // A guitar/bass slung across the body of a standing player.
  function makeGuitar(mat) {
    const inst = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.09, 16), mat);
    body.rotation.x = Math.PI / 2;
    const gneck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.04), mat);
    gneck.position.set(0.5, 0.28, 0);
    gneck.rotation.z = -0.55;
    inst.add(body, gneck);
    inst.position.set(0, 1.25, 0.24);
    inst.rotation.y = 0.2;
    return inst;
  }

  // --- Singer, front and centre, at a mic stand ---
  {
    const s = skeleton();
    s.group.position.set(0, DECK_TOP, 1.5);
    s.group.rotation.y = Math.PI; // face the crowd (+Z)
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 8), micMat);
    stand.position.set(0, DECK_TOP + 0.75, 1.85);
    const mic = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), micMat);
    mic.position.set(0, DECK_TOP + 1.5, 1.85);
    // Raise one hand toward the mic.
    s.armR.shoulder.rotation.x = Math.PI - 1.9;
    s.armR.elbow.rotation.x = -0.6;
    group.add(s.group, stand, mic);
    players.push({ ...s, role: "singer", phase: 0.0 });
  }

  // --- Guitarist, stage right ---
  {
    const s = skeleton();
    s.group.position.set(-4.5, DECK_TOP, -0.5);
    s.group.rotation.y = Math.PI - 0.35;
    s.group.add(makeGuitar(guitarMat));
    s.armL.shoulder.rotation.x = Math.PI - 1.1; s.armL.elbow.rotation.x = -1.0;
    s.armR.shoulder.rotation.x = Math.PI - 0.9; s.armR.elbow.rotation.x = -0.8;
    group.add(s.group);
    players.push({ ...s, role: "guitar", phase: 1.3, strum: s.armR });
  }

  // --- Bassist, stage left ---
  {
    const s = skeleton();
    s.group.position.set(4.5, DECK_TOP, -0.5);
    s.group.rotation.y = Math.PI + 0.35;
    s.group.add(makeGuitar(bassMat));
    s.armL.shoulder.rotation.x = Math.PI - 1.0; s.armL.elbow.rotation.x = -0.9;
    s.armR.shoulder.rotation.x = Math.PI - 0.85; s.armR.elbow.rotation.x = -0.7;
    group.add(s.group);
    players.push({ ...s, role: "bass", phase: 2.1, strum: s.armR });
  }

  // --- Drummer, seated on the riser ---
  {
    const s = skeleton();
    s.group.position.set(0, RISER_TOP - 0.35, -5);
    s.group.rotation.y = Math.PI;
    // Sit: fold the thighs forward at the hips.
    s.legL.hip.rotation.x = Math.PI * 0.55;
    s.legR.hip.rotation.x = Math.PI * 0.55;
    s.legL.knee.rotation.x = -0.9;
    s.legR.knee.rotation.x = -0.9;
    // Arms out front holding sticks.
    s.armL.shoulder.rotation.x = Math.PI - 1.0; s.armL.elbow.rotation.x = -0.9;
    s.armR.shoulder.rotation.x = Math.PI - 1.0; s.armR.elbow.rotation.x = -0.9;

    // Sticks in each hand (attached to the forearm/elbow pivots).
    for (const armPivot of [s.armL.elbow, s.armR.elbow]) {
      const holder = new THREE.Group();
      holder.position.y = 0.32;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), BONE);
      stick.position.y = 0.25;
      holder.add(stick);
      armPivot.add(holder);
    }

    // A tiny kit in front of the drummer.
    const kit = new THREE.Group();
    kit.position.set(0, RISER_TOP, -4.1);
    for (const [dx, dy, r] of [[-0.6, 0.9, 0.28], [0.6, 0.9, 0.28], [0, 0.75, 0.34]]) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.28, 16), drumMat);
      drum.position.set(dx, dy, 0);
      kit.add(drum);
    }
    const kick = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 18), drumMat);
    kick.rotation.x = Math.PI / 2;
    kick.position.set(0, 0.45, 0.25);
    kit.add(kick);

    group.add(s.group, kit);
    players.push({ ...s, role: "drummer", phase: 0, drum: true });
  }

  function update(t, bands) {
    const b = bands || { bass: 0, mid: 0, high: 0 };
    for (const p of players) {
      // Everyone bobs their head and sways a little to the low end.
      const beat = Math.sin(t * 6 + p.phase);
      p.neck.rotation.x = 0.12 * beat + (b.bass || 0) * 0.25;
      p.group.rotation.z = 0.03 * Math.sin(t * 2 + p.phase);

      if (p.role === "singer") {
        // Bob the free hand and work the jaw a touch.
        p.armL.shoulder.rotation.x = Math.PI - 0.4 + 0.25 * Math.sin(t * 3);
        p.neck.children[1].position.y = 0.05 - 0.02 * Math.max(0, beat);
      }
      if (p.strum) {
        // Strumming / picking motion on the playing forearm.
        p.strum.elbow.rotation.x = -0.85 + 0.35 * Math.sin(t * 9 + p.phase);
      }
      if (p.drum) {
        // Alternate stick hits, snappier on the high end.
        const speed = 10 + (b.high || 0) * 14;
        p.armL.elbow.rotation.x = -0.9 - 0.5 * Math.max(0, Math.sin(t * speed));
        p.armR.elbow.rotation.x = -0.9 - 0.5 * Math.max(0, Math.sin(t * speed + Math.PI));
      }
    }
  }

  return { group, update };
}

/** Silhouetted heads and shoulders, instanced so 700 of them are free. */
function crowdField(count) {
  const geo = new THREE.CapsuleGeometry(0.19, 0.5, 4, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 1, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();

  let i = 0;
  while (i < count) {
    const x = (Math.random() - 0.5) * 44;
    const z = 9 + Math.random() * 30;
    // Thin the crowd out toward the back and edges.
    if (Math.random() > 1.05 - z / 45) continue;
    const s = 0.85 + Math.random() * 0.35;
    m.makeScale(s, s, s);
    m.setPosition(x, 0.62 * s, z);
    mesh.setMatrixAt(i++, m);
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * Haze particles. They are lit by nothing — the point is that beams read as
 * volumes, and a slow drift of specks sells the illusion of thick air.
 */
function hazeField(count) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3 + 0] = (Math.random() - 0.5) * 40;
    pos[i * 3 + 1] = Math.random() * 14;
    pos[i * 3 + 2] = -8 + Math.random() * 22;
    seed[i] = Math.random() * 10;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.5 },
      uDpr: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uDpr;
      attribute float aSeed;
      varying float vFade;

      void main() {
        vec3 p = position;
        // Lazy convection: rises, drifts, wraps around.
        p.y = mod(p.y + uTime * 0.22 + aSeed, 14.0);
        p.x += sin(uTime * 0.15 + aSeed * 2.0) * 1.4;
        p.z += cos(uTime * 0.11 + aSeed * 3.0) * 1.0;

        vec4 viewPos = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewPos;
        gl_PointSize = clamp(uDpr * 90.0 / max(-viewPos.z, 0.1), 0.6, 4.0);
        // Fade near the floor and ceiling so there is no hard edge.
        vFade = smoothstep(0.0, 2.0, p.y) * (1.0 - smoothstep(10.0, 14.0, p.y));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * vFade * uOpacity;
        gl_FragColor = vec4(vec3(0.55, 0.6, 0.72), a * 0.16);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}
