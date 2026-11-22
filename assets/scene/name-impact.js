// Show the original shaped text run at rest and the per-letter layer during impact.
export function createNameImpact(heading) {
  const doc = heading.ownerDocument;
  const world = doc.defaultView;
  const source = heading.querySelector(".name-typeset");
  const text = source.firstChild;
  const motion = world.matchMedia("(prefers-reduced-motion: reduce)");
  const range = doc.createRange();
  const canvas = doc.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const layer = doc.createElement("span");
  layer.className = "name-impact-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
  heading.append(layer);

  const letters = [];
  let offset = 0;
  for (const char of text.data) {
    if (!/\s/.test(char)) {
      const element = doc.createElement("span");
      element.className = "name-impact-letter";
      element.dataset.letter = char;
      layer.append(element);
      letters.push({ char, element, start: offset });
    }
    offset += char.length;
  }

  let contour = [];
  let size = 0;
  let lastX, lastRadius, lastHeight;
  let active = false;
  function reset() {
    if (!active) return;
    layer.hidden = true;
    heading.removeAttribute("data-impact");
    active = false;
  }

  function resize() {
    lastX = undefined;
    const box = heading.getBoundingClientRect();
    const css = world.getComputedStyle(source);
    size = parseFloat(css.fontSize);
    if (!size || !box.height || !letters.length) return;
    contour = [];
    if (ctx) {
      canvas.width = canvas.height = Math.ceil(2 * size);
      ctx.font = css.fontStyle + " " + css.fontWeight + " " + css.fontSize + " " + css.fontFamily;
      ctx.fillStyle = "#fff";
    }

    // A native inline marker establishes the font baseline without a browser-specific
    // assumption about where CSS puts the font box within line-height.
    const probe = doc.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    heading.insertBefore(probe, source);
    const firstBaseline = probe.getBoundingClientRect().top;
    probe.remove();

    let firstTop;
    const originX = Math.ceil(size * .25);
    const originY = Math.ceil(size * 1.4);
    for (const letter of letters) {
      range.setStart(text, letter.start);
      range.setEnd(text, letter.start + letter.char.length);
      const rect = range.getBoundingClientRect();
      firstTop ??= rect.top;
      const lineOffset = rect.top - firstTop;
      const left = rect.left + world.scrollX;
      const baseline = firstBaseline + lineOffset + world.scrollY;
      letter.x = left + rect.width / 2;
      letter.element.style.left = (rect.left - box.left) + "px";
      letter.element.style.top = lineOffset + "px";
      if (!ctx) {
        contour.push([letter.x, baseline - size * .70]);
        continue;
      }

      // The first collision with the circle depends on the top contour at each
      // x, including whitespace inside and between glyphs. Rasterize only on resize.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText(letter.char, originX, originY);
      const metrics = ctx.measureText(letter.char);
      const x0 = Math.max(0, Math.floor(originX - metrics.actualBoundingBoxLeft) - 1);
      const x1 = Math.min(canvas.width, Math.ceil(originX + metrics.actualBoundingBoxRight) + 1);
      const y0 = Math.max(0, Math.floor(originY - metrics.actualBoundingBoxAscent) - 1);
      const y1 = Math.min(canvas.height, Math.ceil(originY + metrics.actualBoundingBoxDescent) + 1);
      if (x1 <= x0 || y1 <= y0) continue;
      const pixels = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      for (let x = 0; x < pixels.width; x++) {
        for (let y = 0; y < pixels.height; y++) {
          if (pixels.data[(y * pixels.width + x) * 4 + 3] < 64) continue;
          contour.push([left + x0 + x - originX + .5, baseline + y0 + y - originY]);
          break;
        }
      }
    }
  }

  function contactY(centerClientX, radius) {
    const x = centerClientX + world.scrollX;
    if (x !== lastX || radius !== lastRadius) {
      let surface = Infinity;
      for (const [inkX, inkY] of contour) {
        const dx = x - inkX;
        if (Math.abs(dx) <= radius) {
          surface = Math.min(surface, inkY - Math.sqrt(radius * radius - dx * dx));
        }
      }
      // Use line top if fonts or layout are still loading and ink is unavailable.
      lastHeight = Number.isFinite(surface) ? surface : heading.getBoundingClientRect().top + world.scrollY - radius;
      lastX = x;
      lastRadius = radius;
    }
    return lastHeight - world.scrollY;
  }

  function update(ageSeconds, impactClientX) {
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds >= 1.1 || motion.matches) {
      reset();
      return;
    }
    const impactX = impactClientX + world.scrollX;
    const travel = Math.min(19, size * .15);
    for (const letter of letters) {
      const dx = (letter.x - impactX) / size;
      const time = Math.max(0, ageSeconds - Math.min(.095, .042 * Math.abs(dx)));
      const strength = Math.exp(-.65 * dx * dx);
      const wave = Math.sin(17 * time) * Math.exp(-5.9 * time);
      const y = travel * strength * wave;
      const x = y * .34 * Math.tanh(dx * 1.5);
      letter.element.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)';
    }
    if (!active) {
      heading.setAttribute("data-impact", "");
      layer.hidden = false;
      active = true;
    }
  }

  resize();
  const observer = world.ResizeObserver ? new world.ResizeObserver(resize) : null;
  if (observer) observer.observe(heading);
  else world.addEventListener("resize", resize);
  doc.fonts?.addEventListener("loadingdone", resize);
  motion.addEventListener("change", reset);

  function dispose() {
    reset();
    if (observer) observer.disconnect();
    else world.removeEventListener("resize", resize);
    doc.fonts?.removeEventListener("loadingdone", resize);
    motion.removeEventListener("change", reset);
    layer.remove();
  }

  return { update, contactY, resize, dispose };
}
