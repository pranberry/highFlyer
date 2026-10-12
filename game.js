/* High Flyer — fighter jet WSO game */
(() => {
'use strict';

// ---------------------------------------------------------------- utils
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const WUP = new V3(0, 1, 0), ZERO = new V3();

// ---------------------------------------------------------------- terrain field
const SX = Math.random() * 500, SZ = Math.random() * 500;
function hash(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
}
function fbm(x, z) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}
// The flight path snakes along, but runs dead straight near the carriers.
const rawPathX = (z) => 380 * Math.sin(z * 0.00033) + 140 * Math.sin(z * 0.00097 + 1.3);
function straightAmp(d) {
  let a = clamp((d - 1500) / 2500, 0, 1);
  if (S.straightFrom < Infinity) a *= 1 - clamp((d - S.straightFrom) / 2000, 0, 1);
  return a;
}
const pathX = (z) => rawPathX(z) * straightAmp(-z);
const pathY = (z) => 330 + 40 * Math.sin(z * 0.0008) * straightAmp(-z);
// Land only exists between landStart and landEnd (set as the mission unfolds); elsewhere it's open ocean.
function landMask(d) {
  return Math.min(clamp((d - S.landStart) / 1500, 0, 1), 1 - clamp((d - S.landEnd) / 1500, 0, 1));
}
function groundH(x, z) {
  const d = -z;
  const v = clamp((Math.abs(x - pathX(z)) - 160) / 900, 0, 1);
  // ocean floor with the odd island, kept clear of the carriers
  const calm = Math.min(clamp((d - 3000) / 2000, 0, 1), clamp(Math.abs(d - S.recoverD) / 3000 - 0.3, 0, 1));
  const isl = (fbm(x * 0.0007 + SZ + 40, z * 0.0007 + SX) - 0.64) * 700 * (0.35 + 0.65 * v);
  const sea = Math.max(-40, isl - (1 - calm) * 1000);
  const lm = landMask(d);
  if (lm <= 0) return sea;
  const n = fbm(x * 0.0011 + SX, z * 0.0011 + SZ);
  const land = (n - 0.36) * 430 * (0.3 + 0.7 * v) + v * v * 70;
  return lerp(sea, land, lm);
}
const groundY = (x, z) => Math.max(0, groundH(x, z));

// ---------------------------------------------------------------- renderer / scene
const glCanvas = document.getElementById('gl');
const muteBtn = document.getElementById('muteBtn');
const hud = document.getElementById('hud');
const ctx = hud.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = 0xc4d5e3;
scene.fog = new THREE.Fog(FOG, 1300, 4300);
const camera = new THREE.PerspectiveCamera(68, 1, 2, 8000);

let W = 0, H = 0, DPR = 1, CON_H = 150;
let composer = null, bloom = null, cockpitPass = null, cockpitCam = null;
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  hud.width = W * DPR; hud.height = H * DPR;
  camera.aspect = W / H; camera.updateProjectionMatrix();
  CON_H = clamp(H * 0.19, 118, 190);
  if (cockpitCam) { cockpitCam.aspect = W / H; cockpitCam.updateProjectionMatrix(); }
  if (composer) { composer.setPixelRatio(DPR); composer.setSize(W, H); bloom.resolution.set(W / 2, H / 2); }
}
addEventListener('resize', resize);
resize();

const SUN_DIR = new V3(-0.72, 0.36, -0.5).normalize();
const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a5238, 0.72);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffe2b8, 1.05);
sunLight.position.copy(SUN_DIR);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -1500, right: 1500, top: 1500, bottom: -1500, near: 10, far: 6500 });
sunLight.shadow.bias = -0.0006;
sunLight.shadow.normalBias = 1.5;
scene.add(sunLight);
scene.add(sunLight.target);

function makeSoftTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const TEX = makeSoftTex();

// sky dome: gradient, horizon haze, sun disc + glow
const sky = (() => {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: SUN_DIR }, top: { value: new THREE.Color(0x3270c0) },
      hor: { value: new THREE.Color(FOG) }, sunCol: { value: new THREE.Color(0xffd7a0) },
    },
    vertexShader: `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 sunDir; uniform vec3 top; uniform vec3 hor; uniform vec3 sunCol; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c = mix(hor, top, pow(clamp(y, 0.0, 1.0), 0.5));
  c = mix(c, hor * 0.9, clamp(-y * 3.0, 0.0, 1.0));
  float s = max(dot(d, sunDir), 0.0);
  c += sunCol * (pow(s, 8.0) * 0.16 + pow(s, 80.0) * 0.4);
  c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9998, s) * 1.6;
  float haze = exp(-abs(y) * 10.0);
  c = mix(c, hor + sunCol * pow(s, 3.0) * 0.18, haze * 0.65);
  gl_FragColor = vec4(c, 1.0);
}`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(6500, 32, 16), mat);
  m.renderOrder = -1;
  scene.add(m);
  return m;
})();

// water: one big animated plane that follows the jet
const waterMat = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    time: { value: 0 }, sunDir: { value: SUN_DIR },
    deep: { value: new THREE.Color(0x1c5574) }, shallow: { value: new THREE.Color(0x3a8aa8) }, skyc: { value: new THREE.Color(FOG) },
  }]),
  vertexShader: `varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
  fragmentShader: `uniform float time; uniform vec3 sunDir; uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyc; varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  vec2 p = vW.xz * 0.011; float t = time;
  vec3 n = normalize(vec3(
    cos(p.x * 1.3 + t * 1.1) * 0.10 + cos((p.x + p.y) * 2.1 - t * 1.7) * 0.06 + cos(p.y * 3.7 + t * 2.3) * 0.035,
    1.0,
    sin(p.y * 1.1 + t * 0.9) * 0.10 + sin((p.x - p.y) * 2.6 + t * 1.3) * 0.06 + sin(p.x * 4.1 - t * 2.0) * 0.035));
  vec3 v = normalize(cameraPosition - vW);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 c = mix(deep, shallow, clamp(0.5 + n.x * 3.0, 0.0, 1.0));
  c = mix(c, skyc, fr * 0.75);
  c += vec3(1.0, 0.9, 0.7) * pow(max(dot(reflect(-v, n), sunDir), 0.0), 90.0) * 1.3;
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}`,
  fog: true,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2), waterMat);
water.position.y = 1.5;
scene.add(water);

// ---------------------------------------------------------------- terrain chunks
const CELL = 72, SEG_X = 72, CH_W = CELL * SEG_X, CH_LEN = 600, SEG_Z = 9;
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const C_GRASS = new THREE.Color(0x78a24c), C_FOREST = new THREE.Color(0x45703a), C_DRY = new THREE.Color(0xa89b5e);
const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8d97a4, transparent: true, opacity: 0.88 });

// props: instanced trees, rocks, villages — children of their terrain chunk
const dummy = new THREE.Object3D();
const treeGeo = new THREE.ConeGeometry(1, 1, 6); treeGeo.translate(0, 0.5, 0);
const treeMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0 });
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = new THREE.MeshPhongMaterial({ color: 0x8b8478, flatShading: true, shininess: 0 });
const houseGeo = new THREE.BoxGeometry(1, 1, 1); houseGeo.translate(0, 0.5, 0);
const roofGeo = new THREE.ConeGeometry(0.75, 0.55, 4); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 1.27, 0);
const houseMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0 });
function instanced(geo, mat, list, parent) {
  if (!list.length) return;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  im.castShadow = true; im.receiveShadow = true;
  list.forEach((it, i) => {
    dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.ry || 0, 0); dummy.scale.set(it.sx, it.sy, it.sz);
    dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    im.setColorAt(i, it.c || C_WHITE);
  });
  parent.add(im);
}
const C_WHITE = new THREE.Color(0xffffff);
function populateChunk(m, zc, cx) {
  const trees = [], rocks = [], houses = [], roofs = [], col = new THREE.Color();
  for (let i = 0; i < 170; i++) {
    const x = cx + rand(-2300, 2300), z = zc + rand(-300, 300), h = groundH(x, z);
    if (h < 12 || h > 215) continue;
    const slope = Math.abs(groundH(x + 20, z) - h) + Math.abs(groundH(x, z + 20) - h);
    if (slope > 22) {
      if (Math.random() < 0.5) { const sz = rand(6, 16); rocks.push({ x, y: h - sz * 0.3, z, sx: sz * rand(1, 1.6), sy: sz, sz: sz * rand(1, 1.5), ry: rand(0, TAU) }); }
      continue;
    }
    const forest = clamp((fbm(x * 0.0025 + 11, z * 0.0025 + 5) - 0.45) * 6, 0, 1);
    if (Math.random() > forest * 0.9 + 0.05) continue;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const tx = x + rand(-45, 45), tz = z + rand(-45, 45), th = groundH(tx, tz);
      if (th < 10) continue;
      const sc = rand(7, 11);
      col.setHSL(rand(0.24, 0.33), rand(0.35, 0.5), rand(0.16, 0.26));
      trees.push({ x: tx, y: th - 2, z: tz, sx: sc, sy: sc * rand(2.6, 3.8), sz: sc, ry: rand(0, TAU), c: col.clone() });
    }
  }
  if (Math.random() < 0.4) {
    const vz = zc + rand(-200, 200), vx = pathX(vz) + rand(-550, 550), vh = groundH(vx, vz);
    if (vh > 12 && vh < 100) for (let i = 0; i < 11; i++) {
      const x = vx + rand(-140, 140), z = vz + rand(-140, 140), h = groundH(x, z);
      if (h < 10) continue;
      const it = { x, y: h - 2, z, sx: rand(16, 26), sy: rand(9, 13), sz: rand(12, 18), ry: rand(0, TAU) };
      houses.push({ ...it, c: new THREE.Color().setHSL(rand(0.08, 0.12), rand(0.1, 0.25), rand(0.7, 0.82)) });
      roofs.push({ ...it, c: new THREE.Color().setHSL(rand(0.0, 0.04), rand(0.45, 0.6), rand(0.32, 0.42)) });
    }
  }
  instanced(treeGeo, treeMat, trees, m);
  instanced(rockGeo, rockMat, rocks, m);
  instanced(houseGeo, houseMat, houses, m);
  instanced(roofGeo, houseMat, roofs, m);
}
const clouds = [];
const chunks = new Map();

function makeChunk(k) {
  const z0 = -k * CH_LEN, zc = z0 - CH_LEN / 2;
  const cx = Math.round(pathX(zc) / CELL) * CELL;
  let g = new THREE.PlaneGeometry(CH_W, CH_LEN, SEG_X, SEG_Z);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + zc;
    pos.setXYZ(i, x, Math.max(-8, groundH(x, z)), z);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal;
  const col = new Float32Array(P.count * 3), c = new THREE.Color();
  for (let i = 0; i < P.count; i += 3) {
    const h = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3;
    const ny = N.getY(i);
    const mx = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3, mz = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
    const j = hash(Math.floor(mx * 7), Math.floor(mz * 7)) * 0.07 - 0.035;
    if (h < 1.5) c.setHex(0x2c6a8c);
    else if (h < 10) c.setHex(0xd2c08e);
    else if (h > 235) c.setHex(0xeef3f6);
    else if (ny < 0.72) c.setHex(0x8a7f70);
    else {
      c.copy(C_GRASS).lerp(C_FOREST, clamp(h / 220, 0, 1));
      c.lerp(C_DRY, clamp((fbm(mx * 0.003 + SZ, mz * 0.003 + SX) - 0.5) * 5, 0, 1) * 0.55);
    }
    // fake ambient occlusion: hollows darker, ridges lighter
    const around = (groundY(mx + 80, mz) + groundY(mx - 80, mz) + groundY(mx, mz + 80) + groundY(mx, mz - 80)) / 4;
    c.multiplyScalar(1 + clamp((h - around) / 40, -1, 0.6) * 0.22);
    c.offsetHSL(0, 0, j);
    for (let v = 0; v < 3; v++) { col[(i + v) * 3] = c.r; col[(i + v) * 3 + 1] = c.g; col[(i + v) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, terrainMat);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);

  populateChunk(m, zc, cx);

  // soft low-poly clouds at a few altitudes; some sit right on the flight path
  const n = Math.floor(rand(0, 2.8));
  m.userData.clouds = [];
  for (let i = 0; i < n; i++) {
    const grp = new THREE.Group();
    const parts = 5 + Math.floor(Math.random() * 4);
    const big = rand(0.8, 1.3);
    let r = 0;
    for (let p = 0; p < parts; p++) {
      const pm = new THREE.Mesh(cloudGeo, cloudMat);
      const pr = rand(28, 60) * big;
      pm.scale.set(pr * rand(1.1, 1.5), pr * 0.62, pr);
      pm.position.set(rand(-100, 100) * big, rand(0, 22), rand(-50, 50) * big);
      grp.add(pm);
      r = Math.max(r, pm.position.length() + pr);
    }
    const z = zc + rand(-300, 300);
    const onPath = Math.random() < 0.22;
    if (onPath) grp.position.set(pathX(z) + rand(-40, 40), pathY(z) + rand(-25, 10), z);
    else grp.position.set(pathX(z) + pick([-1, 1]) * rand(250, 1400), pick([rand(400, 470), rand(600, 760), rand(950, 1100)]), z);
    grp.userData.r = r * 0.8;
    scene.add(grp);
    clouds.push(grp);
    m.userData.clouds.push(grp);
  }
  return m;
}
function updateChunks(all) {
  const kMin = Math.floor((S.dist - 900) / CH_LEN), kMax = Math.floor((S.dist + 4400) / CH_LEN);
  for (const [k, m] of chunks) {
    if (k < kMin) {
      scene.remove(m); m.geometry.dispose(); chunks.delete(k);
      for (const c of m.userData.clouds) { scene.remove(c); clouds.splice(clouds.indexOf(c), 1); }
    }
  }
  for (let k = kMin; k <= kMax; k++) {
    if (!chunks.has(k)) { chunks.set(k, makeChunk(k)); if (!all) break; }
  }
}

// ---------------------------------------------------------------- models
const FLAME_GEO = new THREE.ConeGeometry(0.62, 4.5, 8); FLAME_GEO.rotateX(-Math.PI / 2); FLAME_GEO.translate(0, 0, -2.25);
function makeJet(body, accent, enemy = false) {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: body, flatShading: true, shininess: 30 });
  const mat2 = new THREE.MeshPhongMaterial({ color: accent, flatShading: true, side: THREE.DoubleSide });
  const ext = (sh, d) => new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 14, 8), mat);
  fus.rotation.x = Math.PI / 2; g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, enemy ? 6 : 5, 8), mat);
  nose.rotation.x = Math.PI / 2; nose.position.z = enemy ? 10 : 9.5; g.add(nose);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshPhongMaterial({ color: enemy ? 0x3a2a12 : 0x1d2a38, shininess: 100, specular: 0x888888, flatShading: true }));
  canopy.scale.set(0.8, 0.7, enemy ? 2.0 : 2.6); canopy.position.set(0, 1.0, enemy ? 4.6 : 3.6); g.add(canopy);
  const poly = (pts, s, d) => {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0] * s, pts[0][1]);
    for (const [x, y] of pts.slice(1)) sh.lineTo(x * s, y);
    const geo = ext(sh, d); geo.rotateX(Math.PI / 2); return geo;
  };
  for (const s of [1, -1]) {
    if (enemy) {
      g.add(new THREE.Mesh(poly([[0, 4], [8, -4.6], [8, -5.6], [0, -6]], s, 0.25), mat2));        // delta wing
      g.add(new THREE.Mesh(poly([[0, 7.5], [2.6, 5.4], [2.6, 4.8], [0, 5.2]], s, 0.15), mat2));   // canard
    } else {
      g.add(new THREE.Mesh(poly([[0, 3], [8.5, -3], [8.5, -4.5], [0, -5]], s, 0.25), mat2));
      g.add(new THREE.Mesh(poly([[0, -4.5], [4, -7.5], [4, -8.3], [0, -8.3]], s, 0.2), mat2));
      const fsh = new THREE.Shape();
      fsh.moveTo(-7, 0); fsh.lineTo(-3.5, 0); fsh.lineTo(-6.5, 4.2); fsh.lineTo(-8, 4.2); fsh.lineTo(-7, 0);
      const fin = new THREE.Mesh(ext(fsh, 0.2), mat2);
      fin.rotation.y = -Math.PI / 2; fin.rotation.x = s * 0.18;
      fin.position.set(1.4 * s, 0.6, 0); g.add(fin);
    }
  }
  if (enemy) {
    const fsh = new THREE.Shape();
    fsh.moveTo(-7.5, 0); fsh.lineTo(-2.5, 0); fsh.lineTo(-6.8, 5.5); fsh.lineTo(-8.4, 5.5); fsh.lineTo(-7.5, 0);
    const fin = new THREE.Mesh(ext(fsh, 0.25), mat2);
    fin.rotation.y = -Math.PI / 2; fin.position.set(0.12, 0.8, 0); g.add(fin);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 1.6), new THREE.MeshPhongMaterial({ color: 0xa02a20, flatShading: true }));
    tip.position.set(0, 6.0, -7.6); g.add(tip);
  }
  const flames = [];
  const engines = enemy ? [0] : [0.55, -0.55];
  for (const x of engines) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
    eng.rotation.x = Math.PI / 2; eng.position.set(x, 0, -7.1); g.add(eng);
    const fl = new THREE.Mesh(FLAME_GEO, new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.position.set(x, 0, -7.2); g.add(fl); flames.push(fl);
  }
  g.userData.flames = flames;
  g.traverse((o) => { if (o.isMesh && o.material.blending !== THREE.AdditiveBlending) o.castShadow = true; });
  return g;
}
function flickerFlames(g, burner) {
  for (const f of g.userData.flames) {
    const k = (burner ? 1.7 : 0.9) * rand(0.85, 1.15);
    f.scale.set(rand(0.9, 1.1), rand(0.9, 1.1), k);
    f.material.color.setHex(burner ? 0xffb060 : 0xff8a40);
  }
}
const cockpitScene = new THREE.Scene();
cockpitCam = new THREE.PerspectiveCamera(68, W / H, 0.05, 20);
cockpitScene.add(new THREE.HemisphereLight(0xc8d8ea, 0x1a1a1a, 0.55));
const cockpitSun = new THREE.DirectionalLight(0xffe2b8, 0.95);
cockpitScene.add(cockpitSun);
(() => {
  const frame = new THREE.MeshPhongMaterial({ color: 0x24282d, shininess: 40, specular: 0x333333 });
  const trim = new THREE.MeshPhongMaterial({ color: 0x8a9199, shininess: 80, specular: 0x777777 });
  const pts = [[-1.05, -0.7, -1.25], [-0.92, 0.12, -1.45], [-0.52, 0.52, -1.6], [0, 0.63, -1.65], [0.52, 0.52, -1.6], [0.92, 0.12, -1.45], [1.05, -0.7, -1.25]];
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new V3(...p)));
  cockpitScene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.04, 8), frame));
  const lip = new THREE.CatmullRomCurve3(pts.map((p) => new V3(p[0] * 0.965, p[1] - 0.045, p[2] + 0.04)));
  cockpitScene.add(new THREE.Mesh(new THREE.TubeGeometry(lip, 48, 0.011, 6), trim));
  for (const [x, y, z, r] of [[-0.42, 0.57, -1.6, 0.35], [0, 0.66, -1.63, 0], [0.42, 0.57, -1.6, -0.35]]) {
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.015), new THREE.MeshPhongMaterial({ color: 0x9fb4c8, shininess: 120, specular: 0xffffff }));
    mir.position.set(x, y - 0.06, z + 0.04); mir.rotation.z = r; cockpitScene.add(mir);
  }
  for (const sx of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 2.4), frame);
    sill.position.set(sx * 1.1, -0.74, -0.35); cockpitScene.add(sill);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 2.4), trim);
    rail.position.set(sx * 0.96, -0.63, -0.35); cockpitScene.add(rail);
  }
  // front seat: headrest + pilot's helmet
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), new THREE.MeshPhongMaterial({ color: 0x30353b, flatShading: true }));
  seat.position.set(0, -0.84, -1.3); cockpitScene.add(seat);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.22), new THREE.MeshPhongMaterial({ color: 0x4a3c30, flatShading: true }));
  pad.position.set(0, -0.6, -1.3); cockpitScene.add(pad);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshPhongMaterial({ color: 0x5a6048, shininess: 50, specular: 0x444444 }));
  helmet.scale.set(1, 1.05, 1.1); helmet.position.set(0, -0.47, -1.38); cockpitScene.add(helmet);
})();
const playerJet = makeJet(0x8a96a3, 0x76828f);
playerJet.scale.setScalar(3.4);
playerJet.visible = false;
scene.add(playerJet);
// landing gear + tail hook (only seen from outside)
const gearGroup = new THREE.Group();
playerJet.add(gearGroup);
const hook = (() => {
  const strutMat = new THREE.MeshPhongMaterial({ color: 0xbfc4c9 }), tyreMat = new THREE.MeshPhongMaterial({ color: 0x1c1c1c });
  for (const [x, z] of [[0, 6.2], [1.7, -1.2], [-1.7, -1.2]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.7, 6), strutMat); st.position.set(x, -2.0, z); gearGroup.add(st);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), tyreMat); wh.rotation.z = Math.PI / 2; wh.position.set(x, -2.6, z); gearGroup.add(wh);
  }
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 3).translate(0, 0, -1.5), strutMat);
  h.position.set(0, -0.9, -6.2); playerJet.add(h);
  return h;
})();

// ---------------------------------------------------------------- ships
const DECK_TOP = 20, JET_DECK_Y = 23;
// deck outline in carrier-local (x, z); bow points to -z
const DECK_OUTLINE = [[-18, 160], [22, 160], [24, -40], [18, -120], [6, -170], [-6, -170], [-20, -120], [-38, -40], [-36, 60], [-20, 120]];
function deckTexture() {
  const CW = 256, CH = 1088, c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  const X = (x) => (x / 80 + 0.5) * CW, Y = (zl) => (0.5 + zl / 340) * CH;
  g.fillStyle = '#3b3f44'; g.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * CW, Math.random() * CH, rand(4, 18), rand(4, 18)); }
  g.strokeStyle = '#d9c84a'; g.lineWidth = 2;
  for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(X(-12 + sx * 13), Y(160)); g.lineTo(X(-12 + sx * 13), Y(-40)); g.stroke(); }
  g.strokeStyle = '#e8e8e0'; g.lineWidth = 3; g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(X(-12), Y(160)); g.lineTo(X(-12), Y(-40)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#cfcfcf'; g.lineWidth = 2.5;
  for (const zl of [95, 85, 75, 65]) { g.beginPath(); g.moveTo(X(-27), Y(zl)); g.lineTo(X(3), Y(zl)); g.stroke(); }
  for (const cx of [8, -8]) {
    g.strokeStyle = '#25282b'; g.lineWidth = 4; g.beginPath(); g.moveTo(X(cx), Y(-60)); g.lineTo(X(cx), Y(-166)); g.stroke();
    g.strokeStyle = '#d9c84a'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(cx - 6), Y(-60)); g.lineTo(X(cx + 6), Y(-60)); g.stroke();
  }
  g.fillStyle = '#e8e8e0'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.fillText('73', X(0), Y(-128));
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.repeat.set(1 / 80, 1 / 340); t.offset.set(0.5, 0.5);
  return t;
}
let DECK_TEX = null;
const WAKE_MAT = new THREE.MeshBasicMaterial({ map: TEX, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const WAKE_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function shipPart(g, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
}
function hullFrom(outline, height, mat) {
  const sh = new THREE.Shape(outline.map(([x, zl]) => new THREE.Vector2(x, -zl)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: height + 2, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -2, 0);
  const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true;
  return { mesh: m, shape: sh };
}
function makeCarrier() {
  const g = new THREE.Group();
  const { mesh, shape } = hullFrom(DECK_OUTLINE, DECK_TOP, new THREE.MeshPhongMaterial({ color: 0x5d646c, flatShading: true }));
  g.add(mesh);
  DECK_TEX = DECK_TEX || deckTexture();
  const deckGeo = new THREE.ShapeGeometry(shape); deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshLambertMaterial({ map: DECK_TEX }));
  deck.position.y = DECK_TOP + 0.06; deck.receiveShadow = true; g.add(deck);
  const grey = new THREE.MeshPhongMaterial({ color: 0x6e757d, flatShading: true });
  shipPart(g, new THREE.BoxGeometry(9, 18, 40), grey, 22, DECK_TOP + 9, 30);
  shipPart(g, new THREE.BoxGeometry(8, 8, 22), grey, 22, DECK_TOP + 22, 26);
  shipPart(g, new THREE.BoxGeometry(9.3, 2.4, 18), new THREE.MeshPhongMaterial({ color: 0x1b2430, shininess: 90 }), 22, DECK_TOP + 24, 24);
  shipPart(g, new THREE.CylinderGeometry(0.6, 0.8, 16, 6), grey, 22, DECK_TOP + 34, 26);
  g.userData.radar = shipPart(g, new THREE.BoxGeometry(7, 2.2, 0.6), grey, 22, DECK_TOP + 40, 26);
  for (const [x, zl, ry] of [[14, 100, 2.4], [14, 122, 2.4], [14, 144, 2.4], [-16, -135, 0.6]]) {
    const j = makeJet(0x8a96a3, 0x76828f);
    j.userData.flames.forEach((f) => { f.visible = false; });
    j.position.set(x, DECK_TOP + 3, zl); j.rotation.y = ry; g.add(j);
  }
  const wake = new THREE.Mesh(WAKE_GEO, WAKE_MAT); wake.scale.set(70, 1, 900); wake.position.set(-4, 1.8, 600); g.add(wake);
  const bow = new THREE.Mesh(WAKE_GEO, WAKE_MAT); bow.scale.set(110, 1, 80); bow.position.set(0, 1.8, -165); g.add(bow);
  return g;
}
function makeEscort() {
  const g = new THREE.Group();
  const grey = new THREE.MeshPhongMaterial({ color: 0x737a82, flatShading: true });
  g.add(hullFrom([[-8, 70], [8, 70], [9, -40], [0, -82], [-9, -40]], 9, grey).mesh);
  shipPart(g, new THREE.BoxGeometry(12, 9, 34), grey, 0, 13.5, 6);
  shipPart(g, new THREE.BoxGeometry(8, 7, 12), grey, 0, 21, 0);
  shipPart(g, new THREE.CylinderGeometry(0.4, 0.6, 18, 5), grey, 0, 30, 2);
  shipPart(g, new THREE.BoxGeometry(5, 3, 6), grey, 0, 10.5, -45);
  shipPart(g, new THREE.CylinderGeometry(0.35, 0.35, 7, 5).rotateX(Math.PI / 2), grey, 0, 11, -50);
  const wake = new THREE.Mesh(WAKE_GEO, WAKE_MAT); wake.scale.set(40, 1, 500); wake.position.set(0, 1.8, 320); g.add(wake);
  return g;
}
// launch carrier: catapult 1 (local x=8, z=-60) sits at the world origin, on the flight path
const launchGroup = new THREE.Group();
const launchCarrier = makeCarrier();
launchCarrier.position.set(-8, 0, 60);
launchGroup.add(launchCarrier);
{ const e1 = makeEscort(); e1.position.set(-560, 0, 320); const e2 = makeEscort(); e2.position.set(660, 0, -760); launchGroup.add(e1, e2); }
scene.add(launchGroup);
launchGroup.updateMatrixWorld(true);
let recovery = null;
function placeRecovery(L) {
  S.recoverD = L;
  if (!recovery) {
    recovery = new THREE.Group();
    const c = makeCarrier(); recovery.add(c); recovery.userData.carrier = c;
    const e1 = makeEscort(); e1.position.set(-600, 0, -300); const e2 = makeEscort(); e2.position.set(560, 0, 520);
    recovery.add(e1, e2);
    scene.add(recovery);
  }
  // wire 3 (local x=-12, z=75) sits on the flight path at distance L
  recovery.position.set(12, 0, -L - 75);
  recovery.updateMatrixWorld(true);
  S.lsoCam = recovery.userData.carrier.localToWorld(new V3(-36, DECK_TOP + 5, 58));
}
const _st = new V3();
function catSteam(n, big) {
  for (let i = 0; i < n; i++) {
    launchCarrier.localToWorld(_st.set(8 + rand(-1, 1), DECK_TOP + 0.5, rand(-160, -60)));
    smoke.spawn(_st, { vel: new V3(rand(-3, 3), rand(4, 10) * big, rand(4, 14)), life: rand(1.2, 2.2), s0: 3 * big, s1: rand(10, 18) * big, color: 0xf4f6f8, a: 0.55 });
  }
}

const MSL_GEO = new THREE.CylinderGeometry(0.45, 0.45, 5, 6);
const MSL_MAT = new THREE.MeshPhongMaterial({ color: 0xeeeeee, flatShading: true });
const BOMB_GEO = new THREE.CylinderGeometry(1.1, 0.8, 7, 7);
const BOMB_MAT = new THREE.MeshPhongMaterial({ color: 0x4a4f45, flatShading: true });
function makeMissileMesh(glow) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(MSL_GEO, MSL_MAT);
  body.rotation.x = Math.PI / 2; g.add(body);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(9); s.position.z = -3.4; g.add(s);
  g.scale.setScalar(2.2);
  scene.add(g);
  return g;
}
function disposeMesh(g) {
  scene.remove(g);
  g.traverse((o) => { if (o.isSprite) o.material.dispose(); });
}

const WRECK_MAT = new THREE.MeshLambertMaterial({ color: 0x24221f });
function makeTarget(type) {
  const g = new THREE.Group();
  const olive = new THREE.MeshLambertMaterial({ color: 0x5f6545 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3d4130 });
  const conc = new THREE.MeshLambertMaterial({ color: 0x9a968a });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  if (type === 'SAM') {
    add(new THREE.BoxGeometry(46, 4, 46), conc, 0, 2, 0);
    add(new THREE.BoxGeometry(14, 7, 24), olive, 0, 7.5, 0);
    const rack = new THREE.Group(); rack.position.set(0, 13, 0); rack.rotation.x = -0.6; g.add(rack);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 22, 6), dark);
      t.rotation.x = Math.PI / 2; t.position.set(-4.5 + i * 3, 0, 4); rack.add(t);
    }
    add(new THREE.BoxGeometry(9, 6, 14), olive, 18, 3, -14);
  } else if (type === 'RADAR') {
    add(new THREE.BoxGeometry(26, 14, 22), olive, 0, 7, 0);
    add(new THREE.CylinderGeometry(1.2, 1.2, 14, 6), dark, 0, 20, 0);
    const dish = add(new THREE.CylinderGeometry(11, 3, 3, 10), conc, 0, 28, 0);
    dish.rotation.x = 1.1;
  } else if (type === 'FUEL') {
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(9, 9, 12, 10), new THREE.MeshLambertMaterial({ color: 0xbfbcae }), -22 + i * 22, 6, 0);
    add(new THREE.BoxGeometry(70, 1.5, 4), dark, 0, 1, 14);
  } else if (type === 'TRUCK') {
    for (let i = 0; i < 3; i++) {
      add(new THREE.BoxGeometry(7, 6, 7), olive, i * 22 - 22, 3, -9);
      add(new THREE.BoxGeometry(7, 7.5, 13), dark, i * 22 - 22, 3.75, 2);
    }
  } else if (type === 'HANGAR') {
    const hg = add(new THREE.CylinderGeometry(20, 20, 50, 12, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x8f8d84 }), 0, 0, 0);
    hg.rotation.z = Math.PI / 2; hg.rotation.y = Math.PI / 2;
    add(new THREE.BoxGeometry(60, 1, 40), conc, 0, 0.5, 0);
  } else {
    add(new THREE.BoxGeometry(52, 13, 36), conc, 0, 6.5, 0);
    add(new THREE.BoxGeometry(20, 8, 14), conc, 10, 17, 4);
    add(new THREE.CylinderGeometry(0.6, 0.6, 26, 4), dark, -16, 26, -8);
  }
  g.scale.setScalar(1.25);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------------------------------------------------------------- particles
class Pool {
  constructor(n, additive) {
    this.items = []; this.i = 0;
    for (let k = 0; k < n; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      s.visible = false; scene.add(s);
      this.items.push({ s, life: 0, max: 1, vel: new V3(), s0: 1, s1: 1, a0: 1, grav: 0, drag: 1 });
    }
  }
  spawn(pos, o) {
    const p = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
    p.s.visible = true; p.s.position.copy(pos);
    if (o.vel) p.vel.copy(o.vel); else p.vel.set(0, 0, 0);
    p.life = p.max = o.life; p.s0 = o.s0; p.s1 = o.s1; p.a0 = o.a ?? 1;
    p.grav = o.grav || 0; p.drag = o.drag ?? 1;
    p.s.material.color.setHex(o.color ?? 0xffffff);
    p.s.material.opacity = p.a0; p.s.scale.setScalar(p.s0);
    return p;
  }
  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.vel.y -= p.grav * dt;
      if (p.drag !== 1) p.vel.multiplyScalar(Math.pow(p.drag, dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(lerp(p.s0, p.s1, t));
      p.s.material.opacity = p.a0 * (1 - t);
    }
  }
}
const smoke = new Pool(1100, false);
const fire = new Pool(480, true);
const dust = new Pool(90, false);
const RING_TEX = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const rings = new Pool(30, true);
for (const it of rings.items) it.s.material.map = RING_TEX;

const DEBRIS_GEO = new THREE.BoxGeometry(1, 1, 1), DEBRIS_MAT = new THREE.MeshLambertMaterial({ color: 0x2b2a28 });
const debris = [];
for (let i = 0; i < 70; i++) { const d = new THREE.Mesh(DEBRIS_GEO, DEBRIS_MAT); d.visible = false; scene.add(d); debris.push({ m: d, vel: new V3(), spin: new V3(), life: 0, acc: 0 }); }
let debrisI = 0;
function spawnDebris(pos, big) {
  const d = debris[debrisI]; debrisI = (debrisI + 1) % debris.length;
  d.m.visible = true; d.m.position.copy(pos);
  d.m.scale.set(rand(1.5, 4) * big, rand(0.6, 2) * big, rand(1.5, 5) * big);
  d.vel.copy(rvec(180 * big)).add(new V3(0, 90, 0));
  d.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
  d.life = rand(1.4, 2.6); d.acc = 0;
}
function updateDebris(dt) {
  for (const d of debris) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.m.visible = false; continue; }
    d.vel.y -= 140 * dt;
    d.m.position.addScaledVector(d.vel, dt);
    d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt;
    d.acc += dt;
    if (d.acc > 0.045) {
      d.acc = 0;
      smoke.spawn(d.m.position, { life: 1.2, s0: 4, s1: 16, color: 0x333333, a: 0.55 });
      if (d.life > 1) fire.spawn(d.m.position, { life: 0.18, s0: 6, s1: 2, color: 0xff9a40 });
    }
  }
}
const _rv = new V3();
const rvec = (m) => _rv.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(m);

function explosion(pos, big) {
  fire.spawn(pos, { life: 0.25, s0: 60 * big, s1: 150 * big, color: 0xffffff, a: 0.95 });
  rings.spawn(pos, { life: 0.5, s0: 10 * big, s1: 240 * big, color: 0xffe2b0, a: 0.75 });
  for (let i = 0; i < 4; i++) fire.spawn(pos, { vel: rvec(15 * big), life: rand(1.2, 1.9), s0: 25 * big, s1: 60 * big, color: 0xff7a2a, a: 0.65, drag: 0.3 });
  for (let i = 0; i < Math.round(4 * big); i++) spawnDebris(pos, Math.min(big, 1.6));
  for (let i = 0; i < 14; i++) fire.spawn(pos, { vel: rvec(70 * big), life: rand(0.5, 0.95), s0: 10 * big, s1: rand(40, 60) * big, color: pick([0xffa040, 0xffc060, 0xff7a30]), drag: 0.2 });
  for (let i = 0; i < 10; i++) smoke.spawn(pos, { vel: rvec(25 * big).add(new V3(0, 15, 0)), life: rand(2, 3.4), s0: 18 * big, s1: rand(70, 100) * big, color: pick([0x4a4a4a, 0x5c5c5c, 0x3a3a3a]), a: 0.75, drag: 0.5 });
  for (let i = 0; i < 12; i++) fire.spawn(pos, { vel: rvec(220 * big), life: rand(0.5, 1.1), s0: 4, s1: 1.5, color: 0xffe0a0, grav: 140 });
  const d = camera.position.distanceTo(pos);
  AU.boom(big > 1.4, clamp(1.4 - d / 3000, 0.25, 1));
}
const _c = new V3();
function trail(a, b, step, o, off = ZERO) {
  const n = Math.min(8, Math.ceil(a.distanceTo(b) / step));
  for (let i = 0; i < n; i++) smoke.spawn(_c.lerpVectors(a, b, i / n).add(off), o);
}
const _w = new V3();
const wobble = (t) => _w.copy(right).multiplyScalar(Math.sin(t * 22) * 2.6).addScaledVector(upv, Math.cos(t * 22) * 2.6);

// ---------------------------------------------------------------- bullets (tracers)
const MAXB = 200;
const tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.6, 38),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), MAXB);
tracers.frustumCulled = false; tracers.count = 0;
scene.add(tracers);
const tDummy = new THREE.Object3D();

// ---------------------------------------------------------------- audio
const AU = {
  ctx: null,
  muted: (() => { try { return localStorage.getItem('hf-muted') === '1'; } catch (e) { return false; } })(),
  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.6; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; d[i] = w; }
      this.noiseBuf = buf;
      // brown-ish noise for the engine
      const eb = this.ctx.createBuffer(1, len, this.ctx.sampleRate), ed = eb.getChannelData(0);
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; ed[i] = last * 3.5; }
      const src = this.ctx.createBufferSource(); src.buffer = eb; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ctx.createGain(); g.gain.value = 0.12; this.eng = g;
      src.connect(f).connect(g).connect(this.master); src.start();
    } catch (e) { this.ctx = null; }
  },
  beep(freq, dur, type = 'square', vol = 0.08, freq2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq, type = 'lowpass', freq2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  },
  boom(big, near = 1) { this.noise(big ? 1.6 : 1.0, (big ? 0.9 : 0.55) * near, 900, 'lowpass', 70); },
  gun() { this.noise(0.05, 0.13, 1800, 'bandpass'); },
  launch() { this.noise(1.0, 0.35, 500, 'lowpass', 3500); },
  flare() { this.noise(0.18, 0.25, 2500, 'highpass'); this.beep(300, 0.05, 'square', 0.04); },
  lock() { this.beep(1400, 0.07, 'square', 0.05); setTimeout(() => this.beep(1900, 0.12, 'square', 0.05), 85); },
  warn() { this.beep(980, 0.08, 'square', 0.06); },
  engine(v) { if (this.ctx) this.eng.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5); },
  cat() { this.noise(2.2, 0.8, 250, 'lowpass', 1800); this.boom(true, 0.8); },
  trap() { this.noise(0.9, 1, 180, 'lowpass', 60); this.beep(55, 0.5, 'sawtooth', 0.25, 30); },
  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : 0.6;
    try { localStorage.setItem('hf-muted', m ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    muteBtn.classList.toggle('muted', m);
    muteBtn.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  },
  toggleMute() { this.setMuted(!this.muted); },
};

// ---------------------------------------------------------------- game state
const LOCK_T = 0.7, TARGETS_REQUIRED = 16;
const S = {
  phase: 'brief', phaseT: 0, t: 0, dist: 0, speed: 0, cruise: 200, scriptSpeed: true, paused: false, ended: false,
  customY: 23, customVy: 0, yBlend: 1, landStart: Infinity, landEnd: Infinity, straightFrom: Infinity, recoverD: Infinity,
  gearDown: true, hookDown: false, burner: false, extMode: 'orbit', fovKick: 0, cut: 0, dusk: 0, duskTarget: 0,
  waves: [], waveIdx: -1, areas: [], areaIdx: -1, flakT: 0, waveoffs: 0, callouts: {}, startT: 0, lsoCam: null,
  hp: 100, missiles: 12, bombs: 32, flares: 60, gunHeat: 0, overheat: false, gunHeld: false, gunCd: 0,
  view: 'ext', rollKick: 0, totalRoll: 0, shake: 0, flash: 0, flareFlash: 0, static: 0,
  enemies: [], pMissiles: [], bullets: [], flareObjs: [], whiteout: 0, incoming: [], bombsAir: [], targets: [], fires: [],
  wave: 0, waveTimer: -1, maxInc: 1, phaseKills: 0, egressSpawned: false,
  kills: 0, targetsDestroyed: 0, missilesDefeated: 0, flaresUsed: 0, hits: 0, deadT: 0,
  flareCd: 0, bombCd: 0, warnT: 0, lastTargetDist: 0, desig: null,
  mouse: { x: innerWidth / 2, y: innerHeight * 0.4 }, msgs: [], queue: [], toast: null, hint: null,
};

function say(who, text) { S.msgs.push({ who, text, t: S.t }); if (S.msgs.length > 4) S.msgs.shift(); AU.beep(2200, 0.03, 'sine', 0.03); }
function sayIn(delay, who, text) { S.queue.push({ at: S.t + delay, who, text }); }
function toast(text, color = '#ffd27a', dur = 1.2) { S.toast = { text, color, until: S.t + dur }; }
function hint(text, dur = 6) { S.hint = { text, until: S.t + dur }; }

// ---------------------------------------------------------------- jet kinematics
const jetPos = new V3(), fwd = new V3(0, 0, -1), right = new V3(1, 0, 0), upv = new V3(0, 1, 0), fwdFlat = new V3();
let roll = 0;
function updateJet(dt) {
  if (!S.scriptSpeed) S.speed = lerp(S.speed, S.cruise, 1 - Math.pow(0.6, dt));
  S.dist += S.speed * dt;
  const z = -S.dist, z2 = z - 40;
  const py = pathY(z);
  jetPos.set(pathX(z), lerp(py, S.customY, S.yBlend), z);
  const dyds = lerp((pathY(z2) - py) / 40, S.customVy / Math.max(S.speed, 40), S.yBlend);
  fwd.set((pathX(z2) - jetPos.x) / 40, dyds, -1).normalize();
  right.crossVectors(fwd, WUP).normalize();
  upv.crossVectors(right, fwd).normalize();
  fwdFlat.set(fwd.x, 0, fwd.z).normalize();
  const d2 = (pathX(z - 60) - 2 * pathX(z) + pathX(z + 60)) / 3600;
  roll = lerp(roll, clamp(d2 * 2600, -1, 1), 1 - Math.pow(0.1, dt));
  S.rollKick *= Math.pow(0.3, dt);
  S.totalRoll = roll + S.rollKick + Math.sin(S.t * 1.7) * 0.012;
}
function toLocal(w) {
  const d = _c.subVectors(w, jetPos);
  return new V3(d.dot(right), d.dot(upv), d.dot(fwd));
}
function fromLocal(out, x, y, z) {
  return out.copy(jetPos).addScaledVector(right, x).addScaledVector(upv, y).addScaledVector(fwd, z);
}
function clockDir(L) {
  let h = Math.round(Math.atan2(L.x, L.z) / (TAU / 12));
  h = ((h % 12) + 12) % 12; if (h === 0) h = 12;
  const lim = Math.abs(L.z) * 0.15 + 20;
  return h + " o'clock" + (L.y > lim ? ' high' : L.y < -lim ? ' low' : '');
}

const _look = new V3(), _m4 = new THREE.Matrix4(), jetQuat = new THREE.Quaternion(), _q = new THREE.Quaternion();
const headQ = new THREE.Quaternion(), _eul = new THREE.Euler(), _hOff = new V3(), Z_AXIS = new V3(0, 0, 1);
let headYaw = 0, headPitch = -0.028;
function updateCamera() {
  const sh = S.shake;
  const jx = (Math.random() - 0.5) * sh * 3, jy = (Math.random() - 0.5) * sh * 3;
  if (S.view === 'cockpit') {
    camera.fov = 68 + S.fovKick; camera.updateProjectionMatrix();
    // jet attitude, then the WSO's head: glances toward the reticle, sways with the jet
    _m4.makeBasis(right, upv, _look.copy(fwd).negate());
    jetQuat.setFromRotationMatrix(_m4).multiply(_q.setFromAxisAngle(Z_AXIS, -S.totalRoll));
    const k = isCombat() ? 1 : 0;
    headYaw = lerp(headYaw, -(S.mouse.x / W - 0.5) * 0.09 * k, 0.06);
    headPitch = lerp(headPitch, (-(S.mouse.y / H - 0.42) * 0.06 * k) - 0.028, 0.06);
    headQ.setFromEuler(_eul.set(headPitch, headYaw, 0, 'YXZ'));
    _hOff.set(-S.rollKick * 0.08 + jx * 0.01, Math.sin(S.t * 2.1) * 0.006 + jy * 0.01, 0);
    camera.quaternion.copy(jetQuat).multiply(headQ);
    camera.position.copy(jetPos).addScaledVector(upv, 1.2).add(_look.copy(_hOff).applyQuaternion(jetQuat));
    cockpitCam.quaternion.copy(headQ);
    cockpitCam.position.copy(_hOff);
    cockpitSun.position.copy(SUN_DIR).applyQuaternion(_q.copy(jetQuat).invert());
  } else if (S.view === 'ext') {
    camera.fov = 52; camera.updateProjectionMatrix();
    camera.up.set(0, 1, 0);
    if (S.extMode === 'orbit') {
      const a = 2.2 + S.t * 0.09;
      camera.position.set(jetPos.x + Math.sin(a) * 34, jetPos.y + 7 + Math.sin(S.t * 0.3) * 2, jetPos.z + Math.cos(a) * 34);
      camera.lookAt(jetPos.x, jetPos.y + 1, jetPos.z - 4);
    } else if (S.extMode === 'chase') {
      camera.position.copy(jetPos).addScaledVector(fwd, -42).addScaledVector(upv, 9).addScaledVector(right, -10);
      camera.lookAt(_look.copy(jetPos).addScaledVector(fwd, 60));
    } else {
      camera.position.copy(S.lsoCam);
      camera.lookAt(jetPos);
    }
    camera.position.x += jx * 3; camera.position.y += jy * 3;
  } else {
    if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
    const cx = jetPos.x + fwdFlat.x * 300, cz = jetPos.z + fwdFlat.z * 300;
    camera.position.set(cx + jx * 4, jetPos.y + 1150, cz + jy * 4);
    camera.up.copy(fwdFlat);
    camera.lookAt(cx, 0, cz);
  }
  sky.position.copy(camera.position);
  water.position.set(Math.round(jetPos.x / 100) * 100, 1.5, Math.round(jetPos.z / 100) * 100);
  const scx = Math.round((jetPos.x + fwdFlat.x * 1000) / 8) * 8, scz = Math.round((jetPos.z + fwdFlat.z * 1000) / 8) * 8;
  sunLight.target.position.set(scx, 0, scz);
  sunLight.position.set(scx + SUN_DIR.x * 3000, SUN_DIR.y * 3000, scz + SUN_DIR.z * 3000);
  waterMat.uniforms.time.value = S.t;
  playerJet.visible = S.view !== 'cockpit' && S.phase !== 'dead';
  playerJet.scale.setScalar(S.view === 'tgp' ? 3.4 : 1);
  gearGroup.visible = S.gearDown;
  hook.rotation.x = S.hookDown ? -0.5 : 0;
  for (const c of clouds) c.visible = S.view !== 'tgp';
  if (playerJet.visible) {
    playerJet.position.copy(jetPos);
    playerJet.lookAt(_look.copy(jetPos).add(fwd));
    playerJet.rotateZ(S.totalRoll);
    flickerFlames(playerJet, S.burner);
  }
}

// Pod view renders as white-hot FLIR: no fog, hot things glow.
function setThermal(on) {
  scene.fog.near = on ? 6000 : 1300; scene.fog.far = on ? 9000 : 4300;
  const heat = (obj, hex) => obj.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(on ? hex : 0); });
  for (const t of S.targets) heat(t.mesh, t.alive ? 0x9a9a9a : 0);
  WRECK_MAT.emissive.setHex(on ? 0x6a6a6a : 0);
  heat(playerJet, 0x777777);
  terrainMat.color.setHex(on ? 0x8a8a8a : 0xffffff);
}
function setView(v) {
  if (S.view === v) return;
  const pod = v === 'tgp' || S.view === 'tgp';
  S.view = v;
  if (pod) { S.static = 0.28; AU.beep(v === 'tgp' ? 700 : 500, 0.06, 'square', 0.05); } else S.cut = 0.35;
  glCanvas.classList.toggle('tgp', v === 'tgp');
  setThermal(v === 'tgp');
}
// time of day: the mission drifts from afternoon into sunset for the trip home
const SKY0 = { top: new THREE.Color(0x3270c0), hor: new THREE.Color(FOG), sun: new THREE.Color(0xffd7a0), light: new THREE.Color(0xffe2b8), cloud: new THREE.Color(0x8d97a4) };
const SKY1 = { top: new THREE.Color(0x2b3b6a), hor: new THREE.Color(0xe9a77c), sun: new THREE.Color(0xff8a4a), light: new THREE.Color(0xff9d5c), cloud: new THREE.Color(0xb07a68) };
const SUN0 = SUN_DIR.clone(), SUN1 = new V3(-0.8, 0.1, -0.55).normalize();
function applyDusk(k) {
  const u = sky.material.uniforms;
  u.top.value.copy(SKY0.top).lerp(SKY1.top, k);
  u.hor.value.copy(SKY0.hor).lerp(SKY1.hor, k);
  u.sunCol.value.copy(SKY0.sun).lerp(SKY1.sun, k);
  scene.fog.color.copy(u.hor.value);
  waterMat.uniforms.skyc.value.copy(u.hor.value);
  sunLight.color.copy(SKY0.light).lerp(SKY1.light, k);
  sunLight.intensity = lerp(1.05, 0.85, k);
  hemi.intensity = lerp(0.72, 0.5, k);
  SUN_DIR.copy(SUN0).lerp(SUN1, k).normalize();
  cloudMat.emissive.copy(SKY0.cloud).lerp(SKY1.cloud, k);
}

// ---------------------------------------------------------------- enemies
const SHADOW_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ map: TEX, color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
function removeEnemy(e) { scene.remove(e.mesh); scene.remove(e.shadow); }
function spawnEnemy() {
  const mesh = makeJet(0x7a6f58, 0x5a5243, true);
  mesh.scale.setScalar(1.7);
  scene.add(mesh);
  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
  shadow.scale.set(26, 1, 38);
  scene.add(shadow);
  S.enemies.push({
    mesh, shadow, pos: new V3(), alive: true, hp: 7,
    ox: rand(-700, 700), oy: rand(0, 160), oz: rand(3000, 3500), tz: rand(650, 1300), tzT: rand(5, 9),
    ax: rand(220, 440), ay: rand(50, 110), wx: rand(0.28, 0.5), wy: rand(0.3, 0.6),
    phx: rand(0, TAU), phy: rand(0, TAU), cx: rand(-160, 160),
    lockT: 0, locked: false, fireT: rand(4, 7), jink: 0, roll: 0, sx: 0, sy: 0, onScreen: false, sd: 1e9,
  });
}
function killEnemy(e) {
  if (!e.alive) return;
  e.alive = false;
  explosion(e.pos, 1.6);
  for (let i = 0; i < 6; i++) fire.spawn(e.pos, { vel: rvec(90).add(fwd.clone().multiplyScalar(S.speed * 0.6)), life: rand(1.2, 2), s0: 8, s1: 3, color: 0xff9a40, grav: 90 });
  removeEnemy(e);
  S.kills++; S.phaseKills++;
  say('PILOT', pick(['Splash one!', 'Good kill, good kill!', 'Bandit down!', 'Scratch one. Nice shooting.', 'He\'s done, he\'s done!']));
}
const _ep = new V3();
function updateEnemies(dt) {
  for (const e of S.enemies) {
    if (!e.alive) continue;
    e.tzT -= dt;
    if (e.tzT <= 0) { e.tz = rand(600, 1400); e.tzT = rand(5, 9); }
    const entering = e.oz > e.tz + 120;
    e.oz = lerp(e.oz, e.tz, 1 - Math.pow(entering ? 0.6 : 0.75, dt));
    const jk = e.jink > 0 ? 2.2 : 1;
    e.jink -= dt;
    e.phx += dt * e.wx * jk; e.phy += dt * e.wy * jk;
    const tx = e.cx + e.ax * Math.sin(e.phx), ty = 50 + e.ay * Math.sin(e.phy);
    e.ox = lerp(e.ox, tx, 1 - Math.pow(0.08, dt));
    e.oy = lerp(e.oy, ty, 1 - Math.pow(0.08, dt));
    const dtx = e.ax * e.wx * jk * Math.cos(e.phx);
    e.roll = lerp(e.roll, clamp(dtx * 0.006, -1.2, 1.2), 1 - Math.pow(0.05, dt));
    fromLocal(e.pos, e.ox, e.oy, e.oz);
    e.mesh.position.copy(e.pos);
    e.mesh.lookAt(_ep.copy(e.pos).add(fwd));
    e.mesh.rotateZ(e.roll);
    flickerFlames(e.mesh, e.jink > 0 || e.oz > e.tz + 120);
    // ground shadow, projected along the sun direction
    const hgt = e.pos.y - groundY(e.pos.x, e.pos.z);
    const sy = Math.max(SUN_DIR.y, 0.3), sx = e.pos.x - SUN_DIR.x / sy * hgt, sz = e.pos.z - SUN_DIR.z / sy * hgt;
    e.shadow.position.set(sx, groundY(sx, sz) + 3, sz);
    e.shadow.rotation.y = Math.atan2(fwd.x, fwd.z);

    // missile lock — only from the cockpit and within range
    const sp = toScreen(e.pos);
    e.sx = sp.x; e.sy = sp.y; e.onScreen = sp.vis && sp.x > 0 && sp.x < W && sp.y > 0 && sp.y < H - CON_H;
    e.sd = Math.hypot(sp.x - S.mouse.x, sp.y - S.mouse.y);
    const canLock = S.view === 'cockpit' && e.onScreen && e.oz < 2400 && e.sd < 70 && !isOver();
    e.lockT = canLock ? Math.min(LOCK_T, e.lockT + dt) : Math.max(0, e.lockT - dt * 1.5);
    const was = e.locked; e.locked = e.lockT >= LOCK_T;
    if (e.locked && !was) AU.lock();

    e.fireT -= dt;
    if (e.fireT <= 0 && !entering) {
      if (activeIncoming() < S.maxInc) { launchIncoming(e.pos, 'air'); e.fireT = rand(7, 11); }
      else e.fireT = rand(1, 2.5);
    }
  }
  S.enemies = S.enemies.filter((e) => e.alive);
}

// ---------------------------------------------------------------- player missiles
function fireMissile() {
  if (S.missiles <= 0) { toast('NO MISSILES', '#ff7b6b'); AU.beep(200, 0.15, 'square', 0.06); return; }
  let best = null;
  for (const e of S.enemies) if (e.alive && e.locked && (!best || e.sd < best.sd)) best = e;
  if (!best) { toast('NO LOCK', '#ff7b6b'); AU.beep(220, 0.12, 'square', 0.06); return; }
  S.missiles--;
  const side = S.missiles % 2 ? 6 : -6;
  const pos = jetPos.clone().addScaledVector(upv, -4).addScaledVector(fwd, 4).addScaledVector(right, side);
  const pk = best.oz > 1600 ? 0.65 : 0.85;
  S.pMissiles.push({
    pos, prev: pos.clone(), vel: fwd.clone().multiplyScalar(S.speed + 120).addScaledVector(upv, -40),
    target: best, t: 0, willMiss: Math.random() > pk, passed: false,
    missOff: rvec(1).normalize().multiplyScalar(80).clone(), mesh: makeMissileMesh(0xffc070),
  });
  best.jink = 3;
  AU.launch();
  toast('FOX THREE', '#9dffb0', 0.9);
}
const _aim = new V3(), _des = new V3();
function updatePMissiles(dt) {
  for (const m of S.pMissiles) {
    m.t += dt; m.prev.copy(m.pos);
    const tg = m.target;
    if (m.t > 0.3 && tg.alive && !m.passed) {
      _aim.copy(tg.pos); if (m.willMiss) _aim.add(m.missOff);
      _des.subVectors(_aim, m.pos).normalize().multiplyScalar(S.speed + 1000);
      m.vel.lerp(_des, 1 - Math.pow(0.002, dt));
    } else if (m.t <= 0.3) {
      m.vel.addScaledVector(fwd, 900 * dt);
    }
    m.pos.addScaledVector(m.vel, dt);
    m.mesh.position.copy(m.pos);
    m.mesh.lookAt(_aim.copy(m.pos).add(m.vel));
    if (m.t > 0.08) trail(m.prev, m.pos, 9, { life: 1.6, s0: 3, s1: 16, color: 0xe8e8e8, a: 0.55, vel: rvec(4) }, wobble(m.t));
    m.mesh.children[1].scale.setScalar(rand(7, 12));
    if (tg.alive && !m.passed) {
      if (!m.willMiss && segDist(m.prev, m.pos, tg.pos) < 24) { killEnemy(tg); m.dead = true; }
      else if (m.willMiss && m.pos.distanceTo(tg.pos) < 130) {
        m.passed = true;
        for (let i = 0; i < 6; i++) fire.spawn(tg.pos, { vel: rvec(40).addScaledVector(upv, -30), life: 1.4, s0: 9, s1: 3, color: 0xfff1c0 });
        say('PILOT', pick(['He flared it! Re-engage!', 'Missed — he defeated it.', 'Trashed it. Hit him again!']));
      }
    }
    if (m.t > 4.5 && !m.dead) { explosion(m.pos, 0.5); m.dead = true; }
    if (m.dead) disposeMesh(m.mesh);
  }
  S.pMissiles = S.pMissiles.filter((m) => !m.dead);
}

// ---------------------------------------------------------------- gun
const raycaster = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function mouseRay() {
  _ndc.set((S.mouse.x / W) * 2 - 1, -(S.mouse.y / H) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  return raycaster.ray;
}
function updateGun(dt) {
  S.gunHeat = Math.max(0, S.gunHeat - dt * (S.gunHeld ? 0.1 : 0.42));
  if (S.overheat && S.gunHeat < 0.35) S.overheat = false;
  const firing = S.gunHeld && !S.overheat && S.view === 'cockpit' && isCombat();
  if (!firing) { S.gunCd = Math.max(0, S.gunCd - dt); return; }
  S.gunCd -= dt;
  const ray = mouseRay();
  while (S.gunCd <= 0) {
    S.gunCd += 1 / 16;
    const dir = ray.direction.clone().add(rvec(0.006)).normalize();
    const pos = camera.position.clone().addScaledVector(fwd, 6).addScaledVector(upv, -2.5).addScaledVector(right, rand(-0.5, 0.5));
    S.bullets.push({ pos, prev: pos.clone(), vel: fwd.clone().multiplyScalar(S.speed).addScaledVector(dir, 2700), dir, life: 1.4 });
    S.gunHeat += 0.03;
    AU.gun();
    if (S.gunHeat >= 1) { S.overheat = true; toast('GUN OVERHEAT', '#ff7b6b'); break; }
  }
}
function updateBullets(dt) {
  let n = 0;
  for (const b of S.bullets) {
    b.life -= dt; b.prev.copy(b.pos); b.pos.addScaledVector(b.vel, dt);
    for (const e of S.enemies) {
      if (e.alive && segDist(b.prev, b.pos, e.pos) < 22) {
        b.life = 0; e.hp--; e.jink = 2;
        fire.spawn(e.pos, { vel: rvec(60), life: 0.25, s0: 10, s1: 18, color: 0xffd080 });
        if (e.hp <= 0) killEnemy(e);
        break;
      }
    }
    if (b.life > 0) for (const m of S.incoming) {
      if (!m.decoyed && segDist(b.prev, b.pos, m.pos) < 16) {
        b.life = 0; m.shot = true;
        break;
      }
    }
    if (b.life > 0 && n < MAXB) {
      tDummy.position.copy(b.pos).addScaledVector(b.dir, -19);
      tDummy.lookAt(_c.copy(tDummy.position).add(b.dir));
      tDummy.updateMatrix(); tracers.setMatrixAt(n++, tDummy.matrix);
    }
  }
  S.bullets = S.bullets.filter((b) => b.life > 0);
  tracers.count = n; tracers.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- incoming missiles + flares
function activeIncoming() { return S.incoming.filter((m) => !m.decoyed).length; }
let firstLaunch = true;
function launchIncoming(worldPos, kind) {
  const L0 = toLocal(worldPos);
  S.incoming.push({
    kind, L0, T: kind === 'sam' ? 5.4 : 4.8, t: 0, side: rand(-140, 140), arc: kind === 'sam' ? rand(80, 180) : rand(-40, 70),
    decoyAt: -1, decoyed: false, shot: false, dead: false, life: 0,
    pos: worldPos.clone(), prev: worldPos.clone(), vel: new V3(), mesh: makeMissileMesh(0xff6a3a),
  });
  AU.launch();
  if (kind === 'sam') say('PILOT', pick(['SAM launch! SAM launch!', 'Smoke trail — SAM in the air!']));
  else say('PILOT', `Missile launch, ${clockDir(L0)}!`);
  if (firstLaunch) { firstLaunch = false; hint('Missile inbound! Press F to pop flares when the FLARE cue flashes. You can also shoot missiles down with the gun.', 7); }
}
function deployFlares() {
  if (S.flareCd > 0 || !isActive()) return;
  if (S.flares <= 0) { toast('NO FLARES', '#ff7b6b'); return; }
  S.flareCd = 0.4; S.flares = Math.max(0, S.flares - 2); S.flaresUsed++;
  S.flareFlash = 0.35;
  AU.flare();
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    const p = jetPos.clone().addScaledVector(fwd, S.view === 'cockpit' ? 24 : 0).addScaledVector(right, s * 6).addScaledVector(upv, -4);
    S.flareObjs.push({ pos: p, prev: p.clone(), vel: fwd.clone().multiplyScalar(S.speed * 0.55).addScaledVector(right, s * rand(50, 110)).addScaledVector(upv, rand(-10, 30)), life: rand(2.2, 2.8), acc: 0 });
  }
  let resisted = false;
  for (const m of S.incoming) {
    if (m.decoyed || m.decoyAt >= 0) continue;
    const rem = m.T - m.t;
    const pk = rem < 0.45 ? 0.3 : rem < 2.3 ? 0.92 : rem < 3.2 ? 0.45 : 0.12;
    if (Math.random() < pk) m.decoyAt = S.t + rand(0.12, 0.3);
    else resisted = true;
  }
  if (resisted) toast('STILL TRACKING', '#ff7b6b', 1.0);
}
function updateFlares(dt) {
  for (const f of S.flareObjs) {
    f.life -= dt; f.prev.copy(f.pos);
    f.vel.y -= 38 * dt; f.vel.multiplyScalar(Math.pow(0.55, dt));
    f.pos.addScaledVector(f.vel, dt);
    fire.spawn(f.pos, { life: 0.07, s0: rand(10, 17), s1: 8, color: 0xfff4d0 });
    trail(f.prev, f.pos, 4, { life: 1.4, s0: 2, s1: 10, color: 0xf2f2f2, a: 0.5, vel: rvec(2) });
    f.acc += dt;
    if (f.acc > 0.06) { f.acc = 0; fire.spawn(f.pos, { vel: rvec(45), life: 0.4, s0: 3, s1: 1, color: 0xffe0a0, grav: 60 }); }
  }
  S.flareObjs = S.flareObjs.filter((f) => f.life > 0);
}
function hitPlayer(dmg) {
  S.hp = Math.max(0, S.hp - dmg); S.hits++;
  S.shake = 1.2; S.flash = 0.75; S.rollKick = rand(-0.6, 0.6);
  AU.boom(true, 1);
  if (S.view === 'tgp') explosion(jetPos, 1.2);
  if (S.hp <= 0) { die(); return; }
  say('PILOT', S.hp < 40 ? pick(['We\'re hit bad! Hydraulics going!', 'Another hit — we can\'t take much more!']) : pick(['We\'re hit! Still flying.', 'Took a hit! Systems holding.']));
}
const _ip = new V3();
function updateIncoming(dt) {
  let minRem = 99;
  for (const m of S.incoming) {
    m.prev.copy(m.pos);
    if (!m.decoyed) {
      m.t += dt;
      const p = Math.min(1, m.t / m.T), s = Math.sin(Math.PI * p);
      fromLocal(m.pos, m.L0.x * (1 - p) + m.side * s, m.L0.y * (1 - p) + m.arc * s, m.L0.z * (1 - p));
      m.vel.subVectors(m.pos, m.prev).divideScalar(Math.max(dt, 1e-4));
      if (m.shot) {
        explosion(m.pos, 0.7); m.dead = true; S.missilesDefeated++;
        toast('MISSILE SHOT DOWN', '#9dffb0', 1.4); say('PILOT', 'You shot it down?! Outstanding!');
      } else if (m.decoyAt >= 0 && S.t >= m.decoyAt) {
        m.decoyed = true; m.life = 0.8; S.missilesDefeated++;
        m.vel.addScaledVector(right, pick([-1, 1]) * 380).addScaledVector(upv, -120);
        S.rollKick = pick([-0.55, 0.55]);
        toast('MISSILE DEFEATED', '#9dffb0', 1.3);
      } else if (p >= 1) {
        hitPlayer(m.kind === 'sam' ? 28 : 25); m.dead = true;
      } else {
        minRem = Math.min(minRem, m.T - m.t);
      }
    } else {
      m.pos.addScaledVector(m.vel, dt); m.vel.y -= 80 * dt; m.life -= dt;
      if (m.life <= 0) { explosion(m.pos, 0.7); m.dead = true; }
    }
    m.mesh.position.copy(m.pos);
    if (m.decoyed) m.mesh.lookAt(_ip.copy(m.pos).add(m.vel)); else m.mesh.lookAt(jetPos);
    if (m.t > 0.05) trail(m.prev, m.pos, 8, { life: 2.2, s0: 3, s1: 18, color: 0xf0f0f0, a: 0.6, vel: rvec(3) }, wobble(m.t + 1));
    m.mesh.children[1].scale.setScalar(rand(7, 12));
    if (m.dead) disposeMesh(m.mesh);
  }
  S.incoming = S.incoming.filter((m) => !m.dead);
  S.minRem = minRem;
  if (minRem < 90 && S.phase !== 'dead') {
    S.warnT -= dt;
    if (S.warnT <= 0) { AU.warn(); S.warnT = clamp(minRem * 0.11, 0.08, 0.45); }
  }
}

// ---------------------------------------------------------------- ground targets + bombs
const AREAS = [
  { name: 'ALPHA', types: ['SAM', 'RADAR', 'FUEL', 'SAM', 'TRUCK', 'CMD', 'FUEL', 'HANGAR'] },
  { name: 'BRAVO', types: ['SAM', 'TRUCK', 'SAM', 'HANGAR', 'FUEL', 'RADAR', 'SAM', 'TRUCK'] },
  { name: 'CHARLIE', types: ['SAM', 'CMD', 'FUEL', 'SAM', 'HANGAR', 'TRUCK', 'SAM', 'RADAR'] },
];
function placeTargets() {
  let d = S.dist + 2600;
  S.areas = [];
  for (const area of AREAS) {
    S.areas.push({ name: area.name, start: d, count: area.types.length, sams: area.types.filter((t) => t === 'SAM').length });
    for (const type of area.types) {
      const dd = d + rand(-60, 60), z = -dd;
      let x = pathX(z), y = 0;
      for (let tries = 0; tries < 12; tries++) {
        const cx = pathX(z) + rand(-360, 360);
        const h = groundH(cx, z);
        if (h > 4 || tries === 11) { x = cx; y = Math.max(0, h); break; }
      }
      const mesh = makeTarget(type);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rand(0, TAU);
      scene.add(mesh);
      S.targets.push({ type, mesh, pos: new V3(x, y + 6, z), alive: true, fireT: rand(1, 4), dd });
      S.lastTargetDist = Math.max(S.lastTargetDist, dd);
      d += rand(330, 420);
    }
    d += 2200;
  }
}
function flak(dt) {
  S.flakT -= dt;
  if (S.flakT > 0) return;
  S.flakT = rand(0.25, 0.7);
  const p = _st.copy(jetPos).addScaledVector(fwd, rand(250, 1100)).addScaledVector(right, rand(-260, 260)).addScaledVector(upv, rand(-80, 140));
  fire.spawn(p, { life: 0.15, s0: 18, s1: 40, color: 0xffd090, a: 0.9 });
  for (let i = 0; i < 4; i++) smoke.spawn(p, { vel: rvec(8), life: rand(2.5, 3.5), s0: 10, s1: rand(35, 50), color: pick([0x1e1e1e, 0x2a2a2a]), a: 0.8 });
  if (Math.random() < 0.5) AU.noise(0.35, 0.18, 500, 'lowpass', 90);
}
function destroyTarget(t) {
  t.alive = false; S.targetsDestroyed++;
  t.mesh.traverse((o) => { if (o.isMesh) o.material = WRECK_MAT; });
  setThermal(S.view === 'tgp');
  t.mesh.scale.y *= 0.35;
  S.fires.push({ pos: t.pos.clone().add(new V3(0, 8, 0)), life: 40, acc: 0, big: t.type === 'FUEL' ? 1.6 : 1 });
  if (t.type === 'FUEL') setTimeout(() => explosion(t.pos.clone().add(new V3(rand(-30, 30), 20, rand(-30, 30))), 2.4), 250);
  say('PILOT', pick(['Shack! Good hits!', 'Target destroyed!', 'Direct hit — secondaries!', 'That one\'s gone.']));
}
function dropBomb() {
  if (S.bombCd > 0) return;
  if (S.bombs <= 0) { toast('NO BOMBS', '#ff7b6b'); return; }
  const p = S.desig;
  if (!p) return;
  const ahead = _c.subVectors(p, jetPos).dot(fwdFlat);
  if (ahead < 150 || ahead > 1350) { toast('OUT OF RANGE', '#ff7b6b'); AU.beep(220, 0.12, 'square', 0.06); return; }
  S.bombs--; S.bombCd = 0.35;
  const start = jetPos.clone().addScaledVector(upv, -4);
  const mesh = new THREE.Group();
  const b = new THREE.Mesh(BOMB_GEO, BOMB_MAT); b.rotation.x = Math.PI / 2; mesh.add(b);
  mesh.scale.setScalar(2.4); scene.add(mesh);
  S.bombsAir.push({ start, target: p.clone(), T: clamp(start.distanceTo(p) / 560, 1.5, 3.4), t: 0, mesh, pos: start.clone(), prev: start.clone() });
  AU.beep(480, 0.1, 'sine', 0.08, 300);
  toast('BOMB AWAY', '#9dffb0', 0.8);
}
function updateBombs(dt) {
  for (const b of S.bombsAir) {
    b.t += dt;
    const p = Math.min(1, b.t / b.T);
    b.prev.copy(b.pos);
    b.pos.lerpVectors(b.start, b.target, p);
    b.pos.y += Math.sin(Math.PI * p) * 70 * (1 - p * 0.5);
    b.mesh.position.copy(b.pos);
    b.mesh.lookAt(_c.copy(b.pos).add(b.pos).sub(b.prev));
    if (p >= 1) {
      explosion(b.target, 2.2);
      let hit = false;
      for (const t of S.targets) {
        if (t.alive && Math.hypot(t.pos.x - b.target.x, t.pos.z - b.target.z) < 85) { destroyTarget(t); hit = true; }
      }
      if (!hit) toast('MISS', '#ffd27a', 1);
      S.fires.push({ pos: b.target.clone(), life: 5, acc: 0, big: 0.8 });
      scene.remove(b.mesh); b.dead = true;
    }
  }
  S.bombsAir = S.bombsAir.filter((b) => !b.dead);
}
function updateTargets(dt) {
  for (const t of S.targets) {
    if (!t.alive || t.type !== 'SAM') continue;
    const ahead = _c.subVectors(t.pos, jetPos).dot(fwdFlat);
    t.fireT -= dt;
    if (ahead > 250 && ahead < 2600 && t.fireT <= 0) {
      if (activeIncoming() < S.maxInc) { launchIncoming(t.pos.clone().add(new V3(0, 20, 0)), 'sam'); t.fireT = rand(5, 8); }
      else t.fireT = rand(1, 2);
    }
  }
  for (const f of S.fires) {
    f.life -= dt; f.acc += dt;
    while (f.acc > 0.12) {
      f.acc -= 0.12;
      smoke.spawn(f.pos, { vel: new V3(rand(-6, 6) + 10, rand(25, 40), rand(-6, 6)), life: rand(3, 4.5), s0: 14 * f.big, s1: 80 * f.big, color: pick([0x2e2e2e, 0x3c3c3c]), a: 0.7 });
      fire.spawn(f.pos, { vel: new V3(0, 20, 0), life: 0.5, s0: 14 * f.big, s1: 4, color: 0xff8a30, a: 0.8 });
    }
  }
  S.fires = S.fires.filter((f) => f.life > 0);
}

// ---------------------------------------------------------------- phases
const COMBAT = ['ingress', 'a2a', 'feetdry', 'bomb', 'feetwet', 'a2a2', 'approach', 'bolter'];
const isCombat = () => COMBAT.includes(S.phase);
const isActive = () => isCombat() && !S.paused;
const isOver = () => S.phase === 'dead' || S.ended;

const WAVE_CALLS = ['Next group: {n} bandits, closing from the north.', '{n} more bandits. They\'re not giving up.', 'Last group, {n} bandits. Make it count.'];
function startWaves(list) { S.waves = list; S.waveIdx = -1; S.waveTimer = 1; }
function updateWaves(dt) {
  if (S.enemies.length === 0 && S.waveTimer < 0) {
    if (S.waveIdx >= S.waves.length - 1) return true;
    S.waveTimer = 3.5;
    say('AWACS', WAVE_CALLS[Math.min(S.waveIdx, WAVE_CALLS.length - 1)].replace('{n}', S.waves[S.waveIdx + 1]));
  }
  if (S.waveTimer >= 0) {
    S.waveTimer -= dt;
    if (S.waveTimer < 0) {
      S.waveIdx++;
      for (let i = 0; i < S.waves[S.waveIdx]; i++) spawnEnemy();
      S.maxInc = Math.min(3, 1 + S.waveIdx);
    }
  }
  return false;
}
function waveOff() {
  S.waveoffs++;
  say('PADDLES', 'Wave off! Wave off!');
  sayIn(2, 'PILOT', !S.gearDown ? 'Gear\'s still up! Gear and hook, let\'s go around.' : 'No hook, we\'d have gone off the end. Hook down next time!');
  toast('WAVE OFF', '#ff7b6b', 2);
  if (S.view === 'ext') setView('cockpit');
  setPhase('bolter');
}

function setPhase(p) {
  S.phase = p; S.phaseT = 0; S.phaseKills = 0;
  switch (p) {
    case 'launch':
      S.view = 'ext'; S.extMode = 'orbit';
      say('AIR BOSS', 'Nightjar One-One, cat one. Spotted and tensioned.');
      sayIn(3, 'SHOOTER', 'Hooked up. Run it up, full burner.');
      sayIn(5.5, 'PILOT', 'Engines good. Ready back there?');
      sayIn(7.6, 'PILOT', 'Saluting... hang on.');
      hint('Sit tight. The pilot has the jet; you take over once we\'re airborne.', 8);
      break;
    case 'ingress':
      say('PILOT', 'Gear up, climbing out. Feet wet, heading north.');
      sayIn(4, 'AWACS', 'Darkstar: bandits launching from the coast. Expect contact over the water.');
      sayIn(8, 'PILOT', 'Weapons hot. They\'re all yours.');
      hint('Move the mouse to aim. Hold the reticle on a bandit to lock, then left-click to fire. SPACE fires the gun.', 9);
      break;
    case 'a2a':
      startWaves([2, 3, 4]);
      say('AWACS', 'Two bandits, your nose, 15 miles, hot.');
      break;
    case 'feetdry':
      S.landStart = S.dist + 5200;
      say('PILOT', 'Splash all bandits! Coast in about a minute.');
      sayIn(4, 'AWACS', 'Three target areas: Alpha, Bravo, Charlie. Heavy SAM coverage. Need sixteen of twenty-four.');
      sayIn(9, 'PILOT', 'Get the pod up. Press V when you\'re ready.');
      hint('Press V to switch to the targeting pod (bird\'s-eye view).', 8);
      break;
    case 'bomb':
      placeTargets(); S.maxInc = 3; S.cruise = 170; S.areaIdx = -1; S.duskTarget = 0.15;
      say('PILOT', 'Feet dry. Here comes the flak. Keep those flares handy.');
      hint('Pod view: aim the designator at a target and left-click to release a guided bomb. Kill the SAMs first.', 8);
      break;
    case 'feetwet':
      S.landEnd = S.dist + 4600; S.cruise = 200; S.duskTarget = 0.45;
      if (S.view === 'tgp') setView('cockpit');
      say('PILOT', S.targetsDestroyed >= TARGETS_REQUIRED ? 'That\'s a good day\'s work. Pod\'s stowed, heading for the water.' : 'We left too much standing... heading home.');
      sayIn(5, 'AWACS', 'Darkstar: more bandits scrambling behind you. Stay sharp.');
      break;
    case 'a2a2':
      startWaves([3, 4]); S.duskTarget = 0.7;
      say('AWACS', 'Three bandits, closing fast, your nose!');
      break;
    case 'approach':
      S.duskTarget = 0.85;
      if (S.straightFrom === Infinity) S.straightFrom = S.dist + 4500;
      placeRecovery(Math.max(S.straightFrom + 4000, S.dist + 8000));
      S.customY = jetPos.y; S.customVy = 0; S.yBlend = 1; S.scriptSpeed = true; S.callouts = {};
      if (!S.leakerT) S.leakerT = 4;
      say(S.waveoffs ? 'PILOT' : 'AWACS', S.waveoffs ? 'Coming around for another pass.' : 'Darkstar: picture clear. Mother is at your twelve, 25 miles.');
      if (!S.waveoffs) sayIn(4, 'PILOT', 'Let\'s go home. Run the landing checklist when I call it.');
      break;
    case 'trap':
      if (S.view !== 'ext') { setView('ext'); S.extMode = 'lso'; }
      S.shake = 1.6; AU.trap(); AU.engine(0.08); S.burner = false;
      say('PADDLES', 'Three-wire! Nice!');
      sayIn(2.4, 'AIR BOSS', 'Welcome back, Nightjar.');
      sayIn(4.6, 'PILOT', 'Nice work back there. Drinks are on me.');
      break;
  }
}
function updatePhase(dt) {
  S.phaseT += dt;
  switch (S.phase) {
    case 'launch': {
      const t = S.phaseT;
      if (t > 3 && !S.spool) { S.spool = true; S.burner = true; AU.engine(0.5); }
      if (!S.shot) { catSteam(t > 3 ? 2 : 1, 1); S.shake = t > 3 ? 0.15 : 0; }
      if (t > 6.2 && S.extMode === 'orbit' && S.view === 'ext') setView('cockpit');
      if (t >= 8.6 && !S.shot) { S.shot = true; S.shake = 1.6; S.fovKick = 14; AU.cat(); catSteam(40, 2); toast('LAUNCH', '#9dffb0', 1.2); }
      if (S.shot) {
        if (S.dist < 106) S.speed = Math.min(80, S.speed + 38 * dt);
        else {
          S.speed = Math.min(200, S.speed + 13 * dt);
          if (!S.offDeck) { S.offDeck = true; S.offT = t; S.customVy = -6; say('PILOT', 'Good shot! Airborne!'); }
        }
        if (S.offDeck) {
          const ot = t - S.offT;
          S.customVy = Math.min(32, S.customVy + 15 * dt);
          S.customY += S.customVy * dt;
          if (ot > 0.8 && !S.chased) { S.chased = true; setView('ext'); S.extMode = 'chase'; }
          if (ot > 2.2) S.gearDown = false;
          if (ot > 6.5 && S.view === 'ext') setView('cockpit');
          const py = pathY(-S.dist);
          if (S.customY > py - 3) { S.customY = py; S.customVy = 0; S.yBlend = Math.max(0, S.yBlend - dt * 0.8); }
          if (S.yBlend <= 0 && S.speed >= 199) { S.scriptSpeed = false; S.burner = false; AU.engine(0.3); setPhase('ingress'); }
        }
      }
      break;
    }
    case 'ingress':
      if (S.phaseT > 10) setPhase('a2a');
      break;
    case 'a2a':
      if (updateWaves(dt)) setPhase('feetdry');
      break;
    case 'feetdry':
      if (S.dist > S.landStart + 300) setPhase('bomb');
      break;
    case 'bomb': {
      const next = S.areas[S.areaIdx + 1];
      if (next && S.dist > next.start - 1800) {
        S.areaIdx++;
        say('AWACS', `Target area ${next.name}: ${next.count} targets, ${next.sams} SAM sites.`);
        toast(`AREA ${next.name}`, '#9dffb0', 2);
      }
      flak(dt);
      const allDown = S.targets.every((t) => !t.alive);
      if (S.dist > S.lastTargetDist + 300 || (allDown && S.bombsAir.length === 0 && (S.allDownT = (S.allDownT || 0) + dt) > 2.5)) setPhase('feetwet');
      break;
    }
    case 'feetwet':
      if (S.dist > S.landEnd - 800) setPhase('a2a2');
      break;
    case 'a2a2':
      if (updateWaves(dt)) setPhase('approach');
      break;
    case 'approach': {
      const r = S.recoverD - S.dist;
      if (S.leakerT > 0 && (S.leakerT -= dt) <= 0) { S.leakerT = -1; S.maxInc = 1; spawnEnemy(); say('AWACS', 'Leaker! One bandit, your nose, hot!'); }
      if (r < 2800 && S.enemies.length) { for (const e of S.enemies) removeEnemy(e); S.enemies = []; say('PILOT', 'He\'s bugging out. Focus on the landing.'); }
      // glide slope down to the deck, slowing to approach speed
      const tgt = Math.min(330, JET_DECK_Y + Math.max(0, r) * 0.06);
      S.customVy = (tgt < 330 ? -S.speed * 0.06 : 0) + (tgt - S.customY) * 1.5;
      S.customY += S.customVy * dt;
      S.speed = lerp(S.speed, r > 3500 ? 200 : r > 1800 ? lerp(80, 200, (r - 1800) / 1700) : 80, 1 - Math.pow(0.4, dt));
      const call = (key, cond, fn) => { if (cond && !S.callouts[key]) { S.callouts[key] = true; fn(); } };
      call('gear', r < 6500, () => { say('PILOT', 'Landing checklist. Gear down, that\'s you. [G]'); hint('Landing checklist: lower the gear (G) and the tail hook (H) before the ramp.', 9); });
      call('hook', r < 5200, () => say('PILOT', 'Hook down. [H]'));
      call('ball', r < 2600, () => say('PADDLES', 'Nightjar, three-quarter mile, call the ball.'));
      call('ball2', r < 2250, () => say('PILOT', 'Nightjar ball, four-point-two.'));
      call('roger', r < 1950, () => say('PADDLES', 'Roger ball.'));
      call('power', r < 1300, () => say('PADDLES', 'A little power...'));
      if (r < 1000 && (!S.gearDown || !S.hookDown)) { waveOff(); break; }
      call('lso', r < 650, () => { setView('ext'); S.extMode = 'lso'; });
      if (r <= 0) setPhase('trap');
      break;
    }
    case 'bolter':
      S.customVy = Math.min(25, S.customVy + 20 * dt);
      S.customY = Math.min(330, S.customY + S.customVy * dt);
      S.speed = lerp(S.speed, 200, 1 - Math.pow(0.5, dt));
      if (S.phaseT > 8) setPhase('approach');
      break;
    case 'trap':
      S.speed = Math.max(0, S.speed - 75 * dt);
      S.customY = JET_DECK_Y; S.customVy = 0;
      if (S.phaseT > 7) endGame(true);
      break;
  }
}
function die() {
  S.phase = 'dead'; S.deadT = 0;
  S.flash = 1; S.shake = 2;
  explosion(jetPos.clone().addScaledVector(fwd, 20), 2.5);
  say('PILOT', 'EJECT, EJECT, EJECT!');
}
function endGame(landed) {
  if (S.ended) return;
  S.ended = true;
  document.body.classList.remove('playing');
  const alive = S.hp > 0, total = S.targets.length || 24;
  const success = alive && landed && S.targetsDestroyed >= TARGETS_REQUIRED;
  const score = S.kills * 150 + S.targetsDestroyed * 200 + S.missilesDefeated * 60 + (alive ? S.hp * 6 : 0)
    + (landed ? 1500 - S.waveoffs * 400 : 0) + (success ? 1000 : 0);
  const grade = !success ? '—' : score > 9000 ? 'S' : score > 7500 ? 'A' : score > 6000 ? 'B' : 'C';
  const title = document.getElementById('endTitle');
  title.textContent = !alive ? 'AIRCRAFT LOST' : success ? 'MISSION COMPLETE' : 'MISSION FAILED';
  title.className = success ? 'result-ok' : 'result-bad';
  document.getElementById('endSub').textContent = !alive ? 'You and the pilot ejected.'
    : success ? 'Trapped aboard. All three target areas hit. Welcome home.'
    : `Back aboard, but only ${S.targetsDestroyed} of ${total} targets destroyed (${TARGETS_REQUIRED} required).`;
  const secs = Math.round(S.t - S.startT);
  const rows = [
    ['Bandits splashed', S.kills], ['Ground targets', `${S.targetsDestroyed} / ${total}`],
    ['Missiles defeated', S.missilesDefeated], ['Hits taken', S.hits], ['Hull', `${Math.round(S.hp)}%`],
    ['Landing', !landed ? '—' : S.waveoffs ? `${S.waveoffs} wave-off${S.waveoffs > 1 ? 's' : ''}, then trapped` : 'OK, three-wire'],
    ['Mission time', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ['Score', score], ['Grade', grade],
  ];
  document.getElementById('endStats').innerHTML = rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
  document.getElementById('end').classList.remove('hidden');
}

// ---------------------------------------------------------------- main update
function update(dt) {
  S.t += dt;
  if (S.phase === 'dead') S.speed = Math.max(60, S.speed - 60 * dt);
  updateJet(dt);
  updateChunks(false);
  smoke.update(dt); fire.update(dt); rings.update(dt); dust.update(dt);
  updateDebris(dt);
  updateFlares(dt);
  if (S.view === 'cockpit') for (let i = 0; i < 2; i++) {
    dust.spawn(_c.copy(jetPos).addScaledVector(fwd, rand(160, 340)).addScaledVector(right, rand(-70, 70)).addScaledVector(upv, rand(-40, 40)),
      { life: 1.7, s0: 0.7, s1: 0.7, color: 0xffffff, a: 0.45 });
  }
  let inCloud = 0;
  for (const c of clouds) {
    const d = c.position.distanceTo(jetPos);
    if (d < c.userData.r) inCloud = Math.max(inCloud, 1 - d / c.userData.r);
  }
  S.whiteout = lerp(S.whiteout, clamp(inCloud * 2.5, 0, 1), 1 - Math.pow(0.01, dt));
  S.shake = Math.max(0, S.shake - dt * 1.6);
  S.flash = Math.max(0, S.flash - dt * 1.5);
  S.flareFlash = Math.max(0, S.flareFlash - dt);
  S.static = Math.max(0, S.static - dt);
  S.cut = Math.max(0, S.cut - dt);
  S.fovKick *= Math.pow(0.15, dt);
  S.dusk += (S.duskTarget - S.dusk) * (1 - Math.pow(0.9, dt));
  applyDusk(S.dusk);
  launchCarrier.userData.radar.rotation.y += dt * 2;
  if (recovery) recovery.userData.carrier.userData.radar.rotation.y += dt * 2;
  if (launchGroup.parent && S.dist > 6000) scene.remove(launchGroup);
  S.flareCd -= dt; S.bombCd -= dt;
  if (S.phase === 'brief') return;
  if (S.phase === 'dead') {
    S.deadT += dt;
    if (S.deadT > 2.6) endGame(false);
    updateBombs(dt); updateTargets(dt); updateBullets(dt);
    return;
  }
  for (const q of S.queue) if (q.at <= S.t) { say(q.who, q.text); q.done = true; }
  S.queue = S.queue.filter((q) => !q.done);
  updatePhase(dt);
  updateEnemies(dt);
  updatePMissiles(dt);
  updateGun(dt);
  updateBullets(dt);
  updateIncoming(dt);
  updateTargets(dt);
  updateBombs(dt);
  // designator pick for the pod
  S.desig = null;
  if (S.view === 'tgp') {
    const hits = mouseRayHits();
    if (hits) S.desig = hits;
  }
}
function mouseRayHits() {
  mouseRay();
  const res = raycaster.intersectObjects(Array.from(chunks.values()), false);
  return res.length ? res[0].point : null;
}

// ---------------------------------------------------------------- helpers
const _a = new V3(), _b = new V3();
function segDist(a, b, p) {
  _a.subVectors(b, a);
  const l2 = _a.lengthSq();
  const t = l2 > 0 ? clamp(_b.subVectors(p, a).dot(_a) / l2, 0, 1) : 0;
  return _b.copy(a).addScaledVector(_a, t).distanceTo(p);
}
const _v = new V3();
function toScreen(p) {
  _v.copy(p).project(camera);
  return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H, vis: _v.z < 1 && _v.z > -1 };
}

// ---------------------------------------------------------------- HUD
const GREEN = '#8dff9b', AMBER = '#ffc457', RED = '#ff5a4a', FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const font = (px, w = 600) => `${w} ${px}px ${FONT}`;

function drawHUD() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const conT = H - CON_H;
  if (S.view === 'ext') { drawCinematic(); return; }
  if (S.view === 'cockpit') drawCockpit(conT); else drawTGP(conT);
  if (S.view === 'cockpit' && S.whiteout > 0.01) { ctx.fillStyle = `rgba(236,241,246,${S.whiteout * 0.88})`; ctx.fillRect(0, 0, W, conT); }

  if (S.static > 0) {
    ctx.fillStyle = `rgba(30,34,30,${S.static * 2.5})`; ctx.fillRect(0, 0, W, conT);
    for (let i = 0; i < 120; i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`; ctx.fillRect(Math.random() * W, Math.random() * conT, rand(20, 140), 2); }
  }
  if (S.flareFlash > 0) {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    const a = S.flareFlash * 0.5;
    g.addColorStop(0, `rgba(255,240,200,${a})`); g.addColorStop(0.15, 'rgba(255,240,200,0)');
    g.addColorStop(0.85, 'rgba(255,240,200,0)'); g.addColorStop(1, `rgba(255,240,200,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, conT);
  }
  if (S.hp < 40 && S.phase !== 'brief') {
    const a = (0.25 + 0.15 * Math.sin(S.t * 5)) * (1 - S.hp / 40 * 0.6);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,60,30,${S.flash * 0.45})`; ctx.fillRect(0, 0, W, H); }
  if (S.cut > 0) { ctx.fillStyle = `rgba(0,0,0,${S.cut / 0.35})`; ctx.fillRect(0, 0, W, H); }

  drawConsole(conT);
  if (S.phase === 'brief') return;
  drawTopBar();
  drawWarnings(conT);
  if (S.paused) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = font(30, 700); ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H * 0.42);
    ctx.font = font(14, 500); ctx.fillText('P / Esc to resume', W / 2, H * 0.42 + 30);
  }
}

function drawCockpit(conT) {
  // world-space markers
  const fp = toScreen(_c.copy(jetPos).addScaledVector(fwd, 1500));
  if (fp.vis && S.phase !== 'brief') {
    ctx.strokeStyle = 'rgba(141,255,155,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(fp.x, fp.y, 6, 0, TAU);
    ctx.moveTo(fp.x - 18, fp.y); ctx.lineTo(fp.x - 6, fp.y); ctx.moveTo(fp.x + 6, fp.y); ctx.lineTo(fp.x + 18, fp.y);
    ctx.moveTo(fp.x, fp.y - 6); ctx.lineTo(fp.x, fp.y - 13); ctx.stroke();
  }
  drawCanopy(conT);
  if (S.phase === 'approach' || S.phase === 'bolter') drawRecoveryPanel(conT);
  if (!isCombat()) return;

  ctx.textAlign = 'center';
  for (const e of S.enemies) {
    if (!e.alive) continue;
    if (e.onScreen) {
      const sz = clamp(4200 / e.oz, 12, 30);
      const col = e.locked ? RED : e.lockT > 0 ? AMBER : GREEN;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = e.locked ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(e.sx, e.sy - sz); ctx.lineTo(e.sx + sz, e.sy); ctx.lineTo(e.sx, e.sy + sz); ctx.lineTo(e.sx - sz, e.sy); ctx.closePath();
      ctx.stroke();
      if (e.lockT > 0 && !e.locked) {
        ctx.beginPath(); ctx.arc(e.sx, e.sy, sz + 7, -Math.PI / 2, -Math.PI / 2 + TAU * e.lockT / LOCK_T); ctx.stroke();
      }
      if (e.locked) {
        ctx.beginPath(); ctx.arc(e.sx, e.sy, sz + 7, 0, TAU); ctx.stroke();
        ctx.font = font(11, 700); ctx.fillText('LOCK', e.sx, e.sy - sz - 12);
      }
      ctx.font = font(11, 500);
      ctx.fillText(e.oz < 2400 ? (e.oz / 1000).toFixed(1) + 'k' : 'RNG', e.sx, e.sy + sz + 15);
    } else {
      edgeArrow(e.pos, GREEN, conT);
    }
  }
  for (const m of S.incoming) {
    if (m.decoyed) continue;
    const sp = toScreen(m.pos);
    if (sp.vis && sp.x > 0 && sp.x < W && sp.y > 0 && sp.y < conT) {
      const r = 10 + 4 * Math.sin(S.t * 18);
      ctx.strokeStyle = RED; ctx.fillStyle = RED; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, TAU); ctx.stroke();
      ctx.font = font(11, 700); ctx.fillText('MSL', sp.x, sp.y - r - 6);
    } else edgeArrow(m.pos, RED, conT);
  }
  // reticle
  const mx = S.mouse.x, my = Math.min(S.mouse.y, conT - 8);
  const rc = S.overheat ? RED : GREEN;
  ctx.strokeStyle = rc; ctx.lineWidth = 1.8;
  for (let i = 0; i < 4; i++) {
    const a0 = i * TAU / 4 + 0.25;
    ctx.beginPath(); ctx.arc(mx, my, 22, a0, a0 + TAU / 4 - 0.5); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(mx - 34, my); ctx.lineTo(mx - 26, my); ctx.moveTo(mx + 26, my); ctx.lineTo(mx + 34, my);
  ctx.moveTo(mx, my - 34); ctx.lineTo(mx, my - 26); ctx.moveTo(mx, my + 26); ctx.lineTo(mx, my + 34);
  ctx.stroke();
  ctx.fillStyle = rc; ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
  if (S.gunHeat > 0.02) {
    ctx.strokeStyle = S.overheat ? RED : S.gunHeat > 0.7 ? AMBER : 'rgba(141,255,155,.6)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(mx, my, 28, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * S.gunHeat); ctx.stroke();
  }
}
function drawCinematic() {
  const bar = Math.round(H * 0.1);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
  if (S.phase !== 'brief') {
    ctx.textBaseline = 'middle';
    ctx.font = font(12, 700); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'left';
    ctx.fillText(S.phase === 'launch' ? 'CVN-73  ·  CATAPULT ONE' : 'CVN-73  ·  RECOVERY', 20, bar / 2);
    const m = S.msgs[S.msgs.length - 1];
    if (m && S.t - m.t < 6) {
      ctx.textAlign = 'center';
      ctx.font = font(clamp(H * 0.022, 13, 18), 600);
      ctx.fillStyle = m.who === 'PILOT' ? '#7fd7ff' : AMBER;
      ctx.fillText(`${m.who}:  ${m.text.slice(0, Math.floor((S.t - m.t) * 55))}`, W / 2, H - bar / 2, W - 40);
    }
    if (S.toast && S.t < S.toast.until) {
      ctx.textAlign = 'center'; ctx.font = font(22, 800); ctx.fillStyle = S.toast.color;
      ctx.fillText(S.toast.text, W / 2, H * 0.3);
    }
    ctx.textBaseline = 'alphabetic';
  }
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,60,30,${S.flash * 0.45})`; ctx.fillRect(0, 0, W, H); }
  if (S.cut > 0) { ctx.fillStyle = `rgba(0,0,0,${S.cut / 0.35})`; ctx.fillRect(0, 0, W, H); }
}
function drawRecoveryPanel(conT) {
  const r = Math.max(0, S.recoverD - S.dist);
  const w = 176, h = 150, x = W - w - 16, y = conT * 0.3;
  ctx.save();
  ctx.fillStyle = 'rgba(5,8,10,.62)'; roundRect(x, y, w, h, 8); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = font(11, 700); ctx.fillStyle = GREEN; ctx.fillText('RECOVERY', x + 12, y + 20);
  ctx.font = font(12, 600); ctx.fillText(`RNG ${(r / 1852).toFixed(1)} nm`, x + 12, y + 44);
  const line = (label, ok, key, yy) => {
    ctx.fillStyle = ok ? GREEN : Math.sin(S.t * 8) > 0 ? AMBER : 'rgba(255,196,87,.35)';
    ctx.fillText(`${label} ${ok ? 'DOWN' : 'UP'} [${key}]`, x + 12, yy);
  };
  line('GEAR', S.gearDown, 'G', y + 70);
  line('HOOK', S.hookDown, 'H', y + 94);
  const bx = x + w - 28, by = y + 22, bh = 100;
  ctx.fillStyle = '#0c0d0e'; ctx.fillRect(bx - 7, by, 14, bh);
  ctx.fillStyle = '#58ff7a'; ctx.fillRect(bx - 22, by + bh / 2 - 2, 12, 4); ctx.fillRect(bx + 10, by + bh / 2 - 2, 12, 4);
  const dev = Math.sin(S.t * 0.9) * 0.28 * clamp(r / 3000, 0.08, 1);
  ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(bx, by + bh / 2 + dev * bh, 6, 0, TAU); ctx.fill();
  ctx.font = font(10, 600); ctx.fillStyle = 'rgba(141,255,155,.7)'; ctx.fillText('BALL', bx - 14, by + bh + 16);
  ctx.restore();
}
function edgeArrow(p, col, conT) {
  _v.copy(p).project(camera);
  let x = _v.x, y = _v.y;
  if (_v.z > 1) { x = -x; y = -y; }
  let ang = Math.atan2(-y, x);
  const cx = W / 2, cy = conT / 2, rx = W / 2 - 40, ry = conT / 2 - 40;
  const k = Math.min(Math.abs(rx / Math.cos(ang)), Math.abs(ry / Math.sin(ang)));
  const ax = cx + Math.cos(ang) * k, ay = cy + Math.sin(ang) * k;
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawCanopy(conT) {
  const g = ctx.createLinearGradient(0, 0, W, conT);
  g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.03)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, conT);
  const v = ctx.createRadialGradient(W / 2, conT * 0.45, Math.min(W, conT) * 0.45, W / 2, conT * 0.45, Math.max(W, conT) * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, conT);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const NOISE = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
})();
let noisePat = null;
function drawTGP(conT) {
  ctx.save();
  noisePat = noisePat || ctx.createPattern(NOISE, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
  ctx.translate(Math.random() * 256, Math.random() * 256);
  ctx.fillStyle = noisePat; ctx.fillRect(-256, -256, W + 512, conT + 256);
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 0; y < conT; y += 3) ctx.fillRect(0, y, W, 1);
  const vg = ctx.createRadialGradient(W / 2, conT / 2, conT * 0.35, W / 2, conT / 2, Math.max(W, conT) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, conT);
  // frame
  const C = '#e8ffe9';
  ctx.strokeStyle = C; ctx.fillStyle = C; ctx.lineWidth = 2;
  const i = 26, L = 30;
  for (const [x, y, dx, dy] of [[i, i, 1, 1], [W - i, i, -1, 1], [i, conT - i, 1, -1], [W - i, conT - i, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + dy * L); ctx.lineTo(x, y); ctx.lineTo(x + dx * L, y); ctx.stroke();
  }
  ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W / 2, i + 40); ctx.lineTo(W / 2, conT / 2 - 30); ctx.moveTo(W / 2, conT / 2 + 30); ctx.lineTo(W / 2, conT - i - 40);
  ctx.moveTo(i + 40, conT / 2); ctx.lineTo(W / 2 - 30, conT / 2); ctx.moveTo(W / 2 + 30, conT / 2); ctx.lineTo(W - i - 40, conT / 2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = font(12, 600); ctx.textAlign = 'left';
  ctx.fillText('TGP  BHOT  NARO', i + 12, i + 52);
  ctx.fillText(`ALT ${Math.round(jetPos.y * 30).toLocaleString()}  GS ${Math.round(S.speed * 2.4)}`, i + 12, i + 70);
  ctx.textAlign = 'right';
  ctx.fillText(`GBU-12 x${S.bombs}`, W - i - 12, i + 52);
  ctx.fillText(`TGT ${S.targetsDestroyed}/${S.targets.length}`, W - i - 12, i + 70);

  // targets
  ctx.textAlign = 'center';
  for (const t of S.targets) {
    const sp = toScreen(t.pos);
    if (!sp.vis || sp.y < 0 || sp.y > conT || sp.x < 0 || sp.x > W) continue;
    if (t.alive) {
      const isSam = t.type === 'SAM';
      ctx.strokeStyle = isSam ? RED : C; ctx.fillStyle = isSam ? RED : C; ctx.lineWidth = 2;
      const s = 22;
      ctx.strokeRect(sp.x - s, sp.y - s, s * 2, s * 2);
      ctx.font = font(11, 700); ctx.fillText(t.type, sp.x, sp.y - s - 6);
      if (isSam) {
        const ahead = _c.subVectors(t.pos, jetPos).dot(fwdFlat);
        if (ahead > 250 && ahead < 2600) {
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(S.t * 8);
          ctx.beginPath(); ctx.arc(sp.x, sp.y, s + 12, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
    } else {
      ctx.strokeStyle = 'rgba(232,255,233,.45)'; ctx.fillStyle = 'rgba(232,255,233,.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sp.x - 14, sp.y - 14); ctx.lineTo(sp.x + 14, sp.y + 14); ctx.moveTo(sp.x + 14, sp.y - 14); ctx.lineTo(sp.x - 14, sp.y + 14); ctx.stroke();
      ctx.font = font(10, 600); ctx.fillText('DESTROYED', sp.x, sp.y + 30);
    }
  }
  // bombs in flight: show impact points with time to impact
  for (const b of S.bombsAir) {
    const sp = toScreen(b.target);
    ctx.strokeStyle = AMBER; ctx.fillStyle = AMBER; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 6, 0, TAU); ctx.stroke();
    ctx.font = font(11, 700); ctx.fillText((b.T - b.t).toFixed(1), sp.x, sp.y + 20);
  }
  for (const m of S.incoming) {
    if (m.decoyed) continue;
    const sp = toScreen(m.pos);
    if (!sp.vis) continue;
    ctx.strokeStyle = RED; ctx.fillStyle = RED; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 12, 0, TAU); ctx.stroke();
    ctx.font = font(11, 700); ctx.fillText(m.kind === 'sam' ? 'SAM' : 'MSL', sp.x, sp.y - 18);
  }
  // designator
  const mx = S.mouse.x, my = Math.min(S.mouse.y, conT - 8);
  let inRange = false, tof = 0;
  if (S.desig) {
    const ahead = _c.subVectors(S.desig, jetPos).dot(fwdFlat);
    inRange = ahead >= 150 && ahead <= 1350;
    tof = clamp(jetPos.distanceTo(S.desig) / 560, 1.5, 3.4);
    const p0 = toScreen(S.desig), p1 = toScreen(_c.copy(S.desig).addScaledVector(right, 85));
    const r = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    ctx.strokeStyle = inRange ? GREEN : RED; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(p0.x, p0.y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  const dc = inRange ? GREEN : RED;
  ctx.strokeStyle = dc; ctx.fillStyle = dc; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(mx, my - 12); ctx.lineTo(mx + 12, my); ctx.lineTo(mx, my + 12); ctx.lineTo(mx - 12, my); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(mx - 26, my); ctx.lineTo(mx - 16, my); ctx.moveTo(mx + 16, my); ctx.lineTo(mx + 26, my);
  ctx.moveTo(mx, my - 26); ctx.lineTo(mx, my - 16); ctx.moveTo(mx, my + 16); ctx.lineTo(mx, my + 26); ctx.stroke();
  ctx.font = font(11, 700); ctx.textAlign = 'left';
  ctx.fillText(S.desig ? (inRange ? `IN RNG  TOF ${tof.toFixed(1)}s` : 'OUT OF RNG') : '', mx + 30, my - 8);
  ctx.restore();
}

function drawConsole(conT) {
  const g = ctx.createLinearGradient(0, conT, 0, H);
  g.addColorStop(0, '#1d2127'); g.addColorStop(1, '#0d0f12');
  ctx.fillStyle = g; ctx.fillRect(0, conT, W, CON_H);
  ctx.fillStyle = '#2f363f'; ctx.fillRect(0, conT, W, 2);
  const ms = CON_H - 18, pad = 12;
  const lx = pad, rx = W - pad - ms, y = conT + 9;
  mfdFrame(lx, y, ms); mfdFrame(rx, y, ms);
  drawRWR(lx + 6, y + 6, ms - 12);
  drawStores(rx + 6, y + 6, ms - 12);
  // comms panel
  const cx = lx + ms + 16, cw = rx - 16 - cx;
  if (cw > 120) {
    ctx.fillStyle = '#07090b'; roundRect(cx, y + 6, cw, ms - 12, 6); ctx.fill();
    ctx.strokeStyle = '#262c33'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(cx + 6, y + 6, cw - 12, ms - 12); ctx.clip();
    const lineH = clamp((ms - 30) / 4, 14, 22), fs = clamp(lineH * 0.62, 10, 14);
    ctx.font = font(fs, 500); ctx.textAlign = 'left';
    const msgs = S.msgs.slice(-4);
    msgs.forEach((m, k) => {
      const age = S.t - m.t;
      const n = Math.min(m.text.length, Math.floor(age * 55));
      const yy = y + 22 + k * lineH;
      const fade = k === msgs.length - 1 ? 1 : 0.55;
      ctx.globalAlpha = fade;
      ctx.fillStyle = m.who === 'PILOT' ? '#7fd7ff' : m.who === 'AWACS' ? AMBER : GREEN;
      ctx.fillText(m.who + ':', cx + 12, yy);
      ctx.fillStyle = '#dfe8ee';
      ctx.fillText(m.text.slice(0, n), cx + 12 + ctx.measureText(m.who + ': ').width, yy);
    });
    ctx.globalAlpha = 1; ctx.restore();
  }
}
function mfdFrame(x, y, s) {
  ctx.fillStyle = '#2a3037'; roundRect(x, y, s, s, 8); ctx.fill();
  ctx.fillStyle = '#040605'; roundRect(x + 6, y + 6, s - 12, s - 12, 4); ctx.fill();
  ctx.fillStyle = '#3a424b';
  for (let i = 0; i < 4; i++) {
    const p = y + 16 + i * (s - 32) / 3;
    ctx.fillRect(x + 1, p - 3, 4, 7); ctx.fillRect(x + s - 5, p - 3, 4, 7);
  }
}
function drawRWR(x, y, s) {
  const cx = x + s / 2, cy = y + s / 2 + 4, r = s / 2 - 14;
  ctx.save();
  ctx.strokeStyle = 'rgba(141,255,155,.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r / 2, 0, TAU); ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4)); ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); ctx.stroke();
  }
  ctx.fillStyle = GREEN; ctx.font = font(10, 700); ctx.textAlign = 'left';
  ctx.fillText('RWR', x + 6, y + 13);
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const plot = (w, rr, label, col) => {
    const L = toLocal(w);
    const a = Math.atan2(L.x, L.z);
    ctx.fillStyle = col; ctx.fillText(label, cx + Math.sin(a) * rr, cy - Math.cos(a) * rr);
  };
  ctx.font = font(11, 700);
  if (S.phase !== 'brief') {
    for (const e of S.enemies) if (e.alive) plot(e.pos, r * 0.68, '29', GREEN);
    for (const t of S.targets) {
      if (!t.alive || t.type !== 'SAM') continue;
      const d = jetPos.distanceTo(t.pos);
      if (d < 4500) plot(t.pos, r * clamp(d / 4500, 0.35, 0.92), 'SA', AMBER);
    }
    for (const m of S.incoming) {
      if (m.decoyed) continue;
      if (Math.sin(S.t * 20) > -0.3) {
        plot(m.pos, r * clamp((m.T - m.t) / m.T, 0.08, 1), 'M', RED);
        const L = toLocal(m.pos), a = Math.atan2(L.x, L.z), rr = r * clamp((m.T - m.t) / m.T, 0.08, 1);
        ctx.strokeStyle = RED; ctx.beginPath(); ctx.arc(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr, 8, 0, TAU); ctx.stroke();
      }
    }
  }
  ctx.restore();
}
function drawStores(x, y, s) {
  ctx.save();
  ctx.fillStyle = GREEN; ctx.font = font(10, 700); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('STORES', x + 6, y + 13);
  const row = (s - 24) / 5;
  const fs = clamp(row * 0.42, 9, 12);
  const lines = [
    ['AIM-120', S.missiles, 12, GREEN],
    ['GBU-12', S.bombs, 32, GREEN],
    ['FLARE', S.flares, 60, S.flares <= 10 ? AMBER : GREEN],
    ['GUN', 1 - S.gunHeat, 1, S.overheat ? RED : S.gunHeat > 0.7 ? AMBER : GREEN, S.overheat ? 'HOT' : ''],
    ['HULL', S.hp, 100, S.hp < 40 ? RED : S.hp < 70 ? AMBER : GREEN],
  ];
  lines.forEach(([label, v, max, col, txt], k) => {
    const yy = y + 22 + k * row + row * 0.55;
    ctx.fillStyle = 'rgba(141,255,155,.75)'; ctx.font = font(fs, 600);
    ctx.fillText(label, x + 6, yy);
    const bx = x + s * 0.42, bw = s * 0.4, bh = Math.max(4, row * 0.32);
    ctx.fillStyle = 'rgba(141,255,155,.12)'; ctx.fillRect(bx, yy - bh, bw, bh);
    ctx.fillStyle = col; ctx.fillRect(bx, yy - bh, bw * clamp(v / max, 0, 1), bh);
    ctx.textAlign = 'right';
    ctx.fillText(txt || (label === 'GUN' ? '' : label === 'HULL' ? Math.round(v) + '%' : String(v)), x + s - 4, yy);
    ctx.textAlign = 'left';
  });
  ctx.restore();
}
function drawTopBar() {
  const wave = `wave ${Math.max(1, S.waveIdx + 1)}/${S.waves.length}`;
  const objective = {
    launch: 'CATAPULT LAUNCH',
    ingress: 'FEET WET  ·  climbing out',
    a2a: `SPLASH BANDITS  ·  ${wave}`,
    feetdry: 'COAST IN  ·  get the pod up [V]',
    bomb: `DESTROY GROUND TARGETS  ·  ${S.targetsDestroyed}/${S.targets.length}  (min ${TARGETS_REQUIRED})`,
    feetwet: 'FEET WET  ·  heading for the boat',
    a2a2: `BANDITS ON THE WAY HOME  ·  ${wave}`,
    approach: 'RECOVERY  ·  gear [G] + hook [H]',
    bolter: 'WAVE OFF  ·  going around',
    dead: 'AIRCRAFT LOST',
  }[S.phase] || '';
  ctx.font = font(13, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(objective).width + 30;
  ctx.fillStyle = 'rgba(5,8,10,.62)'; roundRect(W / 2 - w / 2, 12, w, 28, 14); ctx.fill();
  ctx.fillStyle = S.phase === 'dead' ? RED : '#e9f3ec'; ctx.fillText(objective, W / 2, 26.5);
  if (S.view === 'tgp' || ((S.phase === 'feetdry' || S.phase === 'bomb') && Math.sin(S.t * 6) > 0)) {
    ctx.font = font(11, 700); ctx.fillStyle = S.view === 'tgp' ? GREEN : AMBER;
    ctx.fillText(S.view === 'tgp' ? 'POD VIEW  ·  [V] cockpit' : 'PRESS [V] — TARGETING POD', W / 2, 54);
  }
  if (S.hint && S.t < S.hint.until) {
    ctx.font = font(13, 500);
    const tw = Math.min(ctx.measureText(S.hint.text).width + 28, W - 32);
    ctx.fillStyle = 'rgba(5,8,10,.7)'; roundRect(W / 2 - tw / 2, 66, tw, 28, 6); ctx.fill();
    ctx.fillStyle = '#ffe2a8'; ctx.fillText(S.hint.text, W / 2, 80.5, W - 44);
  }
  ctx.textBaseline = 'alphabetic';
}
function drawWarnings(conT) {
  ctx.textAlign = 'center';
  if (S.minRem < 90 && S.phase !== 'dead') {
    const flareNow = S.minRem < 2.3 && S.minRem > 0.45;
    if (Math.sin(S.t * (flareNow ? 26 : 14)) > -0.2) {
      ctx.font = font(flareNow ? 30 : 24, 800);
      ctx.fillStyle = flareNow ? AMBER : RED;
      ctx.fillText(flareNow ? 'FLARE!  FLARE!' : 'MISSILE INBOUND', W / 2, conT * 0.27);
      ctx.font = font(12, 700);
      ctx.fillText(flareNow ? '[F]' : `${S.minRem.toFixed(1)}s`, W / 2, conT * 0.27 + 22);
    }
  }
  if (S.toast && S.t < S.toast.until) {
    ctx.font = font(18, 800); ctx.fillStyle = S.toast.color;
    ctx.globalAlpha = clamp((S.toast.until - S.t) * 3, 0, 1);
    ctx.fillText(S.toast.text, W / 2, conT * 0.72);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- input
addEventListener('mousemove', (e) => { S.mouse.x = e.clientX; S.mouse.y = e.clientY; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousedown', (e) => {
  if (!isActive()) return;
  if (e.button === 0) { if (S.view === 'tgp') dropBomb(); else fireMissile(); }
  else if (e.button === 2) S.gunHeld = true;
});
addEventListener('mouseup', (e) => { if (e.button === 2) S.gunHeld = false; });
addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyM' && !e.repeat) { AU.toggleMute(); return; }
  if (!isCombat()) return;
  if (e.code === 'KeyP' || e.code === 'Escape') { S.paused = !S.paused; S.gunHeld = false; return; }
  if (S.paused) return;
  if (e.code === 'Space') S.gunHeld = true;
  else if (e.code === 'KeyF' && !e.repeat) deployFlares();
  else if (e.code === 'KeyV' && !e.repeat) {
    if (S.phase === 'feetdry' || S.phase === 'bomb') setView(S.view === 'tgp' ? 'cockpit' : 'tgp');
    else toast('POD NOT AVAILABLE', '#ffd27a', 1);
  } else if ((e.code === 'KeyG' || e.code === 'KeyH') && !e.repeat) {
    if (S.phase !== 'approach') { toast('NOT NOW', '#ffd27a', 0.8); return; }
    if (e.code === 'KeyG') { S.gearDown = !S.gearDown; toast(S.gearDown ? 'GEAR DOWN' : 'GEAR UP', '#9dffb0', 1); }
    else { S.hookDown = !S.hookDown; toast(S.hookDown ? 'HOOK DOWN' : 'HOOK UP', '#9dffb0', 1); }
    AU.beep(600, 0.08, 'square', 0.05); AU.noise(0.6, 0.12, 400);
  }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') S.gunHeld = false; });
addEventListener('blur', () => { if (isCombat()) S.paused = true; S.gunHeld = false; });

document.getElementById('startBtn').addEventListener('click', () => {
  AU.init();
  document.getElementById('brief').classList.add('hidden');
  document.body.classList.add('playing');
  S.startT = S.t;
  setPhase('launch');
});
document.getElementById('againBtn').addEventListener('click', () => location.reload());
// the mute button must never leak clicks into gameplay (firing, bombing)
muteBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); AU.toggleMute(); muteBtn.blur(); });
AU.setMuted(AU.muted);

// ---------------------------------------------------------------- loop
S.minRem = 99;
updateJet(0);
updateChunks(true);
if (THREE.EffectComposer && THREE.UnrealBloomPass) {
  const rt = renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget
    ? new THREE.WebGLMultisampleRenderTarget(W * DPR, H * DPR, { format: THREE.RGBAFormat }) : undefined;
  composer = new THREE.EffectComposer(renderer, rt);
  composer.addPass(new THREE.RenderPass(scene, camera));
  cockpitPass = new THREE.RenderPass(cockpitScene, cockpitCam);
  cockpitPass.clear = false; cockpitPass.clearDepth = true;
  composer.addPass(cockpitPass);
  bloom = new THREE.UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.5, 0.45, 0.85);
  composer.addPass(bloom);
  bloom.basic.toneMapped = false; // scene is already tone-mapped; don't map it twice on the final copy
  resize();
}
function render() {
  const pod = S.view === 'tgp';
  if (composer) {
    cockpitPass.enabled = S.view === 'cockpit';
    bloom.strength = pod ? 0.9 : 0.42; bloom.threshold = pod ? 0.55 : 0.93;
    composer.render();
  } else {
    renderer.autoClear = true;
    renderer.render(scene, camera);
    if (S.view === 'cockpit') { renderer.autoClear = false; renderer.clearDepth(); renderer.render(cockpitScene, cockpitCam); }
  }
}
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = S.paused ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dt > 0) update(dt);
  updateCamera();
  render();
  drawHUD();
}
requestAnimationFrame(frame);
// debug hooks (console): __dbg.skipTo('feetdry')
window.__S = S;
window.__dbg = {
  skipTo(p) {
    for (const e of S.enemies) removeEnemy(e);
    Object.assign(S, { enemies: [], scriptSpeed: false, yBlend: 0, customVy: 0, gearDown: false, burner: false });
    if (S.view === 'ext') setView('cockpit');
    setPhase(p);
  },
  view: setView,
  fx: () => ({ composer, bloom, renderer }),
};
})();
