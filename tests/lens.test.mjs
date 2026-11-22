import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lensImages, sampleLens, stillTime } from '../src/space/lens.js';

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}

test('conjunction recurs continuously with a finite Einstein ring', () => {
  for (const [width,height] of [[1554,900], [390,844], [844,390]]) {
    const at = time => sampleLens(width,height,{time});
    const lens = at(3);
    const sourceDistance = x => Math.hypot(x.sourceX-x.cx,x.sourceY-x.cy);
    for (const t of [3,18,33]) close(sourceDistance(at(t)),0);
    assert.ok(at(2.6).sourceX < lens.cx && at(3.4).sourceX > lens.cx);
    assert.ok(sourceDistance(at(2.75)) < lens.sourceSize);
    assert.ok(sourceDistance(at(10.5)) > lens.einstein);
    for (const t of [0,2.5,6,12,14.999]) {
      close(at(t).sourceX,at(t+15).sourceX);
      close(at(t).sourceY,at(t+15).sourceY);
    }
    const rings = lensImages(lens);
    const rho = lens.sourceSize/lens.einstein;
    close(rings[0].magnification+rings[1].magnification, Math.hypot(rho,2)/rho);
    for (const img of rings) close(Math.hypot(img.x-lens.cx,img.y-lens.cy),lens.einstein);
    close(lens.einstein/lens.radius,1.5);
    assert.ok(9.3*lens.radius <= width*.83+1e-9 && lens.sourceSize>=1.8);
  }
});

test('both image positions solve the vector point-lens equation on either side of transit', () => {
  for (const time of [0,2,2.6,2.99,3,3.01,3.5,7.5]) {
    const lens = sampleLens(1440,900,{time});
    const [outer,inner] = lensImages(lens);
    assert.equal(outer.parity,1);
    assert.equal(inner.parity,-1);
    close(outer.magnification-inner.magnification,1);
    assert.ok(inner.magnification > 0);
    for (const {x,y} of [outer,inner]) {
      const dx=x-lens.cx, dy=y-lens.cy;
      const scale = 1 - lens.einstein**2 / (dx*dx+dy*dy);
      close(lens.cx+dx*scale,lens.sourceX);
      close(lens.cy+dy*scale,lens.sourceY);
    }
  }
});

test('orbit and brush displace the source; a paused view preserves its exact time', () => {
  const sample = props => sampleLens(1080,810,props);
  const original = sample({time:1.8});
  const tilted = sample({time:1.8,yaw:.65,pitch:-.45});
  assert.notEqual(tilted.angle,original.angle);
  assert.notEqual(tilted.inclination,original.inclination);
  assert.notEqual(tilted.sourceX,original.sourceX);
  assert.notEqual(tilted.sourceY,original.sourceY);
  const brushed = sample({time:1.8,brushX:original.cx-original.sourceX,brushY:original.cy-original.sourceY});
  close(brushed.sourceX,brushed.cx);
  close(brushed.sourceY,brushed.cy);
  assert.deepEqual(sample({time:1.8,reduceMotion:true}), original);
  assert.deepEqual(sample({reduceMotion:true}),sample({time:stillTime}));
  assert.deepEqual(sample({}),sample({time:0}));
});
test('the source aligns with the newly formed disk three seconds after any release',()=>{
  for (const time of [3,38,730]) {
    const lens=sampleLens(900,620,{time,breakAge:3});
    assert.equal(lens.sourceX,lens.cx);
    assert.equal(lens.sourceY,lens.cy);
  }
});
