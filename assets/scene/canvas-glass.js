// The sky photograph is a CSS background. Cache its source pixels and the glass
// optics separately, so the falling orb can sample the sky at its current height.
export function createCanvasGlass(doc, requestFrame) {
  const world = doc.defaultView;
  const surface = doc.createElement("canvas");
  const surfaceContext = surface.getContext("2d");
  const moving = doc.createElement("canvas");
  const movingContext = moving.getContext("2d");
  const source = doc.createElement("canvas");
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  const image = doc.createElement("img");
  let sourceURL = "";
  let layoutKey = "";
  let renderAtHeight;

  image.addEventListener("load", () => {
    layoutKey = "";
    requestFrame();
  });

  function prepareSurface(width, height, cx, radius, size) {
    // Match background-size: cover and background-position: 50% 36%.
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const left = (width - image.naturalWidth * scale) * 0.5;
    const top = (height - image.naturalHeight * scale) * 0.36;
    const extent = radius * 2.4;
    const sampleSize = Math.ceil(size * 1.9);
    // Keep one strip through the entire fall; no canvas readback during motion.
    const density = sampleSize / (extent * 2);
    const margin = extent + radius;
    source.width = sampleSize;
    source.height = Math.ceil((height + 2 * margin) * density) + 2;
    sourceContext.fillStyle = "#020306";
    sourceContext.fillRect(0, 0, source.width, source.height);
    sourceContext.drawImage(image, (cx - extent - left) / scale, (-margin - top) / scale,
      2 * extent / scale, source.height / (density * scale), 0, 0, source.width, source.height);
    const sky = sourceContext.getImageData(0, 0, source.width, source.height).data;
    surface.width = surface.height = size;
    const result = surfaceContext.createImageData(size, size);
    const pixels = result.data;
    const count = size * size;
    const refractedPixel = new Int32Array(count), reflectedPixel = new Int32Array(count);
    const fractionX = new Float32Array(count), fractionY = new Float32Array(count);
    const transmittedLight = new Float32Array(3 * count);
    const reflectedLight = new Float32Array(3 * count);
    const surfaceLight = new Float32Array(3 * count);
    const clamp = value => Math.max(0, Math.min(1, value));
    const smooth = (a, b, value) => {
      const t = clamp((value - a) / (b - a));
      return t * t * (3 - 2 * t);
    };
    const gaussian = value => Math.exp(-value * value);
    const normalize = (x, y, z) => {
      const length = Math.hypot(x, y, z);
      return [x / length, y / length, z / length];
    };
    const [kx, ky, kz] = normalize(-0.59, 0.76, -0.22);
    const [tx, ty] = normalize(ky, -kx, 0);
    const bx = -kz * ty, by = kz * tx, bz = kx * ty - ky * tx;
    // RGB coefficients match glass-orb.js, in linear screen intensities.
    const absorption = [0.65, 0.83, 0.94], clear = [0.96, 1, 1];
    const bodySheen = [0.09, 0.25, 0.39], spillSheen = [0.12, 0.29, 0.45];
    const stripSheen = [0.32, 0.46, 0.57], coreSheen = [0.70, 0.72, 0.74];
    const edgeSheen = [0.63, 0.84, 0.98], bandSheen = [0.22, 0.50, 0.70];
    const causticSheen = [0.65, 0.84, 0.93];
    const aa = 2 / size;
    const sourceCenter = (sampleSize - 1) / 2;

    for (let row = 0; row < size; row++) {
      const y = (row + 0.5) * 2 / size - 1;
      for (let col = 0; col < size; col++) {
        const x = (col + 0.5) * 2 / size - 1;
        const radial = Math.hypot(x, y);
        if (radial >= 1) continue;
        const z = Math.sqrt(1 - radial * radial);
        // A ray bends twice through a solid ball. The transmitted sky turns
        // upside down and the outer angles sweep through more of the scene.
        const bend = 2 * (Math.asin(radial) - Math.asin(radial / 1.5));
        const offset = radial ? 1.95 * Math.sin(bend) / radial : 1.3;
        const srcX = sourceCenter * (1 - x * offset / 2.4);
        const srcY = sourceCenter * (1 - y * offset / 2.4);
        const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
        const pixel = row * size + col;
        refractedPixel[pixel] = 4 * (y0 * sampleSize + x0);
        fractionX[pixel] = srcX - x0;
        fractionY[pixel] = srcY - y0;
        const fresnel = 0.04 + 0.96 * (1 - z) ** 5;
        const reflectX = Math.round(sourceCenter * (1 + x * z * 1.7));
        const reflectY = Math.round(sourceCenter * (1 + y * z * 1.7));
        reflectedPixel[pixel] = 4 * (reflectY * sampleSize + reflectX);

        // Project the oblong source onto the reflected ray, just as on WebGL.
        const rx = 2 * z * x, ry = -2 * z * y, rz = 2 * z * z - 1;
        const u = rx * tx + ry * ty, v = rx * bx + ry * by + rz * bz;
        const facing = smooth(0.32, 0.77, rx * kx + ry * ky + rz * kz);
        const along = u / 0.81, across = (v - 0.070 * along * along) / 0.135;
        const footprint = along ** 4 + across * across;
        const strip = facing * Math.exp(-0.58 * footprint);
        const core = facing * (1 - smooth(0.48, 1.04, footprint))
          * (0.36 + 0.64 * Math.exp(-1.85 * (along + 0.12) ** 2));
        const spill = facing * gaussian(u / 0.90) * gaussian((v + 0.035) / 0.42);
        const lx = x / Math.max(radial, 0.001), ly = -y / Math.max(radial, 0.001);
        const crown = Math.max(0, -0.571 * lx + 0.821 * ly);
        const foot = Math.max(0, 0.622 * lx - 0.783 * ly);
        const volume = smooth(0.40, 0.99, radial) * (0.25 + 0.53 * crown + 0.34 * foot);
        const shade = 1 - 0.50 * gaussian((radial - 0.889) / 0.05);
        const edge = gaussian((1 - radial) / Math.max(0.018, aa * 1.55))
          * (0.14 + 0.92 * crown ** 2.5 + 0.64 * foot ** 3);
        const bandOffset = radial - (0.931 + 0.025 * lx);
        const band = gaussian(bandOffset / 0.033) * (0.13 + 0.71 * foot ** 2.2 + 0.23 * crown);
        const caustic = gaussian(bandOffset / Math.max(0.012, aa * 1.10)) * 0.59 * foot ** 7;
        for (let channel = 0; channel < 3; channel++) {
          const absorptionFactor = absorption[channel] + (clear[channel] - absorption[channel]) * z;
          const sheen = bodySheen[channel] * volume + spillSheen[channel] * spill
            + stripSheen[channel] * strip + coreSheen[channel] * core + edgeSheen[channel] * edge
            + bandSheen[channel] * band + causticSheen[channel] * caustic;
          const light = Math.min(0.99, sheen);
          const index = 3 * pixel + channel;
          transmittedLight[index] = absorptionFactor * (1 - fresnel) * shade * (1 - light);
          reflectedLight[index] = fresnel * shade * (1 - light);
          surfaceLight[index] = 255 * light;
        }
        pixels[4 * pixel + 3] = 255 * clamp((1 - radial) * size * 0.5 + 0.5);
      }
    }

    const stride = 4 * sampleSize;
    let lastRow = -1;
    return cy => {
      const row = Math.max(0, Math.min(source.height - sampleSize - 1,
        Math.round((cy + margin - extent) * density)));
      if (row === lastRow) return;
      lastRow = row;
      const offset = row * stride;
      for (let pixel = 0; pixel < count; pixel++) {
        const output = pixel * 4;
        if (!pixels[output + 3]) continue;
        const base = offset + refractedPixel[pixel], reflection = offset + reflectedPixel[pixel];
        const fx = fractionX[pixel], fy = fractionY[pixel];
        for (let channel = 0; channel < 3; channel++) {
          const p = base + channel;
          const top = sky[p] + fx * (sky[p + 4] - sky[p]);
          const bottom = sky[p + stride] + fx * (sky[p + stride + 4] - sky[p + stride]);
          const index = pixel * 3 + channel;
          pixels[output + channel] = (top + fy * (bottom - top)) * transmittedLight[index]
            + sky[reflection + channel] * reflectedLight[index] + surfaceLight[index];
        }
      }
      surfaceContext.putImageData(result, 0, 0);
    };
  }

  // Unit-sphere coordinates (+Y up), shared with the WebGL glass surface.
  const mainCrack = [[0.489, 0.872], [0.49, 0.85], [0.48, 0.77], [0.52, 0.716],
    [0.493, 0.644], [0.515, 0.59], [0.498, 0.525]];
  const fork = [[0.493, 0.644], [0.55, 0.636], [0.586, 0.60], [0.626, 0.594]];

  function pointAlongCrack(points, progress) {
    // The main cut moves monotonically down the glass, and its fork to the right.
    const axis = points === fork ? 0 : 1;
    const start = points[0][axis], end = points.at(-1)[axis];
    const target = start + progress * (end - start);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const t = (target - a[axis]) / (b[axis] - a[axis]);
      if (t <= 1) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    return points.at(-1);
  }

  function drawHairline(ctx, radius, dpr, intent, glint) {
    const width = Math.max(1.5 / dpr, 1.23, radius * 0.0112);
    ctx.save();
    ctx.lineJoin = ctx.lineCap = "round";
    for (const points of [mainCrack, fork]) {
      const first = points[0], last = points.at(-1);
      const branch = points === fork;
      // Offset the light lip across the dark cut and fade where it runs out.
      for (const lit of [false, true]) {
        const offset = lit ? 0.68 * width : 0;
        const stroke = ctx.createLinearGradient(first[0] * radius, -first[1] * radius,
          last[0] * radius, -last[1] * radius);
        const rgb = lit ? "211,233,247" : "1,8,16";
        const alpha = (lit ? 0.87 : 0.96) * (branch ? 0.88 : 1);
        stroke.addColorStop(0, "rgba(" + rgb + "," + alpha + ")");
        stroke.addColorStop(0.74, "rgba(" + rgb + "," + alpha * (0.89 + 0.10 * intent) + ")");
        stroke.addColorStop(1, "rgba(" + rgb + ",0.10)");
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width * (lit ? 0.84 : 1.42) * (branch ? 0.86 : 1);
        ctx.beginPath();
        ctx.moveTo(first[0] * radius - offset, -first[1] * radius - 0.25 * offset);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i][0] * radius - offset, -points[i][1] * radius - 0.25 * offset);
        }
        ctx.stroke();
      }

      // The final path is the reflective lip. Confine the traveling reflection
      // to it, splitting off only once the light passes the fork's junction.
      if (!(glint >= 0 && glint < 1)) continue;
      const pass = branch ? (glint - 0.657) / 0.32 : glint;
      if (pass < 0 || pass >= 1) continue;
      const [u, v] = pointAlongCrack(points, pass);
      const x = u * radius - 0.68 * width, y = -v * radius - 0.17 * width;
      const spread = Math.max(3.2, radius * (branch ? 0.071 : 0.106));
      const intensity = Math.min(1, pass * 10, (1 - pass) * 10);
      const light = ctx.createRadialGradient(x, y, 0, x, y, spread);
      light.addColorStop(0, "rgba(251,253,255," + intensity + ")");
      light.addColorStop(0.32, "rgba(232,247,255," + intensity * 0.94 + ")");
      light.addColorStop(0.64, "rgba(164,216,250," + intensity * 0.64 + ")");
      light.addColorStop(1, "rgba(151,207,242,0)");
      ctx.strokeStyle = light;
      ctx.lineWidth = width * (branch ? 1.38 : 1.90);
      ctx.stroke();
    }
    ctx.restore();
  }

  return function drawGlass(ctx, layout, radius, dpr, state, shards) {
    if (!surfaceContext || !sourceContext || !movingContext) return;
    const intact = !Number.isFinite(state.breakAge);
    const fade = intact ? 0 : Math.max(0, Math.min(1, (state.breakAge - 0.045) / 0.245));
    if (fade === 1) return;
    const opacity = 1 - fade * fade * (3 - 2 * fade);
    const url = world.matchMedia("(max-aspect-ratio: 4/5)").matches
      ? "/assets/galaxy/deep-portrait.webp" : "/assets/galaxy/deep-landscape.webp";
    if (url !== sourceURL) {
      sourceURL = url;
      layoutKey = "";
      image.src = url;
    }
    const { cx, cy } = layout;
    const size = Math.max(8, Math.min(480, Math.ceil(radius * 2 * dpr)));
    if (!image.complete || !image.naturalWidth) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(195,222,238," + 0.65 * opacity + ")";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const width = ctx.canvas.width / dpr, height = ctx.canvas.height / dpr;
    const key = [width, height, cx, size, radius].join("/");
    if (key !== layoutKey) {
      renderAtHeight = prepareSurface(width, height, cx, radius, size);
      layoutKey = key;
    }
    renderAtHeight(cy);
    const extent = radius * 1.34;
    if (moving.width !== size || moving.height !== size) {
      moving.width = moving.height = size;
    }
    if (intact) {
      movingContext.clearRect(0, 0, size, size);
      movingContext.drawImage(ctx.canvas, (cx - extent) * dpr, (cy - extent) * dpr,
        2 * extent * dpr, 2 * extent * dpr, 0, 0, size, size);
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(surface, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, radius - 0.5 / dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.save();
    ctx.scale(-1, -1);
    ctx.globalAlpha = opacity * 0.82;
    ctx.drawImage(moving, -radius, -radius, 2 * radius, 2 * radius);
    ctx.restore();
    drawHairline(ctx, radius, dpr, state.orbIntent || 0, intact ? state.crackGlint : -1);
    ctx.restore();

    if (!intact && shards) {
      // Follow the fracture wave across released faces after impact.
      ctx.save();
      ctx.lineCap = "round";
      for (let face = 0; face < shards.count; face++) {
        if (shards.normals[3 * face + 2] < 0.08) continue;
        const flash = shards.crackLight[face];
        if (flash < 0.012) continue;
        const offset = 9 * face;
        for (let edge = 0; edge < 3; edge++) {
          const from = offset + 3 * edge, to = offset + 3 * ((edge + 1) % 3);
          ctx.strokeStyle = "rgba(211,234,247," + opacity * flash + ")";
          ctx.lineWidth = flash > 0.1 ? 1.15 : 0.62;
          ctx.beginPath();
          ctx.moveTo(shards.positions[from], shards.positions[from + 1]);
          ctx.lineTo(shards.positions[to], shards.positions[to + 1]);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  };
}
