import test from 'node:test';
import assert from 'node:assert/strict';
import { createConstellations } from '../src/space/constellations.js';
import { sampleLens } from '../src/space/lens.js';

function sky(width=1000,height=700,dpr=1) {
  let path=[];
  const ink={segments:[],stars:[],clears:0};
  const context={
    clearRect(){ink.clears++; ink.segments=[]; ink.stars=[];},
    save(){}, restore(){}, setTransform(){}, fillRect(){}, closePath(){}, fill(){},
    createRadialGradient(){return {addColorStop(){}};},
    beginPath(){path=[];}, moveTo(x,y){path.push([x,y]);}, lineTo(x,y){path.push([x,y]);},
    arc(x,y){ink.stars.push([x,y]);},
    stroke(){if(this.lineWidth<1)ink.segments.push(path);}
  };
  const canvas={getContext:()=>context};
  const layer=createConstellations(canvas);
  layer.resize(width,height,dpr);
  const draw=time=>layer.render({time},width,height);
  return {layer,canvas,ink,draw};
}

test('a sweep recruits a stable constellation and a stationary pointer lets it fade', () => {
  const {layer,ink,draw}=sky();
  draw(0);
  assert.equal(ink.clears,0);
  function sweep(base){
    for(let i=0;i<=15;i++){
      draw(base+i*.035);
      layer.trace(72+i*13,459+19*Math.sin(i*.15));
    }
    draw(base+.9);
    return ink.segments;
  }
  const segments=sweep(0);
  assert.ok(segments.length>=3 && segments.length<=7);
  for(const [a,b] of segments){
    const length=Math.hypot(a[0]-b[0],a[1]-b[1]);
    assert.ok(length>20 && length<91,'seams connect distinct nearby catalogue stars');
  }
  const endpoints=new Set(segments.flat().map(p=>p.join(',')));
  assert.ok(endpoints.size>=4);
  for(let i=0;i<6;i++)layer.trace(267,459+19*Math.sin(2.25));
  draw(3);
  assert.equal(ink.segments.length,0);
  const clears=ink.clears;
  draw(4);
  assert.equal(ink.clears,clears,'empty overlay stops clearing its buffer');
  layer.clear();
  assert.deepEqual(sweep(5),segments);
  layer.leave();
  draw(7.5);
  assert.equal(ink.stars.length,0);
});

test('centre crossings and screen-spanning jumps do not draw connecting chords', () => {
  const {layer,ink,draw}=sky();
  const lens=sampleLens(1000,700);
  for(let i=0;i<=40;i++){
    draw(i*.025);
    layer.trace(80+i*21,lens.cy);
    draw(i*.025+.015);
    for(const [[x,y],[bx,by]] of ink.segments){
      const dx=bx-x,dy=by-y;
      const t=Math.max(0,Math.min(1,((lens.cx-x)*dx+(lens.cy-y)*dy)/(dx*dx+dy*dy)));
      assert.ok(Math.hypot(x+t*dx-lens.cx,y+t*dy-lens.cy)>lens.radius);
    }
  }
  layer.trace(50,612);
  draw(1.33);
  assert.ok(ink.segments.every(([a,b])=>Math.hypot(a[0]-b[0],a[1]-b[1])<91));
  layer.clear();
  assert.equal(ink.stars.length,0);
  layer.dispose();
  layer.trace(150,640);
  draw(2.0);
  assert.equal(ink.stars.length,0);
});

test('releasing during a chain rollover preserves the previous fading constellation', () => {
  const {layer,ink,draw}=sky();
  for(let i=0;i<=34;i++){
    draw(i*.018);
    layer.trace(55+i*14,610+9*Math.sin(i*.19));
  }
  draw(.83);
  const before=ink.segments;
  assert.ok(before.length>7,'the gesture contains both a current and a retiring chain');
  layer.leave();
  draw(.83);
  assert.deepEqual(ink.segments,before);
  draw(2.2);
  assert.equal(ink.segments.length,0);
});

test('the overlay caps backing pixels and gracefully handles unavailable 2D drawing', () => {
  assert.equal(createConstellations({getContext:()=>null}),null);
  const {layer,canvas}=sky(3200,1800,3);
  assert.ok(canvas.width*canvas.height<=3000000);
  layer.resize(300,500,4);
  assert.deepEqual([canvas.width,canvas.height],[600,1000]);
});
