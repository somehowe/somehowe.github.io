import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleLens } from '../src/space/lens.js';
import { createOrb, dustOnlyAge, erosionStartAge, orbRadius, orbStages } from '../src/space/orb.js';

const lens=sampleLens(1440,900);
function center(orb,i) {
  const p=orb.positions, k=9*i;
  return [(p[k]+p[k+3]+p[k+6])/3-lens.cx,
    (p[k+1]+p[k+4]+p[k+7])/3-lens.cy, (p[k+2]+p[k+5]+p[k+8])/3];
}
function edgeLength(p,i,j) {
  return Math.hypot(p[i]-p[j],p[i+1]-p[j+1],p[i+2]-p[j+2]);
}

test('the intact triangles form a closed sphere with outward normals', () => {
  const orb=createOrb().update(lens,{time:2});
  const edges=new Map();
  assert.equal(orb.radius,orbRadius(lens));
  assert.equal(orb.radius,1.24*lens.radius);
  for (let face=0;face<orb.count;face++) {
    const vertices=[];
    for (let j=0;j<3;j++) {
      const k=face*9+j*3, p=orb.positions;
      assert.ok(Math.abs(Math.hypot(p[k]-lens.cx,p[k+1]-lens.cy,p[k+2])-orb.radius)<.001);
      vertices.push([p[k],p[k+1],p[k+2]].map(v=>Math.round(v*1000)).join(','));
    }
    for (let j=0;j<3;j++) {
      const edge=[vertices[j],vertices[(j+1)%3]].sort().join('|');
      edges.set(edge,(edges.get(edge)||0)+1);
    }
    const n=orb.normals.subarray(3*face,3*face+3), [x,y,z]=center(orb,face);
    assert.ok(Math.abs(Math.hypot(...n)-1)<1e-5);
    assert.ok(n[0]*x+n[1]*y+n[2]*z>0);
    assert.ok(Math.abs(orb.depth[face]-z)<.001);
  }
  for (const adjacent of edges.values()) assert.equal(adjacent,2);
});

test('the deliberate seam is two joined real mesh edges and responds without changing the pose',()=>{
  const orb=createOrb().update(lens,{time:2.89});
  const joins=new Map();
  const vertex=(face,corner)=>{
    const start=face*9+corner*3;
    return Array.from(orb.positions.subarray(start,start+3),value=>Math.round(value*1000)).join('/');
  };
  for(let face=0;face<orb.count;face++)for(let edge=0;edge<3;edge++) {
    const weight=orb.seamEdges[face*3+edge];
    if(!weight)continue;
    const a=vertex(face,edge),b=vertex(face,(edge+1)%3),key=[a,b].sort().join('|');
    const join=joins.get(key)||{a,b,weights:[]};
    join.weights.push(weight);joins.set(key,join);
  }
  assert.equal(joins.size,2,'the art-directed 34→32→41 path must remain present');
  const degrees=new Map();
  for(const {a,b,weights} of joins.values()) {
    assert.equal(weights.length,2,'each join must belong to both neighboring facets');
    assert.equal(weights[0],weights[1]);
    for(const vertex of [a,b])degrees.set(vertex,(degrees.get(vertex)||0)+1);
  }
  assert.deepEqual([...degrees.values()].sort(),[1,1,2],'the seam is one short connected fault');
  const positions=orb.positions.slice(),mask=orb.seamEdges,quiet=orb.seamStrength;
  orb.update(lens,{time:2.89,orbIntent:1});
  assert.ok(orb.seamStrength>quiet && orb.seamStrength<.6);
  assert.deepEqual(orb.positions,positions);
  assert.equal(orb.seamEdges,mask,'the static edge buffer is reused');
  const intended=orb.seamStrength;
  orb.update(lens,{time:2.89,orbIntent:1,breakAge:0,reduceMotion:true});
  assert.equal(orb.seamStrength,intended);
  assert.deepEqual(orb.positions,positions,'release begins in the same attached pose');
  orb.update(lens,{time:3.09,orbIntent:1,breakAge:.2});
  assert.ok(orb.seamStrength>0 && orb.seamStrength<intended);
  const strength=orb.seamStrength,broken=orb.positions.slice();
  orb.update(lens,{time:3.09,orbIntent:1,breakAge:.2,reduceMotion:true});
  assert.equal(orb.seamStrength,strength);
  assert.deepEqual(orb.positions,broken);
  orb.update(lens,{time:3.39,orbIntent:1,breakAge:.5});
  assert.equal(orb.seamStrength,0,'the identifying glint yields to the actual open fractures');
});

function longestEdge(positions,face) {
  const k=face*9;
  return Math.max(edgeLength(positions,k,k+3),edgeLength(positions,k+3,k+6),edgeLength(positions,k+6,k));
}

// Measure area in 3D because a tumbling face can turn edge-on to the camera.
function triangleArea(p,face) {
  const k=face*9;
  const ax=p[k+3]-p[k],ay=p[k+4]-p[k+1],az=p[k+5]-p[k+2];
  const bx=p[k+6]-p[k],by=p[k+7]-p[k+1],bz=p[k+8]-p[k+2];
  return Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)/2;
}

function pose(orb) {
  return {
    positions:orb.positions.slice(), normals:orb.normals.slice(), depth:orb.depth.slice(),
    colors:orb.colors.slice(), opacity:orb.opacity.slice(), erosion:orb.erosion.slice(),
    fracture:orb.fracture, settled:orb.settled, disk:orb.disk,
  };
}

test('a click starts in the visible pose, pause freezes erosion, and replay resets every facet', () => {
  const orb=createOrb(), positions=orb.positions;
  const clickTime=4.5;
  function sample(age,reduceMotion=false) {
    orb.update(lens,{time:clickTime+(age??0),breakAge:age,reduceMotion});
    return pose(orb);
  }
  const intact=sample(null);
  assert.deepEqual(sample(0),intact);
  assert.ok(intact.erosion.every(e=>e===0));
  const opening=sample(1.1);
  assert.notDeepEqual(opening.positions,intact.positions);
  const mid=sample(7.5);
  assert.deepEqual(sample(7.5,true),mid);
  const mature=sample(dustOnlyAge+12);
  assert.equal(mature.fracture,1);
  assert.equal(mature.settled,1);
  assert.equal(mature.disk,1);
  assert.deepEqual(sample(null),intact);
  assert.deepEqual(sample(1.1),opening);
  assert.deepEqual(sample(7.5),mid);
  assert.deepEqual(sample(dustOnlyAge+12,true),mature);
  assert.equal(positions,orb.positions);
  for (const stage of ['fracture','settled','disk']) {
    assert.equal(orbStages(null)[stage],0);
    assert.equal(orbStages(3)[stage],1);
  }
});

test('facets erode in size order, losing physical extent before they vanish', () => {
  assert.equal(dustOnlyAge,14);
  const orb=createOrb();
  const settledAge=erosionStartAge;
  function sample(age) {
    orb.update(lens,{time:4+age,breakAge:age});
  }
  sample(settledAge);
  assert.ok(orb.erosion.every(value=>value===0));
  const original=orb.positions.slice();
  const faces=Array.from({length:orb.count},(_,i)=>({
    id:i, settledArea:triangleArea(original,i), settledWidth:longestEdge(original,i), previousWidth:longestEdge(original,i),
    previousErosion:orb.erosion[i], lastSolidAge:null, visiblyShrank:false,
  }));
  for (let step=0;step<=64;step++) {
    const age=step===64?dustOnlyAge:settledAge+(dustOnlyAge-settledAge)*step/64;
    sample(age);
    for (const face of faces) {
      const {id}=face, erosion=orb.erosion[id], opacity=orb.opacity[id];
      const width=longestEdge(orb.positions,id);
      assert.ok(erosion>=0 && erosion<=1 && erosion>=face.previousErosion);
      // Rotations and a moving centroid introduce subpixel Float32 roundoff.
      assert.ok(width<=face.previousWidth+.0003,`face ${id} grows at age ${age}`);
      if (width>.25) {
        const k=9*id;
        const scaleA=edgeLength(orb.positions,k,k+3)/edgeLength(original,k,k+3);
        const scaleB=edgeLength(orb.positions,k,k+6)/edgeLength(original,k,k+6);
        assert.ok(Math.abs(scaleA-scaleB)<.001);
      }
      if (width>0 && width<face.settledWidth*.75 && opacity>.15) face.visiblyShrank=true;
      if (opacity>0 && width>0) face.lastSolidAge=age;
      face.previousErosion=erosion;
      face.previousWidth=width;
      if (age>=orb.erosionEnds[id] || age===dustOnlyAge) {
        assert.equal(erosion,1);
        assert.equal(opacity,0);
        assert.equal(width,0);
      }
    }
  }
  assert.ok(faces.every(face=>face.lastSolidAge!==null));
  assert.ok(faces.filter(f=>f.visiblyShrank).length>faces.length*.6);
  faces.sort((a,b)=>a.settledArea-b.settledArea);
  for (let i=0;i<faces.length;i++) {
    const end=orb.erosionEnds[faces[i].id];
    assert.ok(end>settledAge && end<=dustOnlyAge);
    if (i>0) assert.ok(end>=orb.erosionEnds[faces[i-1].id]-.001);
  }
  const quartile=Math.floor(faces.length/4);
  function averageLastSolid(group) {
    return group.reduce((sum,f)=>sum+f.lastSolidAge,0)/group.length;
  }
  const small=averageLastSolid(faces.slice(0,quartile));
  const large=averageLastSolid(faces.slice(-quartile));
  assert.ok(large>small+1,`smallest quarter persists to ${small}s, largest to ${large}s`);
  assert.ok(new Set(faces.map(f=>f.lastSolidAge)).size>4);
});

test('orbital centers keep shearing through a thin bounded disk after solid facets disappear', () => {
  const orb=createOrb();
  const c=Math.cos(lens.angle),s=Math.sin(lens.angle),inc=lens.inclination,tilt=Math.sqrt(1-inc*inc);
  function sample(age) {
    orb.update(lens,{time:4+age,breakAge:age});
    let near=0,far=0;
    const data=[];
    for (let i=0;i<orb.count;i++) {
      const [x,y,z]=center(orb,i),u=x*c+y*s,cross=x*s-y*c;
      const v=cross*inc-z*tilt, height=cross*tilt+z*inc;
      const r=Math.hypot(u,v)/lens.radius;
      assert.ok(r>1.67 && r<4.65);
      assert.ok(Math.abs(height/lens.radius)<.055);
      assert.ok(Math.abs(z-orb.depth[i])<.001);
      if (orb.depth[i]>0) near++; else far++;
      if (age>=dustOnlyAge) {
        assert.equal(orb.opacity[i],0);
        assert.equal(longestEdge(orb.positions,i),0);
      }
      data.push({phase:Math.atan2(v,u),r});
    }
    assert.ok(Math.min(near,far)>orb.count*.12);
    return data;
  }
  function checkShear(age) {
    const first=sample(age),second=sample(age+.05);
    const speeds=first.map(({phase,r},i)=>({r,delta:(second[i].phase-phase+2*Math.PI)%(2*Math.PI)}));
    const inner=speeds.filter(p=>p.r<2.45),outer=speeds.filter(p=>p.r>3.7);
    assert.ok(inner.length && outer.length);
    assert.ok(Math.min(...inner.map(p=>p.delta))>Math.max(...outer.map(p=>p.delta)));
  }
  checkShear(4);
  checkShear(dustOnlyAge+2);
  checkShear(3600);
});
