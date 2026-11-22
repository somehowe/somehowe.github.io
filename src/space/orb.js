const tau = 2 * Math.PI;
const clamp = x => Math.min(1, Math.max(0, x));
const mix = (a,b,t) => a+(b-a)*t;
function smooth(start,end,t) {
  const u=clamp((t-start)/(end-start));
  return u*u*(3-2*u);
}

export const orbRadius = lens => 1.24*lens.radius;
export const erosionStartAge = 2.65;
export const dustOnlyAge = 14;

export function orbStages(age) {
  const t = Number.isFinite(age) ? Math.max(0,age) : 0;
  return {fracture:smooth(0,.65,t), settled:smooth(.88,2.8,t), disk:smooth(.16,2.12,t)};
}

function normalized([x,y,z]) {
  const r=Math.hypot(x,y,z);
  return [x/r,y/r,z/r];
}
function randomSequence() {
  let state=0x6a40a6ef;
  return () => {
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/4294967296;
  };
}

// Subdivide an icosahedron using shared edge midpoints. Split a subset of
// faces around interior points to give the smaller slivers larger neighbors
// while keeping every edge closed. No new debris is spawned at release.
function makeShell() {
  const random=randomSequence(), g=(1+Math.sqrt(5))/2;
  const points=[[-1,g,0],[1,g,0],[-1,-g,0],[1,-g,0],[0,-1,g],[0,1,g],
    [0,-1,-g],[0,1,-g],[g,0,-1],[g,0,1],[-g,0,-1],[-g,0,1]].map(normalized);
  const faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],
    [11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const edges=new Map(), coarse=[];
  function midpoint(a,b) {
    const key=Math.min(a,b)*64+Math.max(a,b);
    if (edges.has(key)) return edges.get(key);
    const fraction=.37+.26*random();
    const point=points[a].map((n,i)=>mix(n,points[b][i],fraction));
    const id=points.push(normalized(point))-1;
    edges.set(key,id);
    return id;
  }
  for (const [a,b,c] of faces) {
    const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);
    coarse.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);
  }
  const triangles=[];
  for (const [a,b,c] of coarse) {
    if (random()>.43) {triangles.push([a,b,c]); continue;}
    const wa=.13+.34*random(), wb=(1-wa)*(.32+.38*random());
    const interior=points[a].map((n,i)=>n*wa+points[b][i]*wb+points[c][i]*(1-wa-wb));
    const d=points.push(normalized(interior))-1;
    triangles.push([a,b,d],[b,c,d],[c,a,d]);
  }
  const facets=triangles.map(([a,b,c])=>{
    const A=points[a], B=points[b], C=points[c];
    const x=B[0]-A[0],y=B[1]-A[1],z=B[2]-A[2];
    const u=C[0]-A[0],v=C[1]-A[1],w=C[2]-A[2];
    const cross=[y*w-z*v,z*u-x*w,x*v-y*u];
    const normal=normalized(cross);
    const area=.5*Math.hypot(...cross);
    const centroid=A.map((value,axis)=>(value+B[axis]+C[axis])/3);
    const center=normalized(centroid);
    const massResponse=Math.min(1.8,Math.max(.63,Math.pow(.050/area,.34)));
    const lane=random(), grain=random(), bias=random();
    const orbit=1.82+2.36*lane+.19*bias;
    const size=grain<.42 ? .055+.24*random() : grain<.77 ? .32+.18*random() : .60+.25*random();
    // Surface area after the first grind determines how long a pane survives.
    // Express its width in orb radii so erosion looks the same at every zoom.
    const settledWidth=size*Math.sqrt(Math.hypot(...cross));
    const erosionEnd=mix(5.8,dustOnlyAge,clamp(settledWidth/.44));
    return {indices:[a,b,c],normal,centroid,center,area,massResponse,orbit,size,erosionEnd,phase:tau*random(),
      axis:normalized([random()-.5,random()-.5,random()-.5]),
      spin:(random()>.5?1:-1)*(.78+2.7*random()),
      kickBias:.48+.69*random(),eccentricity:.012+.031*random(),
      speed:2.65/Math.pow(.515*orbit,1.5),
      frost:.17+.78*random()};
  });
  return {points,facets};
}

// Pick one short fault from the shell's existing joins. The connected path is
// selected once in body space; it rotates with the glass and never becomes a
// screen-space overlay or a second wireframe around the whole mesh.
function shellSeam(facets) {
  // The seeded shell is art-directed: this short front-side fault follows
  // joins 34→32→41. Keep its two connected physical edges, not a wireframe.
  const chain=[34,32,41];
  const joins=new Map();
  for(let edge=0;edge<chain.length-1;edge++) {
    const a=chain[edge],b=chain[edge+1];
    joins.set(`${Math.min(a,b)}/${Math.max(a,b)}`,.72+.28*Math.sin(Math.PI*(edge+.5)/(chain.length-1)));
  }
  const weights=new Float32Array(facets.length*3);
  facets.forEach(({indices},face)=>{
    for(let edge=0;edge<3;edge++) {
      const a=indices[edge],b=indices[(edge+1)%3];
      weights[face*3+edge]=joins.get(`${Math.min(a,b)}/${Math.max(a,b)}`)||0;
    }
  });
  return weights;
}

// A few broad and narrow studio reflections read as curved strips across the
// intact facets. Their motion follows each fragment's changing 3D normal.
function lightFace(result,i,nx,ny,nz,depth,settled,frost) {
  const face=nz<0?-1:1;
  const z=Math.abs(nz), x=2*nx*face*z, y=2*ny*face*z, rz=2*z*z-1;
  const rim=(1-z)*(1-z);
  const panel=Math.exp(-((x+.53+.32*y)**2)/.026-((y+.26)**2)/.55)*(.53+.47*Math.max(0,rz));
  const strip=Math.exp(-((x-.47+.24*y)**2)/.009-((y+.12)**2)/.66);
  const warm=Math.exp(-((y-.49+.24*x)**2)/.024-((x+.31)**2)/.72);
  const glint=clamp(.43*panel+.74*strip+.23*rim);
  const fill=.13+.12*rim+.103*frost+.050*Math.max(0,-ny);
  const gold=warm*.36 + settled*(.13+.38*Math.max(0,-nx))*(.57+.43*frost);
  const k=3*i;
  result.colors[k]=clamp(fill*.62+.74*glint+gold);
  result.colors[k+1]=clamp(fill*.95+.90*glint+.55*gold);
  result.colors[k+2]=clamp(fill*1.28+glint+.21*gold);
  const glass=.48+.20*rim+.24*glint+.06*warm;
  const debris=.59+.21*smooth(-.32,.32,depth)+.13*glint;
  result.opacity[i]=mix(glass,debris,settled);
}

// All buffers keep their identities. A face consists of three consecutive XYZ
// vertices in absolute CSS pixels (z towards the observer). Facet i has the
// same outline before fracture, in flight and in the rotating disk.
export function createOrb() {
  const {points,facets}=makeShell();
  const rotated=new Float64Array(points.length*3);
  const loadingWeights=new Float64Array(points.length);
  const count=facets.length;
  const branchLights=new Float32Array(count),releaseLoads=new Float64Array(count),meanWeights=new Float64Array(count);
  const normalDeltas=new Float64Array(count*3),impulses=new Float64Array(count*3);
  let strike=null;
  const loading=age=>-.105*(age/.035)*Math.exp(1-age/.035);
  const result={count,positions:new Float32Array(count*9), normals:new Float32Array(count*3),
    colors:new Float32Array(count*3), opacity:new Float32Array(count),depth:new Float32Array(count),
    orbits:Float32Array.from(facets,f=>f.orbit), erosionEnds:Float32Array.from(facets,f=>f.erosionEnd),
    erosion:new Float32Array(count),seamEdges:shellSeam(facets),seamStrength:0,
    crackLight:new Float32Array(count),separation:new Float32Array(count),releaseAges:new Float32Array(count),
    masses:Float32Array.from(facets,facet=>facet.area),
    radius:0,fracture:0,settled:0,disk:0,update};

  function prepareStrike(time,frame) {
    let x=Number.isFinite(frame.impactX)?Math.max(-1,Math.min(1,frame.impactX)):-.24;
    let y=Number.isFinite(frame.impactY)?Math.max(-1,Math.min(1,frame.impactY)):-.16;
    const radius=Math.hypot(x,y);
    if(radius>.98){x*=.98/radius;y*=.98/radius;}
    const yaw=Number.isFinite(frame.impactYaw)?frame.impactYaw:(frame.yaw||0);
    const pitch=Number.isFinite(frame.impactPitch)?frame.impactPitch:(frame.pitch||0);
    if(strike&&Math.abs(strike.time-time)<1e-7&&strike.x===x&&strike.y===y&&strike.yaw===yaw&&strike.pitch===pitch)return strike;
    const z=Math.sqrt(Math.max(0,1-x*x-y*y));
    const sy=Math.sin(.53+.25*time+yaw*.75),cy=Math.cos(.53+.25*time+yaw*.75);
    const sp=Math.sin(-.27+.16*Math.sin(time*.31)+pitch*.52),cp=Math.cos(-.27+.16*Math.sin(time*.31)+pitch*.52);
    const side=-sp*y+cp*z;
    const ix=cy*x+sy*side,iy=cp*y+sp*z,iz=-sy*x+cy*side;
    const length=Math.hypot(iz,ix);
    const tx=length>1e-8?iz/length:1,tz=length>1e-8?-ix/length:0;
    const vx=iy*tz,vy=iz*tx-ix*tz,vz=-iy*tx;
    for(let i=0;i<points.length;i++) {
      const p=points[i];
      loadingWeights[i]=Math.exp(-(1-(p[0]*ix+p[1]*iy+p[2]*iz))/.12);
    }
    let lastRelease=0;
    for(let i=0;i<count;i++) {
      const f=facets[i],[fx,fy,fz]=f.center,[a,b,c]=f.indices;
      const travel=Math.acos(Math.max(-1,Math.min(1,fx*ix+fy*iy+fz*iz)))/Math.PI;
      const bearing=Math.atan2(fx*vx+fy*vy+fz*vz,fx*tx+fz*tz);
      const release=result.releaseAges[i]=.055+.235*travel+.005*Math.sin(4*bearing+3*travel);
      lastRelease=Math.max(lastRelease,release);
      branchLights[i]=.16+.84*Math.max(0,Math.cos(3*bearing+1.7*travel+.6*Math.sin(7*bearing-3*travel)))**6;
      releaseLoads[i]=loading(release);
      const weight=meanWeights[i]=(loadingWeights[a]+loadingWeights[b]+loadingWeights[c])/3;
      const A=points[a],B=points[b],C=points[c],wa=loadingWeights[b]-loadingWeights[a],wb=loadingWeights[c]-loadingWeights[a];
      const ax=B[0]-A[0],ay=B[1]-A[1],az=B[2]-A[2],bx=C[0]-A[0],by=C[1]-A[1],bz=C[2]-A[2];
      const k=i*3;
      normalDeltas[k]=wa*(iy*bz-iz*by)+wb*(ay*iz-az*iy);
      normalDeltas[k+1]=wa*(iz*bx-ix*bz)+wb*(az*ix-ax*iz);
      normalDeltas[k+2]=wa*(ix*by-iy*bx)+wb*(ax*iy-ay*ix);
      const load=releaseLoads[i]*weight;
      const cx=f.centroid[0]+ix*load,cy=f.centroid[1]+iy*load,cz=f.centroid[2]+iz*load;
      let dx=cx-ix*.72,dy=cy-iy*.72,dz=cz-iz*.72;
      let inverse=1/(Math.hypot(dx,dy,dz)||1);
      dx=dx*inverse+.42*cx;dy=dy*inverse+.42*cy;dz=dz*inverse+.42*cz;
      inverse=1/(Math.hypot(dx,dy,dz)||1);
      impulses[k]=dx*inverse;impulses[k+1]=dy*inverse;impulses[k+2]=dz*inverse;
    }
    return strike={time,x,y,yaw,pitch,ix,iy,iz,lastRelease};
  }

  function update(lens,frame={}) {
    const age=Number.isFinite(frame.breakAge)?Math.max(0,frame.breakAge):0;
    const time=(frame.time||0)-age;
    const yaw=.53+.25*time+(frame.yaw||0)*.75;
    const pitch=-.27+.16*Math.sin(time*.31)+(frame.pitch||0)*.52;
    const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
    const hasStrike=Number.isFinite(frame.breakAge);
    if(!hasStrike&&strike){strike=null;result.releaseAges.fill(0);}
    const hit=hasStrike?prepareStrike(time,frame):null;
    const impactSide=hit?sy*hit.ix+cy*hit.iz:0;
    const screenImpactX=hit?cy*hit.ix-sy*hit.iz:0;
    const screenImpactY=hit?cp*hit.iy-sp*impactSide:0;
    const screenImpactZ=hit?sp*hit.iy+cp*impactSide:0;
    const loadNow=hit&&age<hit.lastRelease?loading(age):0;
    const lightWave=hit&&age<hit.lastRelease+.07;
    for (let i=0;i<points.length;i++) {
      const [x,y,z]=points[i], k=3*i;
      const side=sy*x+cy*z;
      rotated[k]=cy*x-sy*z;
      rotated[k+1]=cp*y-sp*side;
      rotated[k+2]=sp*y+cp*side;
    }
    Object.assign(result,orbStages(age));
    // Pointer/focus intent changes only the reflected light. Once the real
    // joins open, the same attached edges quietly lose their identifying glint.
    const intent=Number.isFinite(frame.orbIntent)?clamp(frame.orbIntent):0;
    result.seamStrength=(.13+.41*intent)*(1-smooth(.02,.42,age));
    const R=result.radius=orbRadius(lens);
    const dc=Math.cos(lens.angle),ds=Math.sin(lens.angle),incl=lens.inclination;
    const tilt=Math.sqrt(Math.max(0,1-incl*incl));
    for (let i=0;i<count;i++) {
      const f=facets[i], [a,b,c]=f.indices;
      const erosion=result.erosion[i]=smooth(erosionStartAge,result.erosionEnds[i],age);
      const k=3*i;
      const release=hit?result.releaseAges[i]:Infinity;
      const elapsed=Math.max(0,age-release);
      result.separation[i]=hit?smooth(release,release+.10,age):0;
      result.crackLight[i]=lightWave?smooth(0,.018,age)*Math.exp(-(((age-release+.016)/.017)**2))*branchLights[i]:0;
      // The local indentation is shared until a pane releases. A short elastic
      // recoil then restores its original rigid offsets before the first grind,
      // preserving the original settled-area ordering of erosion lifetimes.
      const centerLoad=hit?(elapsed>0?releaseLoads[i]:loadNow):0;
      const shapeLoad=elapsed>0?centerLoad*(1-smooth(0,.16,elapsed)):centerLoad;
      const weight=hit?meanWeights[i]:0;
      const baseX=(rotated[3*a]+rotated[3*b]+rotated[3*c])/3;
      const baseY=(rotated[3*a+1]+rotated[3*b+1]+rotated[3*c+1])/3;
      const baseZ=(rotated[3*a+2]+rotated[3*b+2]+rotated[3*c+2])/3;
      const bx=baseX+screenImpactX*centerLoad*weight;
      const by=baseY+screenImpactY*centerLoad*weight;
      const bz=baseZ+screenImpactZ*centerLoad*weight;
      let X=R*bx,Y=R*by,Z=R*bz,scale=1;
      let m00=1,m01=0,m02=0,m10=0,m11=1,m12=0,m20=0,m21=0,m22=1;
      if (elapsed>0) {
        // A sharp mass-dependent impulse opens a gap before gravity captures
        // the shards. Polar transport stays differentiable: the initial
        // transverse kick decays while the orbital angular speed takes over.
        const U=X*dc+Y*ds, cross=X*ds-Y*dc;
        const V=cross*incl-Z*tilt, H=cross*tilt+Z*incl;
        const impulseSide=sy*impulses[k]+cy*impulses[k+2];
        const dx=cy*impulses[k]-sy*impulses[k+2];
        const dy=cp*impulses[k+1]-sp*impulseSide,dz=sp*impulses[k+1]+cp*impulseSide;
        const impulseU=dx*dc+dy*ds,impulseCross=dx*ds-dy*dc;
        const impulseV=impulseCross*incl-dz*tilt,impulseH=impulseCross*tilt+dz*incl;
        const launchTime=.24+.11/f.massResponse+.012*(f.kickBias-.8);
        const capture=smooth(.34,2.10+.28*f.frost,elapsed);
        const grind=smooth(.35,1.72+.68*f.frost,elapsed);
        const drift=elapsed-.27*(1-Math.exp(-elapsed/.27));
        const initialR=Math.hypot(U,V);
        const angularKick=Math.max(-2.8,Math.min(2.8,(U*impulseV-V*impulseU)*R*(2.2+f.massResponse)/Math.max(R*R*.10,initialR*initialR)));
        const phi=Math.atan2(V,U)+f.speed*drift+angularKick*.21*(1-Math.exp(-elapsed/.21));
        const orbitalR=f.orbit*lens.radius*(1+f.eccentricity*Math.cos(phi-f.phase));
        const peakR=orbitalR+lens.radius*(.60+.60*f.massResponse);
        const expansion=initialR+(peakR-initialR)*(1-Math.exp(-elapsed/launchTime));
        const r=mix(expansion,orbitalR,capture);
        const kick=elapsed*Math.exp(-3.4*elapsed);
        const vertical=H*(1-capture)+R*impulseH*(3.2+1.5*f.massResponse)*kick*(1-capture) +
          capture*lens.radius*.051*Math.sin(f.phase+1.36*phi);
        const orbitX=r*Math.cos(phi),orbitY=r*Math.sin(phi);
        X=orbitX*dc+(orbitY*incl+vertical*tilt)*ds;
        Y=orbitX*ds-(orbitY*incl+vertical*tilt)*dc;
        Z=-orbitY*tilt+vertical*incl;
        scale=mix(1,f.size,grind)*(1-erosion);
        // Rodrigues rotation preserves each piece's three edge proportions.
        const angle=f.spin*(.55+.65*f.massResponse)*(.70*(1-Math.exp(-elapsed/.14))+.55*elapsed);
        const cs=Math.cos(angle),sn=Math.sin(angle),w=1-cs,[x,y,z]=f.axis;
        m00=cs+x*x*w;m01=x*y*w-z*sn;m02=x*z*w+y*sn;
        m10=y*x*w+z*sn;m11=cs+y*y*w;m12=y*z*w-x*sn;
        m20=z*x*w-y*sn;m21=z*y*w+x*sn;m22=cs+z*z*w;
      }
      result.depth[i]=Z;
      for (let j=0;j<3;j++) {
        const v=3*f.indices[j], o=i*9+j*3;
        const localLoad=shapeLoad*(loadingWeights[f.indices[j]]-weight);
        const px=(rotated[v]-baseX+screenImpactX*localLoad)*R*scale;
        const py=(rotated[v+1]-baseY+screenImpactY*localLoad)*R*scale;
        const pz=(rotated[v+2]-baseZ+screenImpactZ*localLoad)*R*scale;
        result.positions[o]=lens.cx+X+m00*px+m01*py+m02*pz;
        result.positions[o+1]=lens.cy+Y+m10*px+m11*py+m12*pz;
        result.positions[o+2]=Z+m20*px+m21*py+m22*pz;
      }
      let [x,y,z]=f.normal;
      if(shapeLoad) {
        x=x*2*f.area+shapeLoad*normalDeltas[k];
        y=y*2*f.area+shapeLoad*normalDeltas[k+1];
        z=z*2*f.area+shapeLoad*normalDeltas[k+2];
        const inverse=1/(Math.hypot(x,y,z)||1);
        x*=inverse;y*=inverse;z*=inverse;
      }
      const q=sy*x+cy*z;
      const ax=cy*x-sy*z,ay=cp*y-sp*q,az=sp*y+cp*q;
      const nx=m00*ax+m01*ay+m02*az,ny=m10*ax+m11*ay+m12*az,nz=m20*ax+m21*ay+m22*az;
      result.normals[k]=nx;result.normals[k+1]=ny;result.normals[k+2]=nz;
      lightFace(result,i,nx,ny,nz,lens.radius>0?Z/lens.radius:0,result.settled,f.frost);
      // Let the shrinking cross-section carry most of the loss. Only the
      // last fleck becomes translucent before its corners meet at the center.
      result.opacity[i]*=1-smooth(.64,1,erosion);
    }
    return result;
  }
  return result;
}
