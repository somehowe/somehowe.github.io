// Falling glass and the fracture share the same contact point in scene coordinates.
const flightTime = 1.26;
const startDelay = .10;
const impactTime = startDelay + flightTime;
const settleTime = 1.48;

function ease(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export function createOrbDrop(nameImpact) {
  let elapsed = 0;
  let phase = 'fall';
  let stageX = 0, stageY = 0, centerX = 0, restY = 0, radius = 1;

  function resize(box, center, glassRadius) {
    stageX = box.left + window.scrollX;
    stageY = box.top + window.scrollY;
    centerX = center.cx;
    restY = center.cy;
    radius = glassRadius;
    nameImpact.resize();
  }

  function resetPose(state) {
    state.introOrbY = state.introFragmentY = state.introLensY = null;
    state.introHideCore = false;
    state.introReveal = 1;
    nameImpact.update(null, 0);
  }

  function settle(state, finalBreakAge) {
    phase = 'done';
    state.breakAge = finalBreakAge;
    resetPose(state);
  }

  function pose(state) {
    if (phase !== 'fall' && phase !== 'impact') return;
    const x = stageX + centerX - window.scrollX;
    const contact = nameImpact.contactY(x, radius) - (stageY - window.scrollY);
    if (phase === 'fall') {
      const t = Math.min(1, Math.max(0, (elapsed - startDelay) / flightTime));
      state.introOrbY = (-radius - 3) + (contact + radius + 3) * t * t;
      state.introHideCore = true;
      state.introReveal = 0;
      return;
    }

    const age = state.breakAge;
    const lift = ease((age - .085) / (settleTime - .085));
    // For the first beat the glass follows the yielding letters, then its fragments lift off.
    const compression = Math.min(31, radius * .46) * Math.sin(16 * age)
      * Math.exp(-5 * age) * (1 - ease((age - .09) / .16));
    const center = contact + compression + (restY - contact) * lift;
    state.introOrbY = center;
    state.introFragmentY = center;
    state.introLensY = center;
    state.introReveal = ease((age - .075) / .82);
    state.introHideCore = age < .075;
    nameImpact.update(age, x);
    if (age >= settleTime) {
      phase = 'done';
      resetPose(state);
    }
  }

  function advance(state, dt) {
    if (phase === 'fall') {
      elapsed += dt;
      if (elapsed >= impactTime) {
        phase = 'impact';
        // The impact lands at the bottom of the glass, against the heading.
        state.impactX = 0;
        state.impactY = .98;
        state.impactYaw = state.yaw;
        state.impactPitch = state.pitch;
        state.breakAge = elapsed - impactTime;
      }
    }
    pose(state);
  }

  return {
    resize, settle, pose, advance,
    get active() { return phase === 'fall' || phase === 'impact'; }
  };
}
