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

  return { group, haze, crowd, ground };
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
