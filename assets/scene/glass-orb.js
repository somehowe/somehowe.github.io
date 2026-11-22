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
  uniform float orbRadius, shellOpacity, dpr, skyReady, orbIntent;
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

  // Distance to the narrow split in the outer surface, in orb-radius units.
  float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 edge = b - a;
    float t = clamp(dot(p - a, edge) / dot(edge, edge), 0., 1.);
    return length(p - (a + t * edge));
  }

  float crackDistance(vec2 p) {
    const vec2 root = vec2(.489,.872), neck = vec2(.49,.85), turn = vec2(.48,.77);
    const vec2 kink = vec2(.52,.716), fork = vec2(.493,.644), bend = vec2(.515,.59);
    float mainCut = min(segmentDistance(p,root,neck), segmentDistance(p,neck,turn));
    mainCut = min(mainCut,segmentDistance(p,turn,kink));
    mainCut = min(mainCut,segmentDistance(p,kink,fork));
    mainCut = min(mainCut,segmentDistance(p,fork,bend));
    mainCut = min(mainCut,segmentDistance(p,bend,vec2(.498,.525)));
    const vec2 spur = vec2(.55,.636), elbow = vec2(.586,.60), tip = vec2(.626,.594);
    float branch = min(segmentDistance(p,fork,spur),segmentDistance(p,spur,elbow));
    branch = min(branch,segmentDistance(p,elbow,tip));
    return min(mainCut,branch * 1.3);
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
    // A cool body and a dark return just inside the rim give the glass thickness.
    vec3 body = transmission * mix(vec3(.65, .83, .94), vec3(.96, 1., 1.), front.z);
    vec3 surface = mix(body, reflection, fresnel);
    float shoulder = exp(-pow((radius - .889) / .050, 2.));
    surface *= 1. - .50 * shoulder;
    vec2 limb = xy / max(radius, .001);
    float crown = max(dot(limb, normalize(vec2(-.57, .82))), 0.);
    float foot = max(dot(limb, normalize(vec2(.62, -.78))), 0.);
    float thickness = smoothstep(.40, .99, radius);
    vec3 sheen = vec3(.09, .25, .39) * thickness * (.25 + .53 * crown + .34 * foot);

    // An extended light source sweeps across the dome. Projecting it into the
    // reflection direction makes its long and short edges curve around the glass.
    vec3 key = normalize(vec3(-.59 + .12 * parallax.x, .76 + .08 * parallax.y, -.22));
    vec3 tangent = normalize(cross(key, vec3(0., 0., 1.)));
    vec3 bitangent = cross(key, tangent);
    vec2 uv = vec2(dot(reflected, tangent), dot(reflected, bitangent));
    float facing = smoothstep(.32, .77, dot(reflected, key));
    float longAxis = uv.x / .81;
    float shortAxis = (uv.y - .070 * longAxis * longAxis) / .135;
    float footprint = pow(abs(longAxis), 4.) + pow(abs(shortAxis), 2.);
    float broad = exp(-.58 * footprint);
    float core = (1. - smoothstep(.48, 1.04, footprint))
                 * (.36 + .64 * exp(-1.85 * pow(longAxis + .12, 2.)));
    float spill = exp(-pow(uv.x / .90, 2.) - pow((uv.y + .035) / .42, 2.));
    sheen += facing * (vec3(.12, .29, .45) * spill + vec3(.32, .46, .57) * broad
                       + vec3(.70, .72, .74) * core);

    // The exit surface returns a tighter arc on the opposite limb. Its width
    // and intensity vary around the perimeter, leaving a dark edge between glints.
    float outer = exp(-pow((1. - min(radius, 1.)) / max(.018, aa * 1.55), 2.));
    float returnRadius = .931 + .025 * limb.x;
    float returnBand = exp(-pow((radius - returnRadius) / .033, 2.));
    float returnCore = exp(-pow((radius - returnRadius) / max(.012, aa * 1.10), 2.));
    float edgeLight = .14 + .92 * pow(crown, 2.5) + .64 * pow(foot, 3.);
    sheen += vec3(.63, .84, .98) * edgeLight * outer
           + vec3(.22, .50, .70) * (.13 + .71 * pow(foot, 2.2) + .23 * crown) * returnBand
           + vec3(.65, .84, .93) * .59 * pow(foot, 7.) * returnCore;
    vec3 color = surface + (1. - surface) * min(sheen, vec3(.99));
    // While the photograph decodes, let the photographic CSS sky show through.
    float opacity = mix(clamp(max(sheen.r, max(sheen.g, sheen.b)), .006, 1.), 1., skyReady);
    if (skyReady < .5) color = sheen / opacity;
    if (xy.x > .43 && xy.x < .67 && xy.y > .49 && xy.y < .91) {
      // Light catches one lip. Its shadow remains visible over bright stars.
      float halfWidth = clamp(orbRadius * .0035, .39, .68) / orbRadius;
      float taper = smoothstep(.521, .57, xy.y) * (1. - smoothstep(.57,.632,xy.x));
      float stroke = halfWidth * mix(.38, 1., taper);
      float dark = 1. - smoothstep(stroke * .5, stroke + aa, crackDistance(xy));
      vec2 relief = vec2(-.72,.26) * halfWidth * 1.9;
      float lip = 1. - smoothstep(stroke * .28, stroke * .80 + aa, crackDistance(xy - relief));
      color *= 1. - (.55 + .14 * orbIntent) * taper * dark;
      color = mix(color, vec3(.76, .88, .94), (.55 + .28 * orbIntent) * taper * lip);
    }
    gl_FragColor = vec4(color, opacity * coverage * shellOpacity);
  }
`;

export function createGlassOrb(THREE, sceneUniforms, requestRedraw) {
  const { viewport, lensCenter, orbRadius, dpr, parallax } = sceneUniforms;
  const uniforms = {
    viewport, lensCenter, orbRadius, dpr, parallax,
    shellOpacity: { value: 1 },
    orbIntent: { value: 0 },
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
    uniforms.orbIntent.value = state.orbIntent || 0;
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
