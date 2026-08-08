(function () {
  function latLonToVector(THREE, radius, lat, lon, scale = radius * 1.065) {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon + 180);
    return new THREE.Vector3(
      -scale * Math.sin(phi) * Math.cos(theta),
      scale * Math.cos(phi),
      scale * Math.sin(phi) * Math.sin(theta)
    );
  }

  function latestRow(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows[rows.length - 1];
  }

  function parseKpValue(data) {
    const row = latestRow(data);
    if (!row) return null;

    if (Array.isArray(row)) {
      const numeric = row.map(Number).filter(Number.isFinite);
      return numeric.length ? numeric[0] : null;
    }

    const candidates = ['kp_index', 'Kp', 'kp', 'estimated_kp', 'observed_kp'];
    for (const key of candidates) {
      const value = Number(row[key]);
      if (Number.isFinite(value)) return value;
    }

    return null;
  }

  function parseKpTime(data) {
    const row = latestRow(data);
    if (!row) return '';

    if (Array.isArray(row)) return String(row[0] || '');
    return String(row.time_tag || row.time || row.valid_time || '');
  }

  function kpStormLabel(kp) {
    if (!Number.isFinite(kp)) return 'Kp unavailable';
    if (kp >= 9) return 'Kp 9 G5 extreme';
    if (kp >= 8) return 'Kp 8 G4 severe';
    if (kp >= 7) return 'Kp 7 G3 strong';
    if (kp >= 6) return 'Kp 6 G2 moderate';
    if (kp >= 5) return 'Kp 5 G1 minor';
    return `Kp ${kp.toFixed(1)} quiet`;
  }

  function auroraColor(intensity) {
    if (intensity >= 80) return [1.0, 0.3, 0.25];
    if (intensity >= 45) return [1.0, 0.8, 0.25];
    if (intensity >= 20) return [0.5, 1.0, 0.65];
    return [0.2, 0.95, 1.0];
  }

  function buildAuroraPointsFromGrid(THREE, radius, grid) {
    const coordinates = Array.isArray(grid.coordinates) ? grid.coordinates : [];
    const positions = [];
    const colors = [];
    const sizes = [];

    coordinates.forEach((entry, index) => {
      if (!Array.isArray(entry) || entry.length < 3) return;
      if (index % 3 !== 0) return;

      const lon = Number(entry[0]);
      const lat = Number(entry[1]);
      const intensity = Number(entry[2]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(intensity) || intensity < 6) return;

      const position = latLonToVector(THREE, radius, lat, lon, radius * 1.074);
      const color = auroraColor(intensity);
      positions.push(position.x, position.y, position.z);
      colors.push(color[0], color[1], color[2]);
      sizes.push(THREE.MathUtils.clamp(0.01 + intensity * 0.00026, 0.012, 0.045));
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: sizes.length ? Math.max(...sizes) : 0.018,
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        sizeAttenuation: true,
        depthWrite: false
      })
    );
    points.userData.count = positions.length / 3;
    return points;
  }

  function buildFallbackOval(THREE, radius, kp) {
    const group = new THREE.Group();
    const intensity = Number.isFinite(kp) ? THREE.MathUtils.clamp(kp / 9, 0.16, 1) : 0.28;
    const latitude = 72 - intensity * 18;

    [latitude, -latitude].forEach((lat) => {
      const points = [];
      for (let lon = -180; lon <= 180; lon += 3) {
        points.push(latLonToVector(THREE, radius, lat, lon, radius * 1.072));
      }

      group.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: kp >= 5 ? 0xffd45a : 0x65ffb0,
          transparent: true,
          opacity: 0.32 + intensity * 0.34
        })
      ));
    });

    group.userData.count = 2;
    return group;
  }

  function createSpaceWeatherManager({ THREE, radius, earth, spaceWeatherStatus, auroraStatus }) {
    const layer = new THREE.Group();
    earth.add(layer);

    let lastLoad = 0;
    let currentKp = null;

    const kpUrl = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
    const auroraUrl = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

    async function loadKp() {
      const response = await fetch(kpUrl);
      if (!response.ok) throw new Error(`NOAA Kp request failed: ${response.status}`);
      const data = await response.json();
      currentKp = parseKpValue(data);
      const time = parseKpTime(data);
      spaceWeatherStatus.textContent = kpStormLabel(currentKp);
      spaceWeatherStatus.title = time ? `NOAA SWPC ${time}` : 'NOAA SWPC planetary K-index';
      return currentKp;
    }

    async function loadAuroraGrid() {
      const response = await fetch(auroraUrl);
      if (!response.ok) throw new Error(`NOAA aurora request failed: ${response.status}`);
      const grid = await response.json();
      const points = buildAuroraPointsFromGrid(THREE, radius, grid);
      if (!points.userData.count) throw new Error('NOAA aurora grid had no visible intensity points.');

      layer.clear();
      layer.add(points);
      auroraStatus.textContent = `aurora ${points.userData.count.toLocaleString()} NOAA cells`;
      auroraStatus.title = grid['Forecast Time'] || grid['Observation Time'] || 'NOAA OVATION aurora forecast';
    }

    async function refresh(force = false) {
      const now = Date.now();
      if (!force && now - lastLoad < 5 * 60 * 1000) return;
      lastLoad = now;

      spaceWeatherStatus.textContent = 'space weather loading...';
      auroraStatus.textContent = 'aurora loading...';

      try {
        await loadKp();
      } catch (error) {
        console.warn('Could not load NOAA Kp.', error);
        spaceWeatherStatus.textContent = 'space weather unavailable';
        spaceWeatherStatus.title = error.message;
      }

      try {
        await loadAuroraGrid();
      } catch (error) {
        console.warn('Could not load NOAA aurora grid; using Kp fallback oval.', error);
        layer.clear();
        layer.add(buildFallbackOval(THREE, radius, currentKp));
        auroraStatus.textContent = 'aurora Kp fallback oval';
        auroraStatus.title = error.message;
      }
    }

    return {
      layer,
      refresh,
      setVisible(visible) {
        layer.visible = visible;
      },
      getKp() {
        return currentKp;
      }
    };
  }

  window.createSpaceWeatherManager = createSpaceWeatherManager;
}());
