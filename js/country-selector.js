(function () {
  const timeZoneKey = 'digitalcpu:globe-selected-time-zone:v1';

  function createEl(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function normalizeLon(lon) {
    let value = lon;
    while (value < -180) value += 360;
    while (value > 180) value -= 360;
    return value;
  }

  function unwrapLon(lon, nearLon) {
    let value = lon;
    while (value - nearLon > 180) value -= 360;
    while (value - nearLon < -180) value += 360;
    return value;
  }

  function pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = unwrapLon(ring[i][0], lon);
      const yi = ring[i][1];
      const xj = unwrapLon(ring[j][0], lon);
      const yj = ring[j][1];
      const crosses = (yi > lat) !== (yj > lat);
      if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(lat, lon, polygon) {
    if (!polygon.length || !pointInRing(lat, lon, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) {
      if (pointInRing(lat, lon, polygon[i])) return false;
    }
    return true;
  }

  function featureContains(feature, lat, lon) {
    const geometry = feature && feature.geometry;
    if (!geometry) return false;
    if (geometry.type === 'Polygon') return pointInPolygon(lat, lon, geometry.coordinates);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => pointInPolygon(lat, lon, polygon));
    return false;
  }

  function countryName(feature) {
    const props = feature.properties || {};
    return props.name || props.NAME || props.name_long || props.admin || `Country ${feature.id || ''}`.trim();
  }

  function ringCenter(ring) {
    const usable = ring.slice(0, Math.max(0, ring.length - 1));
    if (!usable.length) return [0, 0];
    const near = usable[0][0];
    const sum = usable.reduce((acc, point) => {
      acc.lon += unwrapLon(point[0], near);
      acc.lat += point[1];
      return acc;
    }, { lon: 0, lat: 0 });
    return [normalizeLon(sum.lon / usable.length), sum.lat / usable.length];
  }

  function defaultZones() {
    if (Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone');
    return [
      'UTC',
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York',
      'Europe/London',
      'Europe/Paris',
      'Asia/Tokyo',
      'Australia/Sydney'
    ];
  }

  function createCountrySelectorManager(options) {
    const { THREE, earth, shell, radius, renderer, camera, container, raycaster, mouse, latLonToVector, getEarthEvents } = options;
    const fillLayer = new THREE.Group();
    earth.add(fillLayer);

    const state = {
      countries: [],
      selectedFeature: null,
      selectedTimeZone: localStorage.getItem(timeZoneKey) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      longPressTimer: null,
      longPressPoint: null
    };

    const panel = createEl('section', 'country-panel');
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Country and time-zone controls');
    panel.innerHTML = [
      '<h2 id="selectedCountryName">No country selected</h2>',
      '<p id="selectedCountryMeta">Right-click or tap-hold a country.</p>',
      '<label>Time zone<select id="countryTimeZone"></select></label>',
      '<label>Location by zip code<div class="zip-row"><input id="countryZipCode" placeholder="ZIP code" inputmode="numeric"><button id="countryZipButton" type="button">Set</button></div></label>'
    ].join('');
    container.appendChild(panel);

    const nameEl = panel.querySelector('#selectedCountryName');
    const metaEl = panel.querySelector('#selectedCountryMeta');
    const zoneSelect = panel.querySelector('#countryTimeZone');
    const zipInput = panel.querySelector('#countryZipCode');
    const zipButton = panel.querySelector('#countryZipButton');

    defaultZones().forEach((zone) => {
      const option = document.createElement('option');
      option.value = zone;
      option.textContent = zone;
      zoneSelect.appendChild(option);
    });
    zoneSelect.value = state.selectedTimeZone;

    function latLonFromPointer(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObject(shell, false)[0];
      if (!hit) return null;
      const local = earth.worldToLocal(hit.point.clone()).normalize();
      const lat = THREE.MathUtils.radToDeg(Math.asin(local.y));
      const theta = Math.atan2(local.z, -local.x);
      const lon = normalizeLon(THREE.MathUtils.radToDeg(theta) - 180);
      return { lat, lon };
    }

    function findCountry(lat, lon) {
      return state.countries.find((feature) => featureContains(feature, lat, lon)) || null;
    }

    function makeFillGeometry(feature) {
      const positions = [];
      const addTriangle = (a, b, c) => {
        [a, b, c].forEach(([lon, lat]) => {
          const vector = latLonToVector(lat, lon, radius * 1.016);
          positions.push(vector.x, vector.y, vector.z);
        });
      };
      const addPolygon = (polygon) => {
        const ring = polygon[0] || [];
        if (ring.length < 4) return;
        const center = ringCenter(ring);
        for (let i = 0; i < ring.length - 1; i++) addTriangle(center, ring[i], ring[i + 1]);
      };

      if (feature.geometry.type === 'Polygon') addPolygon(feature.geometry.coordinates);
      if (feature.geometry.type === 'MultiPolygon') feature.geometry.coordinates.forEach(addPolygon);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      return geometry;
    }

    function drawSelection(feature) {
      fillLayer.clear();
      if (!feature) return;
      fillLayer.add(new THREE.Mesh(
        makeFillGeometry(feature),
        new THREE.MeshBasicMaterial({
          color: 0x4bd6ff,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      ));
    }

    function selectAtEvent(event) {
      const coords = latLonFromPointer(event);
      if (!coords) return false;
      const feature = findCountry(coords.lat, coords.lon);
      if (!feature) return false;
      state.selectedFeature = feature;
      drawSelection(feature);
      panel.hidden = false;
      nameEl.textContent = countryName(feature);
      metaEl.textContent = `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)} / fill 60%`;
      return true;
    }

    function selectedTimeZone() {
      return state.selectedTimeZone;
    }

    function formatClock(date) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: state.selectedTimeZone,
        month: '2-digit',
        day: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      return [parts.month, parts.day, parts.year, parts.hour, parts.minute, parts.second].join('/');
    }

    function beginLongPress(event) {
      clearTimeout(state.longPressTimer);
      state.longPressPoint = { x: event.clientX, y: event.clientY };
      state.longPressTimer = setTimeout(() => {
        selectAtEvent(event);
        state.longPressTimer = null;
      }, 620);
    }

    function cancelLongPress() {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
      state.longPressPoint = null;
    }

    function moveLongPress(event) {
      if (!state.longPressPoint) return;
      if (Math.hypot(event.clientX - state.longPressPoint.x, event.clientY - state.longPressPoint.y) > 10) cancelLongPress();
    }

    async function setLocationByZip() {
      const postalcode = zipInput.value.trim();
      if (!postalcode) return;
      zipButton.textContent = '...';
      try {
        const country = state.selectedFeature ? countryName(state.selectedFeature) : '';
        const params = new URLSearchParams({
          postalcode,
          format: 'jsonv2',
          limit: '1'
        });
        if (country) params.set('country', country);
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
        const results = await response.json();
        if (!response.ok || !Array.isArray(results) || !results.length) throw new Error('zip not found');
        const lat = Number(results[0].lat);
        const lon = Number(results[0].lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('zip not found');
        const earthEvents = getEarthEvents && getEarthEvents();
        if (!earthEvents) throw new Error('location manager unavailable');
        earthEvents.setUserLocation(lat, lon, null);
        metaEl.textContent = `${results[0].display_name || postalcode}`;
      } catch (error) {
        metaEl.textContent = error.message || 'zip lookup failed';
      } finally {
        zipButton.textContent = 'Set';
      }
    }

    zoneSelect.addEventListener('change', () => {
      state.selectedTimeZone = zoneSelect.value;
      localStorage.setItem(timeZoneKey, state.selectedTimeZone);
    });
    zipButton.addEventListener('click', setLocationByZip);
    zipInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') setLocationByZip();
    });

    return {
      setCountries(features) {
        state.countries = Array.isArray(features) ? features : [];
      },
      selectAtEvent,
      beginLongPress,
      moveLongPress,
      cancelLongPress,
      selectedTimeZone,
      formatClock
    };
  }

  window.createCountrySelectorManager = createCountrySelectorManager;
}());
