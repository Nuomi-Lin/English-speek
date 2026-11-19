/* Digital Twin — control room
   One physical robot cell, its live virtual copy, and the data between them. */
(function () {
  'use strict';

  var CYAN = 0x62ecff;
  var ORANGE = 0xffa46b;
  var WARM = 0xffc99a;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;

  var stage = document.getElementById('stage');
  var boot = document.getElementById('boot');
  var clockEl = document.getElementById('clock');
  var uiToggle = document.getElementById('ui-toggle');

  var hotspotEls = {};
  Array.prototype.forEach.call(document.querySelectorAll('.hotspot'), function (el) {
    hotspotEls[el.getAttribute('data-spot')] = el;
  });
  var hJ2 = document.getElementById('h-j2');
  var hJ4 = document.getElementById('h-j4');
  var hDev = document.getElementById('h-dev');

  var renderer, scene, camera, clock;
  var physRoot, holoRoot, physJoints, holoJoints;
  var holoMats = [];
  var scanMats = [];
  var scanRing;
  var floorRings = [];
  var packets = [];
  var dataCubes = [];
  var sensors = [];
  var burstGroup, burstRings = [];
  var hitProxy;
  var dust, dustPositions, dustPhase;
  var ray = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2(-2, -2);

  var tmpA = new THREE.Vector3();
  var tmpB = new THREE.Vector3();

  var state = {
    mx: 0,
    my: 0,
    tmx: 0,
    tmy: 0,
    burst: 0,
    time: 0,
    yaw: 0,
    tilt: 0
  };

  var drag = {
    active: false,
    moved: false,
    x: 0,
    y: 0,
    yaw: 0,
    tilt: 0,
    hold: 0
  };
  var ghostYaw = 0;
  var ghostTilt = 0;
  var modeInd = document.getElementById('mode-ind');
  var modeTxt = document.getElementById('mode-txt');
  var dragHint = document.getElementById('drag-hint');

  function setMode(teach) {
    if (!modeInd) return;
    modeInd.classList.toggle('teach', teach);
    if (modeTxt) modeTxt.textContent = teach ? 'TEACH' : 'LIVE';
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

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
    grd.addColorStop(0.18, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.22)');
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
    grad.addColorStop(0, '#1a2a32');
    grad.addColorStop(0.42, '#0a1116');
    grad.addColorStop(0.55, '#0d1a20');
    grad.addColorStop(1, '#020406');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);

    function band(x, y, w, h, color) {
      g.save();
      try { g.filter = 'blur(38px)'; } catch (e) { /* noop */ }
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
      g.restore();
    }
    band(80, 110, 250, 26, 'rgba(255,206,160,0.55)');
    band(620, 90, 300, 22, 'rgba(98,236,255,0.3)');
    band(430, 250, 200, 14, 'rgba(98,236,255,0.34)');
    band(860, 320, 130, 16, 'rgba(255,196,140,0.18)');

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
    g.fillStyle = '#2c2e32';
    g.fillRect(0, 0, size, size);
    for (var i = 0; i < 9000; i++) {
      var x = Math.random() * size;
      var y = Math.random() * size;
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(x, y, 1.8, 1.8);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  var glowTexture = makeGlowTexture();

  /* ---------------------------------------------------------------- */
  /* Materials                                                         */
  /* ---------------------------------------------------------------- */

  var physMats, holoSurface, holoLine, holoWire, holoAccent;

  function buildMaterials() {
    physMats = {
      steel: new THREE.MeshStandardMaterial({
        color: 0xa6b0b6, metalness: 0.93, roughness: 0.34, envMapIntensity: 1.0
      }),
      dark: new THREE.MeshStandardMaterial({
        color: 0x22282c, metalness: 0.8, roughness: 0.44, envMapIntensity: 0.75
      }),
      accent: new THREE.MeshStandardMaterial({
        color: 0x5a3a1c, metalness: 0.4, roughness: 0.42,
        emissive: WARM, emissiveIntensity: 0.55
      })
    };

    holoSurface = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.075, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending
    });
    holoLine = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.78, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    holoWire = new THREE.MeshBasicMaterial({
      color: CYAN, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    holoAccent = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    [holoSurface, holoLine, holoWire, holoAccent].forEach(function (m) {
      m.userData.base = m.opacity;
      holoMats.push(m);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Robot arm — 6 axis cell                                           */
  /* ---------------------------------------------------------------- */

  function buildArm(holo) {
    var root = new THREE.Group();
    var joints = {};

    function add(geo, kind, opts) {
      opts = opts || {};
      var mat;
      if (holo) {
        mat = kind === 'accent' ? holoAccent : holoSurface;
      } else {
        mat = physMats[kind] || physMats.steel;
      }
      var mesh = new THREE.Mesh(geo, mat);
      if (opts.p) mesh.position.set(opts.p[0], opts.p[1], opts.p[2]);
      if (opts.r) mesh.rotation.set(opts.r[0], opts.r[1], opts.r[2]);
      (opts.parent || root).add(mesh);

      if (holo) {
        if (opts.edges !== false) {
          mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), holoLine));
        }
        if (kind !== 'accent' && opts.wire !== false) {
          mesh.add(new THREE.Mesh(geo, holoWire));
        }
      } else {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      return mesh;
    }

    /* base plate + bolts + pedestal */
    add(new THREE.CylinderGeometry(0.64, 0.70, 0.10, 48), 'dark', { p: [0, 0.05, 0] });
    for (var b = 0; b < 8; b++) {
      var ba = (b / 8) * Math.PI * 2;
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), 'accent', {
        p: [Math.cos(ba) * 0.55, 0.115, Math.sin(ba) * 0.55],
        edges: false, wire: false
      });
    }
    add(new THREE.CylinderGeometry(0.36, 0.46, 0.44, 36), 'steel', { p: [0, 0.31, 0] });
    for (var r = 0; r < 6; r++) {
      var ra = (r / 6) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.05, 0.34, 0.13), 'dark', {
        p: [Math.cos(ra) * 0.42, 0.31, Math.sin(ra) * 0.42],
        r: [0, -ra, 0],
        edges: false
      });
    }
    add(new THREE.BoxGeometry(0.14, 0.12, 0.14), 'dark', { p: [0.26, 0.42, -0.22], edges: false });

    var baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.49, 0.007, 8, 64),
      new THREE.MeshBasicMaterial({
        color: holo ? CYAN : WARM, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.105;
    root.add(baseRing);
    if (holo) { baseRing.material.userData.base = 0.45; holoMats.push(baseRing.material); }

    /* turret */
    var turret = new THREE.Group();
    turret.position.y = 0.54;
    root.add(turret);
    add(new THREE.CylinderGeometry(0.30, 0.34, 0.24, 32), 'steel', { p: [0, 0.12, 0], parent: turret });
    add(new THREE.BoxGeometry(0.44, 0.20, 0.34), 'dark', { p: [0, 0.27, 0], parent: turret });
    add(new THREE.BoxGeometry(0.06, 0.32, 0.26), 'dark', { p: [0.23, 0.30, 0], parent: turret, edges: false });
    add(new THREE.BoxGeometry(0.06, 0.32, 0.26), 'dark', { p: [-0.23, 0.30, 0], parent: turret, edges: false });
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.34, 24), 'steel', {
      p: [0, 0.30, 0], r: [Math.PI / 2, 0, 0], parent: turret
    });
    var shoulderGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.115, 0.007, 8, 40),
      new THREE.MeshBasicMaterial({
        color: holo ? CYAN : WARM, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    shoulderGlow.position.set(0, 0.30, 0.176);
    turret.add(shoulderGlow);
    if (holo) { shoulderGlow.material.userData.base = 0.5; holoMats.push(shoulderGlow.material); }

    var shoulder = new THREE.Group();
    shoulder.position.y = 0.30;
    turret.add(shoulder);

    var lower = new THREE.Group();
    shoulder.add(lower);
    joints.lower = lower;

    add(new THREE.CylinderGeometry(0.052, 0.058, 1.12, 18), 'steel', { p: [0.085, 0.56, 0], parent: lower });
    add(new THREE.CylinderGeometry(0.052, 0.058, 1.12, 18), 'steel', { p: [-0.085, 0.56, 0], parent: lower });
    add(new THREE.BoxGeometry(0.28, 0.05, 0.14), 'dark', { p: [0, 0.22, 0], parent: lower, edges: false });
    add(new THREE.BoxGeometry(0.28, 0.05, 0.14), 'dark', { p: [0, 0.58, 0], parent: lower, edges: false });
    add(new THREE.BoxGeometry(0.28, 0.05, 0.14), 'dark', { p: [0, 0.94, 0], parent: lower, edges: false });
    var cable = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.15, 0.10, -0.03),
      new THREE.Vector3(0.19, 0.42, -0.10),
      new THREE.Vector3(0.15, 0.80, -0.09),
      new THREE.Vector3(0.08, 1.06, -0.03)
    ]);
    add(new THREE.TubeGeometry(cable, 24, 0.018, 6, false), 'dark', { parent: lower, edges: false });

    var elbow = new THREE.Group();
    elbow.position.y = 1.12;
    lower.add(elbow);
    joints.elbow = elbow;
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.30, 24), 'steel', {
      p: [0, 0, 0], r: [Math.PI / 2, 0, 0], parent: elbow
    });
    var elbowGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.095, 0.006, 8, 36),
      new THREE.MeshBasicMaterial({
        color: holo ? CYAN : WARM, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    elbowGlow.position.set(0, 0, 0.156);
    elbow.add(elbowGlow);
    if (holo) { elbowGlow.material.userData.base = 0.42; holoMats.push(elbowGlow.material); }

    add(new THREE.CylinderGeometry(0.048, 0.054, 0.84, 18), 'steel', { p: [0.06, 0.42, 0], parent: elbow });
    add(new THREE.CylinderGeometry(0.048, 0.054, 0.84, 18), 'steel', { p: [-0.06, 0.42, 0], parent: elbow });
    add(new THREE.BoxGeometry(0.22, 0.05, 0.12), 'dark', { p: [0, 0.64, 0], parent: elbow, edges: false });

    var wrist = new THREE.Group();
    wrist.position.y = 0.84;
    elbow.add(wrist);
    joints.wrist = wrist;
    add(new THREE.SphereGeometry(0.10, 18, 12), 'steel', { parent: wrist });
    add(new THREE.CylinderGeometry(0.07, 0.08, 0.10, 18), 'dark', { p: [0, 0.10, 0], parent: wrist, edges: false });
    add(new THREE.BoxGeometry(0.20, 0.09, 0.12), 'dark', { p: [0, 0.18, 0], parent: wrist, edges: false });
    add(new THREE.BoxGeometry(0.04, 0.20, 0.05), 'steel', { p: [0.09, 0.30, 0], parent: wrist, edges: false });
    add(new THREE.BoxGeometry(0.04, 0.20, 0.05), 'steel', { p: [-0.09, 0.30, 0], parent: wrist, edges: false });
    add(new THREE.BoxGeometry(0.04, 0.05, 0.10), 'accent', { p: [0.09, 0.405, 0.02], parent: wrist, edges: false });
    add(new THREE.BoxGeometry(0.04, 0.05, 0.10), 'accent', { p: [-0.09, 0.405, 0.02], parent: wrist, edges: false });

    joints.turret = turret;
    root.userData = joints;
    return root;
  }

  /* ---------------------------------------------------------------- */
  /* Setup                                                             */
  /* ---------------------------------------------------------------- */

  function init() {
    buildMaterials();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04070a);
    scene.fog = new THREE.FogExp2(0x04070a, 0.032);
    scene.environment = makeEnvTexture();

    camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x04070a, 1);
    stage.appendChild(renderer.domElement);

    addLights();
    buildFloor();
    buildArmParts();
    addPackets();
    addAtmosphere();

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

  function addLights() {
    scene.add(new THREE.HemisphereLight(0x8fa6b4, 0x040507, 0.3));

    var key = new THREE.DirectionalLight(0xffd9b4, 1.35);
    key.position.set(-4.5, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -2;
    key.shadow.camera.far = 24;
    key.shadow.bias = -0.0006;
    scene.add(key);

    var rim = new THREE.SpotLight(0xffc98f, 2.4, 16, Math.PI / 5, 0.8, 1.2);
    rim.position.set(2.4, 6.4, 2.6);
    rim.target.position.set(0, 0.9, 0);
    rim.castShadow = true;
    rim.shadow.mapSize.set(1024, 1024);
    rim.shadow.bias = -0.0008;
    scene.add(rim);
    scene.add(rim.target);

    var cyanFill = new THREE.PointLight(CYAN, 3.4, 14, 2);
    cyanFill.position.set(-2.6, 2.8, -2.4);
    scene.add(cyanFill);

    var cyanRim = new THREE.PointLight(CYAN, 2.0, 12, 2);
    cyanRim.position.set(3.0, 1.8, 2.2);
    scene.add(cyanRim);
  }

  function buildFloor() {
    var base = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x030508, metalness: 0.55, roughness: 0.62 })
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.012;
    scene.add(base);

    var slab = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshStandardMaterial({
        map: makeConcreteTexture(), color: 0x6e7175,
        metalness: 0.05, roughness: 0.92, envMapIntensity: 0.3
      })
    );
    slab.rotation.x = -Math.PI / 2;
    slab.receiveShadow = true;
    scene.add(slab);

    /* safety lines */
    [[1.9, 0.5], [2.05, 0.25]].forEach(function (spec) {
      var line = new THREE.Mesh(
        new THREE.RingGeometry(spec[0], spec[0] + 0.05, 96),
        new THREE.MeshBasicMaterial({
          color: 0xb08a3a, transparent: true, opacity: spec[1],
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      line.rotation.x = -Math.PI / 2;
      line.position.y = 0.004;
      scene.add(line);
    });

    /* cyan survey grid */
    var gridMat = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    scene.add(makeGrid(-9, 9, -9, 9, 0.5, gridMat));

    var gridMat2 = new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    scene.add(makeGrid(-9, 9, -9, 9, 2, gridMat2));

    /* concentric rings — virtual overlay */
    [1.35, 2.4, 3.6].forEach(function (radius, i) {
      var mat = new THREE.MeshBasicMaterial({
        color: i === 1 ? ORANGE : CYAN, transparent: true, opacity: 0.22 - i * 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.012, 128), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.006 + i * 0.0004;
      scene.add(ring);
      floorRings.push({ mesh: ring, mat: mat, base: 0.22 - i * 0.05, speed: 0.06 + i * 0.02 });
    });

    /* radial ticks */
    var tickMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    for (var i = 0; i < 36; i++) {
      var a = (i / 36) * Math.PI * 2;
      var tick = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.001, i % 9 === 0 ? 0.22 : 0.1), tickMat);
      tick.position.set(Math.cos(a) * 2.52, 0.007, Math.sin(a) * 2.52);
      tick.rotation.y = -a;
      scene.add(tick);
    }

    /* faint vertical data wall behind the cell */
    var wallPts = [];
    for (var wx = -6; wx <= 6; wx += 0.5) wallPts.push(wx, 0.05, -5.2, wx, 5.2, -5.2);
    for (var wy = 0.05; wy <= 5.2; wy += 0.5) wallPts.push(-6, wy, -5.2, 6, wy, -5.2);
    var wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPts, 3));
    var wall = new THREE.LineSegments(wallGeo, new THREE.LineBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    scene.add(wall);
  }

  function makeGrid(x0, x1, z0, z1, step, mat) {
    var pts = [];
    for (var x = x0; x <= x1 + 0.001; x += step) pts.push(x, 0, z0, x, 0, z1);
    for (var z = z0; z <= z1 + 0.001; z += step) pts.push(x0, 0, z, x1, 0, z);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    var lines = new THREE.LineSegments(geo, mat);
    lines.position.y = 0.008;
    return lines;
  }

  /* ---------------------------------------------------------------- */
  /* The cell + its ghost                                             */
  /* ---------------------------------------------------------------- */

  var NODE_KEYS = ['turret', 'lower', 'elbow', 'wrist'];

  function buildArmParts() {
    physRoot = buildArm(false);
    physRoot.rotation.y = 0.3;
    scene.add(physRoot);
    physJoints = physRoot.userData;

    holoRoot = new THREE.Group();
    holoRoot.position.set(0.055, 0.03, 0.05);
    holoRoot.scale.setScalar(1.03);
    holoRoot.rotation.y = 0.3;
    scene.add(holoRoot);
    var holoArm = buildArm(true);
    holoRoot.add(holoArm);
    holoJoints = holoArm.userData;

    /* twin halo at the base — two counter-rotating rings */
    [1.02, 1.22].forEach(function (radius, i) {
      var mat = new THREE.MeshBasicMaterial({
        color: CYAN, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      mat.userData.base = 0.28;
      holoMats.push(mat);
      var halo = new THREE.Mesh(
        new THREE.TorusGeometry(radius, i ? 0.004 : 0.007, 6, 100), mat
      );
      halo.rotation.x = Math.PI / 2;
      halo.rotation.z = i * 0.4;
      halo.position.y = 0.02 + i * 0.03;
      halo.userData.spin = i ? -0.2 : 0.14;
      halo.userData.axis = 'z';
      holoRoot.add(halo);
      floorRings.push({ mesh: halo, mat: mat, base: 0.28, speed: 0 });
    });

    /* sensor nodes on the physical arm */
    var sensorSpecs = [
      { parent: physJoints.turret, p: [0.3, 0.43, 0.16] },
      { parent: physJoints.lower, p: [0.11, 0.72, 0.13] },
      { parent: physJoints.elbow, p: [0, 0.28, 0.17] },
      { parent: physJoints.wrist, p: [0, 0.06, 0.13] }
    ];
    sensorSpecs.forEach(function (spec) {
      var mat = new THREE.SpriteMaterial({
        map: glowTexture, color: WARM, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var sprite = new THREE.Sprite(mat);
      sprite.position.set(spec.p[0], spec.p[1], spec.p[2]);
      sprite.scale.setScalar(0.17);
      spec.parent.add(sprite);
      sensors.push(sprite);
    });

    /* sweeping scan ring */
    var scanMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    scanMats.push(scanMat);
    var scan = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.006, 6, 90), scanMat);
    scan.rotation.x = Math.PI / 2;
    scan.position.y = 0.2;
    scene.add(scan);
    scanRing = scan;

    /* a soft disc travels with the ring — a copier-like scan plane */
    var discMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.05, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    scanMats.push(discMat);
    var disc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 64), discMat);
    disc.rotation.x = -Math.PI / 2;
    scan.add(disc);

    /* invisible hit volume for click bursts */
    hitProxy = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 3.0, 12, 1, true),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitProxy.position.set(0, 1.4, 0);
    scene.add(hitProxy);

    /* floating model layers — three wireframe octahedra */
    var cubeSpecs = [
      { r: 1.9, y: 2.9, a: 0.4, s: 0.18, o: 0.28 },
      { r: 2.35, y: 3.35, a: 2.4, s: 0.13, o: 0.2 },
      { r: 2.05, y: 3.75, a: 4.4, s: 0.16, o: 0.15 }
    ];
    cubeSpecs.forEach(function (spec) {
      var mat = new THREE.MeshBasicMaterial({
        color: CYAN, wireframe: true, transparent: true, opacity: spec.o,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      mat.userData.base = spec.o;
      holoMats.push(mat);
      var cube = new THREE.Mesh(new THREE.OctahedronGeometry(spec.s, 0), mat);
      cube.position.set(Math.cos(spec.a) * spec.r, spec.y, Math.sin(spec.a) * spec.r);
      cube.userData.angle = spec.a;
      cube.userData.radius = spec.r;
      cube.userData.y = spec.y;
      cube.userData.spin = 0.2 + Math.random() * 0.2;
      scene.add(cube);
      dataCubes.push(cube);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Data particles rising from the joints                              */
  /* ---------------------------------------------------------------- */

  function addPackets() {
    var count = reduceMotion ? 22 : 46;
    for (var i = 0; i < count; i++) {
      var hot = i % 7 === 0;
      var mat = new THREE.SpriteMaterial({
        map: glowTexture,
        color: hot ? ORANGE : CYAN,
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(hot ? 0.1 : 0.075);
      scene.add(sprite);
      packets.push({
        sprite: sprite,
        joint: NODE_KEYS[i % NODE_KEYS.length],
        u: Math.random(),
        speed: 0.3 + Math.random() * 0.35,
        rise: 1.1 + Math.random() * 1.5,
        swirl: (Math.random() - 0.5) * 1.4,
        hot: hot
      });
    }
  }

  function updatePackets(dt, time) {
    packets.forEach(function (pk) {
      pk.u += dt * pk.speed;
      if (pk.u > 1) pk.u -= 1;

      var joint = physJoints[pk.joint];
      if (!joint) return;
      joint.getWorldPosition(tmpA);

      var u = pk.u;
      var lift = Math.sin(u * Math.PI * 0.5) * pk.rise;
      var swirl = Math.sin(u * Math.PI * 2 + time * 0.8) * 0.16 * pk.swirl;
      pk.sprite.position.set(
        tmpA.x + swirl + pk.swirl * 0.1 * u,
        tmpA.y + 0.06 + lift,
        tmpA.z + Math.cos(u * Math.PI * 2 + time * 0.8) * 0.12 * pk.swirl
      );

      var fade = Math.sin(Math.PI * u);
      pk.sprite.material.opacity = fade * (pk.hot ? 0.75 : 0.55);
      var s = (pk.hot ? 0.1 : 0.075) * (0.7 + 0.5 * fade);
      pk.sprite.scale.setScalar(s);
    });
  }

  function addAtmosphere() {
    var count = reduceMotion ? 60 : 150;
    var positions = new Float32Array(count * 3);
    dustPositions = positions;
    dustPhase = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 1] = Math.random() * 6 + 0.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
      dustPhase[i] = Math.random() * Math.PI * 2;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xbfe6f2, size: 0.02, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    dust = new THREE.Points(geo, mat);
    dust.frustumCulled = false;
    scene.add(dust);
  }

  /* ---------------------------------------------------------------- */
  /* Click burst                                                       */
  /* ---------------------------------------------------------------- */

  function initBurst() {
    burstGroup = new THREE.Group();
    scene.add(burstGroup);
    for (var i = 0; i < 3; i++) {
      var mat = new THREE.MeshBasicMaterial({
        color: CYAN, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      var ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.006, 6, 80), mat);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      burstGroup.add(ring);
      burstRings.push({ mesh: ring, mat: mat, life: 0, delay: i * 0.09 });
    }
  }

  function triggerBurst() {
    state.burst = 1;
    burstRings.forEach(function (r) { r.life = 1.15 + r.delay; });
    pushLog('operator ping — twin state queried');
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  function bindEvents() {
    initBurst();

    window.addEventListener('resize', onResize);

    window.addEventListener('pointermove', function (e) {
      if (drag.active) {
        var dx = e.clientX - drag.x;
        var dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        state.yaw = clamp(drag.yaw + dx * 0.0065, -1.15, 1.15);
        state.tilt = clamp(drag.tilt - dy * 0.0055, -0.5, 0.5);
        return;
      }

      state.tmx = (e.clientX / window.innerWidth) * 2 - 1;
      state.tmy = (e.clientY / window.innerHeight) * 2 - 1;
      pointerNdc.set(state.tmx, -state.tmy);
      ray.setFromCamera(pointerNdc, camera);
      var hit = ray.intersectObject(hitProxy, false);
      document.body.style.cursor = hit.length ? 'grab' : '';
    }, { passive: true });

    renderer.domElement.addEventListener('pointerdown', function (e) {
      pointerNdc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      ray.setFromCamera(pointerNdc, camera);
      if (!ray.intersectObject(hitProxy, false).length) return;

      drag.active = true;
      drag.moved = false;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.yaw = state.yaw;
      drag.tilt = state.tilt;
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }

      document.body.classList.add('teaching');
      document.body.style.cursor = 'grabbing';
      setMode(true);
      if (dragHint) dragHint.classList.add('off');
      pushLog('teach mode — manual joint override engaged');
    });

    function endDrag() {
      if (!drag.active) return;
      drag.active = false;
      drag.hold = 2.2;
      document.body.classList.remove('teaching');
      document.body.style.cursor = '';
      setMode(false);
      if (drag.moved) {
        pushLog('pose captured — twin re-synced 140 ms later');
      } else {
        triggerBurst();
      }
    }
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

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
    camera.fov = camera.aspect < 1 ? 52 : (camera.aspect < 1.35 ? 44 : 38);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
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
  var angles = [0, 0, 0, 0, 0, 0];

  var AXIS_LABELS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'];
  var LOG_MSGS = [
    'sensor 14 · bearing temp stable at 67.5 °c',
    'edge node flush · 2 412 packets buffered',
    'physics step 60 hz · residual 0.003 mm',
    'prognosis: gearbox b2 wear +1.2 % — watch',
    'twin mesh re-solved · 18 420 nodes',
    'anomaly score 0.12 · baseline ok',
    'kinematic chain verified · 6/6 axes',
    'model drift 0.014 s · within tolerance',
    'mqtt heartbeat · rtt 24 ms',
    'torque ripple detected on j3 · 0.4 %'
  ];

  function buildPanels() {
    AXIS_LABELS.forEach(function (label) {
      var row = document.createElement('div');
      row.className = 'axis-row';
      row.innerHTML = '<span>' + label + '</span><div class="track"><i></i></div><em>0.0\u00b0</em>';
      axesEl.appendChild(row);
      axisRows.push({ fill: row.querySelector('i'), val: row.querySelector('em') });
    });

    for (var i = 0; i < 24; i++) {
      var dot = document.createElement('i');
      dot.className = 'on';
      sensorDotsEl.appendChild(dot);
      dotEls.push(dot);
    }

    ['temp', 'vib', 'rpm', 'tq'].forEach(function (key) {
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
    grad.addColorStop(0, 'rgba(98, 236, 255, 0.28)');
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

  function setVal(id, html) {
    if (valCache[id] === html) return;
    valCache[id] = html;
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
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
      return [
        (i / (data.length - 1)) * w,
        h - 4 - ((v - min) / span) * (h - 9)
      ];
    });

    ctx.beginPath();
    ctx.moveTo(pts[0][0], h);
    pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(w, h);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(98, 236, 255, 0.22)');
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

  function pushLog(text) {
    if (!logLinesEl) return;
    var line = document.createElement('div');
    line.className = 'log-line fresh';
    var d = new Date();
    var stamp = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    line.innerHTML = '<em>' + stamp + '</em><span>' + text + '</span>';
    logLinesEl.appendChild(line);
    while (logLinesEl.children.length > 3) {
      logLinesEl.removeChild(logLinesEl.firstChild);
    }
    Array.prototype.forEach.call(logLinesEl.children, function (el) {
      el.classList.remove('fresh');
    });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  var uiAcc = 0;
  var logAcc = 0;
  var logIndex = 0;
  var lastSecond = -1;

  function updateUI(dt, time) {
    var now = new Date();
    if (now.getSeconds() !== lastSecond) {
      lastSecond = now.getSeconds();
      if (clockEl) {
        clockEl.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
      }
    }

    uiAcc += dt;
    logAcc += dt;

    if (logAcc > 3.4) {
      logAcc = 0;
      pushLog(LOG_MSGS[logIndex % LOG_MSGS.length]);
      logIndex++;
      var hit = dotEls[Math.floor(Math.random() * dotEls.length)];
      if (hit) {
        hit.classList.add('hit');
        setTimeout(function () { hit.classList.remove('hit'); }, 900);
      }
    }

    if (uiAcc < 0.16) return;
    uiAcc = 0;

    var t = Date.now() / 1000;
    var temp = 67.4 + Math.sin(t / 7) * 0.7 + Math.sin(t / 1.7) * 0.12;
    var vib = 2.05 + Math.sin(t / 3.1) * 0.16 + Math.sin(t * 1.9) * 0.03;
    var rpm = 1942 + Math.sin(t / 5.2) * 9 + Math.sin(t * 0.9) * 2;
    var tq = 78 + Math.sin(t / 4.4) * 3.2;

    setVal('k-temp', temp.toFixed(1) + '<i>\u00b0C</i>');
    setVal('k-vib', vib.toFixed(2) + '<i>mm/s</i>');
    setVal('k-rpm', String(Math.round(rpm)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '<i>rpm</i>');
    setVal('k-tq', Math.round(tq) + '<i>%</i>');
    setVal('sync-val', drag.active ? '99.21 %' : '99.98 %');

    sparkState.temp.data.push((temp - 66) / 3);
    sparkState.vib.data.push((vib - 1.8) / 0.5);
    sparkState.rpm.data.push((rpm - 1920) / 50);
    sparkState.tq.data.push((tq - 70) / 16);
    Object.keys(sparkState).forEach(function (key) {
      if (sparkState[key].data.length > 40) sparkState[key].data.shift();
    });
    drawSpark('temp', 'rgba(98, 236, 255, 0.95)');
    drawSpark('vib', 'rgba(98, 236, 255, 0.95)');
    drawSpark('rpm', 'rgba(98, 236, 255, 0.95)');
    drawSpark('tq', 'rgba(255, 164, 107, 0.95)');

    tpState.data.push(0.5 + Math.sin(t / 2.4) * 0.1 + Math.random() * 0.16);
    if (tpState.data.length > 60) tpState.data.shift();
    drawThroughput();

    for (var i = 0; i < axisRows.length; i++) {
      var a = angles[i];
      var w = clamp(Math.abs(a) / 180, 0, 0.5) * 100;
      axisRows[i].fill.style.left = (a < 0 ? 50 - w : 50) + '%';
      axisRows[i].fill.style.width = w + '%';
      axisRows[i].val.textContent = (a >= 0 ? '+' : '') + a.toFixed(1) + '\u00b0';
    }

    var dev = 0.014 + (drag.active ? 0.009 : 0) + Math.sin(t / 2.6) * 0.003 + Math.sin(t * 7) * 0.001;
    if (devValEl) devValEl.textContent = dev.toFixed(3);
    if (devBarEl) devBarEl.style.width = clamp((dev / 0.03) * 100, 8, 96) + '%';
    if (hDev) hDev.textContent = Math.round(dev * 1000) + ' ms lag';

    var rate = 2380 + Math.round(Math.sin(t / 2.2) * 60 + Math.random() * 20);
    if (sampleRateEl) sampleRateEl.textContent = String(rate).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (pipeRate) pipeRate.textContent = (rate / 1000).toFixed(1) + 'K/s';
  }

  /* ---------------------------------------------------------------- */
  /* Camera, pose, environment                                         */
  /* ---------------------------------------------------------------- */

  function poseJoints(j, t, yaw, tilt) {
    j.turret.rotation.y = -0.32 + Math.sin(t * 0.33) * 0.52 + yaw;
    j.lower.rotation.z = 0.2 + Math.sin(t * 0.47) * 0.2 + tilt;
    j.elbow.rotation.z = -1.04 + Math.sin(t * 0.61) * 0.27 - tilt * 1.35;
    j.wrist.rotation.z = 0.55 + Math.sin(t * 0.83) * 0.22 + tilt * 0.5;
    j.wrist.rotation.x = Math.sin(t * 0.5) * 0.16;
  }

  function updateJoints(t, dt) {
    if (!drag.active) {
      if (drag.hold > 0) {
        drag.hold -= dt;
      } else {
        var back = Math.min(1, dt * 1.4);
        state.yaw += (0 - state.yaw) * back;
        state.tilt += (0 - state.tilt) * back;
      }
    }

    /* the twin chases the real pose with a visible lag */
    var chase = Math.min(1, dt * 7);
    ghostYaw += (state.yaw - ghostYaw) * chase;
    ghostTilt += (state.tilt - ghostTilt) * chase;

    poseJoints(physJoints, t, state.yaw, state.tilt);
    poseJoints(holoJoints, reduceMotion ? t : t - 0.14, ghostYaw, ghostTilt);

    angles[0] = -physJoints.turret.rotation.y * 57.2958;
    angles[1] = physJoints.lower.rotation.z * 57.2958;
    angles[2] = physJoints.elbow.rotation.z * 57.2958;
    angles[3] = physJoints.wrist.rotation.z * 57.2958;
    angles[4] = physJoints.wrist.rotation.x * 57.2958;
    angles[5] = Math.sin(t * 0.42) * 62;

    var flicker = reduceMotion ? 1 : 1 - 0.1 * Math.pow(Math.abs(Math.sin(t * 11.3)), 16);
    holoMats.forEach(function (m) {
      m.opacity = m.userData.base * flicker;
    });
    holoRoot.position.y = 0.02 + (reduceMotion ? 0 : Math.sin(t * 0.9) * 0.012);
  }

  function updateCamera(t) {
    var aspect = window.innerWidth / window.innerHeight;
    var radius = 7.0;
    if (aspect < 1.25) radius = 7.0 + (1.25 - aspect) * 2.0;
    var base = 0.58;
    var ang = base + Math.sin(t * 0.06) * 0.13 + state.mx * 0.07;
    var cx = Math.sin(ang) * radius;
    var cz = Math.cos(ang) * radius;
    var cy = 2.95 - state.my * 0.22;

    camera.position.set(cx, cy, cz);
    camera.lookAt(0, 1.28, 0);

    var showCubes = aspect > 0.95;
    dataCubes.forEach(function (cube) { cube.visible = showCubes; });
  }

  function updateEnvironment(dt, t) {
    /* scan ring sweeps the cell */
    var phase = (t * 0.22) % 1;
    if (scanRing) {
      scanRing.position.y = 0.16 + phase * 2.5;
      scanRing.scale.setScalar(1 - phase * 0.35);
      scanMats[0].opacity = Math.sin(phase * Math.PI) * 0.5;
      scanMats[1].opacity = Math.sin(phase * Math.PI) * 0.075;
    }

    /* floor rings breathe and rotate */
    floorRings.forEach(function (r, i) {
      if (r.mesh.parent === scene) r.mesh.rotation.z += dt * r.speed;
      else r.mesh.rotation.z += dt * (r.mesh.userData.spin || 0);
    });

    /* model layers orbit the cell */
    dataCubes.forEach(function (cube, i) {
      var a = cube.userData.angle + t * cube.userData.spin * 0.45;
      cube.position.set(
        Math.cos(a) * cube.userData.radius,
        cube.userData.y + Math.sin(t * 0.6 + i) * 0.07,
        Math.sin(a) * cube.userData.radius
      );
      cube.rotation.y += dt * cube.userData.spin;
      cube.rotation.x += dt * cube.userData.spin * 0.6;
    });

    /* sensors breathe */
    sensors.forEach(function (s, i) {
      var pulse = 0.72 + Math.sin(t * 2.4 + i * 1.5) * 0.28;
      s.material.opacity = pulse;
      s.scale.setScalar(0.16 + Math.sin(t * 2.1 + i) * 0.02);
    });

    /* dust */
    if (!reduceMotion) {
      for (var i = 0; i < dustPhase.length; i++) {
        dustPositions[i * 3 + 1] += dt * 0.04;
        dustPositions[i * 3] += Math.sin(t * 0.14 + dustPhase[i]) * dt * 0.02;
        if (dustPositions[i * 3 + 1] > 6.2) dustPositions[i * 3 + 1] = 0.2;
      }
      dust.geometry.attributes.position.needsUpdate = true;
    }

    /* burst decay */
    burstRings.forEach(function (r) {
      r.life = Math.max(0, r.life - dt);
      var vis = r.life > 0;
      r.mesh.visible = vis;
      if (vis) {
        var k = 1 - r.life / 1.15;
        r.mesh.scale.setScalar(1 + k * 3.4);
        r.mat.opacity = clamp(r.life, 0, 1) * 0.4;
        r.mesh.position.y = 1.1;
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Projected hotspots                                                */
  /* ---------------------------------------------------------------- */

  var viewEl = document.querySelector('.view');
  var projV = new THREE.Vector3();

  function placeHotspot(el, worldPos, offsetX, offsetY, side) {
    if (!el || !viewEl) return;
    var rect = viewEl.getBoundingClientRect();
    projV.copy(worldPos).project(camera);
    var visible = projV.z < 1;
    el.style.opacity = visible ? 1 : 0;
    if (!visible) return;
    var x = (projV.x * 0.5 + 0.5) * window.innerWidth - rect.left + offsetX;
    var y = (-projV.y * 0.5 + 0.5) * window.innerHeight - rect.top + offsetY;
    var flip = side === true ? true : (side === false ? false : x > rect.width * 0.56);
    el.classList.toggle('flip', flip);
    el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)' +
      (flip ? ' translateX(-100%)' : '');
  }

  var hotTmp = new THREE.Vector3();

  function updateHotspots() {
    if (!physJoints || !holoJoints) return;
    var narrow = window.innerWidth < 760;

    physJoints.lower.getWorldPosition(hotTmp);
    hotTmp.y += 0.55;
    placeHotspot(hotspotEls.j2, hotTmp, narrow ? -12 : -22, -8, true);
    if (hJ2) hJ2.textContent = angles[1].toFixed(1) + '\u00b0 · ' + (drag.active ? 'MANUAL' : 'NOMINAL');

    physJoints.wrist.getWorldPosition(hotTmp);
    hotTmp.y += 0.34;
    placeHotspot(hotspotEls.j4, hotTmp, narrow ? 10 : 18, -14, false);
    if (hJ4) hJ4.textContent = angles[3].toFixed(1) + '\u00b0 · ' + (drag.active ? 'MANUAL' : 'NOMINAL');

    holoJoints.wrist.getWorldPosition(hotTmp);
    hotTmp.y += 0.02;
    placeHotspot(hotspotEls.dev, hotTmp, narrow ? 6 : 56, narrow ? 48 : 62, false);
  }

  /* ---------------------------------------------------------------- */
  /* Loop                                                              */
  /* ---------------------------------------------------------------- */

  function animate() {
    requestAnimationFrame(animate);

    var dt = Math.min(clock.getDelta(), 0.05);
    var t = reduceMotion ? 0 : clock.elapsedTime;
    state.time = t;

    state.mx += (state.tmx - state.mx) * Math.min(1, dt * 2.2);
    state.my += (state.tmy - state.my) * Math.min(1, dt * 2.2);

    updateJoints(t, dt);
    updateCamera(t);
    updatePackets(dt, t);
    updateEnvironment(dt, t);
    updateHotspots();
    updateUI(dt, t);

    renderer.render(scene, camera);
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  try {
    buildPanels();
    init();
    pushLog('control room online — cell-04 · twin v2.4.1');
  } catch (err) {
    if (window.console) console.warn('3D scene unavailable:', err);
    if (boot) boot.classList.add('done');
    if (stage) {
      stage.style.background =
        'radial-gradient(ellipse at 52% 46%, rgba(98,236,255,0.16), transparent 62%), #04070a';
    }
  }
})();
