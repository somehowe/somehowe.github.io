import './style.css';
import { createFallback } from './fallback.js';
import { nextAlignment, sampleLens, stillTime } from './lens.js';
import { sampleBrush } from './star-stream.js';
import { createConstellations } from './constellations.js';
import { dustOnlyAge, orbRadius } from './orb.js';

const home = document.getElementById('space-home');
const sky = document.getElementById('sky');
const tools = document.getElementById('scene-tools');
const motion = document.getElementById('motion');
const orbButton = document.getElementById('orb-target');
const reformButton = document.getElementById('reform');
const orbStatus = document.getElementById('orb-status');
const dissolvedStatus = 'The glass has dissolved into a disk of dust around the black hole.';
const preference = matchMedia('(prefers-reduced-motion: reduce)');
let canvas = document.getElementById('space-stage');
let backend;
let usingWebGL = false;
let disposed = false;
let running = !preference.matches;
let previous;
let animation = 0;
let width = 1, height = 1;
let pointer, drag, releaseTouch;
let trail, ignoreOrbClick = false;
let pointerOnOrb = false, keyboardOnOrb = false;
const frame = {
  time: stillTime, reduceMotion: !running,
  yaw:0, pitch:0, brushX:0, brushY:0, breakAge:null, orbIntent:0
};

function updateMotionButton() {
  frame.reduceMotion = !running;
  motion.toggleAttribute('data-paused',!running);
  motion.title = running ? 'Pause animation' : 'Play animation';
  motion.setAttribute('aria-label',motion.title);
}

function measure() {
  const rect = sky.getBoundingClientRect();
  width = Math.max(1,rect.width);
  height = Math.max(1,rect.height);
  const lens = sampleLens(width,height,frame);
  sky.style.setProperty('--orb-diameter',2*orbRadius(lens)+'px');
  trail?.resize(width,height,window.devicePixelRatio||1);
}

function render() {
  backend.render(frame);
  trail?.render(frame,width,height);
  home.toggleAttribute('data-rendered',true);
}

function updateOrbControls() {
  orbButton.hidden = tools.hidden || frame.breakAge!==null;
  reformButton.hidden = tools.hidden || frame.breakAge===null;
  if (orbButton.hidden) {
    pointerOnOrb = keyboardOnOrb = false;
  }
}

orbButton.addEventListener('pointerenter',()=>{ pointerOnOrb=true; queueFrame(); });
orbButton.addEventListener('pointerleave',()=>{ pointerOnOrb=false; queueFrame(); });
orbButton.addEventListener('pointercancel',()=>{ pointerOnOrb=false; queueFrame(); });
orbButton.addEventListener('focus',()=>{ keyboardOnOrb=orbButton.matches(':focus-visible'); queueFrame(); });
orbButton.addEventListener('blur',()=>{ keyboardOnOrb=false; queueFrame(); });
orbButton.addEventListener('click',event=>{
  if (orbButton.hidden || (event.detail && ignoreOrbClick)) return;
  orbButton.setAttribute('data-discovered','');
  // On a paused sky, compose the finished disk with the star's Einstein ring.
  frame.breakAge = running ? 0 : nextAlignment(dustOnlyAge);
  updateOrbControls();
  orbStatus.textContent = running
    ? 'The glass fragments are orbiting the black hole and dissolving into dust.'
    : dissolvedStatus;
  if (!event.detail) reformButton.focus({preventScroll:true});
  queueFrame();
});
reformButton.addEventListener('click',event=>{
  frame.breakAge = null;
  updateOrbControls();
  orbStatus.textContent = 'The glass orb is whole again.';
  if (!event.detail) orbButton.focus({preventScroll:true});
  queueFrame();
});

function setInteractive(available) {
  tools.hidden = !available;
  updateOrbControls();
  if (available) {
    sky.tabIndex = 0;
    sky.setAttribute('aria-describedby','instructions');
    sky.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight ArrowUp ArrowDown Home');
  } else {
    trail?.clear();
    sky.removeAttribute('tabindex');
    sky.removeAttribute('aria-describedby');
    sky.removeAttribute('aria-keyshortcuts');
    home.removeAttribute('data-rendered');
  }
}

function queueFrame() {
  if (!disposed && backend && !animation && !document.hidden) animation = requestAnimationFrame(tick);
}

function tick(timestamp) {
  animation = 0;
  if (!backend || disposed || document.hidden) return;
  const dt = Math.max(0,Math.min(.1,(timestamp-(previous ?? timestamp))/1000));
  previous = timestamp;
  const inspecting = (pointerOnOrb || keyboardOnOrb) && !orbButton.hidden && !sky.hasAttribute('data-dragging');
  const targetIntent = Number(inspecting);
  frame.orbIntent = running ? targetIntent+(frame.orbIntent-targetIntent)*Math.exp(-dt*12) : targetIntent;
  if (running) {
    frame.time += dt;
    if (frame.breakAge!==null) {
      const age = frame.breakAge;
      frame.breakAge += dt;
      if (age<dustOnlyAge && frame.breakAge>=dustOnlyAge) orbStatus.textContent = dissolvedStatus;
    }
    let x=0, y=0;
    if (pointer) {
      const lens = sampleLens(width,height,{...frame,brushX:0,brushY:0});
      const target = sampleBrush(lens,pointer.x*width,pointer.y*height,width,height);
      x = target.x;
      y = target.y;
    }
    const blend = 1-Math.exp(-dt*10);
    frame.brushX += (x-frame.brushX)*blend;
    frame.brushY += (y-frame.brushY)*blend;
  }
  try { render(); }
  catch {
    if (usingWebGL) restoreCanvas();
    else {
      backend?.dispose();
      backend = undefined;
      setInteractive(false);
    }
  }
  if (running) queueFrame();
}

function leaveTrail() {
  if (running) trail?.leave();
  else trail?.clear();
}

function trace(position) {
  if (position.x<0 || position.y<0 || position.x>1 || position.y>1) {
    leaveTrail();
    return;
  }
  if (trail===undefined) {
    const overlay=document.createElement('canvas');
    overlay.id='constellation-trail';
    overlay.setAttribute('aria-hidden','true');
    trail=createConstellations(overlay);
    if (!trail) { trail=null; return; }
    sky.append(overlay);
    trail.resize(width,height,window.devicePixelRatio||1);
    trail.render(frame,width,height);
  }
  trail?.trace(position.x*width,position.y*height);
  if (!running) trail?.render(frame,width,height);
}

function brush(position) {
  pointer = position;
  if (position && running) backend?.brush(2*position.x-1,1-2*position.y);
  else backend?.brush();
}
function local(event) {
  const rect=sky.getBoundingClientRect();
  return {x:(event.clientX-rect.left)/Math.max(1,rect.width), y:(event.clientY-rect.top)/Math.max(1,rect.height)};
}
function orbit(horizontal,vertical) {
  frame.yaw = Math.max(-1.45,Math.min(1.45,frame.yaw+horizontal));
  frame.pitch = Math.max(-.70,Math.min(.70,frame.pitch+vertical));
  queueFrame();
}
function finishDrag() {
  drag = undefined;
  sky.removeAttribute('data-dragging');
}
sky.addEventListener('pointerdown', event => {
  if (!backend || event.isPrimary===false || event.button!==0) return;
  clearTimeout(releaseTouch);
  const position=local(event);
  const lens=sampleLens(width,height,frame);
  const offset=Math.hypot(position.x*width-lens.cx,position.y*height-lens.cy);
  const target=sampleBrush(lens,position.x*width,position.y*height,width,height);
  // A finger in the outer stream can sweep it independently of the disk.
  const turn = event.pointerType!=='touch' || offset<2.1*lens.einstein || target.weight<.15;
  drag = {id:event.pointerId,x:event.clientX,y:event.clientY,turn};
  ignoreOrbClick=false;
  const surface=orbButton.contains(event.target) ? orbButton : sky;
  surface.setPointerCapture?.(event.pointerId);
  trace(position);
  brush(position);
});
sky.addEventListener('pointermove', event => {
  if (event.isPrimary===false || !backend) return;
  const position=local(event);
  trace(position);
  if (drag?.id===event.pointerId && drag?.turn) {
    const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
    if (!sky.hasAttribute('data-dragging') && Math.hypot(dx,dy)<4) return;
    sky.setAttribute('data-dragging','');
    ignoreOrbClick=true;
    const sensitivity=Math.PI/Math.max(320,Math.min(850,width));
    orbit(dx*sensitivity,-dy*sensitivity);
    drag.x=event.clientX; drag.y=event.clientY;
    brush();
  } else brush(position);
});
sky.addEventListener('pointerup', event => {
  if (!drag || event.pointerId!==drag.id) return;
  finishDrag();
  if (event.pointerType==='touch') {
    leaveTrail();
    releaseTouch=setTimeout(()=>brush(),180);
  }
});
sky.addEventListener('lostpointercapture', finishDrag);
sky.addEventListener('pointercancel', () => { finishDrag(); brush(); leaveTrail(); });
sky.addEventListener('pointerleave', () => { if (!drag) { brush(); leaveTrail(); } });
sky.addEventListener('keydown', event => {
  const steps = {ArrowLeft:[-.14,0], ArrowRight:[.14,0], ArrowUp:[0,.09], ArrowDown:[0,-.09]};
  if (event.key==='Home') {
    event.preventDefault();
    frame.yaw=frame.pitch=frame.brushX=frame.brushY=0;
    brush();
    trail?.clear();
    queueFrame();
  } else if (Object.hasOwn(steps,event.key)) {
    event.preventDefault();
    orbit(...steps[event.key]);
  }
});

function setRunning(enabled) {
  running = enabled;
  previous = undefined;
  if (!enabled) { brush(); trail?.clear(); }
  updateMotionButton();
  queueFrame();
}
motion.addEventListener('click',()=>setRunning(!running));
preference.addEventListener('change',()=>setRunning(!preference.matches));
document.addEventListener('visibilitychange',()=>{
  previous=undefined;
  if (document.hidden) { cancelAnimationFrame(animation); animation=0; brush(); finishDrag(); leaveTrail(); }
  else queueFrame();
});
window.addEventListener('resize',()=>{
  brush();
  measure();
  backend?.resize();
  queueFrame();
});

function newCanvas() {
  const next=document.createElement('canvas');
  next.id='space-stage';
  next.setAttribute('aria-hidden','true');
  return next;
}
function startFallback() {
  try {
    backend=createFallback(canvas);
    if (!backend) return;
    if (pointer) brush(pointer);
    render();
    setInteractive(true);
  } catch {
    backend?.dispose();
    backend=undefined;
    setInteractive(false);
  }
}
function restoreCanvas() {
  usingWebGL=false;
  backend?.dispose();
  backend=undefined;
  const next=newCanvas();
  canvas.replaceWith(next);
  canvas=next;
  setInteractive(false);
  startFallback();
  queueFrame();
}
async function init() {
  measure();
  updateMotionButton();
  startFallback();
  queueFrame();
  let replacement;
  try {
    const {createRenderer}=await import('./renderer.js');
    if (disposed) return;
    const next=newCanvas();
    // Keep the first surface visible until the new context has drawn successfully.
    next.style.visibility='hidden';
    sky.append(next);
    try {
      replacement=createRenderer(next);
      if (pointer && running) replacement.brush(2*pointer.x-1,1-2*pointer.y);
      replacement.render(frame);
    } catch (error) {
      next.remove(); replacement?.dispose(); throw error;
    }
    next.style.visibility='';
    backend?.dispose();
    canvas.remove();
    canvas=next;
    backend=replacement;
    usingWebGL=true;
    next.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      if (!disposed && canvas===next) restoreCanvas();
    },{once:true});
    setInteractive(true);
    home.setAttribute('data-rendered','');
    queueFrame();
  } catch { setInteractive(Boolean(backend)); }
}
window.addEventListener('pagehide',event=>{
  cancelAnimationFrame(animation); animation=0; previous=undefined;
  finishDrag(); clearTimeout(releaseTouch);
  if (!event.persisted) { disposed=true; backend?.dispose(); backend=undefined; trail?.dispose(); }
});
window.addEventListener('pageshow',()=>{ previous=undefined; queueFrame(); });
init();
