import { createOrb, dustOnlyAge, erosionStartAge } from './orb.js';

const vertexShader=/* glsl */ `
  uniform vec2 viewport,lensCenter;
  uniform float orbRadius;
  attribute vec3 glassNormal,glassTint,barycentric,fractureJoin;
  attribute vec4 optical;
  varying vec3 faceNormal,spherePoint,facetTint,bary,joinedEdges;
  varying float faceKind,visibility,depth,crackLight,separation;
  void main() {
    faceNormal=glassNormal*vec3(1.,-1.,1.);
    spherePoint=vec3((position.xy-lensCenter)*vec2(1.,-1.),position.z)/orbRadius;
    facetTint=glassTint;
    bary=barycentric;
    joinedEdges=fractureJoin;
    faceKind=optical.x;
    visibility=optical.y;
    crackLight=optical.z;
    separation=optical.w;
    depth=position.z;
    gl_Position=vec4((position.xy/viewport-.5)*vec2(2.,-2.),0.,1.);
  }`;

const fragmentShader=/* glsl */ `
  uniform float orbRadius,orbSettled,orbSeamStrength,depthPass,dpr;
  varying vec3 faceNormal,spherePoint,facetTint,bary,joinedEdges;
  varying float faceKind,visibility,depth,crackLight,separation;

  // A narrow white source, a cool wash overhead and the warm equatorial gas
  // form an environment around the crystal. Sample it on reflected AND
  // refracted paths, so neighboring cut faces show different parts of it.
  vec3 environment(vec3 direction) {
    vec3 ray=normalize(direction);
    float horizon=ray.y+.30*ray.x+.12;
    float rim=exp(-abs(horizon)*16.)*(.20+.80*smoothstep(-.38,.78,ray.x));
    float bank=.5+.5*ray.y;
    vec3 color=mix(vec3(.009,.014,.031),vec3(.050,.115,.178),bank*bank);
    color+=vec3(1.,.43,.145)*rim*.74;
    vec3 key=normalize(vec3(-.52,.67,.51));
    vec3 along=normalize(vec3(.83,.55,.13));
    vec3 across=normalize(cross(key,along));
    vec2 strip=vec2(dot(ray,along)*1.75,dot(ray,across)*12.);
    float side=smoothstep(.42,.80,dot(ray,key));
    float reflection=exp(-dot(strip,strip))*side;
    float border=exp(-pow((abs(strip.y)-.67)*4.5,2.)-3.*strip.x*strip.x)*side;
    color+=vec3(.70,.90,1.)*(4.4*reflection+.85*border);
    vec3 amber=normalize(vec3(.68,-.39,.64));
    float gold=pow(max(dot(ray,amber),0.),25.);
    color+=vec3(1.,.66,.29)*gold*2.3;
    return color;
  }

  void main() {
    float nearWeight=smoothstep(-.065,.065,depth/orbRadius);
    float depthWeight=depthPass>0.?nearWeight:1.-nearWeight;
    if(visibility*depthWeight<.004 || faceNormal.z<=0.) discard;
    vec3 facet=normalize(faceNormal);
    vec3 radial=normalize(spherePoint);
    bool wall=faceKind>.5;
    bool inside=faceKind<-.5;
    float rounding=(!wall && !inside) ? .23*(1.-separation) : 0.;
    vec3 normal=normalize(mix(facet,radial,rounding));
    vec3 eyeRay=vec3(0.,0.,-1.);
    float incidence=max(.015,normal.z);
    float fresnel=.048+.952*pow(1.-incidence,4.2);
    vec3 reflected=environment(reflect(eyeRay,normal));
    vec3 bent=refract(eyeRay,normal,1./1.52);

    // The exit interface is curved on the intact shell and planar on the
    // separated wafers. Reflections from behind the sphere remain continuous
    // across a cut, while each cut has its own refraction and grazing glints.
    vec3 entry=vec3(radial.xy,abs(radial.z));
    vec3 exitNormal=normalize(entry-2.*dot(entry,bent)*bent);
    vec3 exitRay=refract(bent,-exitNormal,1.52);
    if(dot(exitRay,exitRay)<.01) exitRay=reflect(bent,exitNormal);
    vec3 interior=environment(mix(exitRay,bent,separation));
    vec3 internalReflection=environment(reflect(bent,exitNormal));
    float caustic=exp(-abs(dot(exitRay,normalize(vec3(.25,.91,.21)))+.17)*19.);
    float opticalDepth=(.32+.68*incidence)*(1.-.69*separation);
    vec3 absorption=exp(-opticalDepth*vec3(1.05,.42,.19));
    vec3 glass=interior*absorption*.55+internalReflection*vec3(.14,.21,.26);
    glass+=vec3(.018,.055,.083)+vec3(.040,.11,.14)*caustic*(1.-separation);
    glass=mix(glass,reflected,fresnel)+reflected*(wall?.24:.10);

    if(!wall && !inside && separation<.995) {
      // The long reflection of the upper softbox crosses the polished dome.
      // Its edges kink slightly on each neighboring cut and separate as the
      // panels lift. The amber band is transmitted from the seed behind it.
      vec2 uv=radial.xy;
      vec2 cut=facet.xy-uv;
      float band=uv.y-.52+.36*uv.x+.32*(uv.x+.13)*(uv.x+.13)+.20*cut.y+.05*cut.x;
      float lengthwise=smoothstep(-.96,-.59,uv.x)*(1.-smoothstep(-.02,.53,uv.x));
      float broad=exp(-band*band/.034)*lengthwise;
      float hot=exp(-band*band/.0025)*lengthwise;
      float twin=exp(-pow((band-.102)/.029,2.))*lengthwise;
      vec2 limb=normalize(uv+.00001);
      float skim=smoothstep(.77,.985,length(uv));
      float upper=pow(max(dot(limb,vec2(-.56,.83)),0.),3.);
      float lower=pow(max(dot(limb,vec2(.88,-.47)),0.),6.);
      float minor=uv.x-.60-.23*uv.y+.18*uv.y*uv.y+.20*cut.x;
      float slash=exp(-minor*minor/.0016)*exp(-pow((uv.y+.16)/.41,2.));
      float amberY=uv.y+.22-.27*uv.x+.16*uv.x*uv.x+.24*cut.x;
      float transmitted=exp(-amberY*amberY/.028)*exp(-pow((uv.x+.04)/.72,2.));
      vec3 polish=vec3(.025,.078,.125)*(1.+skim)+
                  vec3(.19,.43,.67)*broad+vec3(.90,1.08,1.19)*hot*2.35+
                  vec3(.35,.63,.83)*twin+vec3(.68,.91,1.)*(skim*(1.35*upper+.75*lower)+slash*.91)+
                  vec3(.77,.34,.09)*transmitted;
      glass+=(1.-separation)*polish;
    }

    // Exposed broken edges catch the hotter gas as their orbital plane fills.
    float hotSide=max(0.,dot(normal,normalize(vec3(.61,-.65,.46))));
    glass+=separation*(vec3(.025,.074,.10)+vec3(.70,.33,.14)*hotSide*hotSide*.56);
    glass*=mix(vec3(.84,.90,.96),.64+.54*facetTint,.42);
    vec3 distanceToEdge=bary/max(fwidth(bary),vec3(.0001));
    float nearestEdge=min(distanceToEdge.x,min(distanceToEdge.y,distanceToEdge.z))/dpr;
    float edge=1.-smoothstep(.08,.72,nearestEdge);
    float warmSide=smoothstep(-.16,.75,normal.x-.5*normal.y);
    vec3 bevel=mix(vec3(.52,.81,1.),vec3(1.,.73,.42),warmSide);
    glass+=bevel*edge*(.030+.12*fresnel+.33*separation);
    // A fresh cut briefly reflects the long white light. The dark shoulder
    // beside its fine bright lip keeps it readable over a polished highlight.
    if(crackLight>.001) {
      vec3 cutLight=mix(vec3(.76,.92,1.),vec3(1.,.90,.72),.38*warmSide);
      if(wall) {
        glass+=cutLight*crackLight*(.22+.30*fresnel);
      } else if(!inside) {
        float lip=1.-smoothstep(.16,.95,nearestEdge);
        float shoulder=smoothstep(.30,.95,nearestEdge)*(1.-smoothstep(.95,1.75,nearestEdge));
        glass*=1.-.38*crackLight*shoulder;
        glass+=cutLight*crackLight*lip*(1.45+.55*fresnel);
      }
    }
    // This mask belongs to just a few shared outer-face edges. Drawing it in
    // the glass material retains the same depth pass, facing and occlusion as
    // the surface itself; no hovering line or always-visible sprite is added.
    vec3 fault=(1.-smoothstep(vec3(.06*dpr),vec3(.51*dpr),distanceToEdge))*joinedEdges;
    float joined=max(fault.x,max(fault.y,fault.z))*smoothstep(.025,.25,facet.z);
    glass+=vec3(.55,.77,.91)*joined*orbSeamStrength;
    vec3 exposed=1.-exp(-glass*(1.52+.43*orbSettled));
    float alpha=mix(.78+.16*fresnel,.83+.10*fresnel,separation);
    if(inside) alpha*=mix(.43,.95,separation);
    float coverage=visibility*alpha;
    if(!wall && !inside) coverage=mix(coverage,1.,(1.-separation)*.85*smoothstep(.57,.985,exposed.b));
    gl_FragColor=vec4(exposed,coverage*depthWeight);
  }`;

function glassDust(THREE,uniforms,count) {
  // These times are the flight ages of grains, in seconds. Each one starts at
  // a real edge in a prior pose of its own pane. A short Kepler integration
  // then separates the fine material from that edge and lets it settle.
  const flights=[.055,.16,.33,.59,.96];
  const grainCount=2*count*flights.length;
  const history=createOrb();
  const geometry=new THREE.BufferGeometry();
  const positions=new THREE.BufferAttribute(new Float32Array(grainCount*3),3).setUsage(THREE.DynamicDrawUsage);
  const lights=new THREE.BufferAttribute(new Float32Array(grainCount*3),3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',positions);
  geometry.setAttribute('grain',lights);
  const seeds=new Float32Array(grainCount);
  let seed=31710866;
  for(let i=0;i<grainCount;i++) {
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    seeds[i]=seed/4294967296;
  }
  const grainVertex=/* glsl */ `
    uniform vec2 viewport;
    uniform float dpr,depthPass,orbRadius;
    attribute vec3 grain;
    varying float energy,diameter,extent;
    varying vec3 tint;
    void main() {
      float nearWeight=smoothstep(-.065,.065,position.z/orbRadius);
      energy=grain.x*(depthPass>0.?nearWeight:1.-nearWeight);
      diameter=grain.y;
      extent=max(5.,diameter*5.8);
      tint=mix(vec3(.61,.83,1.),vec3(1.,.64,.31),grain.z);
      gl_PointSize=extent*dpr;
      gl_Position=vec4((position.xy/viewport-.5)*vec2(2.,-2.),0.,1.);
      if(energy<.01) gl_Position.x=3.;
    }`;
  const grainFragment=/* glsl */ `
    varying float energy,diameter,extent;
    varying vec3 tint;
    void main() {
      float r=length(gl_PointCoord-.5)*extent;
      float core=exp2(-4.*r*r/max(.02,diameter*diameter));
      float scatter=.17*exp(-r/(.32+.48*diameter));
      vec3 flux=(mix(tint,vec3(1.),core*.52)*core+tint*scatter)*energy;
      float a=max(flux.r,max(flux.g,flux.b))*(1.-smoothstep(.38,.5,r/extent));
      gl_FragColor=vec4(flux/max(.001,a),min(1.,a));
    }`;
  function pass(side,name) {
    const material=new THREE.ShaderMaterial({
      uniforms:{...uniforms,depthPass:{value:side}},vertexShader:grainVertex,fragmentShader:grainFragment,
      transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,toneMapped:false
    });
    const points=new THREE.Points(geometry,material);
    points.name=name;
    return points;
  }
  const back=pass(-1,'Glass dust behind the disk'),front=pass(1,'Glass dust in front of the disk');
  const emissionFrame={};
  const radii=new Float32Array(count), angles=new Float32Array(count), heights=new Float32Array(count);
  const displacementTime=new Float64Array(count);
  const parentSpeed=new Float64Array(count),grainSpeedDelta=new Float64Array(grainCount);
  const radialSpread=new Float32Array(grainCount);
  let haveSpeeds=false;
  function update(lens,frame,orb) {
    const age=frame.breakAge;
    // Grains are stored in launch-time order. An unlit lane needs neither
    // vertices nor a second evaluation of its parent shell's earlier pose.
    let activeLanes=0;
    while(activeLanes<flights.length && age>flights[activeLanes]+.10)activeLanes++;
    geometry.setDrawRange(0,activeLanes*2*count);
    front.visible=back.visible=Number.isFinite(age)&&activeLanes>0;
    if(!front.visible) return;
    const dc=Math.cos(lens.angle),ds=Math.sin(lens.angle),incl=lens.inclination;
    const tilt=Math.sqrt(1.-incl*incl),unit=Math.max(.98,Math.min(2.1,lens.radius*.024));
    if(!haveSpeeds) {
      for(let id=0;id<count;id++) parentSpeed[id]=2.65/Math.pow(.515*orb.orbits[id],1.5);
      for(let i=0;i<grainCount;i++) {
        const lane=Math.floor(i/(2*count));
        const spread=(seeds[i]-.57)*(.095+.19*flights[lane]);
        radialSpread[i]=spread;
        // Keplerian speed depends on the guiding radius. An eccentric orbit's
        // instantaneous radius must never multiply unbounded elapsed time.
        grainSpeedDelta[i]=parentSpeed[i%count]*(Math.pow(1.+spread,-1.5)-1.);
      }
      haveSpeeds=true;
    }
    for(let id=0;id<count;id++) {
      const v=orb.positions,k=id*9;
      const x=(v[k]+v[k+3]+v[k+6])/3-lens.cx, y=(v[k+1]+v[k+4]+v[k+7])/3-lens.cy;
      const z=orb.depth[id],cross=x*ds-y*dc,u=x*dc+y*ds,vDisk=cross*incl-z*tilt;
      radii[id]=Math.hypot(u,vDisk);
      angles[id]=Math.atan2(vDisk,u);
      heights[id]=cross*tilt+z*incl;
      // Integrating smoothstep gives a continuous transfer of angular velocity
      // from the pane to each orbit. After dissolution this increases linearly.
      const end=orb.erosionEnds[id],duration=end-erosionStartAge;
      const t=Math.max(0,Math.min(1,(age-erosionStartAge)/duration));
      displacementTime[id]=duration*t*t*t*(1.-.5*t)+Math.max(0,age-end);
    }
    Object.assign(emissionFrame,frame);
    const detached=age>=dustOnlyAge;
    for(let lane=0;lane<activeLanes;lane++) {
      const flight=flights[lane],elapsed=Math.max(0,age-flight);
      const onset=THREE.MathUtils.smoothstep(elapsed,.10,.57);
      // Only still-eroding panes need an earlier surface pose for emission.
      // The entire mature disk is driven by the single current guiding field.
      if(!detached) {
        emissionFrame.time=(frame.time||0)-(age-elapsed);
        emissionFrame.breakAge=elapsed;
        history.update(lens,emissionFrame);
      }
      for(let branch=0;branch<2;branch++) for(let id=0;id<count;id++) {
        const i=(2*lane+branch)*count+id,s=seeds[i],e=orb.erosion[id];
        const angle=angles[id],guide=radii[id],omega=parentSpeed[id];
        const tail=-omega*flight*(.20+.28*s)+radialSpread[i]*(.7+.8*flight);
        let sweep=tail,radius=guide*(1.+radialSpread[i]);
        let height=heights[id]*.48+(s-.5)*lens.radius*(.012+.083*flight);
        if(e<1. && !detached) {
          const tri=id*9,v=history.positions,edge=(id+lane)%3;
          const a=tri+3*edge,b=tri+3*((edge+1)%3);
          const edgeMix=branch===0?.38+.24*s:.12+.75*s;
          const x=v[a]+(v[b]-v[a])*edgeMix-lens.cx;
          const y=v[a+1]+(v[b+1]-v[a+1])*edgeMix-lens.cy;
          const z=v[a+2]+(v[b+2]-v[a+2])*edgeMix;
          const cross=x*ds-y*dc,u=x*dc+y*ds,vDisk=cross*incl-z*tilt;
          const releasePhi=Math.atan2(vDisk,u)+omega*flight*(.59+.27*s)*(.28+.72*history.settled);
          const releaseR=Math.hypot(u,vDisk)*(1.+flight*radialSpread[i]*.45);
          const releaseH=(cross*tilt+z*incl)*Math.exp(-flight*(1.24+.75*s));
          // Interpolate relative angles, so the trail stays continuous when
          // the parent crosses the polar coordinate seam.
          const nearAngle=Math.atan2(Math.sin(releasePhi-angle),Math.cos(releasePhi-angle));
          sweep=nearAngle+(tail-nearAngle)*e;
          radius=releaseR+(radius-releaseR)*e;
          height=releaseH+(height-releaseH)*e;
        }
        const phi=angle+sweep+grainSpeedDelta[i]*displacementTime[id];
        const ux=radius*Math.cos(phi),vy=radius*Math.sin(phi);
        const projected=vy*incl+height*tilt;
        positions.setXYZ(i,lens.cx+ux*dc+projected*ds,lens.cy+ux*ds-projected*dc,-vy*tilt+height*incl);
        const sparkle=.76+.24*Math.sin(phi*3.6+s*65.)**2;
        const cast=(.35+.65*s)*(branch===0?1.:.32);
        const wearing=4.*e*(1.-e);
        const shed=wearing*(branch===0?.65:.43)*(1.-.35*flight);
        const mature=s>.93?(.29+.18*s):(.026+.116*s*s);
        const emission=onset*sparkle*(cast*(1.-e)+shed+mature*e);
        lights.setXYZ(i,emission,unit*(.52+.66*s+.22*(lane===0))*(1.-.17*e),
          Math.min(.97,.13+.37*s+.33*orb.settled+.14*e));
      }
    }
    positions.needsUpdate=true;
    lights.needsUpdate=true;
  }
  function dispose() { geometry.dispose();back.material.dispose();front.material.dispose(); }
  return {back,front,update,dispose};
}

// A shallow triangular prism provides an outer pane, three physical fracture
// faces, and an inner pane. The same corners remain attached to each facet ID.
const panels=[
  {corners:[5,4,3],surface:-1},
  {corners:[0,3,4,0,4,1],surface:1,edge:0},
  {corners:[1,4,5,1,5,2],surface:1,edge:1},
  {corners:[2,5,3,2,3,0],surface:1,edge:2},
  {corners:[0,1,2],surface:0}
];
const verticesPerFacet=24;

export function createGlassOrb(THREE,uniforms) {
  const orb=createOrb();
  const vertexCount=orb.count*verticesPerFacet;
  const geometry=new THREE.BufferGeometry();
  function dynamic(name,size) {
    const attribute=new THREE.BufferAttribute(new Float32Array(vertexCount*size),size);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name,attribute);
    return attribute;
  }
  const position=dynamic('position',3), normal=dynamic('glassNormal',3);
  const tint=dynamic('glassTint',3), optical=dynamic('optical',4);
  const bary=new Float32Array(vertexCount*3);
  for(let i=0;i<vertexCount;i++) bary[3*i+i%3]=1;
  geometry.setAttribute('barycentric',new THREE.BufferAttribute(bary,3));
  const seam=new Float32Array(vertexCount*3);
  for(let face=0;face<orb.count;face++)for(let corner=0;corner<3;corner++) {
    const at=(face*verticesPerFacet+verticesPerFacet-3+corner)*3;
    // Barycentric channel i measures distance from the edge opposite corner i.
    seam[at]=orb.seamEdges[face*3+1];
    seam[at+1]=orb.seamEdges[face*3+2];
    seam[at+2]=orb.seamEdges[face*3];
  }
  geometry.setAttribute('fractureJoin',new THREE.BufferAttribute(seam,3));
  const seamStrength={value:0};
  const index=new THREE.BufferAttribute(new Uint16Array(vertexCount),1).setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(index);
  const sorted=Array.from({length:orb.count},(_,i)=>i);
  const corners=new Float32Array(18);
  const edges=new Float32Array(9);

  function pass(sign,name) {
    const material=new THREE.ShaderMaterial({
      uniforms:{...uniforms,orbSeamStrength:seamStrength,depthPass:{value:sign}},vertexShader,fragmentShader,
      transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide,toneMapped:false
    });
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;
    return mesh;
  }
  const dust=glassDust(THREE,uniforms,orb.count);
  const back=pass(-1,'Crystal behind the accretion disk');
  const front=pass(1,'Crystal in front of the accretion disk');

  function update(lens,frame) {
    orb.update(lens,frame);
    seamStrength.value=orb.seamStrength;
    uniforms.orbRadius.value=orb.radius;
    uniforms.orbSettled.value=orb.settled;
    uniforms.diskBuild.value=orb.disk;
    dust.update(lens,frame,orb);
    if(Number.isFinite(frame.breakAge)&&frame.breakAge>=dustOnlyAge) {
      front.visible=back.visible=false;
      geometry.setDrawRange(0,0);
      return;
    }
    sorted.sort((a,b)=>orb.depth[a]-orb.depth[b]);
    let written=0;
    for(const id of sorted) {
      const separation=orb.separation[id];
      const opacity=orb.opacity[id]+(1.-separation)*(.87-orb.opacity[id]);
      if(orb.erosion[id]>=1. || opacity<=0.) continue;
      const n=id*3,base=id*9;
      const nx=orb.normals[n],ny=orb.normals[n+1],nz=orb.normals[n+2];
      const crackLight=orb.crackLight[id];
      let reach=Infinity;
      for(let c=0;c<9;c++) corners[c]=orb.positions[base+c];
      // A side normal is perpendicular to its edge and points away from the
      // opposite corner. This is independent of the triangle's winding.
      for(let e=0;e<3;e++) {
        const a=e*3,b=((e+1)%3)*3,c=((e+2)%3)*3;
        const ex=corners[b]-corners[a],ey=corners[b+1]-corners[a+1],ez=corners[b+2]-corners[a+2];
        const len=Math.max(.0001,ex*ex+ey*ey+ez*ez);
        reach=Math.min(reach,Math.sqrt(len));
        const vx=corners[a]-corners[c],vy=corners[a+1]-corners[c+1],vz=corners[a+2]-corners[c+2];
        const proj=(vx*ex+vy*ey+vz*ez)/len;
        const sx=vx-proj*ex,sy=vy-proj*ey,sz=vz-proj*ez;
        const inv=1./Math.max(.00001,Math.hypot(sx,sy,sz));
        edges[a]=sx*inv;edges[a+1]=sy*inv;edges[a+2]=sz*inv;
      }
      const thickness=Math.min(.048*orb.radius,.12*reach);
      for(let c=0;c<9;c+=3) {
        corners[9+c]=corners[c]-nx*thickness;
        corners[10+c]=corners[c+1]-ny*thickness;
        corners[11+c]=corners[c+2]-nz*thickness;
      }
      let v=id*verticesPerFacet;
      for(const panel of panels) {
        const edge=panel.edge*3;
        const direction=panel.surface<0?-1:1;
        const x=panel.surface===1?edges[edge]:nx*direction;
        const y=panel.surface===1?edges[edge+1]:ny*direction;
        const z=panel.surface===1?edges[edge+2]:nz*direction;
        for(const corner of panel.corners) {
          const p=corner*3;
          position.setXYZ(v,corners[p],corners[p+1],corners[p+2]);
          normal.setXYZ(v,x,y,z);
          tint.setXYZ(v,orb.colors[n],orb.colors[n+1],orb.colors[n+2]);
          optical.setXYZW(v,panel.surface,opacity,crackLight,separation);
          index.array[written++]=v++;
        }
      }
    }
    front.visible=back.visible=written>0;
    geometry.setDrawRange(0,written);
    position.needsUpdate=normal.needsUpdate=tint.needsUpdate=optical.needsUpdate=index.needsUpdate=true;
  }
  function dispose() {
    dust.dispose();geometry.dispose();back.material.dispose();front.material.dispose();
  }
  return {back,front,dust,update,dispose};
}
