import * as THREE from 'three';
import { createCosmos } from './cosmos.js';

export function createRenderer(canvas) {
  const renderer=new THREE.WebGLRenderer({
    canvas, alpha:true, antialias:true, powerPreference:'low-power'
  });
  renderer.setClearColor(0x020407,0);
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,10);
  camera.position.z=1;
  const cosmos=createCosmos(THREE);
  scene.add(cosmos.group);

  function resize() {
    const {width,height}=canvas.getBoundingClientRect();
    if(!width||!height) return;
    const dpr=Math.min(window.devicePixelRatio||1,1.8,Math.sqrt(3200000/(width*height)));
    if(dpr!==renderer.getPixelRatio()) renderer.setPixelRatio(dpr);
    renderer.setSize(width,height,false);
    cosmos.resize(width,height,dpr);
  }
  resize();
  return {
    resize,
    render(frame) { cosmos.update(frame); renderer.render(scene,camera); },
    brush(x,y) { cosmos.brush(x,y); },
    dispose() { cosmos.dispose(); renderer.dispose(); }
  };
}
