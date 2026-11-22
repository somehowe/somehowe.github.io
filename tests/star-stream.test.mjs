import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStarStream, sampleBrush } from '../src/space/star-stream.js';
import { lensImages, sampleLens } from '../src/space/lens.js';

test('a brush displaces a bounded patch and stars settle onto their moving paths',()=>{
  const sky=createStarStream(), control=createStarStream();
  const width=1280, height=800;
  const x=.23*width, y=.42*height;
  function frame(time,w=width,h=height) {
    for (const stream of [sky,control]) stream.update({time},w,h);
  }
  frame(0);
  sky.hover(2*x/width-1,1-2*y/height);
  for (let i=1;i<=36;i++) frame(i/60);
  let moved=0;
  for (let i=0;i<sky.count;i++) {
    const k=3*i, p=sky.positions, q=control.positions;
    const shift=Math.hypot((p[k]-q[k])*width/2,(p[k+1]-q[k+1])*height/2);
    if (shift<1) continue;
    moved++;
    const fromBrush=Math.hypot((q[k]+1)*width/2-x,(1-q[k+1])*height/2-y);
    assert.ok(fromBrush<119);
    assert.ok(shift<36);
  }
  assert.ok(moved>18);
  sky.hover();
  for (let i=37;i<=155;i++) frame(i/60,390,844);
  // Particles culled on a narrow screen must not revive a stale brush offset.
  frame(156/60);
  assert.deepEqual(sky.positions,control.positions);
});

test('visible stream stars follow the positive image of the point lens', () => {
  const width = 1280, height = 800, frame = {time: 2.4};
  const lens = sampleLens(width,height,frame);
  const unlensed = createStarStream(), lensed = createStarStream();
  unlensed.update(frame,width,height);
  lensed.update(frame,width,height,lens);
  let checked = 0;
  for (let k = 0; k < lensed.positions.length; k += 3) {
    if (lensed.positions[k+2] <= 0) continue;
    const x = (1+lensed.positions[k])*width/2 - lens.cx;
    const y = (1-lensed.positions[k+1])*height/2 - lens.cy;
    const distance = Math.hypot(x,y);
    assert.ok(distance >= lens.einstein);
    const inverse = 1 - (lens.einstein/distance)**2;
    const sourceX = (1+unlensed.positions[k])*width/2;
    const sourceY = (1-unlensed.positions[k+1])*height/2;
    assert.ok(Math.abs(lens.cx + x*inverse - sourceX) < .001);
    assert.ok(Math.abs(lens.cy + y*inverse - sourceY) < .001);
    checked++;
  }
  assert.ok(checked > 100);
});

test('a fixed reduced-motion frame stays still and respects the paused clock', () => {
  const sky = createStarStream(), control = createStarStream();
  const width = 390, height = 844;
  function draw(stream,time,reduced) {
    const frame = {time,reduceMotion:reduced};
    stream.update(frame,width,height,sampleLens(width,height,frame));
  }
  draw(sky,1.5,true);
  const paused = sky.positions.slice();
  sky.hover(-.5,.2);
  for (let i=0; i<3; i++) draw(sky,1.5,true);
  assert.deepEqual(sky.positions,paused);
  // A supplied new clock remains authoritative, while a hover in reduced
  // motion leaves the particle paths identical to those of an untouched sky.
  draw(sky,1.55,true);
  draw(control,1.55,false);
  assert.notDeepEqual(sky.positions,paused);
  assert.deepEqual(sky.positions,control.positions);
});

test('brushing either lensed image of the same source gives the same bounded push', () => {
  const width = 1280, height = 800;
  const lens = sampleLens(width,height,{time:3});
  const source = {...lens, sourceX:lens.sourceX+.24*lens.einstein, sourceY:lens.sourceY-.13*lens.einstein};
  const probes = lensImages(source).map(({x,y}) => sampleBrush(lens,x,y,width,height));
  for (const probe of probes) {
    assert.ok(probe.weight > .7 && probe.weight <= 1);
    assert.ok(probe.x < 0 && probe.y > 0);
    assert.ok(Math.hypot(probe.x,probe.y) <= Math.min(45,.44*lens.einstein));
  }
  for (const key of ['x','y','weight']) assert.ok(Math.abs(probes[0][key]-probes[1][key]) < 1e-9);
  assert.deepEqual(sampleBrush(lens,lens.cx,lens.cy,width,height),{x:0,y:0,weight:0});
  assert.equal(sampleBrush(lens,width*.05,height*.94,width,height).weight,0);
});
