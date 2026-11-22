// All distances are CSS pixels in the screen plane, with y increasing downward.
// The Einstein radius sets the scale of the weak-field point-lens equation.
const crossingTime = 3;
const period = 15;
const tau = 2 * Math.PI;
export const stillTime = 2.89;

export function nextAlignment(age) {
  return crossingTime + period*Math.ceil((age-crossingTime)/period);
}

export function sampleLens(width, height, frame = {}) {
  const radius = Math.min(width * .83, height * .99, 950) / 9.3;
  const einstein = radius * 1.5;
  const cx = width * .5;
  const cy = height * .36;
  const yaw = Math.sin(frame.yaw || 0);
  const pitch = Math.sin(frame.pitch || 0);
  const skyTime = Number.isFinite(frame.time) ? frame.time : (frame.reduceMotion ? stillTime : 0);
  // The source emerges as the glass opens. Its first transit meets the newly
  // formed disk no matter how long the visitor spent drawing in the sky.
  const time = Number.isFinite(frame.breakAge) ? frame.breakAge : skyTime;

  // The background star crosses the optical axis once per
  // revolution. Ease through conjunction so the finite star's arcs can resolve.
  const meanPhase = tau * (((time - crossingTime) % period) / period);
  const phase = meanPhase - .81 * Math.sin(meanPhase);
  const along = 2.68 * Math.sin(phase);
  const across = .68 * (1 - Math.cos(phase));
  const pathAngle = .33;
  const c = Math.cos(pathAngle), s = Math.sin(pathAngle);
  const sourceX = cx + einstein * (along * c + across * s + .26 * yaw) + (frame.brushX || 0);
  const sourceY = cy + einstein * (along * s - across * c + .34 * pitch) + (frame.brushY || 0);
  return {
    cx, cy, radius, einstein,
    angle: -.095 + .17 * yaw,
    inclination: .33 + .135 * pitch + .073 * pitch * pitch,
    sourceX, sourceY, sourceSize: Math.max(1.8, einstein * .085),
  };
}

// Area-average the point-source magnification across a uniform disk near
// conjunction. A ray from the optical axis intersects the source between lo
// and hi. The radial integral of u A(u) is u sqrt(u² + 4) / 2.
function diskMagnification(u, rho) {
  if (!u) return Math.hypot(rho, 2) / rho;
  const point = (u*u + 2) / (u * Math.hypot(u, 2));
  if (u >= 4*rho) return point;
  const limit = u < rho ? Math.PI : Math.asin(Math.min(1, rho/u));
  const count = 16;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const angle = (i + .5) * limit / count;
    const middle = u * Math.cos(angle);
    const half = Math.sqrt(Math.max(0, rho*rho - (u*Math.sin(angle))**2));
    const lo = Math.max(0, middle - half), hi = middle + half;
    sum += hi * Math.hypot(hi,2) - lo * Math.hypot(lo,2);
  }
  const finite = sum * limit / (count * Math.PI * rho*rho);
  const blend = Math.max(0, u/rho - 3);
  return finite + (point - finite) * blend*blend*(3 - 2*blend);
}

// Image-center positions solve beta = theta - 1/theta. Magnification is the
// unsigned image area divided by the unlensed source area. Exactly on axis,
// these positions are opposite samples of a continuous Einstein ring.
export function lensImages(lens) {
  const { cx, cy, einstein, sourceX, sourceY, sourceSize } = lens;
  const dx = sourceX - cx, dy = sourceY - cy;
  const distance = Math.hypot(dx, dy);
  const ux = distance ? dx / distance : Math.cos(.33);
  const uy = distance ? dy / distance : Math.sin(.33);
  const u = distance / einstein;
  const outer = .5 * (u + Math.hypot(u,2));
  // The product of the signed roots is -1. Its reciprocal is well-conditioned
  // even when the secondary image is very close to the optical axis.
  const inner = -1 / outer;
  const total = diskMagnification(u, sourceSize / einstein);
  function image(theta, parity) {
    return {
      x: cx + ux * theta * einstein, y: cy + uy * theta * einstein,
      parity, magnification: (total + parity) / 2,
    };
  }
  return [image(outer,1), image(inner,-1)];
}
