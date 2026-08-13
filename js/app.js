const container = document.getElementById('container');
    const panel = document.querySelector('.panel');
    const togglePanelButton = document.getElementById('togglePanel');
    const clock = document.getElementById('clock');
    const timeScaleInput = document.getElementById('timeScale');
    const timeScaleValue = document.getElementById('timeScaleValue');
    const actualTimeInput = document.getElementById('actualTime');
    const distanceLinesInput = document.getElementById('distanceLines');
    const dayNightInput = document.getElementById('dayNight');
    const moonPhaseInput = document.getElementById('moonPhase');
    const satellitesInput = document.getElementById('satellites');
    const earthquakesInput = document.getElementById('earthquakes');
    const spaceWeatherInput = document.getElementById('spaceWeather');
    const showCalendarInput = document.getElementById('showCalendar');
    const showWeatherInput = document.getElementById('showWeather');
    const spaceBackgroundInput = document.getElementById('spaceBackground');
    const controlsOpacityInput = document.getElementById('controlsOpacity');
    const controlsOpacityValue = document.getElementById('controlsOpacityValue');
    const satelliteSourceInput = document.getElementById('satelliteSource');
    const slowTimeButton = document.getElementById('slowTime');
    const earthFocusButton = document.getElementById('earthFocus');
    const fullscreenToggleButton = document.getElementById('fullscreenToggle');
    const useLocationButton = document.getElementById('useLocation');
    const loadWeatherButton = document.getElementById('loadWeather');
    const sunDirection = document.getElementById('sunDirection');
    const sunDistance = document.getElementById('sunDistance');
    const satelliteStatus = document.getElementById('satelliteStatus');
    const issStatus = document.getElementById('issStatus');
    const earthquakeStatus = document.getElementById('earthquakeStatus');
    const spaceWeatherStatus = document.getElementById('spaceWeatherStatus');
    const auroraStatus = document.getElementById('auroraStatus');
    const locationStatus = document.getElementById('locationStatus');
    const visibleSatellites = document.getElementById('visibleSatellites');
    const selectedSatellite = document.getElementById('selectedSatellite');
    const satelliteDetails = document.getElementById('satelliteDetails');
    const calendarWidget = document.getElementById('calendarWidget');
    const calendarDate = document.getElementById('calendarDate');
    const calendarTime = document.getElementById('calendarTime');
    const calendarLockScreen = document.getElementById('calendarLockScreen');
    const calendarLockForm = document.getElementById('calendarLockForm');
    const calendarLockUser = document.getElementById('calendarLockUser');
    const calendarLockPass = document.getElementById('calendarLockPass');
    const calendarLockTime = document.getElementById('calendarLockTime');
    const calendarLockPeriod = document.getElementById('calendarLockPeriod');
    const calendarLockSubseconds = document.getElementById('calendarLockSubseconds');
    const calendarLockMonth = document.getElementById('calendarLockMonth');
    const calendarLockGrid = document.getElementById('calendarLockGrid');
    const calendarLockStamp = document.getElementById('calendarLockStamp');
    const weatherWidget = document.getElementById('weatherWidget');
    const weatherTemp = document.getElementById('weatherTemp');
    const weatherMeta = document.getElementById('weatherMeta');
    const controllerButton = document.getElementById('controllerButton');
    const controllerOverlay = document.getElementById('controllerOverlay');
    const zoomHalo = document.getElementById('zoomHalo');
    const zoomStick = document.getElementById('zoomStick');
    const directionHalo = document.getElementById('directionHalo');
    const directionStick = document.getElementById('directionStick');
    const hoverLabel = document.getElementById('hoverLabel');
    const geoCollectEndpoint = 'https://globe-qwen-relay.digitalcomputermail.workers.dev/api/geo';
    const geoUserStorageKey = 'digitalcpu:globe-geo-user:v1';
    const backgroundStorageKey = 'digitalcpu:globe-background:v1';
    const controlsOpacityStorageKey = 'digitalcpu:controls-opacity:v1';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020406);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    function setSpaceBackground(mode) {
      const useWhite = mode === 'white';
      const color = useWhite ? 0xf6fbff : 0x020406;
      scene.background = new THREE.Color(color);
      renderer.setClearColor(color, 1);
      document.body.classList.toggle('space-bg-white', useWhite);
      document.body.classList.toggle('space-bg-black', !useWhite);
      if (spaceBackgroundInput) spaceBackgroundInput.value = useWhite ? 'white' : 'black';
      localStorage.setItem(backgroundStorageKey, useWhite ? 'white' : 'black');
    }

    function setControlsOpacity(value) {
      const numeric = Math.min(100, Math.max(35, Number(value) || 82));
      panel.style.setProperty('--settings-opacity', (numeric / 100).toFixed(2));
      if (controlsOpacityInput) controlsOpacityInput.value = String(numeric);
      if (controlsOpacityValue) controlsOpacityValue.textContent = `${numeric}%`;
      localStorage.setItem(controlsOpacityStorageKey, String(numeric));
    }

    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 100000);
    camera.position.set(0, 0, 4.2);

    const solarSystem = new THREE.Group();
    solarSystem.position.x = 0;
    solarSystem.rotation.x = THREE.MathUtils.degToRad(-8);
    solarSystem.rotation.y = THREE.MathUtils.degToRad(18);
    scene.add(solarSystem);

    const earthSystem = new THREE.Group();
    solarSystem.add(earthSystem);

    const earth = new THREE.Group();
    earth.rotation.set(-0.28, -0.55, 0.12);
    earthSystem.add(earth);

    scene.add(new THREE.AmbientLight(0x80dfff, 0.35));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(4, 2.5, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x1fb8ff, 1.1);
    rimLight.position.set(-5, 1, -3);
    scene.add(rimLight);

    const radius = 1.42;
    const moonRadius = radius * 0.2727;
    const moonDistance = radius * 4.15;
    const moonOrbitEccentricity = 0.0549;
    const moonOrbitInclination = THREE.MathUtils.degToRad(5.145);
    const sunRadiusRatioToEarth = 109.1;
    const astronomicalUnitInEarthRadii = 23454.8;
    const sunDisplayRadius = radius * sunRadiusRatioToEarth;
    const earthSunDistance = radius * astronomicalUnitInEarthRadii;
    const earthSunEccentricity = 0.0167;
    const eclipticTilt = THREE.MathUtils.degToRad(7.155);
    const earthViewRotationOffset = THREE.MathUtils.degToRad(112);
    const moonViewOrbitOffset = 4.05;
    const sphereGeometry = new THREE.SphereGeometry(radius, 48, 32);
    let zoomOffset = 2.1;
    const virtualController = {
      enabled: false,
      zoomPointerId: null,
      directionPointerId: null,
      zoom: 0,
      rotateX: 0,
      rotateY: 0
    };

    function getDefaultCameraZ() {
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const sceneWidth = moonDistance + radius + moonRadius;
      const distanceToFitWidth = (sceneWidth * 1.34) / (2 * Math.tan(verticalFov / 2) * camera.aspect);
      const distanceToFitEarth = (radius * 2.24) / (2 * Math.tan(verticalFov / 2) * camera.aspect);
      return Math.max(7.2, distanceToFitWidth, distanceToFitEarth);
    }

    function applyCameraDistance() {
      camera.position.z = THREE.MathUtils.clamp(getDefaultCameraZ() + zoomOffset, 2.25, 36);
    }

    applyCameraDistance();

    function setControllerStickPosition(stick, x, y) {
      if (!stick) return;
      stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }

    function resetControllerInputs() {
      virtualController.zoomPointerId = null;
      virtualController.directionPointerId = null;
      virtualController.zoom = 0;
      virtualController.rotateX = 0;
      virtualController.rotateY = 0;
      setControllerStickPosition(zoomStick, 0, 0);
      setControllerStickPosition(directionStick, 0, 0);
    }

    function setControllerEnabled(enabled) {
      virtualController.enabled = enabled;
      controllerOverlay?.classList.toggle('is-active', enabled);
      controllerOverlay?.setAttribute('aria-hidden', String(!enabled));
      controllerButton?.classList.toggle('is-active', enabled);
      controllerButton?.setAttribute('aria-pressed', String(enabled));
      if (!enabled) resetControllerInputs();
    }

    function updateZoomHalo(event) {
      if (!zoomHalo) return;
      const rect = zoomHalo.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const limit = rect.height * 0.34;
      const y = THREE.MathUtils.clamp(event.clientY - centerY, -limit, limit);
      virtualController.zoom = y / limit;
      setControllerStickPosition(zoomStick, 0, y);
    }

    function updateDirectionHalo(event) {
      if (!directionHalo) return;
      const rect = directionHalo.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const limit = rect.width * 0.34;
      const x = THREE.MathUtils.clamp(event.clientX - centerX, -limit, limit);
      const y = THREE.MathUtils.clamp(event.clientY - centerY, -limit, limit);
      virtualController.rotateY = x / limit;
      virtualController.rotateX = y / limit;
      setControllerStickPosition(directionStick, x, y);
    }

    function applyVirtualControllerInput() {
      if (!virtualController.enabled) return;
      if (virtualController.directionPointerId !== null) {
        solarSystem.rotation.y += virtualController.rotateY * 0.035;
        solarSystem.rotation.x += virtualController.rotateX * 0.026;
        solarSystem.rotation.x = THREE.MathUtils.clamp(solarSystem.rotation.x, -Math.PI * 0.48, Math.PI * 0.48);
      }
      if (virtualController.zoomPointerId !== null) {
        if (cameraFocus.mode === 'satellite') focusEarth();
        zoomOffset += virtualController.zoom * 0.08;
        zoomOffset = THREE.MathUtils.clamp(zoomOffset, -4.2, 12);
        applyCameraDistance();
      }
    }

    function updateDeviceFormatClasses() {
      const width = window.innerWidth || document.documentElement.clientWidth || 0;
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const nextFormat = width <= 700 ? 'phone' : width <= 1024 ? 'tablet' : 'desktop';
      document.body.classList.toggle('format-phone', nextFormat === 'phone');
      document.body.classList.toggle('format-tablet', nextFormat === 'tablet');
      document.body.classList.toggle('format-desktop', nextFormat === 'desktop');
      document.body.classList.toggle('format-landscape', width > height);
      document.body.classList.toggle('format-portrait', width <= height);
      document.body.classList.toggle('format-touch', Boolean(isCoarsePointer));
    }

    updateDeviceFormatClasses();

    const sun = new THREE.Group();
    solarSystem.add(sun);

    const sunShell = new THREE.Mesh(
      new THREE.SphereGeometry(sunDisplayRadius, 64, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffc94a,
        transparent: true,
        opacity: 0.88
      })
    );
    sun.add(sunShell);

    const sunWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(sunDisplayRadius * 1.006, 36, 24)),
      new THREE.LineBasicMaterial({
        color: 0xfff2a6,
        transparent: true,
        opacity: 0.18
      })
    );
    sun.add(sunWire);

    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(sunDisplayRadius * 1.35, 64, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff8a28,
        transparent: true,
        opacity: 0.13,
        side: THREE.BackSide
      })
    );
    sun.add(sunGlow);

    function earthSunOrbitPoint(angle) {
      const semiMajor = earthSunDistance;
      const semiMinor = semiMajor * Math.sqrt(1 - earthSunEccentricity * earthSunEccentricity);
      const focusOffset = semiMajor * earthSunEccentricity;
      return new THREE.Vector3(
        Math.cos(angle) * semiMajor - focusOffset,
        Math.sin(angle) * semiMinor * Math.sin(eclipticTilt),
        Math.sin(angle) * semiMinor * Math.cos(eclipticTilt)
      );
    }

    function normalizeDegrees(degrees) {
      return ((degrees % 360) + 360) % 360;
    }

    function signedDegrees(degrees) {
      const normalized = normalizeDegrees(degrees);
      return normalized > 180 ? normalized - 360 : normalized;
    }

    function julianDate(date) {
      return date.getTime() / 86400000 + 2440587.5;
    }

    function greenwichMeanSiderealTime(jd) {
      const centuries = (jd - 2451545.0) / 36525;
      return normalizeDegrees(
        280.46061837
        + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * centuries * centuries
        - (centuries * centuries * centuries) / 38710000
      );
    }

    function getSolarPosition(date) {
      const jd = julianDate(date);
      const daysSinceJ2000 = jd - 2451545.0;
      const meanLongitude = normalizeDegrees(280.460 + 0.9856474 * daysSinceJ2000);
      const meanAnomaly = THREE.MathUtils.degToRad(normalizeDegrees(357.528 + 0.9856003 * daysSinceJ2000));
      const eclipticLongitude = THREE.MathUtils.degToRad(
        normalizeDegrees(
          meanLongitude
          + 1.915 * Math.sin(meanAnomaly)
          + 0.020 * Math.sin(2 * meanAnomaly)
        )
      );
      const obliquity = THREE.MathUtils.degToRad(23.439 - 0.0000004 * daysSinceJ2000);
      const rightAscension = THREE.MathUtils.radToDeg(
        Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude))
      );
      const declination = THREE.MathUtils.radToDeg(
        Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))
      );
      const gmst = greenwichMeanSiderealTime(jd);
      const subsolarLongitude = signedDegrees(rightAscension - gmst);

      return {
        declination,
        rightAscension: normalizeDegrees(rightAscension),
        subsolarLongitude,
        gmst
      };
    }

    function sunVectorForDate(date) {
      const solar = getSolarPosition(date);
      return {
        ...solar,
        localDirection: latLonToVector(solar.declination, solar.subsolarLongitude, 1).normalize()
      };
    }

    const shell = new THREE.Mesh(
      sphereGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x07151c,
        emissive: 0x031018,
        roughness: 0.55,
        metalness: 0.18,
        transparent: true,
        opacity: 0.2
      })
    );
    earth.add(shell);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(sphereGeometry),
      new THREE.LineBasicMaterial({
        color: 0x4bd6ff,
        transparent: true,
        opacity: 0.26
      })
    );
    earth.add(wire);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.012, 48, 32),
      new THREE.MeshBasicMaterial({
        color: 0x0aa8ff,
        transparent: true,
        opacity: 0.055,
        side: THREE.BackSide
      })
    );
    earth.add(glow);

    const moonOrbitPlane = new THREE.Group();
    moonOrbitPlane.rotation.x = moonOrbitInclination;
    earthSystem.add(moonOrbitPlane);

    function moonOrbitPoint(angle) {
      const semiMajor = moonDistance;
      const semiMinor = semiMajor * Math.sqrt(1 - moonOrbitEccentricity * moonOrbitEccentricity);
      const focusOffset = semiMajor * moonOrbitEccentricity;
      return new THREE.Vector3(
        Math.cos(angle) * semiMajor - focusOffset,
        0,
        Math.sin(angle) * semiMinor
      );
    }

    const moon = new THREE.Group();
    moon.position.copy(moonOrbitPoint(0.1));
    moonOrbitPlane.add(moon);

    const moonGeometry = new THREE.SphereGeometry(moonRadius, 32, 24);
    const moonShell = new THREE.Mesh(
      moonGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x9fb4bd,
        emissive: 0x10191d,
        roughness: 0.85,
        metalness: 0.05,
        transparent: true,
        opacity: 0.45
      })
    );
    moon.add(moonShell);

    const moonWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(moonGeometry),
      new THREE.LineBasicMaterial({
        color: 0xc9f4ff,
        transparent: true,
        opacity: 0.34
      })
    );
    moon.add(moonWire);

    const moonGlow = new THREE.Mesh(
      new THREE.SphereGeometry(moonRadius * 1.08, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0x9ddfff,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide
      })
    );
    moon.add(moonGlow);

    function moonLatLonToVector(lat, lon, scale = moonRadius * 1.018) {
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon + 180);
      return new THREE.Vector3(
        -scale * Math.sin(phi) * Math.cos(theta),
        scale * Math.cos(phi),
        scale * Math.sin(phi) * Math.sin(theta)
      );
    }

    function makeMoonSurfaceRing(lat, lon, diameterKm, color, opacity, segments = 64) {
      const lunarRadiusKm = 1737.4;
      const angularRadius = (diameterKm * 0.5) / lunarRadiusKm;
      const featureRadius = moonRadius * Math.sin(angularRadius);
      const center = moonLatLonToVector(lat, lon, moonRadius * 1.018).normalize();
      const tangent = new THREE.Vector3(0, 1, 0).cross(center);
      if (tangent.lengthSq() < 0.0001) tangent.set(1, 0, 0);
      tangent.normalize();
      const bitangent = center.clone().cross(tangent).normalize();
      const points = [];

      for (let i = 0; i <= segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        const point = center.clone()
          .multiplyScalar(moonRadius * 1.019)
          .add(tangent.clone().multiplyScalar(Math.cos(angle) * featureRadius))
          .add(bitangent.clone().multiplyScalar(Math.sin(angle) * featureRadius))
          .normalize()
          .multiplyScalar(moonRadius * 1.02);
        points.push(point);
      }

      return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity
        })
      );
    }

    [
      [32.8, -15.6, 1145],
      [28.0, 17.5, 674],
      [8.5, 31.4, 876],
      [17.0, 59.1, 556],
      [-7.8, 51.3, 840],
      [-15.2, 16.0, 333],
      [-21.3, -16.6, 715],
      [-24.4, -38.6, 419],
      [56.0, 1.4, 1596],
      [-13.3, -16.8, 603]
    ].forEach(([lat, lon, diameterKm]) => {
      moon.add(makeMoonSurfaceRing(lat, lon, diameterKm, 0x6fb8c4, 0.2, 96));
    });

    [
      [-43.3, -11.2, 85],
      [9.7, -20.1, 93],
      [8.1, -38.0, 32],
      [23.7, -47.4, 40],
      [51.6, -9.3, 101],
      [-58.4, -14.4, 231],
      [-5.4, -68.4, 222],
      [-8.9, 61.1, 132],
      [-25.1, 60.4, 177],
      [-11.4, 26.4, 100],
      [-13.2, 24.0, 98],
      [-9.2, -1.8, 154],
      [29.7, -4.0, 81],
      [14.5, -11.3, 59],
      [-17.6, -39.9, 110],
      [-44.4, -55.1, 227],
      [31.8, 30.0, 95],
      [46.7, 44.4, 87],
      [46.7, 39.1, 69],
      [53.6, 56.5, 125],
      [16.1, 46.8, 28],
      [14.6, 54.7, 23]
    ].forEach(([lat, lon, diameterKm]) => {
      moon.add(makeMoonSurfaceRing(lat, lon, diameterKm, 0xd7f7ff, 0.58, 56));
    });

    const moonOrbit = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 241 }, (_, i) => moonOrbitPoint((i / 240) * Math.PI * 2))
      ),
      new THREE.LineBasicMaterial({
        color: 0x2c7e91,
        transparent: true,
        opacity: 0.22
      })
    );
    moonOrbitPlane.add(moonOrbit);

    function latLonToVector(lat, lon, scale = radius * 1.013) {
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon + 180);
      return new THREE.Vector3(
        -scale * Math.sin(phi) * Math.cos(theta),
        scale * Math.cos(phi),
        scale * Math.sin(phi) * Math.sin(theta)
      );
    }

    function makeLine(points, color, opacity, closed = false) {
      const vectors = points.map(([lat, lon]) => latLonToVector(lat, lon));
      if (closed && points.length > 1) vectors.push(vectors[0].clone());

      return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(vectors),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity
        })
      );
    }

    function makeGraticule() {
      const group = new THREE.Group();
      const color = 0x1b6f86;

      for (let lat = -60; lat <= 60; lat += 20) {
        const points = [];
        for (let lon = -180; lon <= 180; lon += 4) points.push([lat, lon]);
        group.add(makeLine(points, color, 0.42));
      }

      for (let lon = -180; lon < 180; lon += 20) {
        const points = [];
        for (let lat = -80; lat <= 80; lat += 4) points.push([lat, lon]);
        group.add(makeLine(points, color, 0.34));
      }

      return group;
    }

    const fallbackLandShapes = [
      [[72,-168],[70,-142],[60,-124],[51,-130],[44,-124],[32,-117],[25,-105],[18,-97],[13,-85],[9,-79],[18,-73],[26,-81],[31,-89],[38,-96],[45,-104],[54,-110],[61,-126],[68,-150]],
      [[13,-82],[7,-77],[1,-79],[-9,-78],[-18,-72],[-33,-71],[-46,-74],[-55,-68],[-50,-58],[-38,-57],[-24,-47],[-8,-35],[3,-43],[8,-55],[12,-66]],
      [[72,-20],[67,10],[60,28],[50,42],[42,30],[35,12],[36,-7],[45,-15],[55,-24],[65,-32]],
      [[37,-10],[50,4],[58,24],[52,44],[42,61],[31,72],[22,58],[12,43],[3,36],[-11,28],[-28,19],[-35,18],[-35,31],[-25,41],[-5,50],[10,61],[24,80],[34,92],[46,88],[57,70],[64,42],[70,18],[67,-4],[55,-10]],
      [[36,32],[25,36],[12,43],[5,48],[-12,42],[-26,31],[-34,22],[-34,14],[-20,12],[-3,11],[12,18],[25,25]],
      [[8,72],[20,79],[29,88],[23,97],[9,91],[6,80]],
      [[55,70],[62,95],[59,124],[48,140],[35,124],[26,104],[35,86]],
      [[45,126],[37,139],[30,121],[21,106],[12,103],[3,112],[-6,107],[-8,96],[2,88],[16,97],[28,103]],
      [[-11,112],[-18,123],[-30,134],[-39,145],[-36,154],[-22,153],[-13,143],[-13,130]],
      [[-13,48],[-20,47],[-25,43],[-21,49],[-15,51]],
      [[-61,-62],[-64,-18],[-66,48],[-63,112],[-70,160],[-75,-150],[-72,-92]],
      [[76,-44],[80,-20],[77,15],[72,28],[68,5],[70,-28]]
    ];

    earth.add(makeGraticule());

    const coastlines = new THREE.Group();
    earth.add(coastlines);
    let countryFeatures = [];
    let countrySelector = null;

    function addFallbackCoastlines() {
      fallbackLandShapes.forEach((shape) => {
        coastlines.add(makeLine(shape, 0x82f7ff, 0.9, true));
      });
    }

    function addGeoJsonPolygonRing(ring, color, opacity) {
      if (ring.length < 2) return;

      const points = ring.map(([lon, lat]) => [lat, lon]);
      coastlines.add(makeLine(points, color, opacity, false));
    }

    function drawCountryGeometry(geometry) {
      if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach((ring) => addGeoJsonPolygonRing(ring, 0x82f7ff, 0.92));
      }

      if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => addGeoJsonPolygonRing(ring, 0x82f7ff, 0.92));
        });
      }
    }

    async function loadCountryNames() {
      try {
        const response = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.tsv');
        if (!response.ok) return {};
        const text = await response.text();
        return Object.fromEntries(text.trim().split(/\r?\n/).slice(1).map((line) => {
          const [id, name] = line.split('\t');
          return [id, name];
        }).filter(([id, name]) => id && name));
      } catch (error) {
        console.warn('Country names failed to load.', error);
        return {};
      }
    }

    async function loadAccurateCoastlines() {
      try {
        const [response, countryNames] = await Promise.all([
          fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'),
          loadCountryNames()
        ]);
        if (!response.ok) throw new Error(`World map request failed: ${response.status}`);

        const world = await response.json();
        const countries = topojson.feature(world, world.objects.countries);
        countries.features.forEach((feature) => {
          if (!feature.properties) feature.properties = {};
          feature.properties.name = countryNames[feature.id] || feature.properties.name;
        });
        countryFeatures = countries.features;
        if (countrySelector) countrySelector.setCountries(countryFeatures);
        countries.features.forEach((feature) => drawCountryGeometry(feature.geometry));
      } catch (error) {
        console.warn('Using fallback continent outlines because world-atlas failed to load.', error);
        addFallbackCoastlines();
      }
    }

    loadAccurateCoastlines();

    const lighting = window.createLightingManager({
      THREE,
      scene,
      earth,
      moon,
      sun,
      radius,
      moonRadius
    });

    const satellites = window.createSatelliteManager({
      THREE,
      radius,
      earthSystem,
      satelliteStatus
    });
    const satelliteLayer = satellites.layer;
    const realSatellites = satellites.realSatellites;
    satellites.loadSource(satelliteSourceInput.value);

    const earthEvents = window.createEarthEventsManager({
      THREE,
      radius,
      earth,
      earthquakeStatus,
      locationStatus
    });
    earthEvents.loadEarthquakes(true);

    const spaceWeather = window.createSpaceWeatherManager({
      THREE,
      radius,
      earth,
      spaceWeatherStatus,
      auroraStatus
    });
    spaceWeather.refresh(true);

const distanceLines = new THREE.Group();
    solarSystem.add(distanceLines);

    const earthMoonLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({
        color: 0x8df2ff,
        transparent: true,
        opacity: 0.34
      })
    );
    distanceLines.add(earthMoonLine);

    const earthSunLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({
        color: 0xffd45a,
        transparent: true,
        opacity: 0.2
      })
    );
    distanceLines.add(earthSunLine);

    function updateLine(line, start, end) {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    }

    const selectedPulse = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0], 3)
      ),
      new THREE.PointsMaterial({
        color: 0xfff26f,
        size: 0.045,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        depthTest: false,
        depthWrite: false
      })
    );
    selectedPulse.visible = false;
    selectedPulse.renderOrder = 20;
    scene.add(selectedPulse);

    function hideSelectedPulse() {
      selectedPulse.visible = false;
    }

    function updateSelectedPulse(target) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.007);
      selectedPulse.visible = true;
      selectedPulse.position.copy(target);
      selectedPulse.material.size = 0.036 + pulse * 0.014;
      selectedPulse.material.opacity = 0.72 + pulse * 0.28;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.075;
    const mouse = new THREE.Vector2();
    countrySelector = window.createCountrySelectorManager({
      THREE,
      earth,
      shell,
      radius,
      renderer,
      camera,
      container,
      raycaster,
      mouse,
      latLonToVector,
      getEarthEvents: () => earthEvents
    });
    countrySelector.setCountries(countryFeatures);
    const cameraFocus = {
      mode: 'earth',
      object: null,
      index: -1,
      name: '',
      targetPosition: new THREE.Vector3(0, 0, 0),
      desiredPosition: new THREE.Vector3(0, 0, camera.position.z)
    };

    function getSatellitePointObjects() {
      const pointObjects = [];
      satelliteLayer.traverse((child) => {
        if (child.isPoints) pointObjects.push(child);
      });
      return pointObjects;
    }

    function getSatelliteHit(event) {
      if (!satelliteLayer.visible) return null;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObjects(getSatellitePointObjects(), true);
      if (!intersects.length) return null;

      const hit = intersects[0];
      const names = hit.object.userData.names || [];
      return {
        object: hit.object,
        index: hit.index,
        name: names[hit.index] || hit.object.userData.source || 'Satellite',
        detail: satellites.getDetail(hit.object, hit.index)
      };
    }

    function getSatelliteWorldPosition(object, index) {
      const position = object.geometry.getAttribute('position');
      if (!position || index < 0 || index >= position.count) return null;

      const localPosition = new THREE.Vector3().fromBufferAttribute(position, index);
      return object.localToWorld(localPosition);
    }

    function hideHoverLabel() {
      hoverLabel.style.display = 'none';
      hoverLabel.textContent = '';
    }

    function updateSatelliteHover(event) {
      if (pointer.active) return;

      const hit = getSatelliteHit(event);
      if (!hit) {
        hideHoverLabel();
        return;
      }

      hoverLabel.textContent = hit.detail ? satellites.getDetailText(hit.detail) : hit.name;
      hoverLabel.style.left = `${event.clientX + 12}px`;
      hoverLabel.style.top = `${event.clientY + 12}px`;
      hoverLabel.style.display = 'block';
    }

    function focusEarth() {
      cameraFocus.mode = 'earth';
      cameraFocus.object = null;
      cameraFocus.index = -1;
      cameraFocus.name = '';
      selectedSatellite.textContent = 'selected none';
      satelliteDetails.textContent = 'details --';
      hideSelectedPulse();
      hideHoverLabel();
    }

    function focusSatellite(hit) {
      cameraFocus.mode = 'satellite';
      cameraFocus.object = hit.object;
      cameraFocus.index = hit.index;
      cameraFocus.name = hit.name;
      selectedSatellite.textContent = `selected ${hit.name}`;
      satelliteDetails.textContent = hit.detail
        ? satellites.getDetailText(hit.detail).split('\n').slice(1).join(' / ')
        : 'details unavailable';
      hoverLabel.textContent = hit.detail ? satellites.getDetailText(hit.detail) : hit.name;
      hoverLabel.style.display = 'block';
    }

    function updateCameraFocus() {
      if (cameraFocus.mode === 'satellite' && cameraFocus.object) {
        const target = getSatelliteWorldPosition(cameraFocus.object, cameraFocus.index);
        if (!target) {
          focusEarth();
          return;
        }

        cameraFocus.targetPosition.copy(target);
        updateSelectedPulse(target);
        const direction = target.clone().normalize();
        if (direction.lengthSq() < 0.0001) direction.set(0, 0, 1);
        cameraFocus.desiredPosition.copy(target).add(direction.multiplyScalar(0.72));
      } else {
        hideSelectedPulse();
        cameraFocus.targetPosition.set(0, 0, 0);
        cameraFocus.desiredPosition.set(0, 0, THREE.MathUtils.clamp(getDefaultCameraZ() + zoomOffset, 2.25, 36));
      }

      camera.position.lerp(cameraFocus.desiredPosition, 0.08);
      camera.lookAt(cameraFocus.targetPosition);
    }

    const pointer = {
      active: false,
      id: null,
      x: 0,
      y: 0,
      startX: 0,
      startY: 0,
      moved: false
    };

    renderer.domElement.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      countrySelector.selectAtEvent(event);
    });

    renderer.domElement.addEventListener('pointerdown', (event) => {
      if (event.button === 2) {
        countrySelector.selectAtEvent(event);
        return;
      }
      if (event.button > 1) return;

      const hit = getSatelliteHit(event);
      if (hit) {
        focusSatellite(hit);
      }

      if (event.pointerType === 'touch') countrySelector.beginLongPress(event);

      pointer.active = true;
      pointer.id = event.pointerId;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.startX = event.clientX;
      pointer.startY = event.clientY;
      pointer.moved = false;
      container.classList.add('dragging');
      renderer.domElement.setPointerCapture(event.pointerId);
    });

    renderer.domElement.addEventListener('pointermove', (event) => {
      updateSatelliteHover(event);
      if (!pointer.active || event.pointerId !== pointer.id) return;

      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      const totalDx = event.clientX - pointer.startX;
      const totalDy = event.clientY - pointer.startY;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.moved = pointer.moved || Math.hypot(totalDx, totalDy) > 4;
      countrySelector.moveLongPress(event);

      if (!pointer.moved && cameraFocus.mode === 'satellite') return;

      solarSystem.rotation.y += dx * 0.006;
      solarSystem.rotation.x += dy * 0.006;
      solarSystem.rotation.x = THREE.MathUtils.clamp(solarSystem.rotation.x, -Math.PI * 0.48, Math.PI * 0.48);
    });

    function stopDrag(event) {
      if (!pointer.active || event.pointerId !== pointer.id) return;

      pointer.active = false;
      pointer.id = null;
      container.classList.remove('dragging');
      countrySelector.cancelLongPress();
      renderer.domElement.releasePointerCapture(event.pointerId);
    }

    renderer.domElement.addEventListener('pointerup', stopDrag);
    renderer.domElement.addEventListener('pointercancel', (event) => {
      countrySelector.cancelLongPress();
      stopDrag(event);
    });
    renderer.domElement.addEventListener('pointerleave', () => {
      countrySelector.cancelLongPress();
      hideHoverLabel();
    });

    renderer.domElement.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (cameraFocus.mode === 'satellite') {
        focusEarth();
      }
      zoomOffset += Math.sign(event.deltaY) * 0.28;
      zoomOffset = THREE.MathUtils.clamp(zoomOffset, -4.2, 12);
      applyCameraDistance();
    }, { passive: false });

    window.addEventListener('resize', () => {
      updateDeviceFormatClasses();
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      applyCameraDistance();
    });

    const simulation = {
      startDate: new Date(),
      startPerformance: performance.now(),
      timeScale: 3600,
      matchActualTime: true,
      earthSiderealDaySeconds: 86164.0905,
      moonSiderealOrbitSeconds: 27.321661 * 86400,
      earthSiderealYearSeconds: 365.256363004 * 86400,
      sunRadiusRatioToEarth,
      astronomicalUnitInEarthRadii,
      sunRadius: sunDisplayRadius,
      earthSunDistance
    };

    const timeScaleSteps = [1, 60, 600, 1800, 3600, 21600, 86400];

    function setPanelMinimized(minimized) {
      panel.classList.toggle('is-minimized', minimized);
      togglePanelButton.textContent = minimized ? '+' : '-';
      togglePanelButton.setAttribute('aria-expanded', String(!minimized));
      togglePanelButton.setAttribute('aria-label', minimized ? 'Show settings' : 'Minimize settings');
    }

    togglePanelButton.addEventListener('click', () => {
      setPanelMinimized(!panel.classList.contains('is-minimized'));
    });

    setPanelMinimized(true);

    if (controllerButton) {
      controllerButton.addEventListener('click', () => {
        setControllerEnabled(!virtualController.enabled);
      });
    }

    if (zoomHalo) {
      zoomHalo.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        virtualController.zoomPointerId = event.pointerId;
        zoomHalo.setPointerCapture(event.pointerId);
        updateZoomHalo(event);
      });

      zoomHalo.addEventListener('pointermove', (event) => {
        if (virtualController.zoomPointerId !== event.pointerId) return;
        event.preventDefault();
        updateZoomHalo(event);
      });

      const stopZoomControl = (event) => {
        if (virtualController.zoomPointerId !== event.pointerId) return;
        virtualController.zoomPointerId = null;
        virtualController.zoom = 0;
        setControllerStickPosition(zoomStick, 0, 0);
      };

      zoomHalo.addEventListener('pointerup', stopZoomControl);
      zoomHalo.addEventListener('pointercancel', stopZoomControl);
    }

    if (directionHalo) {
      directionHalo.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        virtualController.directionPointerId = event.pointerId;
        directionHalo.setPointerCapture(event.pointerId);
        updateDirectionHalo(event);
      });

      directionHalo.addEventListener('pointermove', (event) => {
        if (virtualController.directionPointerId !== event.pointerId) return;
        event.preventDefault();
        updateDirectionHalo(event);
      });

      const stopDirectionControl = (event) => {
        if (virtualController.directionPointerId !== event.pointerId) return;
        virtualController.directionPointerId = null;
        virtualController.rotateX = 0;
        virtualController.rotateY = 0;
        setControllerStickPosition(directionStick, 0, 0);
      };

      directionHalo.addEventListener('pointerup', stopDirectionControl);
      directionHalo.addEventListener('pointercancel', stopDirectionControl);
    }

    function isFullscreen() {
      return Boolean(
        document.fullscreenElement
        || document.webkitFullscreenElement
        || document.msFullscreenElement
      );
    }

    function updateFullscreenButton() {
      if (!fullscreenToggleButton) return;
      const fullscreen = isFullscreen();
      fullscreenToggleButton.textContent = fullscreen ? 'Exit immersion' : 'Full immersion';
      fullscreenToggleButton.setAttribute(
        'aria-label',
        fullscreen ? 'Exit full screen view' : 'Enter full screen view'
      );
    }

    async function toggleFullscreen() {
      try {
        if (isFullscreen()) {
          const exitFullscreen = document.exitFullscreen
            || document.webkitExitFullscreen
            || document.msExitFullscreen;
          if (exitFullscreen) await exitFullscreen.call(document);
        } else {
          const requestFullscreen = container.requestFullscreen
            || container.webkitRequestFullscreen
            || container.msRequestFullscreen;
          if (requestFullscreen) await requestFullscreen.call(container);
        }
      } catch (error) {
        console.warn('Fullscreen request failed.', error);
      } finally {
        updateFullscreenButton();
      }
    }

    if (fullscreenToggleButton) {
      fullscreenToggleButton.addEventListener('click', toggleFullscreen);
      document.addEventListener('fullscreenchange', updateFullscreenButton);
      document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
      updateFullscreenButton();
    }

    function setWidgetVisible(widget, visible) {
      widget.style.display = visible ? 'flex' : 'none';
    }

    function updateCalendarWidget(date) {
      const two = (value) => String(value).padStart(2, '0');
      calendarDate.textContent = [
        two(date.getMonth() + 1),
        two(date.getDate()),
        two(date.getFullYear() % 100)
      ].join('/');
      calendarTime.textContent = [
        two(date.getHours()),
        two(date.getMinutes()),
        two(date.getSeconds())
      ].join(':');
    }

    function updateCalendarLockCalendar(date) {
      if (!calendarLockGrid || !calendarLockMonth) return;
      calendarLockMonth.textContent = new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric'
      }).format(date).toUpperCase();

      calendarLockGrid.textContent = '';
      ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].forEach((dayName) => {
        const cell = document.createElement('span');
        cell.className = 'day-name';
        cell.textContent = dayName;
        calendarLockGrid.appendChild(cell);
      });

      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let index = 0; index < firstDay; index += 1) {
        calendarLockGrid.appendChild(document.createElement('span'));
      }
      for (let day = 1; day <= daysInMonth; day += 1) {
        const cell = document.createElement('span');
        cell.textContent = String(day);
        calendarLockGrid.appendChild(cell);
      }
    }

    function updateCalendarLock(date) {
      if (!calendarLockScreen?.classList.contains('is-active')) return;
      const two = (value) => String(value).padStart(2, '0');
      const hours = date.getHours();
      const displayHour = hours % 12 || 12;
      if (calendarLockTime) {
        calendarLockTime.textContent = [
          two(displayHour),
          two(date.getMinutes()),
          two(date.getSeconds())
        ].join(':');
      }
      if (calendarLockPeriod) calendarLockPeriod.textContent = hours >= 12 ? 'PM' : 'AM';
      if (calendarLockSubseconds) calendarLockSubseconds.textContent = String(date.getMilliseconds()).padStart(3, '0');
      if (calendarLockStamp) {
        calendarLockStamp.textContent = [
          two(date.getMonth() + 1),
          two(date.getDate()),
          two(date.getFullYear() % 100),
          two(date.getHours()),
          two(date.getMinutes()),
          two(date.getSeconds())
        ].join('/');
      }
    }

    function openCalendarLock() {
      if (!calendarLockScreen) return;
      calendarLockForm?.reset();
      if (calendarLockUser) calendarLockUser.value = '';
      if (calendarLockPass) calendarLockPass.value = '';
      const now = new Date();
      updateCalendarLockCalendar(now);
      calendarLockScreen.classList.add('is-active');
      calendarLockScreen.setAttribute('aria-hidden', 'false');
      updateCalendarLock(now);

      const requestFullscreen = calendarLockScreen.requestFullscreen
        || calendarLockScreen.webkitRequestFullscreen
        || calendarLockScreen.msRequestFullscreen;
      if (requestFullscreen && !document.fullscreenElement && !document.webkitFullscreenElement) {
        const request = requestFullscreen.call(calendarLockScreen);
        if (request?.catch) request.catch(() => {});
      }

      setTimeout(() => calendarLockUser?.focus(), 0);
    }

    function closeCalendarLock() {
      if (!calendarLockScreen) return;
      calendarLockScreen.classList.remove('is-active');
      calendarLockScreen.setAttribute('aria-hidden', 'true');
      calendarLockForm?.reset();
      if (calendarLockUser) calendarLockUser.value = '';
      if (calendarLockPass) calendarLockPass.value = '';
      if (document.fullscreenElement === calendarLockScreen && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitFullscreenElement === calendarLockScreen && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }

    function weatherCodeLabel(code) {
      if (code === 0) return 'clear';
      if ([1, 2, 3].includes(code)) return 'clouds';
      if ([45, 48].includes(code)) return 'fog';
      if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
      if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
      if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
      if ([95, 96, 99].includes(code)) return 'storm';
      return 'weather';
    }

    async function updateWeatherWidget(lat, lon) {
      weatherTemp.textContent = 'Weather ...';
      weatherMeta.textContent = 'loading';

      try {
        const params = new URLSearchParams({
          latitude: lat.toFixed(4),
          longitude: lon.toFixed(4),
          current: 'temperature_2m,weather_code,wind_speed_10m',
          temperature_unit: 'fahrenheit',
          wind_speed_unit: 'mph'
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!response.ok) throw new Error(`Open-Meteo request failed: ${response.status}`);

        const data = await response.json();
        const current = data.current || {};
        const temperature = Number(current.temperature_2m);
        const wind = Number(current.wind_speed_10m);
        const code = Number(current.weather_code);

        weatherTemp.textContent = Number.isFinite(temperature)
          ? `${temperature.toFixed(0)} F`
          : 'Weather --';
        weatherMeta.textContent = `${weatherCodeLabel(code)}${Number.isFinite(wind) ? ` / ${wind.toFixed(0)} mph` : ''}`;
      } catch (error) {
        console.warn('Could not load Open-Meteo weather.', error);
        weatherTemp.textContent = 'Weather --';
        weatherMeta.textContent = 'unavailable';
      }
    }

    function loadWeatherForCurrentLocation() {
      const location = earthEvents.getUserLocation();
      if (!location) {
        weatherTemp.textContent = 'Weather --';
        weatherMeta.textContent = 'set location first';
        return;
      }

      updateWeatherWidget(location.lat, location.lon);
    }

    function getGeoUserKey() {
      let key = localStorage.getItem(geoUserStorageKey) || '';
      if (!/^[a-zA-Z0-9_-]{24,96}$/.test(key)) {
        const values = new Uint8Array(24);
        crypto.getRandomValues(values);
        key = `geo_${btoa(String.fromCharCode(...values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
        localStorage.setItem(geoUserStorageKey, key);
      }
      return key;
    }

    async function collectGeoPoint(event) {
      const detail = event.detail || {};
      const lat = Number(detail.lat);
      const lon = Number(detail.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      try {
        const response = await fetch(geoCollectEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat,
            lon,
            accuracy: Number.isFinite(Number(detail.accuracy)) ? Number(detail.accuracy) : null,
            source: 'globe-user-location',
            user_key: getGeoUserKey()
          })
        });
        if (!response.ok) throw new Error(`geo ${response.status}`);
        locationStatus.title = 'location saved to geo database';
      } catch (error) {
        console.warn('Could not save geo point.', error);
        locationStatus.title = 'location set; geo save failed';
      }
    }

    function resetSimulationClock(nextScale = simulation.timeScale) {
      simulation.startDate = new Date();
      simulation.startPerformance = performance.now();
      simulation.timeScale = nextScale;
    }

    function updateTimeScaleLabel() {
      timeScaleValue.textContent = `${simulation.timeScale}x`;
    }

    timeScaleInput.addEventListener('input', () => {
      const nextScale = timeScaleSteps[Number(timeScaleInput.value)];
      actualTimeInput.checked = false;
      simulation.matchActualTime = false;
      resetSimulationClock(nextScale);
      updateTimeScaleLabel();
    });

    slowTimeButton.addEventListener('click', () => {
      const nextIndex = Math.max(0, Number(timeScaleInput.value) - 1);
      timeScaleInput.value = String(nextIndex);
      timeScaleInput.dispatchEvent(new Event('input'));
    });

    earthFocusButton.addEventListener('click', focusEarth);

    actualTimeInput.addEventListener('change', () => {
      simulation.matchActualTime = actualTimeInput.checked;
      if (!simulation.matchActualTime) {
        resetSimulationClock(simulation.timeScale);
      }
    });

    distanceLinesInput.addEventListener('change', () => {
      distanceLines.visible = distanceLinesInput.checked;
    });

    dayNightInput.addEventListener('change', () => {
      lighting.setDayNightVisible(dayNightInput.checked);
    });

    moonPhaseInput.addEventListener('change', () => {
      lighting.setMoonPhaseVisible(moonPhaseInput.checked);
    });

    satellitesInput.addEventListener('change', () => {
      satelliteLayer.visible = satellitesInput.checked;
      if (!satellitesInput.checked) {
        focusEarth();
        hideHoverLabel();
      }
    });

    earthquakesInput.addEventListener('change', () => {
      earthEvents.setEarthquakesVisible(earthquakesInput.checked);
    });

    spaceWeatherInput.addEventListener('change', () => {
      spaceWeather.setVisible(spaceWeatherInput.checked);
    });

    showCalendarInput.addEventListener('change', () => {
      setWidgetVisible(calendarWidget, showCalendarInput.checked);
    });

    if (calendarWidget) {
      calendarWidget.addEventListener('click', openCalendarLock);
    }

    if (calendarLockForm) {
      calendarLockForm.addEventListener('submit', (event) => {
        event.preventDefault();
        closeCalendarLock();
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && calendarLockScreen?.classList.contains('is-active')) {
        closeCalendarLock();
      }
    });

    showWeatherInput.addEventListener('change', () => {
      setWidgetVisible(weatherWidget, showWeatherInput.checked);
    });

    if (spaceBackgroundInput) {
      spaceBackgroundInput.addEventListener('change', () => {
        setSpaceBackground(spaceBackgroundInput.value);
      });
    }

    if (controlsOpacityInput) {
      controlsOpacityInput.addEventListener('input', () => {
        setControlsOpacity(controlsOpacityInput.value);
      });
    }

    satelliteSourceInput.addEventListener('change', () => {
      focusEarth();
      hideHoverLabel();
      satelliteStatus.textContent = 'satellites loading...';
      satellites.loadSource(satelliteSourceInput.value);
    });

    useLocationButton.addEventListener('click', () => {
      earthEvents.requestUserLocation();
    });

    loadWeatherButton.addEventListener('click', loadWeatherForCurrentLocation);

    window.addEventListener('globe:user-location', loadWeatherForCurrentLocation);
    window.addEventListener('globe:user-location', collectGeoPoint);

    updateTimeScaleLabel();
    distanceLines.visible = distanceLinesInput.checked;
    lighting.setDayNightVisible(dayNightInput.checked);
    lighting.setMoonPhaseVisible(moonPhaseInput.checked);
    satelliteLayer.visible = satellitesInput.checked;
    earthEvents.setEarthquakesVisible(earthquakesInput.checked);
    spaceWeather.setVisible(spaceWeatherInput.checked);
    setWidgetVisible(calendarWidget, showCalendarInput.checked);
    setWidgetVisible(weatherWidget, showWeatherInput.checked);
    setSpaceBackground(localStorage.getItem(backgroundStorageKey) || 'black');
    setControlsOpacity(localStorage.getItem(controlsOpacityStorageKey) || (controlsOpacityInput && controlsOpacityInput.value) || 82);

    function formatClock(date) {
      if (countrySelector) return countrySelector.formatClock(date);
      const two = (value) => String(value).padStart(2, '0');
      return [
        two(date.getMonth() + 1),
        two(date.getDate()),
        two(date.getFullYear() % 100),
        two(date.getHours()),
        two(date.getMinutes()),
        two(date.getSeconds())
      ].join('/');
    }

    function animate(now) {
      const currentDate = new Date();
      const simulatedElapsedSeconds = simulation.matchActualTime
        ? (currentDate.getTime() / 1000)
        : ((now - simulation.startPerformance) / 1000) * simulation.timeScale;
      const simulatedDate = simulation.matchActualTime
        ? currentDate
        : new Date(simulation.startDate.getTime() + simulatedElapsedSeconds * 1000);
      const earthAngle = (simulatedElapsedSeconds / simulation.earthSiderealDaySeconds) * Math.PI * 2 + earthViewRotationOffset;
      const moonAngle = (simulatedElapsedSeconds / simulation.moonSiderealOrbitSeconds) * Math.PI * 2 + moonViewOrbitOffset;

      earth.rotation.y = earthAngle;
      earth.updateWorldMatrix(true, false);
      const solarPosition = sunVectorForDate(simulatedDate);
      const sunWorldPosition = earth.localToWorld(
        solarPosition.localDirection.clone().multiplyScalar(earthSunDistance)
      );
      const sunPosition = solarSystem.worldToLocal(sunWorldPosition);

      sun.position.copy(sunPosition);
      moon.position.copy(moonOrbitPoint(moonAngle));
      moon.rotation.y = -moonAngle;
      sun.rotation.y += 0.00035;
      clock.textContent = formatClock(simulatedDate);
      updateCalendarWidget(simulatedDate);
      updateCalendarLock(currentDate);
      sunDirection.textContent = `subsolar ${solarPosition.subsolarLongitude.toFixed(1)} lon / ${solarPosition.declination.toFixed(1)} lat`;
      sunDistance.textContent = `distance ${(earthSunDistance / radius).toLocaleString(undefined, { maximumFractionDigits: 0 })} Earth radii`;

      const moonWorld = new THREE.Vector3();
      moon.getWorldPosition(moonWorld);
      solarSystem.worldToLocal(moonWorld);
      updateLine(earthMoonLine, new THREE.Vector3(0, 0, 0), moonWorld);
      updateLine(earthSunLine, new THREE.Vector3(0, 0, 0), sun.position.clone());

      lighting.update();
      satellites.update(simulatedDate);
      earthEvents.loadEarthquakes(false);
      spaceWeather.refresh(false);
      const issDetail = satellites.getIssDetail();
      issStatus.textContent = issDetail && Number.isFinite(issDetail.altitudeKm)
        ? `ISS alt ${issDetail.altitudeKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
        : 'ISS not in group';
      const observerPosition = earthEvents.getObserverPositionInEarthSystem(earthSystem);
      const visibleCount = observerPosition ? satellites.countVisibleFrom(observerPosition) : null;
      visibleSatellites.textContent = visibleCount === null
        ? 'visible sats set location'
        : `visible sats ${visibleCount.toLocaleString()}`;
      applyVirtualControllerInput();
      updateCameraFocus();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);

    window._globe = { scene, camera, renderer, solarSystem, sun, earthSystem, earth, moon, satelliteLayer, selectedPulse, realSatellites, earthEvents, spaceWeather, simulation };


