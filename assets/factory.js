/* Digital Factory — plant + living mirror
   A factory floor of cells, conveyors and AGVs, overlaid with its virtual twin. */
(function () {
  'use strict';

  var CYAN = 0x62ecff;
  var ORANGE = 0xffa46b;
  var WARM = 0xffc99a;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var stage = document.getElementById('stage');
  var boot = document.getElementById('boot');
  var clockEl = document.getElementById('clock');
  var uiToggle = document.getElementById('ui-toggle');
  var dragHint = document.getElementById('drag-hint');
  var modeInd = document.getElementById('mode-ind');
  var modeTxt = document.getElementById('mode-txt');

  var hotspotEls = {};
  Array.prototype.forEach.call(document.querySelectorAll('.hotspot'), function (el) {
    hotspotEls[el.getAttribute('data-spot')] = el;
  });
  var hA = document.getElementById('h-a');
  var hAgv = document.getElementById('h-agv');
  var hDev = document.getElementById('h-dev');

  var renderer, scene, camera, clock;
  var edgeMat, glassMat;
  var machines = [];
  var armUnits = [];
  var agvs = [];
  var packets = [];
  var labels = [];
  var scanPlane, scanEdge;
  var burstGroup, burstRings = [];
  var floorHits;
  var raycaster = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2(-2, -2);

  var tmpA = new THREE.Vector3();
  var tmpB = new THREE.Vector3();

  var state = {
    mx: 0,
    my: 0,
    tmx: 0,
    tmy: 0,
    time: 0,
    idle: 0
  };

  var orbit = {
    az: 0.66,
    pol: 0.86,
    r: 45,
    taz: 0.66,
    tpol: 0.86,
    tr: 45
  };

  var drag = { active: false, moved: false, x: 0, y: 0, az: 0, pol: 0 };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------------------------------------------------------- */
  /* Textures                                                          */
  /* ---------------------------------------------------------------- */

  function makeGlowTexture() {
    var size = 64;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.2)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function makeEnvTexture() {
    var c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#20323a');
    grad.addColorStop(0.45, '#0a1116');
    grad.addColorStop(0.55, '#0c171c');
    grad.addColorStop(1, '#020406');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);

    function band(x, y, w, h, color) {
      g.save();
      try { g.filter = 'blur(40px)'; } catch (e) { /* noop */ }
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
      g.restore();
    }
    band(70, 120, 280, 24, 'rgba(255,206,160,0.5)');
    band(600, 90, 320, 20, 'rgba(98,236,255,0.3)');
    band(420, 250, 220, 14, 'rgba(98,236,255,0.3)');
    band(880, 330, 120, 16, 'rgba(255,196,140,0.16)');

    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function makeConcreteTexture() {
    var size = 512;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    g.fillStyle = '#33363a';
    g.fillRect(0, 0, size, size);
    for (var i = 0; i < 9000; i++) {
      var x = Math.random() * size;
      var y = Math.random() * size;
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(x, y, 2, 2);
    }
    for (var j = 0; j < 18; j++) {
      var r = 30 + Math.random() * 90;
      var cx = Math.random() * size;
      var cy = Math.random() * size;
      var rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, 'rgba(0,0,0,0.05)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function makeLabelTexture(text, color) {
    var c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.font = '500 44px "JetBrains Mono", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color || 'rgba(98,236,255,0.75)';
    g.fillText(text, 256, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  var glowTexture = makeGlowTexture();

  /* ---------------------------------------------------------------- */
  /* Setup                                                             */
  /* ---------------------------------------------------------------- */

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04070a);
    scene.fog = new THREE.FogExp2(0x04070a, 0.0095);
    scene.environment = makeEnvTexture();

    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);

    buildMaterials();
    addLights();
    buildGround();
    buildPlant();
    buildPackets();
    buildScan();
    buildBurst();

    clock = new THREE.Clock();
    bindEvents();
    onResize();
    animate();

    requestAnimationFrame(function () {
      setTimeout(function () {
        if (boot) boot.classList.add('done');
      }, 300);
    });
  }

  function buildMaterials() {
    edgeMat = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.42, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    glassMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.16, depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    window.FM = {
      dark: new THREE.MeshStandardMaterial({ color: 0x232a2f, metalness: 0.72, roughness: 0.48 }),
      body: new THREE.MeshStandardMaterial({ color: 0x8d979d, metalness: 0.9, roughness: 0.38 }),
      panel: new THREE.MeshStandardMaterial({ color: 0x39434a, metalness: 0.6, roughness: 0.5 }),
      warm: new THREE.MeshStandardMaterial({
        color: 0x5a3a1c, metalness: 0.4, roughness: 0.42,
        emissive: WARM, emissiveIntensity: 0.55
      })
    };
  }

  function addLights() {
    scene.add(new THREE.HemisphereLight(0x93acba, 0x040507, 0.42));

    var key = new THREE.DirectionalLight(0xffd9b4, 1.35);
    key.position.set(-14, 22, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -22;
    key.shadow.camera.right = 22;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    key.shadow.camera.far = 60;
    key.shadow.bias = -0.0006;
    scene.add(key);

    var rim = new THREE.SpotLight(0xffc98f, 2.2, 46, Math.PI / 4, 0.7, 1.1);
    rim.position.set(10, 20, 14);
    rim.target.position.set(0, 0, 0);
    scene.add(rim);
    scene.add(rim.target);

    var c1 = new THREE.PointLight(CYAN, 3.0, 42, 2);
    c1.position.set(-14, 7, -10);
    scene.add(c1);

    var c2 = new THREE.PointLight(CYAN, 2.4, 38, 2);
    c2.position.set(14, 6, 8);
    scene.add(c2);

    var c3 = new THREE.PointLight(ORANGE, 1.6, 26, 2);
    c3.position.set(0, 4, -10);
    scene.add(c3);
  }

  function buildGround() {
    var base = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: 0x030507, metalness: 0.5, roughness: 0.7 })
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.03;
    scene.add(base);

    /* soft cyan halo under the plant so it sits in the dark */
    var halo = new THREE.Mesh(
      new THREE.PlaneGeometry(76, 56),
      new THREE.MeshBasicMaterial({
        map: glowTexture, color: 0x2f93ad, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.002;
    scene.add(halo);

    var slab = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 26),
      new THREE.MeshStandardMaterial({
        map: makeConcreteTexture(), color: 0x515559,
        metalness: 0.15, roughness: 0.82, envMapIntensity: 0.28
      })
    );
    slab.rotation.x = -Math.PI / 2;
    slab.receiveShadow = true;
    scene.add(slab);

    var gridMat = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    scene.add(makeGrid(-19, 19, -13, 13, 1, gridMat, 0.012));

    var gridMat2 = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    scene.add(makeGrid(-19, 19, -13, 13, 5, gridMat2, 0.014));

    /* safety lane around the AGV loop */
    lane(-20, -13.5, 20, 13.5, 0.13);

    /* zone pads */
    zonePad(-9.5, -4.5, 7.4, 5.4, 0x62ecff, 'LINE A');
    zonePad(-9.5, 4.2, 7.4, 5.2, 0x62ecff, 'LINE B');
    zonePad(9.2, -4.6, 7.2, 5.6, 0x62ecff, 'LINE C');
    zonePad(9.2, 4.6, 7.2, 5.2, 0x62ecff, 'WAREHOUSE');

    /* perimeter posts */
    for (var i = 0; i < 36; i++) {
      var a = (i / 36) * Math.PI * 2;
      var post = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.5, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x2a3238, metalness: 0.6, roughness: 0.5 })
      );
      post.position.set(Math.cos(a) * 20.5, 0.25, Math.sin(a) * 13.8);
      post.castShadow = true;
      scene.add(post);
    }
  }

  function makeGrid(x0, x1, z0, z1, step, mat, y) {
    var pts = [];
    for (var x = x0; x <= x1 + 0.001; x += step) pts.push(x, 0, z0, x, 0, z1);
    for (var z = z0; z <= z1 + 0.001; z += step) pts.push(x0, 0, z, x1, 0, z);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    var lines = new THREE.LineSegments(geo, mat);
    lines.position.y = y || 0.01;
    return lines;
  }

  function lane(x0, z0, x1, z1, opacity) {
    var pts = [x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1, x0, 0, z0];
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    var line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xb08a3a, transparent: true, opacity: opacity,
      depthWrite: false
    }));
    line.position.y = 0.016;
    scene.add(line);
  }

  function zonePad(x, z, w, d, color, text) {
    var mat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.03,
      depthWrite: false, side: THREE.DoubleSide
    });
    var pad = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.018, z);
    scene.add(pad);

    var borderPts = [
      x - w / 2, 0, z - d / 2, x + w / 2, 0, z - d / 2,
      x + w / 2, 0, z - d / 2, x + w / 2, 0, z + d / 2,
      x + w / 2, 0, z + d / 2, x - w / 2, 0, z + d / 2,
      x - w / 2, 0, z + d / 2, x - w / 2, 0, z - d / 2
    ];
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    var border = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: color, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    border.position.y = 0.02;
    scene.add(border);

    addFloorLabel(text, x, z + d / 2 - 0.7, 0.55);
  }

  function addFloorLabel(text, x, z, scale) {
    var tex = makeLabelTexture(text);
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.5,
      depthWrite: false, side: THREE.DoubleSide
    });
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(4 * (scale || 1), 1 * (scale || 1)), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.z = Math.PI;
    plane.position.set(x, 0.022, z);
    scene.add(plane);
    labels.push(plane);
  }

  /* ---------------------------------------------------------------- */
  /* Building blocks                                                   */
  /* ---------------------------------------------------------------- */

  function box(parent, w, h, d, x, y, z, mat) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function wire(mesh) {
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat));
    return mesh;
  }

  function beacon(parent, x, y, z, color) {
    var mat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mat;
  }

  /* ---------------------------------------------------------------- */
  /* Machines                                                          */
  /* ---------------------------------------------------------------- */

  function makeMachine(x, z, rot, scale, tone) {
    var g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot || 0;
    scene.add(g);

    var s = scale || 1;
    var plinth = wire(box(g, 2.4 * s, 0.22, 1.9 * s, 0, 0.11, 0, window.FM.dark));
    var cabinet = wire(box(g, 1.75 * s, 1.25 * s, 1.25 * s, 0, 0.22 + 0.62 * s, 0, window.FM.panel));

    var glass = new THREE.Mesh(new THREE.PlaneGeometry(1.05 * s, 0.46 * s), glassMat);
    glass.position.set(0, 0.95 * s, 0.64 * s);
    g.add(glass);

    box(g, 1.25 * s, 0.1 * s, 0.9 * s, 0, 1.24 * s, 0, window.FM.dark);
    box(g, 0.16 * s, 0.5 * s, 0.16 * s, -0.7 * s, 1.0 * s, -0.35 * s, window.FM.body);

    var bMat = beacon(g, 0.5 * s, 1.34 * s, 0.3 * s, tone === 'warm' ? WARM : CYAN);

    /* side status strip */
    var stripMat = new THREE.MeshBasicMaterial({
      color: tone === 'warm' ? ORANGE : CYAN, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6 * s, 0.03), stripMat);
    strip.position.set(-0.88 * s, 0.85 * s, 0.45 * s);
    g.add(strip);

    machines.push({ group: g, beaconMat: bMat, stripMat: stripMat, phase: Math.random() * 6 });
    return g;
  }

  /* small articulated arm for assembly cells */
  function makeMiniArm(parent, x, y, z, rotY) {
    var root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = rotY || 0;
    parent.add(root);

    wire(box(root, 1.0, 0.16, 1.0, 0, 0.08, 0, window.FM.dark));
    var turret = new THREE.Group();
    turret.position.y = 0.16;
    root.add(turret);
    box(turret, 0.5, 0.3, 0.5, 0, 0.15, 0, window.FM.body);

    var lower = new THREE.Group();
    lower.position.y = 0.3;
    turret.add(lower);
    wire(box(lower, 0.16, 0.9, 0.16, 0, 0.45, 0, window.FM.body));
    var elbow = new THREE.Group();
    elbow.position.y = 0.9;
    lower.add(elbow);
    wire(box(elbow, 0.13, 0.78, 0.13, 0, 0.39, 0, window.FM.body));
    var wrist = new THREE.Group();
    wrist.position.y = 0.78;
    elbow.add(wrist);
    wire(box(wrist, 0.2, 0.12, 0.2, 0, 0.06, 0, window.FM.warm));

    armUnits.push({ turret: turret, lower: lower, elbow: elbow, wrist: wrist, phase: Math.random() * 6 });
    return root;
  }

  function buildPlant() {
    /* LINE A — assembly, three cells with arms */
    var aPositions = [[-11.4, -4.9], [-8.9, -4.9], [-6.4, -4.9]];
    aPositions.forEach(function (p, i) {
      makeMachine(p[0], p[1], 0, 1, i === 2 ? 'warm' : 'cool');
      makeMiniArm(machines[i].group, 0.1, 1.28, -0.1, Math.PI);
    });

    /* LINE B — machining, two CNC cells */
    var bPositions = [[-11.4, 3.9], [-8.6, 3.9]];
    bPositions.forEach(function (p) {
      makeMachine(p[0], p[1], Math.PI, 1.05, 'cool');
    });

    /* LINE C — packing, three cells */
    var cPositions = [[7.2, -5.1], [9.9, -5.1], [12.4, -5.1]];
    cPositions.forEach(function (p, i) {
      makeMachine(p[0], p[1], 0, 0.95, i === 1 ? 'warm' : 'cool');
    });
    makeMiniArm(machines[5].group, 0.1, 1.22, -0.1, Math.PI);

    buildConveyor(-13.2, 13.4, -1.5);
    buildConveyor(-12.6, -6.2, 1.55);
    buildRacks();
    buildAgvs();
    buildDataBeams();

    /* floor hit plane for clicks */
    floorHits = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    floorHits.rotation.x = -Math.PI / 2;
    scene.add(floorHits);
  }

  /* ---------------------------------------------------------------- */
  /* Conveyor + crates                                                 */
  /* ---------------------------------------------------------------- */

  var conveyors = [];
  var crates = [];

  function buildConveyor(x0, x1, z) {
    var len = x1 - x0;
    var mid = (x0 + x1) / 2;
    var g = new THREE.Group();
    scene.add(g);

    var frame = wire(box(g, len, 0.16, 0.85, mid, 0.62, z, window.FM.dark));
    for (var leg = x0 + 0.6; leg < x1; leg += 2.4) {
      box(g, 0.08, 0.54, 0.08, leg, 0.28, z + 0.32, window.FM.panel);
      box(g, 0.08, 0.54, 0.08, leg, 0.28, z - 0.32, window.FM.panel);
    }

    var rollerMat = new THREE.MeshStandardMaterial({
      color: 0x6c777d, metalness: 0.9, roughness: 0.4
    });
    for (var rx = x0 + 0.35; rx < x1; rx += 0.55) {
      var roller = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.78, 8), rollerMat);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(rx, 0.7, z);
      g.add(roller);
    }

    conveyors.push({ x0: x0, x1: x1, z: z, speed: 0.9 + Math.random() * 0.3 });

    for (var i = 0; i < 5; i++) {
      var crate = wire(box(g, 0.42, 0.36, 0.42, x0, 0.9, z, window.FM.panel));
      crates.push({
        mesh: crate,
        conveyor: conveyors.length - 1,
        offset: Math.random() * len
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Warehouse racks                                                   */
  /* ---------------------------------------------------------------- */

  function buildRacks() {
    [[7.4, 4.6], [10.6, 4.6], [7.4, 6.6], [10.6, 6.6]].forEach(function (p) {
      var g = new THREE.Group();
      g.position.set(p[0], 0, p[1]);
      scene.add(g);

      for (var i = 0; i < 3; i++) {
        wire(box(g, 2.6, 0.09, 0.9, 0, 0.5 + i * 0.55, 0, window.FM.dark));
      }
      for (var s = -1; s <= 1; s += 2) {
        for (var t = -1; t <= 1; t += 2) {
          box(g, 0.09, 1.75, 0.09, s * 1.2, 0.87, t * 0.38, window.FM.body);
        }
      }
      for (var k = 0; k < 8; k++) {
        var bw = 0.3 + Math.random() * 0.2;
        wire(box(g, bw, 0.28, 0.5, -0.9 + (k % 4) * 0.6, 0.72 + Math.floor(k / 4) * 0.55, (Math.random() - 0.5) * 0.3, window.FM.panel));
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* AGVs                                                              */
  /* ---------------------------------------------------------------- */

  var agvCurve;

  function buildAgvs() {
    var pts = [
      new THREE.Vector3(-14.5, 0, -10.2),
      new THREE.Vector3(0, 0, -10.4),
      new THREE.Vector3(14.8, 0, -10.2),
      new THREE.Vector3(17.2, 0, -6.6),
      new THREE.Vector3(17.2, 0, 7.2),
      new THREE.Vector3(14.4, 0, 10.2),
      new THREE.Vector3(0, 0, 10.5),
      new THREE.Vector3(-14.8, 0, 10.2),
      new THREE.Vector3(-17.2, 0, 6.4),
      new THREE.Vector3(-17.2, 0, -6.4)
    ];
    agvCurve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35);

    var agvColors = [CYAN, ORANGE, CYAN, CYAN, ORANGE, CYAN];
    for (var i = 0; i < 6; i++) {
      var g = new THREE.Group();
      scene.add(g);

      wire(box(g, 1.25, 0.34, 0.82, 0, 0.2, 0, window.FM.body));
      box(g, 1.05, 0.08, 0.66, 0, 0.4, 0, window.FM.dark);

      var stripMat = new THREE.MeshBasicMaterial({
        color: agvColors[i], transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var strip = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.045, 0.06), stripMat);
      strip.position.set(0, 0.36, 0.36);
      g.add(strip);
      var strip2 = strip.clone();
      strip2.position.z = -0.36;
      g.add(strip2);

      var ringMat = new THREE.MeshBasicMaterial({
        color: agvColors[i], transparent: true, opacity: 0.25,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      var ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 32), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);

      agvs.push({
        group: g,
        u: i / 6 + Math.random() * 0.02,
        speed: 0.012 + Math.random() * 0.008,
        stripMat: stripMat,
        ringMat: ringMat
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Vertical data beams                                               */
  /* ---------------------------------------------------------------- */

  var beams = [];

  function buildDataBeams() {
    machines.forEach(function (m, i) {
      var p = new THREE.Vector3();
      m.group.getWorldPosition(p);
      p.y = 0;
      var mat = new THREE.MeshBasicMaterial({
        color: CYAN, transparent: true, opacity: 0.09,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.2, 6.4, 8, 1, true), mat);
      beam.position.set(p.x, 3.2, p.z);
      scene.add(beam);
      beams.push({ mesh: beam, mat: mat, phase: (i / machines.length) * Math.PI * 2 });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Packets                                                           */
  /* ---------------------------------------------------------------- */

  function buildPackets() {
    var hosts = [];
    machines.forEach(function (m) {
      m.group.getWorldPosition(tmpA);
      hosts.push(tmpA.clone().setY(1.2));
    });
    hosts.push(new THREE.Vector3(0, 1.0, 0));
    hosts.push(new THREE.Vector3(9, 1.4, 5.6));

    var count = reduceMotion ? 30 : 70;
    for (var i = 0; i < count; i++) {
      var hot = i % 8 === 0;
      var mat = new THREE.SpriteMaterial({
        map: glowTexture, color: hot ? ORANGE : CYAN,
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var sprite = new THREE.Sprite(mat);
      scene.add(sprite);
      packets.push({
        sprite: sprite,
        host: hosts[i % hosts.length],
        u: Math.random(),
        speed: 0.16 + Math.random() * 0.2,
        rise: 2.2 + Math.random() * 2.6,
        sway: Math.random() * Math.PI * 2
      });
    }
  }

  function updatePackets(dt, t) {
    packets.forEach(function (p) {
      p.u += dt * p.speed;
      if (p.u > 1) p.u -= 1;
      var u = p.u;
      p.sprite.position.set(
        p.host.x + Math.sin(u * 6 + p.sway) * 0.22,
        p.host.y + u * p.rise,
        p.host.z + Math.cos(u * 5 + p.sway) * 0.22
      );
      p.sprite.material.opacity = Math.sin(Math.PI * u) * 0.8;
      p.sprite.scale.setScalar(0.2 * (0.7 + 0.5 * Math.sin(Math.PI * u)));
    });
  }

  /* ---------------------------------------------------------------- */
  /* Scan curtain + burst                                              */
  /* ---------------------------------------------------------------- */

  function buildScan() {
    var mat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.02,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(38, 2.6), mat);
    scanPlane.position.set(0, 1.3, -14);
    scene.add(scanPlane);

    var edgeGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-19, 0, 0), new THREE.Vector3(19, 0, 0)
    ]);
    scanEdge = new THREE.Line(edgeGeo, new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    scanEdge.position.set(0, 0.05, -14);
    scene.add(scanEdge);
  }

  function buildBurst() {
    burstGroup = new THREE.Group();
    scene.add(burstGroup);
    for (var i = 0; i < 3; i++) {
      var mat = new THREE.MeshBasicMaterial({
        color: CYAN, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      var ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      burstGroup.add(ring);
      burstRings.push({ mesh: ring, mat: mat, life: 0, delay: i * 0.1 });
    }
  }

  function triggerBurst(point) {
    burstRings.forEach(function (r) {
      r.life = 1.2 + r.delay;
      if (point) {
        r.mesh.position.set(point.x, 0.04, point.z);
      } else {
        r.mesh.position.set(0, 0.04, 0);
      }
    });
    pushLog('operator ping — plant state queried');
  }

  /* ---------------------------------------------------------------- */
  /* Panel bindings                                                    */
  /* ---------------------------------------------------------------- */

  var valCache = {};
  var sparkState = {};
  var tpState = { canvas: null, ctx: null, data: [] };
  var axisRows = [];
  var dotEls = [];
  var logLinesEl = document.getElementById('log-lines');
  var sensorDotsEl = document.getElementById('sensor-dots');
  var pipeRate = document.getElementById('pipe-rate');
  var sampleRateEl = document.getElementById('sample-rate');
  var axesEl = document.getElementById('axes');
  var devValEl = document.getElementById('dev-val');
  var devBarEl = document.getElementById('dev-bar');

  var AXIS_LABELS = ['LINE A', 'LINE B', 'LINE C', 'AGV', 'WH', 'PWR'];
  var UTIL = [92, 78, 64, 88, 71, 66];

  var LOG_MSGS = [
    'line a · station 07 cycle complete in 42.6 s',
    'agv-03 dispatched to warehouse · route 2',
    'press 07 vibration 4.1 mm/s — watch list',
    'quality gate 3 · 0 defects in last 1 200 units',
    'energy peak shaved · 38 kw shifted to buffer',
    'edge cluster 04 · 8 160 points ingested',
    'twin re-solved · 14 820 assets · 18 ms',
    'line b · tool wear 68 % — schedule service',
    'wip 214 units · wip limit ok',
    'agv fleet charge · 6 of 8 above 60 %'
  ];

  function buildPanels() {
    AXIS_LABELS.forEach(function (label) {
      var row = document.createElement('div');
      row.className = 'axis-row';
      row.innerHTML = '<span>' + label + '</span><div class="track"><i></i></div><em>0.0%</em>';
      axesEl.appendChild(row);
      axisRows.push({ fill: row.querySelector('i'), val: row.querySelector('em') });
    });

    for (var i = 0; i < 36; i++) {
      var dot = document.createElement('i');
      dot.className = 'on';
      sensorDotsEl.appendChild(dot);
      dotEls.push(dot);
    }

    ['out', 'oee', 'pwr', 'def'].forEach(function (key) {
      var canvas = document.getElementById('sp-' + key);
      sparkState[key] = { canvas: canvas, ctx: canvas.getContext('2d'), data: [] };
      for (var k = 0; k < 40; k++) sparkState[key].data.push(0.5 + Math.random() * 0.1);
    });

    var tpCanvas = document.getElementById('tp-chart');
    if (tpCanvas) {
      tpState.canvas = tpCanvas;
      tpState.ctx = tpCanvas.getContext('2d');
      for (var n = 0; n < 60; n++) tpState.data.push(0.55 + Math.random() * 0.2);
    }
  }

  function setVal(id, html) {
    if (valCache[id] === html) return;
    valCache[id] = html;
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function pushLog(text) {
    if (!logLinesEl) return;
    var line = document.createElement('div');
    line.className = 'log-line fresh';
    var d = new Date();
    line.innerHTML = '<em>' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      '</em><span>' + text + '</span>';
    logLinesEl.appendChild(line);
    while (logLinesEl.children.length > 3) {
      logLinesEl.removeChild(logLinesEl.firstChild);
    }
    Array.prototype.forEach.call(logLinesEl.children, function (el) {
      el.classList.remove('fresh');
    });
  }

  function drawSpark(key, color) {
    var s = sparkState[key];
    if (!s || !s.ctx) return;
    var ctx = s.ctx;
    var w = s.canvas.width;
    var h = s.canvas.height;
    var data = s.data;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(98, 236, 255, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 1);
    ctx.lineTo(w, h - 1);
    ctx.stroke();

    var min = Math.min.apply(null, data);
    var max = Math.max.apply(null, data);
    var span = Math.max(max - min, 0.0001);
    var pts = data.map(function (v, i) {
      return [(i / (data.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 9)];
    });

    ctx.beginPath();
    ctx.moveTo(pts[0][0], h);
    pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(w, h);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(98, 236, 255, 0.2)');
    grad.addColorStop(1, 'rgba(98, 236, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    var head = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(head[0], head[1], 1.8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawThroughput() {
    var ctx = tpState.ctx;
    if (!ctx) return;
    var w = tpState.canvas.width;
    var h = tpState.canvas.height;
    var data = tpState.data;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(98, 236, 255, 0.08)';
    ctx.lineWidth = 1;
    for (var g = 1; g <= 3; g++) {
      var gy = (h / 4) * g;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
    var pts = data.map(function (v, i) {
      return [(i / (data.length - 1)) * w, h - 6 - v * (h - 16)];
    });
    ctx.beginPath();
    ctx.moveTo(0, h);
    pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(w, h);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(98, 236, 255, 0.26)');
    grad.addColorStop(1, 'rgba(98, 236, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    ctx.strokeStyle = 'rgba(98, 236, 255, 0.85)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    var last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last[0], last[1], 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 164, 107, 0.95)';
    ctx.fill();
  }

  var uiAcc = 0;
  var logAcc = 0;
  var logIndex = 0;
  var lastSecond = -1;

  function updateUI(dt, t) {
    var now = new Date();
    if (now.getSeconds() !== lastSecond) {
      lastSecond = now.getSeconds();
      if (clockEl) {
        clockEl.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
      }
    }

    uiAcc += dt;
    logAcc += dt;
    if (logAcc > 3.6) {
      logAcc = 0;
      pushLog(LOG_MSGS[logIndex % LOG_MSGS.length]);
      logIndex++;
      var hitDot = dotEls[Math.floor(Math.random() * dotEls.length)];
      if (hitDot) {
        hitDot.classList.add('hit');
        setTimeout(function () { hitDot.classList.remove('hit'); }, 900);
      }
    }

    if (uiAcc < 0.16) return;
    uiAcc = 0;

    var sec = Date.now() / 1000;
    var out = 128 + Math.sin(sec / 9) * 6 + Math.sin(sec * 1.3) * 1.4;
    var oee = 86.2 + Math.sin(sec / 12) * 1.2;
    var pwr = 412 + Math.sin(sec / 7) * 14;
    var def = 0.42 + Math.sin(sec / 15) * 0.05;

    setVal('k-out', Math.round(out) + '<i>units/h</i>');
    setVal('k-oee', oee.toFixed(1) + '<i>%</i>');
    setVal('k-pwr', Math.round(pwr) + '<i>kW</i>');
    setVal('k-def', def.toFixed(2) + '<i>%</i>');
    setVal('sync-val', drag.active ? '99.62 %' : '99.97 %');

    sparkState.out.data.push(out / 150);
    sparkState.oee.data.push(oee / 100);
    sparkState.pwr.data.push(pwr / 500);
    sparkState.def.data.push(def * 2);
    Object.keys(sparkState).forEach(function (key) {
      if (sparkState[key].data.length > 40) sparkState[key].data.shift();
    });
    drawSpark('out', 'rgba(98, 236, 255, 0.95)');
    drawSpark('oee', 'rgba(98, 236, 255, 0.95)');
    drawSpark('pwr', 'rgba(255, 164, 107, 0.95)');
    drawSpark('def', 'rgba(98, 236, 255, 0.95)');

    tpState.data.push(0.52 + Math.sin(sec / 2.8) * 0.1 + Math.random() * 0.14);
    if (tpState.data.length > 60) tpState.data.shift();
    drawThroughput();

    for (var i = 0; i < axisRows.length; i++) {
      var v = clamp(UTIL[i] + Math.sin(sec / 6 + i) * 2, 0, 100);
      axisRows[i].fill.style.left = '0%';
      axisRows[i].fill.style.width = v + '%';
      axisRows[i].val.textContent = v.toFixed(1) + '%';
    }

    var dev = 0.018 + (drag.active ? 0.005 : 0) + Math.sin(sec / 3) * 0.002;
    if (devValEl) devValEl.textContent = dev.toFixed(3);
    if (devBarEl) devBarEl.style.width = clamp((dev / 0.03) * 100, 8, 96) + '%';
    if (hDev) hDev.textContent = Math.round(dev * 1000) + ' ms lag';
    if (hA) hA.textContent = (UTIL[0] + Math.sin(sec / 6) * 2).toFixed(1) + '% · RUNNING';
    if (hAgv) hAgv.textContent = '6 / 8 · ROUTE 2';

    var rate = 8100 + Math.round(Math.sin(sec / 2.4) * 120 + Math.random() * 40);
    if (sampleRateEl) sampleRateEl.textContent = String(rate).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (pipeRate) pipeRate.textContent = (rate / 1000).toFixed(1) + 'K/s';
  }

  /* ---------------------------------------------------------------- */
  /* Animation                                                         */
  /* ---------------------------------------------------------------- */

  function updatePlant(dt, t) {
    machines.forEach(function (m, i) {
      var p = 0.55 + Math.sin(t * 1.7 + m.phase) * 0.35;
      m.beaconMat.opacity = p;
      m.stripMat.opacity = 0.22 + p * 0.25;
    });

    armUnits.forEach(function (a) {
      a.turret.rotation.y = Math.sin(t * 0.35 + a.phase) * 0.7;
      a.lower.rotation.z = 0.25 + Math.sin(t * 0.5 + a.phase) * 0.22;
      a.elbow.rotation.z = -0.7 + Math.sin(t * 0.62 + a.phase) * 0.3;
    });

    conveyors.forEach(function (c, ci) {
      crates.forEach(function (cr) {
        if (cr.conveyor !== ci) return;
        var len = c.x1 - c.x0;
        var x = c.x0 + ((cr.offset + t * c.speed) % len);
        cr.mesh.position.x = x;
        cr.mesh.rotation.y = 0;
      });
    });

    agvs.forEach(function (a) {
      a.u = (a.u + a.speed * dt * 0.06) % 1;
      var pos = agvCurve.getPointAt(a.u);
      var tan = agvCurve.getTangentAt(a.u);
      a.group.position.set(pos.x, 0, pos.z);
      a.group.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI / 2;
      a.stripMat.opacity = 0.65 + Math.sin(t * 3 + a.u * 10) * 0.25;
      a.ringMat.opacity = 0.18 + Math.sin(t * 2 + a.u * 14) * 0.1;
    });

    beams.forEach(function (b) {
      b.mat.opacity = 0.06 + (0.5 + Math.sin(t * 1.4 + b.phase)) * 0.085;
    });

    if (!reduceMotion) {
      var z = -14 + ((t * 1.6) % 28);
      scanPlane.position.z = z;
      scanPlane.material.opacity = 0.014 + Math.sin((z + 14) / 28 * Math.PI) * 0.018;
      scanEdge.position.z = z;
      scanEdge.material.opacity = 0.28 + Math.sin((z + 14) / 28 * Math.PI) * 0.35;
    }

    burstRings.forEach(function (r) {
      r.life = Math.max(0, r.life - dt);
      var vis = r.life > 0;
      r.mesh.visible = vis;
      if (vis) {
        var k = 1 - r.life / 1.2;
        r.mesh.scale.setScalar(1 + k * 6);
        r.mat.opacity = clamp(r.life, 0, 1) * 0.35;
      }
    });
  }

  function updateCamera(dt) {
    if (!drag.active) {
      state.idle += dt;
      if (state.idle > 6 && !reduceMotion) orbit.taz += dt * 0.032;
    }
    orbit.az += (orbit.taz - orbit.az) * Math.min(1, dt * 4);
    orbit.pol += (orbit.tpol - orbit.pol) * Math.min(1, dt * 4);
    orbit.r += (orbit.tr - orbit.r) * Math.min(1, dt * 3);

    var aspect = window.innerWidth / window.innerHeight;
    var r = orbit.r * (aspect < 1 ? 1.62 : (aspect < 1.35 ? 1.15 : 1));
    var hx = Math.sin(orbit.az) * Math.cos(orbit.pol) * r;
    var hz = Math.cos(orbit.az) * Math.cos(orbit.pol) * r;
    camera.position.set(hx, 1.6 + Math.sin(orbit.pol) * r, hz);
    camera.lookAt(0, 0.9, 0);
  }

  /* ---------------------------------------------------------------- */
  /* Hotspots                                                          */
  /* ---------------------------------------------------------------- */

  var viewEl = document.querySelector('.view');
  var projV = new THREE.Vector3();
  var hotTmp = new THREE.Vector3();

  function placeHotspot(el, worldPos, ox, oy, side) {
    if (!el || !viewEl) return;
    var rect = viewEl.getBoundingClientRect();
    projV.copy(worldPos).project(camera);
    var visible = projV.z < 1;
    el.style.opacity = visible ? 1 : 0;
    if (!visible) return;
    var x = (projV.x * 0.5 + 0.5) * window.innerWidth - rect.left + ox;
    var y = (-projV.y * 0.5 + 0.5) * window.innerHeight - rect.top + oy;
    var w = el.offsetWidth || 120;
    var h = el.offsetHeight || 32;
    var flip = side === true ? true : (side === false ? false : x > rect.width * 0.56);
    if (flip && x - w < 6) flip = false;
    if (!flip && x + w > rect.width - 6) flip = true;
    x = clamp(x, 6, rect.width - 6);
    y = clamp(y, 6, rect.height - h - 6);
    el.classList.toggle('flip', flip);
    el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)' +
      (flip ? ' translateX(-100%)' : '');
  }

  function updateHotspots() {
    var narrow = window.innerWidth < 760;
    machines[1].group.getWorldPosition(hotTmp);
    hotTmp.y += 2.4;
    placeHotspot(hotspotEls.lineA, hotTmp, narrow ? 10 : 26, -10, false);

    agvs[2].group.getWorldPosition(hotTmp);
    hotTmp.y += 1.2;
    placeHotspot(hotspotEls.agv, hotTmp, narrow ? -10 : 18, -6, narrow ? null : false);

    hotTmp.set(0, 2.8, 0);
    placeHotspot(hotspotEls.dev, hotTmp, narrow ? 8 : 40, narrow ? 40 : 54, false);
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  function setMode(on) {
    if (!modeInd) return;
    modeInd.classList.toggle('teach', on);
    if (modeTxt) modeTxt.textContent = on ? 'ORBIT' : 'LIVE';
  }

  function bindEvents() {
    window.addEventListener('resize', onResize);

    window.addEventListener('pointermove', function (e) {
      if (!drag.active) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      orbit.taz = drag.az - dx * 0.006;
      orbit.tpol = clamp(drag.pol + dy * 0.0045, 0.48, 1.16);
      state.idle = 0;
    }, { passive: true });

    renderer.domElement.addEventListener('pointerdown', function (e) {
      drag.active = true;
      drag.moved = false;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.az = orbit.taz;
      drag.pol = orbit.tpol;
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      document.body.classList.add('teaching');
      document.body.style.cursor = 'grabbing';
      setMode(true);
      if (dragHint) dragHint.classList.add('off');
      state.idle = 0;
    });

    window.addEventListener('pointerup', function (e) {
      if (!drag.active) return;
      drag.active = false;
      document.body.classList.remove('teaching');
      document.body.style.cursor = '';
      setMode(false);
      state.idle = 0;
      if (!drag.moved) {
        pointerNdc.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          -(e.clientY / window.innerHeight) * 2 + 1
        );
        raycaster.setFromCamera(pointerNdc, camera);
        var hits = raycaster.intersectObject(floorHits, false);
        triggerBurst(hits.length ? hits[0].point : null);
      }
    });
    window.addEventListener('pointercancel', function () {
      drag.active = false;
      document.body.classList.remove('teaching');
      document.body.style.cursor = '';
      setMode(false);
    });

    renderer.domElement.addEventListener('wheel', function (e) {
      e.preventDefault();
      orbit.tr = clamp(orbit.tr + e.deltaY * 0.045, 30, 74);
      state.idle = 0;
    }, { passive: false });

    renderer.domElement.addEventListener('pointermove', function () {
      if (!drag.active) document.body.style.cursor = 'grab';
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'h' || e.key === 'H') {
        document.body.classList.toggle('clean');
        if (uiToggle) {
          uiToggle.textContent = document.body.classList.contains('clean')
            ? 'SHOW UI · H' : 'CLEAN UI · H';
        }
      }
    });

    if (uiToggle) {
      uiToggle.addEventListener('click', function () {
        document.body.classList.toggle('clean');
        uiToggle.textContent = document.body.classList.contains('clean')
          ? 'SHOW UI · H' : 'CLEAN UI · H';
      });
    }
  }

  function onResize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 46 : (camera.aspect < 1.35 ? 40 : 36);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
  }

  /* ---------------------------------------------------------------- */
  /* Loop + boot                                                       */
  /* ---------------------------------------------------------------- */

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = reduceMotion ? 0 : clock.elapsedTime;

    updatePlant(dt, t);
    updatePackets(dt, t);
    updateCamera(dt);
    updateHotspots();
    updateUI(dt, t);

    renderer.render(scene, camera);
  }

  try {
    buildPanels();
    init();
    pushLog('plant mirror online — cell-04 · twin v3.1.0');
  } catch (err) {
    if (window.console) console.warn('3D scene unavailable:', err);
    if (boot) boot.classList.add('done');
    if (stage) {
      stage.style.background =
        'radial-gradient(ellipse at 52% 46%, rgba(98,236,255,0.16), transparent 62%), #04070a';
    }
  }
})();
