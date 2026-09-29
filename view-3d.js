// 3D·평면 적재 화면 그리기(three.js)와 보기 전환. app.js에서 분리했다(1.1.85).
// app.js보다 먼저 불러온다. shipment·camera·viewMode 등 화면 상태와 $·esc는 app.js에 있고 호출할 때만 쓴다.

function resizeCanvas() {
  const c = $('loadingCanvas'),
    rect = $('canvasWrap').getBoundingClientRect(),
    dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.max(1, rect.width * dpr);
  c.height = Math.max(1, rect.height * dpr);
  if (threeView && rect.width && rect.height) {
    threeView.renderer.setSize(rect.width, rect.height, false);
    threeView.camera.aspect = rect.width / rect.height;
    threeView.camera.updateProjectionMatrix();
  }
  draw();
}
function draw() {
  if (!result) {
    clearDrawing();
    return;
  }
  if (typeof THREE !== 'undefined') {
    drawThree();
    return;
  }
  const canvas = $('loadingCanvas'),
    ctx = canvas.getContext('2d'),
    dpr = Math.min(2, window.devicePixelRatio || 1),
    W = canvas.width / dpr,
    H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (viewMode === 'top') drawTop(ctx, W, H);
  else drawIso(ctx, W, H);
}
// 컨테이너 밖 좌표 원점(문 쪽에서 봤을 때 왼쪽 아래 모서리)에서 뻗는 좌표축. 엔진 x(길이)·y(폭)·z(높이)는 3D의 X·Z·Y 축이다.
const axisLabels = {};
function axisLabel(text, color, size) {
  if (!axisLabels[text]) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.font = '600 44px Inter, "Noto Sans KR", sans-serif';
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    axisLabels[text] = texture;
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: axisLabels[text], depthTest: false, transparent: true })
  );
  sprite.scale.set(size, size * 0.375, 1);
  sprite.renderOrder = 12;
  return sprite;
}
function addAxes(group, c) {
  // 화면에서 비슷한 크기로 보이도록 카메라 거리(컨테이너 크기)에 비례한다.
  const scale = Math.max(c.l, c.w * 2.5, c.h * 2.5) * 1.25,
    gap = scale * 0.03,
    length = scale * 0.1,
    origin = new THREE.Vector3(-gap, 0, -gap);
  for (const [text, color, dir] of [
    ['X 안쪽', '#d4402b', new THREE.Vector3(1, 0, 0)],
    ['Y 우측', '#1f9d55', new THREE.Vector3(0, 0, 1)],
    ['Z 위', '#2a6fdb', new THREE.Vector3(0, 1, 0)]
  ]) {
    const arrow = new THREE.ArrowHelper(dir, origin, length, new THREE.Color(color), length * 0.18, length * 0.11);
    arrow.line.material.depthTest = false;
    arrow.cone.material.depthTest = false;
    arrow.renderOrder = 11;
    group.add(arrow);
    const label = axisLabel(text, color, scale * 0.07);
    label.position.copy(origin).addScaledVector(dir, length + scale * 0.04);
    group.add(label);
  }
}
function initThree() {
  if (threeView || typeof THREE === 'undefined') return;
  const mount = $('threeMount');
  mount.style.display = 'block';
  const rect = $('canvasWrap').getBoundingClientRect(),
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(rect.width, rect.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);
  $('loadingCanvas').style.display = 'none';
  const scene = new THREE.Scene(),
    camera3 = new THREE.PerspectiveCamera(34, rect.width / rect.height, 1, 100000),
    group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x789085, 2.1));
  const light = new THREE.DirectionalLight(0xffffff, 2.6);
  light.position.set(-6000, 8000, 5000);
  scene.add(light);
  threeView = { renderer, scene, camera: camera3, group };
  let dragging = false,
    lastX = 0,
    lastY = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => {
    if (viewMode !== 'iso') return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    camera.yaw += (e.clientX - lastX) * 0.008;
    camera.pitch = Math.max(0.12, Math.min(1.35, camera.pitch - (e.clientY - lastY) * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
    drawThree();
  });
  el.addEventListener('pointerup', () => (dragging = false));
  el.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      camera.zoom = Math.max(0.55, Math.min(2, camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      drawThree();
    },
    { passive: false }
  );
}
function disposeThreeGroup() {
  if (!threeView) return;
  while (threeView.group.children.length) {
    const o = threeView.group.children.pop();
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
    else o.material?.dispose();
    o.children?.forEach(c => {
      c.geometry?.dispose();
      c.material?.dispose();
    });
  }
}
function clearDrawing() {
  if (threeView) {
    disposeThreeGroup();
    threeView.renderer.dispose();
    threeView.renderer.domElement.remove();
    threeView = null;
  }
  $('threeMount').style.display = 'none';
  const canvas = $('loadingCanvas'),
    ctx = canvas.getContext('2d');
  canvas.style.display = 'block';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
function drawThree() {
  initThree();
  if (!threeView) return;
  const { renderer, scene, camera: cam, group } = threeView,
    c = result.container;
  // 화물·고정재 모형은 보이는 내용이 바뀔 때만 다시 만든다. 화면 크기 변경·드래그 회전·확대는 카메라만 옮겨 다시 그린다(빠름).
  const shown = { result, securing: result.securing, visibleStep, showCog, showDunnage, showAirbags, showAxes },
    built = threeView.built;
  if (!built || Object.keys(shown).some(k => built[k] !== shown[k])) {
    disposeThreeGroup();
    const visible = result.placed.slice(0, visibleStep),
      toColor = hex => new THREE.Color(hex),
      edgeMat = new THREE.LineBasicMaterial({ color: 0x315e4c, transparent: true, opacity: 0.65 });
    visible.forEach(p => {
      let geometry;
      if (p.shape === 'cylinder') {
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
        geometry.scale(p.l, p.h, p.w);
      } else geometry = new THREE.BoxGeometry(p.l, p.h, p.w);
      const material = new THREE.MeshStandardMaterial({
          color: toColor(p.color),
          roughness: 0.72,
          metalness: 0.03,
          transparent: true,
          opacity: showCog ? 0.2 : 0.94,
          depthWrite: !showCog,
          side: THREE.DoubleSide
        }),
        mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(p.x + p.l / 2, p.z + p.h / 2, p.y + p.w / 2);
      group.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x263b32, transparent: true, opacity: showCog ? 0.12 : 0.42 })
      );
      edges.position.copy(mesh.position);
      group.add(edges);
    });
    if (visibleStep === result.placed.length && result.securing) {
      const woodMaterial = new THREE.MeshStandardMaterial({ color: 0xa56a32, roughness: 0.88 }),
        nailMaterial = new THREE.MeshStandardMaterial({ color: 0x383d42, metalness: 0.65, roughness: 0.38 });
      if (showDunnage)
        result.securing.dunnage.forEach(d => {
          if (d.kind === 'note') return;
          if (d.kind === 'fence' || d.kind === 'spacer') {
            const geometry = new THREE.BoxGeometry(d.l, d.h, d.w),
              mesh = new THREE.Mesh(
                geometry,
                d.kind === 'fence' ? woodMaterial : new THREE.MeshStandardMaterial({ color: 0xd9c08a, roughness: 0.95 })
              );
            mesh.position.set(d.x + d.l / 2, d.z + d.h / 2, d.y + d.w / 2);
            group.add(mesh);
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(geometry),
              new THREE.LineBasicMaterial({
                color: d.kind === 'fence' ? 0x62401f : 0x9c7a3c,
                transparent: true,
                opacity: 0.75
              })
            );
            edges.position.copy(mesh.position);
            group.add(edges);
            return;
          }
          if (d.kind === 'filler' || d.kind === 'strap' || d.kind === 'lashing') {
            const geometry = new THREE.BoxGeometry(d.l, d.h, d.w),
              mesh = new THREE.Mesh(
                geometry,
                new THREE.MeshStandardMaterial({
                  color: d.kind === 'filler' ? 0xe8d3a8 : 0xf29b38,
                  roughness: 0.9,
                  transparent: d.kind === 'filler',
                  opacity: d.kind === 'filler' ? 0.85 : 1
                })
              );
            mesh.position.set(d.x + d.l / 2, d.z + d.h / 2, d.y + d.w / 2);
            group.add(mesh);
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(geometry),
              new THREE.LineBasicMaterial({
                color: d.kind === 'filler' ? 0x9c7a3c : 0xb7651a,
                transparent: true,
                opacity: 0.8
              })
            );
            edges.position.copy(mesh.position);
            group.add(edges);
            return;
          }
          if (d.kind === 'beam') {
            const geometry = new THREE.BoxGeometry(d.l, d.h, d.w),
              mesh = new THREE.Mesh(geometry, woodMaterial);
            mesh.position.set(d.x + d.l / 2, d.h / 2, d.y + d.w / 2);
            group.add(mesh);
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(geometry),
              new THREE.LineBasicMaterial({ color: 0x62401f, transparent: true, opacity: 0.7 })
            );
            edges.position.copy(mesh.position);
            group.add(edges);
            return;
          }
          const dx = d.l,
            dz = d.w,
            h = d.h,
            isX = d.axis === 'x',
            highAtMax = d.side === 'min',
            positions = isX
              ? [0, 0, 0, dx, 0, 0, dx, 0, dz, 0, 0, dz, highAtMax ? dx : 0, h, 0, highAtMax ? dx : 0, h, dz]
              : [0, 0, 0, dx, 0, 0, dx, 0, dz, 0, 0, dz, 0, h, highAtMax ? dz : 0, dx, h, highAtMax ? dz : 0],
            indices = highAtMax
              ? isX
                ? [0, 2, 1, 0, 3, 2, 1, 2, 5, 1, 5, 4, 0, 4, 5, 0, 5, 3, 0, 1, 4, 3, 5, 2]
                : [0, 2, 1, 0, 3, 2, 3, 5, 2, 3, 4, 5, 0, 1, 5, 0, 5, 4, 0, 4, 3, 1, 2, 5]
              : isX
                ? [0, 2, 1, 0, 3, 2, 0, 4, 5, 0, 5, 3, 1, 2, 5, 1, 5, 4, 0, 1, 4, 3, 5, 2]
                : [0, 2, 1, 0, 3, 2, 0, 1, 5, 0, 5, 4, 3, 4, 5, 3, 5, 2, 0, 4, 3, 1, 2, 5];
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geometry.setIndex(indices);
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, woodMaterial);
          mesh.position.set(d.x, 4, d.y);
          group.add(mesh);
          const nailGeometry = new THREE.CylinderGeometry(12, 12, 8, 14);
          [0.3, 0.7].forEach(t => {
            const nail = new THREE.Mesh(nailGeometry, nailMaterial);
            nail.position.set(
              d.x + (isX ? (highAtMax ? 0.2 : 0.8) * dx : t * dx),
              10,
              d.y + (isX ? t * dz : (highAtMax ? 0.2 : 0.8) * dz)
            );
            group.add(nail);
          });
        });
      if (showAirbags)
        result.securing.airbags.forEach(a => {
          const material = new THREE.MeshStandardMaterial({
              color: 0x70bde9,
              transparent: true,
              opacity: 0.74,
              roughness: 0.58
            }),
            geometry = new THREE.SphereGeometry(0.5, 28, 18),
            mesh = new THREE.Mesh(geometry, material);
          mesh.scale.set(a.l * 0.94, a.h, a.w * 0.94);
          mesh.position.set(a.x + a.l / 2, a.z + a.h / 2, a.y + a.w / 2);
          group.add(mesh);
          const seam = new THREE.Mesh(
            new THREE.TorusGeometry(0.5, 0.018, 8, 36),
            new THREE.MeshStandardMaterial({ color: 0xd7effb, transparent: true, opacity: 0.8, roughness: 0.65 })
          );
          seam.scale.set(a.l * 0.96, a.w * 0.96, 1);
          seam.rotation.x = Math.PI / 2;
          seam.position.set(a.x + a.l / 2, a.z + a.h / 2, a.y + a.w / 2);
          group.add(seam);
          const valve = new THREE.Mesh(
            new THREE.CylinderGeometry(17, 21, 28, 12),
            new THREE.MeshStandardMaterial({ color: 0x276e96, roughness: 0.48 })
          );
          valve.position.set(a.x + a.l / 2, a.z + a.h + 8, a.y + a.w / 2);
          group.add(valve);
        });
    }
    if (showAxes) addAxes(group, c);
    const frameGeo = new THREE.BoxGeometry(c.l, c.h, c.w),
      frame = new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo), edgeMat);
    frame.position.set(c.l / 2, c.h / 2, c.w / 2);
    group.add(frame);
    const doorGeo = new THREE.BoxGeometry(10, c.h, c.w),
      doorFrame = new THREE.LineSegments(
        new THREE.EdgesGeometry(doorGeo),
        new THREE.LineBasicMaterial({ color: 0x0066cc, transparent: true, opacity: 0.95 })
      );
    doorFrame.position.set(0, c.h / 2, c.w / 2);
    group.add(doorFrame);
    const floorGeo = new THREE.PlaneGeometry(c.l, c.w),
      floor = new THREE.Mesh(
        floorGeo,
        new THREE.MeshStandardMaterial({ color: 0xdfe9e2, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
      );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(c.l / 2, 0, c.w / 2);
    group.add(floor);
    const balance = LoadwiseInsights.ctu(result);
    if (showCog && balance) {
      const color = balance.level === 'safe' ? 0x16803c : balance.level === 'caution' ? 0xd38b00 : 0xb42318,
        marker = new THREE.Mesh(
          new THREE.SphereGeometry(140, 24, 18),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, depthTest: false })
        );
      marker.position.set(balance.cog.x, balance.cog.z, balance.cog.y);
      marker.renderOrder = 10;
      group.add(marker);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(balance.cog.x, 0, balance.cog.y), marker.position]),
        new THREE.LineDashedMaterial({ color, dashSize: 70, gapSize: 35, depthTest: false })
      );
      line.computeLineDistances();
      line.renderOrder = 9;
      group.add(line);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(150, 195, 32),
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
          depthTest: false
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(balance.cog.x, 6, balance.cog.y);
      ring.renderOrder = 9;
      group.add(ring);
    }
    threeView.built = shown;
  }
  const target = new THREE.Vector3(c.l / 2, viewMode === 'iso' ? c.h * 0.3 : c.h * 0.42, c.w / 2),
    distance = (Math.max(c.l, c.w * 2.5, c.h * 2.5) * (viewMode === 'iso' ? 1.65 : 1.25)) / camera.zoom;
  if (viewMode === 'top') {
    cam.position.set(c.l / 2, distance * 1.1, c.w / 2 + 0.01);
    cam.up.set(0, 0, -1);
  } else if (viewMode === 'door') {
    cam.position.set(-distance * 0.72, c.h * 0.45, c.w / 2);
    cam.up.set(0, 1, 0);
  } else if (viewMode === 'left') {
    cam.position.set(c.l / 2, c.h * 0.45, -distance * 0.72);
    cam.up.set(0, 1, 0);
  } else if (viewMode === 'right') {
    cam.position.set(c.l / 2, c.h * 0.45, c.w + distance * 0.72);
    cam.up.set(0, 1, 0);
  } else {
    const horizontal = distance * Math.cos(camera.pitch);
    cam.position.set(
      target.x + Math.cos(camera.yaw) * horizontal,
      target.y + Math.sin(camera.pitch) * distance,
      target.z + Math.sin(camera.yaw) * horizontal
    );
    cam.up.set(0, 1, 0);
  }
  cam.lookAt(target);
  cam.near = Math.max(1, distance / 1000);
  cam.far = distance * 10;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
}
function drawIso(ctx, W, H) {
  const c = result.container,
    cy = Math.cos(camera.yaw),
    sy = Math.sin(camera.yaw),
    cp = Math.cos(camera.pitch),
    sp = Math.sin(camera.pitch);
  const raw = (x, y, z) => {
    x -= c.l / 2;
    y -= c.w / 2;
    z -= c.h / 2;
    const rx = x * cy - y * sy,
      ry = x * sy + y * cy;
    return [rx, ry * sp - z * cp, ry * cp + z * sp];
  };
  const corners = [
      [0, 0, 0],
      [c.l, 0, 0],
      [0, c.w, 0],
      [c.l, c.w, 0],
      [0, 0, c.h],
      [c.l, 0, c.h],
      [0, c.w, c.h],
      [c.l, c.w, c.h]
    ],
    rawCorners = corners.map(v => raw(...v));
  const xs = rawCorners.map(p => p[0]),
    ys = rawCorners.map(p => p[1]),
    minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys),
    pad = 58;
  const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY)) * camera.zoom,
    centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2;
  const P = (x, y, z) => {
    const p = raw(x, y, z);
    return [W / 2 + (p[0] - centerX) * scale, H / 2 + (p[1] - centerY) * scale, p[2]];
  };
  const visible = result.placed.slice(0, visibleStep),
    polygons = [];
  const addBox = o => {
    const pts = [
      [o.x, o.y, o.z],
      [o.x + o.l, o.y, o.z],
      [o.x, o.y + o.w, o.z],
      [o.x + o.l, o.y + o.w, o.z],
      [o.x, o.y, o.z + o.h],
      [o.x + o.l, o.y, o.z + o.h],
      [o.x, o.y + o.w, o.z + o.h],
      [o.x + o.l, o.y + o.w, o.z + o.h]
    ].map(v => P(...v));
    const faces = [
        [0, 1, 3, 2],
        [4, 6, 7, 5],
        [0, 4, 5, 1],
        [2, 3, 7, 6],
        [0, 2, 6, 4],
        [1, 5, 7, 3]
      ],
      tones = [-18, 20, -7, 5, -12, 1];
    faces.forEach((f, i) =>
      polygons.push({
        pts: f.map(n => pts[n]),
        depth: f.reduce((s, n) => s + pts[n][2], 0) / 4,
        fill: shade(o.color, tones[i]),
        stroke: 'rgba(19,37,29,.34)'
      })
    );
  };
  const addCylinder = o => {
    const n = 20,
      cx = o.x + o.l / 2,
      midY = o.y + o.w / 2,
      rx = o.l / 2,
      ry = o.w / 2,
      b = [],
      t = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      b.push(P(cx + Math.cos(a) * rx, midY + Math.sin(a) * ry, o.z));
      t.push(P(cx + Math.cos(a) * rx, midY + Math.sin(a) * ry, o.z + o.h));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        pts = [b[i], b[j], t[j], t[i]];
      polygons.push({
        pts,
        depth: pts.reduce((s, p) => s + p[2], 0) / 4,
        fill: shade(o.color, i % 2 ? -3 : 3),
        stroke: 'rgba(19,37,29,.24)'
      });
    }
    polygons.push({
      pts: b,
      depth: b.reduce((s, p) => s + p[2], 0) / n,
      fill: shade(o.color, -14),
      stroke: 'rgba(19,37,29,.3)'
    });
    polygons.push({
      pts: t,
      depth: t.reduce((s, p) => s + p[2], 0) / n,
      fill: shade(o.color, 20),
      stroke: 'rgba(19,37,29,.35)'
    });
  };
  visible.forEach(p => (p.shape === 'cylinder' ? addCylinder(p) : addBox(p)));
  polygons
    .sort((a, b) => a.depth - b.depth)
    .forEach(poly => {
      ctx.beginPath();
      poly.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = poly.fill;
      ctx.globalAlpha = 0.94;
      ctx.fill();
      ctx.strokeStyle = poly.stroke;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    });
  ctx.globalAlpha = 1;
  const framePts = corners.map(v => P(...v)),
    edges = [
      [0, 1],
      [0, 2],
      [0, 4],
      [1, 3],
      [1, 5],
      [2, 3],
      [2, 6],
      [3, 7],
      [4, 5],
      [4, 6],
      [5, 7],
      [6, 7]
    ];
  ctx.strokeStyle = 'rgba(15,107,72,.72)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  edges.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(framePts[a][0], framePts[a][1]);
    ctx.lineTo(framePts[b][0], framePts[b][1]);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  if (visible.length) {
    const p = visible[visible.length - 1],
      [x, y] = P(p.x + p.l / 2, p.y + p.w / 2, p.z + p.h);
    ctx.fillStyle = '#13251d';
    ctx.beginPath();
    ctx.arc(x, y - 15, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9ff5a';
    ctx.font = '700 10px DM Sans';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.order), x, y - 15);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}
function drawTop(ctx, W, H) {
  const c = result.container,
    pad = 52,
    scale = Math.min((W - pad * 2) / c.l, (H - pad * 2) / c.w) * camera.zoom,
    ox = (W - c.l * scale) / 2,
    oy = (H - c.w * scale) / 2;
  ctx.fillStyle = '#f7faf6';
  ctx.strokeStyle = 'rgba(15,107,72,.7)';
  ctx.lineWidth = 2;
  ctx.fillRect(ox, oy, c.l * scale, c.w * scale);
  ctx.strokeRect(ox, oy, c.l * scale, c.w * scale);
  result.placed
    .slice(0, visibleStep)
    .sort((a, b) => a.z - b.z)
    .forEach(p => {
      ctx.fillStyle = p.color + 'd9';
      ctx.strokeStyle = 'rgba(19,37,29,.35)';
      ctx.beginPath();
      if (p.shape === 'cylinder')
        ctx.ellipse(
          ox + (p.x + p.l / 2) * scale,
          oy + (p.y + p.w / 2) * scale,
          (p.l * scale) / 2,
          (p.w * scale) / 2,
          0,
          0,
          Math.PI * 2
        );
      else ctx.rect(ox + p.x * scale, oy + p.y * scale, p.l * scale, p.w * scale);
      ctx.fill();
      ctx.stroke();
      if (p.l * scale > 28 && p.w * scale > 18) {
        ctx.fillStyle = 'white';
        ctx.font = '700 10px DM Sans';
        ctx.fillText(p.order, ox + p.x * scale + 5, oy + p.y * scale + 13);
      }
    });
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16),
    r = Math.max(0, Math.min(255, (n >> 16) + amt)),
    g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)),
    b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}
function setView(mode) {
  viewMode = mode;
  for (const name of ['Iso', 'Top', 'Door', 'Left', 'Right'])
    $(`view${name}`).classList.toggle('active', mode === name.toLowerCase());
  draw();
}
function toggleCenterOfGravity() {
  showCog = !showCog;
  const button = $('viewCog');
  button.classList.toggle('active', showCog);
  button.setAttribute('aria-pressed', String(showCog));
  button.querySelector('b').textContent = showCog ? 'ON' : 'OFF';
  draw();
}
function toggleSecuringVisibility(type) {
  const active = type === 'dunnage' ? (showDunnage = !showDunnage) : (showAirbags = !showAirbags),
    button = $(type === 'dunnage' ? 'toggleDunnage' : 'toggleAirbags');
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  button.querySelector('b').textContent = active ? 'ON' : 'OFF';
  draw();
}
