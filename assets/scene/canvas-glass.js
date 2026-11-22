// The sky photograph is a CSS background. Cache its refraction once per layout;
// only the transparent layer of moving stars needs to be copied each frame.
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

  image.addEventListener("load", () => {
    layoutKey = "";
    requestFrame();
  });

  function bake(width, height, cx, cy, radius, size) {
    // Match background-size: cover and background-position: 50% 36%.
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const left = (width - image.naturalWidth * scale) * 0.5;
    const top = (height - image.naturalHeight * scale) * 0.36;
    const extent = radius * 2.4;
    const sampleSize = Math.ceil(size * 1.9);
    source.width = source.height = sampleSize;
    sourceContext.fillStyle = "#020306";
    sourceContext.fillRect(0, 0, sampleSize, sampleSize);
    sourceContext.drawImage(image, (cx - extent - left) / scale, (cy - extent - top) / scale,
      2 * extent / scale, 2 * extent / scale, 0, 0, sampleSize, sampleSize);
    const sky = sourceContext.getImageData(0, 0, sampleSize, sampleSize).data;
    surface.width = surface.height = size;
    const result = surfaceContext.createImageData(size, size);
    const pixels = result.data;
    const clamp = value => Math.max(0, Math.min(1, value));
    const tint = [186, 218, 238];
    const transmission = [0.94, 0.99, 1];
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
        const base = 4 * (y0 * sampleSize + x0);
        const near = 4 * sampleSize;
        const fractionX = srcX - x0, fractionY = srcY - y0;
        const fresnel = 0.04 + 0.96 * (1 - z) ** 5;
        const directional = clamp(0.48 - 0.30 * x - 0.29 * y);
        const rim = fresnel * (0.18 + 0.55 * directional);
        const reflectX = Math.round(sourceCenter * (1 + x * z * 1.7));
        const reflectY = Math.round(sourceCenter * (1 + y * z * 1.7));
        const reflected = 4 * (reflectY * sampleSize + reflectX);
        const lightX = x + 0.43, lightY = y + 0.74;
        const along = (lightX * 0.85 - lightY * 0.52) / 0.18;
        const across = (lightX * 0.52 + lightY * 0.85 + 0.035 * along * along) / 0.033;
        const glint = 0.86 * Math.exp(-along * along - across * across);
        const arc = Math.exp(-(((radial - 0.956) / 0.014) ** 2)
          - ((x - 0.42) / 0.50) ** 2 - ((y - 0.82) / 0.25) ** 2);
        const index = 4 * (row * size + col);
        for (let channel = 0; channel < 3; channel++) {
          const p = base + channel;
          const upper = sky[p] + fractionX * (sky[p + 4] - sky[p]);
          const lower = sky[p + near] + fractionX * (sky[p + near + 4] - sky[p + near]);
          const through = (upper + fractionY * (lower - upper)) * transmission[channel];
          const mixed = through + (sky[reflected + channel] - through) * fresnel;
          const edge = mixed + (tint[channel] - mixed) * (rim + 0.21 * arc);
          pixels[index + channel] = edge + (249 - edge) * glint;
        }
        pixels[index + 3] = 255 * clamp((1 - radial) * size * 0.5 + 0.5);
      }
    }
    surfaceContext.putImageData(result, 0, 0);
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
    const key = [width, height, cx, cy, size, radius].join("/");
    if (key !== layoutKey) {
      bake(width, height, cx, cy, radius, size);
      layoutKey = key;
    }
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
    ctx.scale(-1, -1);
    ctx.globalAlpha = opacity * 0.82;
    ctx.drawImage(moving, -radius, -radius, 2 * radius, 2 * radius);
    ctx.restore();

    if (shards) {
      // The hairline follows the actual cut that will release on impact.
      ctx.save();
      ctx.lineCap = "round";
      for (let face = 0; face < shards.count; face++) {
        if (shards.normals[3 * face + 2] < 0.08) continue;
        const flash = shards.crackLight[face];
        const offset = 9 * face;
        for (let edge = 0; edge < 3; edge++) {
          const seam = shards.seamEdges[3 * face + edge] * (state.orbIntent || 0) * 0.30;
          const strength = Math.max(seam, flash);
          if (strength < 0.012) continue;
          const from = offset + 3 * edge, to = offset + 3 * ((edge + 1) % 3);
          ctx.strokeStyle = "rgba(211,234,247," + opacity * strength + ")";
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
