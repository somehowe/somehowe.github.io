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
  return {fracture:smooth(0,.65,t), settled:smooth(.88,2.8,t), disk:smooth(.28,2.7,t)};
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
    const lane=random(), grain=random(), bias=random();
    const orbit=1.82+2.36*lane+.19*bias;
    const size=grain<.42 ? .055+.24*random() : grain<.77 ? .32+.18*random() : .60+.25*random();
    // Surface area after the first grind determines how long a pane survives.
    // Express its width in orb radii so erosion looks the same at every zoom.
    const settledWidth=size*Math.sqrt(Math.hypot(...cross));
    const erosionEnd=mix(5.8,dustOnlyAge,clamp(settledWidth/.44));
    return {indices:[a,b,c],normal,orbit,size,erosionEnd,phase:tau*random(),
      axis:normalized([random()-.5,random()-.5,random()-.5]),
      spin:(random()>.5?1:-1)*(.78+2.7*random()),
      launch:.48+.69*random(),eccentricity:.012+.031*random(),
      speed:2.65/Math.pow(.515*orbit,1.5),
      delay:.044+.18*(1-(normal[0]*.31-normal[1]*.29+normal[2]*.9))*.5,
      frost:.17+.78*random()};
  });
  return {points,facets};
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
  const count=facets.length;
  const result={count,positions:new Float32Array(count*9), normals:new Float32Array(count*3),
    colors:new Float32Array(count*3), opacity:new Float32Array(count),depth:new Float32Array(count),
    orbits:Float32Array.from(facets,f=>f.orbit), erosionEnds:Float32Array.from(facets,f=>f.erosionEnd),
    erosion:new Float32Array(count),
    radius:0,fracture:0,settled:0,disk:0,update};

  function update(lens,frame={}) {
    const age=Number.isFinite(frame.breakAge)?Math.max(0,frame.breakAge):0;
    const time=(frame.time||0)-age;
    const yaw=.53+.25*time+(frame.yaw||0)*.75;
    const pitch=-.27+.16*Math.sin(time*.31)+(frame.pitch||0)*.52;
    const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
    for (let i=0;i<points.length;i++) {
      const [x,y,z]=points[i], k=3*i;
      const side=sy*x+cy*z;
      rotated[k]=cy*x-sy*z;
      rotated[k+1]=cp*y-sp*side;
      rotated[k+2]=sp*y+cp*side;
    }
    Object.assign(result,orbStages(age));
    const R=result.radius=orbRadius(lens);
    const dc=Math.cos(lens.angle),ds=Math.sin(lens.angle),incl=lens.inclination;
    const tilt=Math.sqrt(Math.max(0,1-incl*incl));
    for (let i=0;i<count;i++) {
      const f=facets[i], [a,b,c]=f.indices;
      const erosion=result.erosion[i]=smooth(erosionStartAge,result.erosionEnds[i],age);
      const k=3*i;
      const bx=(rotated[3*a]+rotated[3*b]+rotated[3*c])/3;
      const by=(rotated[3*a+1]+rotated[3*b+1]+rotated[3*c+1])/3;
      const bz=(rotated[3*a+2]+rotated[3*b+2]+rotated[3*c+2])/3;
      let X=R*bx,Y=R*by,Z=R*bz,scale=1;
      let m00=1,m01=0,m02=0,m10=0,m11=1,m12=0,m20=0,m21=0,m22=1;
      const elapsed=Math.max(0,age-f.delay);
      if (elapsed>0) {
        // Resolve the original centroid into disk coordinates. C starts on
        // the sphere's surface, then picks up angular momentum as it opens.
        const U=X*dc+Y*ds, cross=X*ds-Y*dc;
        const V=cross*incl-Z*tilt, H=cross*tilt+Z*incl;
        const capture=smooth(0,1.50+.50*f.frost,elapsed);
        const grind=smooth(.35,1.72+.68*f.frost,elapsed);
        const drift=elapsed-.43*(1-Math.exp(-elapsed/.43));
        const phi=Math.atan2(V,U)+f.speed*drift;
        const orbitalR=f.orbit*lens.radius*(1+f.eccentricity*Math.cos(phi-f.phase));
        let r=mix(Math.hypot(U,V),orbitalR,capture);
        const kick=elapsed*Math.exp(-2.4*elapsed);
        r+=R*f.launch*kick;
        const vertical=H*(1-capture)+H*f.launch*2.4*kick +
          capture*lens.radius*.051*Math.sin(f.phase+1.36*phi);
        const orbitX=r*Math.cos(phi),orbitY=r*Math.sin(phi);
        X=orbitX*dc+(orbitY*incl+vertical*tilt)*ds;
        Y=orbitX*ds-(orbitY*incl+vertical*tilt)*dc;
        Z=-orbitY*tilt+vertical*incl;
        scale=mix(1,f.size,grind)*(1-erosion);
        // Rodrigues rotation preserves each piece's three edge proportions.
        const angle=f.spin*(.73*elapsed+.83*(1-Math.exp(-elapsed)));
        const cs=Math.cos(angle),sn=Math.sin(angle),w=1-cs,[x,y,z]=f.axis;
        m00=cs+x*x*w;m01=x*y*w-z*sn;m02=x*z*w+y*sn;
        m10=y*x*w+z*sn;m11=cs+y*y*w;m12=y*z*w-x*sn;
        m20=z*x*w-y*sn;m21=z*y*w+x*sn;m22=cs+z*z*w;
      }
      result.depth[i]=Z;
      for (let j=0;j<3;j++) {
        const v=3*f.indices[j], o=i*9+j*3;
        const px=(rotated[v]-bx)*R*scale, py=(rotated[v+1]-by)*R*scale, pz=(rotated[v+2]-bz)*R*scale;
        result.positions[o]=lens.cx+X+m00*px+m01*py+m02*pz;
        result.positions[o+1]=lens.cy+Y+m10*px+m11*py+m12*pz;
        result.positions[o+2]=Z+m20*px+m21*py+m22*pz;
      }
      const [x,y,z]=f.normal, q=sy*x+cy*z;
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
