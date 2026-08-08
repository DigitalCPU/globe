(function () {
  function makeNightShader(THREE, radius, color, opacity, feather) {
    return new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        shadeColor: { value: new THREE.Color(color) },
        maxOpacity: { value: opacity },
        feather: { value: feather }
      },
      vertexShader: `
        varying vec3 vLocalNormal;

        void main() {
          vLocalNormal = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform vec3 shadeColor;
        uniform float maxOpacity;
        uniform float feather;
        varying vec3 vLocalNormal;

        void main() {
          float facingSun = dot(normalize(vLocalNormal), normalize(sunDirection));
          float nightAmount = 1.0 - smoothstep(-feather, feather, facingSun);
          gl_FragColor = vec4(shadeColor, nightAmount * maxOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide
    });
  }

  function makeTerminatorLine(THREE, radius) {
    const points = [];
    const segments = 192;

    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }

    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0x9cf7ff,
        transparent: true,
        opacity: 0.28
      })
    );
  }

  function localSunDirection(THREE, target, sun) {
    const targetWorld = new THREE.Vector3();
    const sunWorld = new THREE.Vector3();
    target.getWorldPosition(targetWorld);
    sun.getWorldPosition(sunWorld);

    const directionWorld = sunWorld.sub(targetWorld).normalize();
    const inverseTarget = new THREE.Matrix4().copy(target.matrixWorld).invert();
    return directionWorld.transformDirection(inverseTarget).normalize();
  }

  function faceLineToSun(line, sunDirection) {
    const zAxis = new THREE.Vector3(0, 0, 1);
    const direction = sunDirection.clone().normalize();
    line.quaternion.setFromUnitVectors(zAxis, direction);
  }

  window.createLightingManager = function createLightingManager(options) {
    const { THREE, scene, earth, moon, sun, radius, moonRadius } = options;

    const sunLight = new THREE.DirectionalLight(0xfff2c2, 1.25);
    scene.add(sunLight);

    const earthNight = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.021, 64, 48),
      makeNightShader(THREE, radius, 0x01070c, 0.62, 0.105)
    );
    earthNight.renderOrder = 5;
    earth.add(earthNight);

    const terminatorLine = makeTerminatorLine(THREE, radius * 1.024);
    terminatorLine.renderOrder = 6;
    earth.add(terminatorLine);

    const moonNight = new THREE.Mesh(
      new THREE.SphereGeometry(moonRadius * 1.031, 40, 28),
      makeNightShader(THREE, moonRadius, 0x030507, 0.7, 0.08)
    );
    moonNight.renderOrder = 5;
    moon.add(moonNight);

    const moonTerminator = makeTerminatorLine(THREE, moonRadius * 1.034);
    moonTerminator.material.opacity = 0.22;
    moonTerminator.renderOrder = 6;
    moon.add(moonTerminator);

    return {
      setDayNightVisible(visible) {
        earthNight.visible = visible;
        terminatorLine.visible = visible;
      },
      setMoonPhaseVisible(visible) {
        moonNight.visible = visible;
        moonTerminator.visible = visible;
      },
      update() {
        const earthSunDirection = localSunDirection(THREE, earth, sun);
        earthNight.material.uniforms.sunDirection.value.copy(earthSunDirection);
        faceLineToSun(terminatorLine, earthSunDirection);

        const moonSunDirection = localSunDirection(THREE, moon, sun);
        moonNight.material.uniforms.sunDirection.value.copy(moonSunDirection);
        faceLineToSun(moonTerminator, moonSunDirection);

        const sunWorld = new THREE.Vector3();
        const earthWorld = new THREE.Vector3();
        sun.getWorldPosition(sunWorld);
        earth.getWorldPosition(earthWorld);
        sunLight.position.copy(sunWorld.sub(earthWorld).normalize().multiplyScalar(12));
      }
    };
  };
}());
