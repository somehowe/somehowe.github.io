// The intact lens has a continuous surface. The original fracture mesh takes over on impact.
export const orbVertexShader = `
  uniform vec2 viewport, lensCenter;
  uniform float orbRadius, dpr;
  varying vec2 disk;
  void main() {
    disk = position.xy * (1.0 + 1.0 / (orbRadius * dpr));
    vec2 screen = lensCenter + disk * vec2(1., -1.) * orbRadius;
    gl_Position = vec4((screen / viewport - .5) * vec2(2., -2.), 0., 1.);
  }
`;

export const orbFragmentShader = `
  uniform vec2 viewport, lensCenter, skySize, frameOrigin, frameExtent, parallax;
  uniform float orbRadius, shellOpacity, dpr, skyReady;
  uniform sampler2D galaxyMap, starLayer;
  varying vec2 disk;

  vec3 skyAt(vec2 pixel) {
    // These are the same cover scale and background-position used by #sky.
    vec2 cover = skySize * max(viewport.x / skySize.x, viewport.y / skySize.y);
    vec2 uv = (pixel - (viewport - cover) * vec2(.5, .36)) / cover;
    return texture2D(galaxyMap, vec2(uv.x, 1. - uv.y)).rgb;
  }

  vec3 transmittedSky(vec2 pixel) {
    vec2 uv = ((vec2(pixel.x, viewport.y - pixel.y) * dpr) - frameOrigin) / frameExtent;
    vec4 stars = texture2D(starLayer, clamp(uv, 0., 1.));
    // Fade at the bounds of the captured region to avoid extending an edge texel.
    vec2 padding = min(uv, 1. - uv) * frameExtent;
    stars *= clamp(min(padding.x, padding.y), 0., 1.);
    return skyAt(pixel) * (1. - stars.a) + stars.rgb;
  }

  void main() {
    float radius = length(disk);
    float aa = 1. / (orbRadius * dpr);
    float coverage = 1. - smoothstep(1. - aa * .5, 1. + aa * .5, radius);
    if (coverage <= 0.) discard;
    vec2 xy = disk / max(1., radius);
    vec3 front = vec3(xy, sqrt(max(0., 1. - dot(xy, xy))));
    vec3 inside = refract(vec3(0., 0., -1.), front, 1. / 1.50);
    vec3 back = front - 2. * dot(front, inside) * inside;
    vec3 outRay = refract(inside, -back, 1.50);
    vec2 screenAxis = orbRadius * vec2(1., -1.);
    // Project onto the nearby sky plane. Bounded projection keeps the limb continuous.
    vec2 samplePixel = lensCenter + screenAxis * (back.xy + 2.85 * outRay.xy);
    vec3 transmission = transmittedSky(samplePixel);
    vec3 reflected = reflect(vec3(0., 0., -1.), front);
    vec3 reflection = skyAt(lensCenter + screenAxis * (2.6 * reflected.xy + vec2(.13, .26)));
    float fresnel = .04 + .96 * pow(1. - front.z, 5.);
    vec3 surface = mix(transmission * vec3(.95, .988, 1.), reflection, fresnel);
    // A soft, directional reflection gives the curved surface a readable silhouette.
    vec3 key = normalize(vec3(-.63 + .12 * parallax.x, .74 + .08 * parallax.y, .08));
    vec3 tangent = normalize(cross(key, vec3(0., 0., 1.)));
    vec3 bitangent = cross(key, tangent);
    vec2 delta = vec2(dot(reflected, tangent), dot(reflected, bitangent));
    float upper = max(dot(reflected, key), 0.);
    float soft = exp(-dot(delta * vec2(2.6, 7.), delta * vec2(2.6, 7.)));
    float glint = exp(-dot(delta * vec2(3.8, 22.), delta * vec2(3.8, 22.)));
    vec2 limb = xy / max(radius, .001);
    float rimLight = .09 + .74 * pow(max(dot(limb, normalize(vec2(-.64, .77))), 0.), 3.)
                         + .40 * pow(max(dot(limb, normalize(vec2(.78, -.63))), 0.), 7.);
    float lip = exp(-pow((1. - min(radius, 1.)) / max(aa * 1.3, .010), 2.));
    float inner = exp(-pow((radius - .956) / .018, 2.));
    vec3 sheen = vec3(.70, .83, .94) * (soft * .19 + glint * .70) * upper
               + vec3(.70, .86, .96) * rimLight * (.92 * lip + .17 * inner + .30 * fresnel);
    vec3 color = surface + (1. - surface) * sheen;
    // While the photograph decodes, let the photographic CSS sky show through.
    float opacity = mix(clamp(max(sheen.r, max(sheen.g, sheen.b)), .006, 1.), 1., skyReady);
    if (skyReady < .5) color = sheen / opacity;
    gl_FragColor = vec4(color, opacity * coverage * shellOpacity);
  }
`;

export function createGlassOrb(THREE, sceneUniforms, requestRedraw) {
  const { viewport, lensCenter, orbRadius, dpr, parallax } = sceneUniforms;
  const uniforms = {
    viewport, lensCenter, orbRadius, dpr, parallax,
    shellOpacity: { value: 1 },
    skyReady: { value: 0 },
    skySize: { value: new THREE.Vector2(1, 1) },
    galaxyMap: { value: null },
    starLayer: { value: null },
    frameOrigin: { value: new THREE.Vector2() },
    frameExtent: { value: new THREE.Vector2(1, 1) }
  };
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: orbVertexShader, fragmentShader: orbFragmentShader,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Polished glass orb';
  const skies = new Map();
  const bufferSize = new THREE.Vector2();
  const loader = new THREE.TextureLoader();
  let selectedSky;
  let disposed = false;

  function resize() {
    const file = matchMedia('(max-aspect-ratio: 4/5)').matches ? 'deep-portrait' : 'deep-landscape';
    if (selectedSky === file) return;
    selectedSky = file;
    function select(texture) {
      if (disposed || selectedSky !== file || !texture.image) return;
      uniforms.galaxyMap.value = texture;
      uniforms.skySize.value.set(texture.image.width, texture.image.height);
      uniforms.skyReady.value = 1;
      requestRedraw?.();
    }
    uniforms.skyReady.value = 0;
    if (skies.has(file)) select(skies.get(file));
    else skies.set(file, loader.load('/assets/galaxy/' + file + '.webp', select));
  }

  mesh.onBeforeRender = renderer => {
    // Copy only the neighborhood that contributes moving stars to this lens.
    renderer.getDrawingBufferSize(bufferSize);
    // At IOR 1.50 this projection reaches just under three radii at the limb.
    const radius = Math.ceil(orbRadius.value * dpr.value * 3) + 1;
    const x = Math.round(lensCenter.value.x * dpr.value);
    const y = Math.round(bufferSize.y - lensCenter.value.y * dpr.value);
    const origin = uniforms.frameOrigin.value.set(Math.max(0, x - radius), Math.max(0, y - radius));
    const width = Math.min(bufferSize.x, x + radius) - origin.x;
    const height = Math.min(bufferSize.y, y + radius) - origin.y;
    let frame = uniforms.starLayer.value;
    if (!frame || frame.image.width !== width || frame.image.height !== height) {
      frame?.dispose();
      frame = new THREE.FramebufferTexture(width, height);
      frame.minFilter = frame.magFilter = THREE.LinearFilter;
      uniforms.starLayer.value = frame;
      uniforms.frameExtent.value.set(width, height);
    }
    renderer.copyFramebufferToTexture(frame, origin);
  };

  function update(state) {
    const age = Number.isFinite(state.breakAge) ? state.breakAge : 0;
    uniforms.shellOpacity.value = 1 - THREE.MathUtils.smoothstep(age, .045, .29);
    mesh.visible = uniforms.shellOpacity.value > 0;
  }

  function dispose() {
    disposed = true;
    geometry.dispose();
    material.dispose();
    uniforms.starLayer.value?.dispose();
    for (const texture of skies.values()) texture.dispose();
  }

  return { mesh, opacity: uniforms.shellOpacity, resize, update, dispose };
}
