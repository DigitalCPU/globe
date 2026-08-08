(function () {
  function createSatelliteManager({ THREE, radius, earthSystem, satelliteStatus }) {
    const satelliteLayer = new THREE.Group();
    earthSystem.add(satelliteLayer);

    let usingRealSatellites = false;
    let visibleSatelliteNames = [];
    let visibleSatelliteDetails = [];
    let visibleSatellitePositions = [];
    let satelliteApi = null;

    const realSatelliteGeometry = new THREE.BufferGeometry();
    const realSatelliteMaterial = new THREE.PointsMaterial({
      color: 0xaaf7ff,
      size: 0.012,
      transparent: true,
      opacity: 0.78,
      sizeAttenuation: true
    });
    const realSatellitePoints = new THREE.Points(realSatelliteGeometry, realSatelliteMaterial);
    const realSatellites = [];
    const realSatelliteLimit = 1200;

    const issGeometry = new THREE.BufferGeometry();
    const issMarker = new THREE.Points(
      issGeometry,
      new THREE.PointsMaterial({
        color: 0xfff26f,
        size: 0.055,
        transparent: true,
        opacity: 0.96,
        sizeAttenuation: true
      })
    );
    issMarker.visible = false;
    issMarker.userData.names = ['ISS (ZARYA)'];
    issMarker.userData.details = [];
    issMarker.userData.source = 'ISS highlight';

    const fallbackSatelliteShells = [
      { count: 720, altitude: 0.35, spread: 0.55, color: 0xaaf7ff, size: 0.016, opacity: 0.78, speed: 0.006 },
      { count: 120, altitude: 1.55, spread: 0.5, color: 0x78dfff, size: 0.018, opacity: 0.62, speed: 0.0022 },
      { count: 80, altitude: 3.05, spread: 0.25, color: 0xfff1a8, size: 0.02, opacity: 0.72, speed: 0.001 },
      { count: 60, altitude: 4.6, spread: 0.7, color: 0x7bb7ff, size: 0.017, opacity: 0.45, speed: 0.00055 }
    ];

    const satelliteSources = {
      'local-starlink': [
        { label: 'local Starlink TLE cache', url: 'active.tle' }
      ],
      'iss-live': [
        { label: 'CelesTrak ISS', url: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle' },
        { label: 'CelesTrak stations', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle' }
      ],
      'active-live': [
        { label: 'CelesTrak active', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle' }
      ],
      'starlink-live': [
        { label: 'CelesTrak Starlink', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle' },
        { label: 'local Starlink TLE cache backup', url: 'active.tle' }
      ]
    };

    function makeSatelliteShell({ count, altitude, spread, color, size, opacity, speed }) {
      const shell = new THREE.Group();
      shell.userData.speed = speed;

      const positions = [];
      const names = [];
      for (let i = 0; i < count; i += 1) {
        const orbitRadius = radius + altitude + (Math.random() - 0.5) * spread;
        const phase = Math.random() * Math.PI * 2;
        const inclination = THREE.MathUtils.degToRad(-70 + Math.random() * 140);
        const node = Math.random() * Math.PI * 2;
        const point = new THREE.Vector3(Math.cos(phase) * orbitRadius, 0, Math.sin(phase) * orbitRadius);

        point.applyAxisAngle(new THREE.Vector3(1, 0, 0), inclination);
        point.applyAxisAngle(new THREE.Vector3(0, 1, 0), node);
        positions.push(point.x, point.y, point.z);
        names.push(`Visual satellite ${String(i + 1).padStart(3, '0')}`);
      }

      const satellites = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.PointsMaterial({ color, size, transparent: true, opacity })
      );
      satellites.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      satellites.userData.names = names;
      satellites.userData.source = 'Visual fallback';
      shell.add(satellites);
      return shell;
    }

    function loadFallback() {
      usingRealSatellites = false;
      realSatellites.splice(0, realSatellites.length);
      visibleSatelliteNames = [];
      visibleSatelliteDetails = [];
      visibleSatellitePositions = [];
      satelliteLayer.clear();
      fallbackSatelliteShells.forEach((shellConfig) => satelliteLayer.add(makeSatelliteShell(shellConfig)));
      satelliteStatus.textContent = 'satellites visual fallback';
      satelliteStatus.title = 'Visual fallback';
    }

    async function getSatelliteApi() {
      if (satelliteApi) return satelliteApi;

      satelliteApi = window.satellite || window.satellitejs || null;
      if (satelliteApi) return satelliteApi;

      try {
        satelliteApi = await import('https://cdn.jsdelivr.net/npm/satellite.js@5/+esm');
      } catch (error) {
        console.warn('Could not import satellite.js module.', error);
      }

      return satelliteApi;
    }

    function parseTleSet(tleText) {
      const lines = tleText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const records = [];

      for (let i = 0; i < lines.length - 2; i += 3) {
        if (!lines[i + 1].startsWith('1 ') || !lines[i + 2].startsWith('2 ')) continue;

        try {
          records.push({
            name: lines[i],
            line1: lines[i + 1],
            line2: lines[i + 2],
            satrec: satelliteApi.twoline2satrec(lines[i + 1], lines[i + 2])
          });
        } catch (error) {
          console.warn('Skipping invalid TLE record.', lines[i], error);
        }
      }

      return records;
    }

    function sampleSatellites(records, limit) {
      if (records.length <= limit) return records;

      const sampled = [];
      const step = records.length / limit;
      for (let i = 0; i < limit; i += 1) {
        sampled.push(records[Math.floor(i * step)]);
      }
      return sampled;
    }

    function hasIssName(record) {
      return /(^|\s)(ISS|ZARYA)(\s|$|\()/i.test(record.name);
    }

    function ensureIssIncluded(records, sampled) {
      const issRecord = records.find(hasIssName);
      if (!issRecord || sampled.includes(issRecord)) return sampled;

      const nextSample = sampled.slice();
      if (nextSample.length >= realSatelliteLimit) nextSample[nextSample.length - 1] = issRecord;
      else nextSample.push(issRecord);
      return nextSample;
    }

    function orbitTypeFromAltitude(altitudeKm) {
      if (!Number.isFinite(altitudeKm)) return 'unknown orbit';
      if (altitudeKm < 2000) return 'LEO';
      if (altitudeKm < 35786 - 1500) return 'MEO';
      if (altitudeKm < 35786 + 1500) return 'GEO';
      return 'high Earth orbit';
    }

    function formatDetailLines(detail) {
      if (!detail) return ['details unavailable'];

      const lines = [
        detail.name,
        `NORAD ${detail.noradId || '--'} / ${detail.orbitType}`
      ];

      if (Number.isFinite(detail.altitudeKm)) {
        lines.push(`alt ${detail.altitudeKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`);
      }

      if (Number.isFinite(detail.speedKmS)) {
        lines.push(`speed ${detail.speedKmS.toFixed(2)} km/s`);
      }

      return lines;
    }

    async function fetchTleFromSources(sourceKey) {
      const sources = satelliteSources[sourceKey] || satelliteSources['local-starlink'];

      for (const source of sources) {
        try {
          const response = await fetch(source.url);
          if (!response.ok) throw new Error(`${source.label} request failed: ${response.status}`);
          return { label: source.label, text: await response.text() };
        } catch (error) {
          console.warn(`Could not load ${source.label}.`, error);
        }
      }

      throw new Error('No TLE source could be loaded.');
    }

    async function loadSource(sourceKey = 'local-starlink') {
      if (sourceKey === 'fallback') {
        loadFallback();
        return;
      }

      satelliteApi = await getSatelliteApi();
      if (!satelliteApi) {
        console.warn('satellite.js did not load; using visual fallback satellites.');
        loadFallback();
        return;
      }

      try {
        const tleSource = await fetchTleFromSources(sourceKey);
        const parsedRecords = parseTleSet(tleSource.text);
        const records = ensureIssIncluded(parsedRecords, sampleSatellites(parsedRecords, realSatelliteLimit));
        if (!records.length) throw new Error('No active satellite TLE records were parsed.');

        realSatellites.splice(0, realSatellites.length, ...records);
        visibleSatelliteNames = records.map((record) => record.name);
        visibleSatelliteDetails = [];
        visibleSatellitePositions = [];
        satelliteLayer.clear();
        satelliteLayer.add(realSatellitePoints);
        satelliteLayer.add(issMarker);
        realSatellitePoints.userData.names = visibleSatelliteNames;
        realSatellitePoints.userData.details = visibleSatelliteDetails;
        realSatellitePoints.userData.source = tleSource.label;
        usingRealSatellites = true;
        satelliteStatus.textContent = `satellites ${records.length.toLocaleString()} real TLE`;
        satelliteStatus.title = tleSource.label;
      } catch (error) {
        console.warn('Using fallback satellite shells because real TLE data failed to load.', error);
        loadFallback();
      }
    }

    function updateRealSatellites(date) {
      if (!usingRealSatellites || !realSatellites.length || !satelliteApi) return;

      const positions = [];
      const names = [];
      const details = [];
      const modelPositions = [];
      const earthRadiusKm = 6371;
      const modelScale = radius / earthRadiusKm;
      let issDetail = null;
      let issPosition = null;

      realSatellites.forEach(({ name, satrec }) => {
        const propagated = satelliteApi.propagate(satrec, date);
        const position = propagated && propagated.position;
        const velocity = propagated && propagated.velocity;
        if (!position) return;

        const modelPosition = new THREE.Vector3(position.x * modelScale, position.z * modelScale, -position.y * modelScale);
        const altitudeKm = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z) - earthRadiusKm;
        const speedKmS = velocity
          ? Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z)
          : NaN;
        const detail = {
          name,
          noradId: satrec.satnum,
          altitudeKm,
          speedKmS,
          orbitType: orbitTypeFromAltitude(altitudeKm),
          source: realSatellitePoints.userData.source
        };

        positions.push(modelPosition.x, modelPosition.y, modelPosition.z);
        names.push(name);
        details.push(detail);
        modelPositions.push(modelPosition);

        if (hasIssName({ name })) {
          issDetail = { ...detail, name: 'ISS (ZARYA)' };
          issPosition = modelPosition;
        }
      });

      visibleSatelliteNames = names;
      visibleSatelliteDetails = details;
      visibleSatellitePositions = modelPositions;
      realSatelliteGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      realSatelliteGeometry.computeBoundingSphere();
      realSatellitePoints.userData.names = visibleSatelliteNames;
      realSatellitePoints.userData.details = visibleSatelliteDetails;

      if (issPosition && issDetail) {
        issGeometry.setAttribute('position', new THREE.Float32BufferAttribute([issPosition.x, issPosition.y, issPosition.z], 3));
        issGeometry.computeBoundingSphere();
        issMarker.userData.names = [issDetail.name];
        issMarker.userData.details = [issDetail];
        issMarker.visible = true;
      } else {
        issMarker.visible = false;
        issMarker.userData.details = [];
      }
    }

    function spinFallbackShells() {
      satelliteLayer.children.forEach((shell, index) => {
        shell.rotation.y += shell.userData.speed;
        shell.rotation.x += shell.userData.speed * 0.17 * (index % 2 === 0 ? 1 : -1);
      });
    }

    function update(date) {
      updateRealSatellites(date);
      if (!usingRealSatellites) spinFallbackShells();
    }

    loadFallback();

    return {
      layer: satelliteLayer,
      realSatellites,
      loadSource,
      update,
      getDetail(object, index) {
        return (object.userData.details || [])[index] || null;
      },
      getDetailText(detail) {
        return formatDetailLines(detail).join('\n');
      },
      getIssDetail() {
        return issMarker.userData.details[0] || null;
      },
      countVisibleFrom(observerPosition) {
        if (!observerPosition || !visibleSatellitePositions.length) return null;

        const observerNormal = observerPosition.clone().normalize();
        let count = 0;

        visibleSatellitePositions.forEach((satellitePosition) => {
          const lookDirection = satellitePosition.clone().sub(observerPosition).normalize();
          if (lookDirection.dot(observerNormal) > 0) count += 1;
        });

        return count;
      }
    };
  }

  window.createSatelliteManager = createSatelliteManager;
})();
