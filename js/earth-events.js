(function () {
  function latLonToVector(THREE, radius, lat, lon, scale = radius * 1.03) {
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon + 180);
    return new THREE.Vector3(
      -scale * Math.sin(phi) * Math.cos(theta),
      scale * Math.cos(phi),
      scale * Math.sin(phi) * Math.sin(theta)
    );
  }

  function makeMarker(THREE, position, color, size, opacity) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(size, 10, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity
      })
    );
    marker.position.copy(position);
    return marker;
  }

  function getMagnitudeColor(magnitude) {
    if (magnitude >= 6) return 0xff3f2f;
    if (magnitude >= 5) return 0xff8a36;
    if (magnitude >= 4) return 0xffd35c;
    if (magnitude >= 2.5) return 0x8df2ff;
    return 0x50a8ff;
  }

  function getMagnitudeSize(THREE, radius, magnitude) {
    const mag = Number.isFinite(magnitude) ? magnitude : 1;
    return radius * THREE.MathUtils.clamp(0.006 + mag * 0.0032, 0.009, 0.032);
  }

  function createEarthEventsManager({ THREE, radius, earth, earthquakeStatus, locationStatus }) {
    const earthquakeLayer = new THREE.Group();
    const userLayer = new THREE.Group();
    earth.add(earthquakeLayer);
    earth.add(userLayer);

    let userLocation = null;
    let lastEarthquakeLoad = 0;
    const earthquakeFeedUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

    async function loadEarthquakes(force = false) {
      const now = Date.now();
      if (!force && now - lastEarthquakeLoad < 5 * 60 * 1000) return;
      lastEarthquakeLoad = now;
      earthquakeStatus.textContent = 'earthquakes loading...';

      try {
        const response = await fetch(earthquakeFeedUrl);
        if (!response.ok) throw new Error(`USGS request failed: ${response.status}`);
        const feed = await response.json();
        const features = Array.isArray(feed.features) ? feed.features : [];
        const sorted = features
          .filter((feature) => feature.geometry && feature.geometry.type === 'Point')
          .sort((a, b) => (b.properties.mag || 0) - (a.properties.mag || 0))
          .slice(0, 140);

        earthquakeLayer.clear();
        sorted.forEach((feature) => {
          const [lon, lat, depthKm] = feature.geometry.coordinates;
          const magnitude = Number(feature.properties.mag);
          const position = latLonToVector(THREE, radius, lat, lon, radius * 1.035);
          const marker = makeMarker(
            THREE,
            position,
            getMagnitudeColor(magnitude),
            getMagnitudeSize(THREE, radius, magnitude),
            0.82
          );
          marker.userData = {
            title: feature.properties.title || 'Earthquake',
            magnitude,
            depthKm,
            time: feature.properties.time
          };
          earthquakeLayer.add(marker);
        });

        earthquakeStatus.textContent = `earthquakes ${sorted.length.toLocaleString()} live USGS`;
        earthquakeStatus.title = feed.metadata && feed.metadata.title ? feed.metadata.title : 'USGS live earthquake feed';
      } catch (error) {
        console.warn('Could not load USGS earthquakes.', error);
        earthquakeStatus.textContent = 'earthquakes unavailable';
        earthquakeStatus.title = error.message;
      }
    }

    function setEarthquakesVisible(visible) {
      earthquakeLayer.visible = visible;
    }

    function setUserLocation(lat, lon) {
      userLocation = { lat, lon };
      userLayer.clear();

      const position = latLonToVector(THREE, radius, lat, lon, radius * 1.07);
      userLayer.add(makeMarker(THREE, position, 0xffffff, radius * 0.026, 0.95));

      const vertical = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          latLonToVector(THREE, radius, lat, lon, radius * 1.018),
          latLonToVector(THREE, radius, lat, lon, radius * 1.18)
        ]),
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.52
        })
      );
      userLayer.add(vertical);

      locationStatus.textContent = `location ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
      window.dispatchEvent(new CustomEvent('globe:user-location', {
        detail: { lat, lon }
      }));
    }

    function requestUserLocation() {
      if (!navigator.geolocation) {
        locationStatus.textContent = 'location unavailable';
        return;
      }

      locationStatus.textContent = 'location requesting...';
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          locationStatus.textContent = 'location blocked';
          locationStatus.title = error.message;
        },
        {
          enableHighAccuracy: false,
          maximumAge: 10 * 60 * 1000,
          timeout: 12000
        }
      );
    }

    function getObserverPositionInEarthSystem(earthSystem) {
      if (!userLocation) return null;

      const local = latLonToVector(THREE, radius, userLocation.lat, userLocation.lon, radius);
      const world = earth.localToWorld(local.clone());
      return earthSystem.worldToLocal(world);
    }

    return {
      layer: earthquakeLayer,
      loadEarthquakes,
      requestUserLocation,
      setUserLocation,
      setEarthquakesVisible,
      getObserverPositionInEarthSystem,
      getUserLocation() {
        return userLocation ? { ...userLocation } : null;
      },
      hasUserLocation() {
        return !!userLocation;
      }
    };
  }

  window.createEarthEventsManager = createEarthEventsManager;
}());
