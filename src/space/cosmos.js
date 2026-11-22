import { createStarStream } from './star-stream.js';
import { sampleLens } from './lens.js';
import { createGlassOrb } from './orb-gl.js';

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function starCatalogue() {
  const random = seededRandom(194650);
  const clusters = [[.13,.74],[.79,.86],[.9,.32],[.32,.24],[.63,.65],[.03,.4],[.58,.17]];
  const stars = [];
  for (let i = 0; i < 420; i++) {
    const clustered = i % 6 === 0;
    const cluster = clusters[i % clusters.length];
    const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(.001, random()))) * Math.cos(random()*Math.PI*2);
    const x = clustered ? cluster[0] + gaussian() * .032 : random();
    const y = clustered ? cluster[1] + gaussian() * .051 : random();
    const depth = i % 10 < 5 ? 0 : i % 10 < 8 ? .43 : 1;
    const size = .90 + Math.pow(random(), 2.8) * 2.8 + depth * .59;
    stars.push({ x,y,depth,size,temperature:random(),phase:random(),hero:0 });
  }
  // Distinct amber, periwinkle, pale violet and icy blue beacons give the eye
  // individual points to follow. Only the largest carry long diffraction rays.
  const bright = [
    [.065,.80,1,.17], [.138,.445,.52,.74], [.212,.905,.79,.22], [.17,.15,.62,.12],
    [.31,.72,.47,.65], [.385,.25,.57,.18], [.465,.87,.78,.48], [.54,.105,.53,.34],
    [.64,.79,.63,.08], [.71,.20,.79,.91], [.818,.64,.72,.32], [.923,.395,1,.25],
    [.89,.88,.54,.76], [.965,.71,.47,.53], [.78,.46,.42,.19], [.277,.50,.45,.31],
    [.565,.595,.32,.71]
  ];
  for (const [x,y,hero,temperature] of bright) {
    stars.push({x,y,depth:.43,size:2.4+1.85*hero,temperature,phase:random(),hero});
  }
  // Loose associations share depth and proper motion. Their halos stay small
  // beside the original bright guide stars and the distant galactic light.
  const associations=[
    [.065,.57,.031,.046,-.36,.20], [.18,.88,.045,.026,.55,.42],
    [.40,.80,.032,.038,-.23,.25], [.73,.90,.044,.027,.48,.57],
    [.87,.70,.038,.046,.58,.35], [.95,.27,.032,.060,-.33,.61],
    [.76,.105,.062,.029,-.51,.29], [.19,.15,.057,.029,.47,.15]
  ];
  for(let i=0;i<366;i++) {
    let x=random(),y=random();
    let depth=.07+.86*random()**1.35;
    let motionSeed;
    if(i%5<2) {
      const group=associations[i%associations.length];
      const distance=Math.sqrt(-2*Math.log(Math.max(.0001,random())));
      const angle=random()*2*Math.PI;
      const dx=distance*Math.cos(angle),dy=distance*Math.sin(angle);
      x=group[0]+group[2]*(dx+group[4]*dy);
      y=group[1]+group[3]*dy;
      depth=group[5];
      // Common transverse velocity keeps the association together across
      // screen wraps. Every member still has its own brightness and phase.
      motionSeed=group[0];
    }
    const size=1.02+.32*depth+1.82*random()**2.20;
    const temperature=random()<.42 ? .10+.19*random() : .54+.30*random();
    stars.push({x,y,depth,size,temperature,phase:random(),motionSeed,hero:0});
  }
  return stars;
}

const skyUniforms = /* glsl */ `
  uniform vec2 viewport;
  uniform vec2 parallax;
  uniform vec2 lensCenter;
  uniform float dpr, aspect, clock, einstein;
  vec2 skyPosition(vec2 base, float layer, float seed) {
    float speed = (4. + 26. * layer) * (1. + .20 * layer * (seed-.5));
    // Speeds are in CSS pixels per second, which also keeps motion legible in
    // portrait. The gentle bend follows one continuous orbit through the frame.
    float wave = (sin(clock * .12 + base.x * 5.) - sin(base.x * 5.));
    vec2 travel = vec2(clock * speed, clock * speed * .18 + wave * (2. + 9. * layer));
    vec2 uv = fract(base + parallax * (.002 + .018 * layer) + travel / viewport);
    return 2. * uv - 1.;
  }
  vec3 stellarColor(float t) {
    if (t < .30) return mix(vec3(.38,.59,1.), vec3(.69,.84,1.), t/.30);
    if (t < .48) return mix(vec3(.72,.56,.95), vec3(.95,.80,1.), (t-.30)/.18);
    if (t < .70) return mix(vec3(.71,.92,.99), vec3(1.,.96,.87), (t-.48)/.22);
    if (t < .88) return mix(vec3(1.,.85,.65), vec3(1.,.59,.39), (t-.70)/.18);
    return mix(vec3(1.,.53,.35), vec3(.98,.43,.50), (t-.88)/.12);
  }
`;

function additiveMaterial(THREE, uniforms, vertexShader, fragmentShader) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, transparent:true, depthWrite:false,
    side:THREE.DoubleSide, blending:THREE.AdditiveBlending, toneMapped:false
  });
}

function attribute(THREE, values, size) {
  return new THREE.Float32BufferAttribute(values,size);
}

function starLayer(THREE, catalogue, uniforms) {
  const geometry = new THREE.BufferGeometry();
  const positions = [], lights = [], branches = [], motionSeeds = [];
  for (const star of catalogue) {
    for(const parity of [1,-1]) {
      positions.push(star.x,star.y,star.depth);
      lights.push(star.size,star.temperature,star.phase,star.hero);
      branches.push(parity);
      motionSeeds.push(star.motionSeed??star.phase);
    }
  }
  geometry.setAttribute('position',attribute(THREE,positions,3));
  geometry.setAttribute('light',attribute(THREE,lights,4));
  geometry.setAttribute('parity',attribute(THREE,branches,1));
  geometry.setAttribute('motionSeed',attribute(THREE,motionSeeds,1));

  const vertex = /* glsl */ `
    ${skyUniforms}
    attribute vec4 light;
    attribute float parity,motionSeed;
    uniform vec4 contactBox;
    varying vec3 tint;
    varying float energy, hero, extent, diameter, twist;
    void main() {
      vec2 original = skyPosition(position.xy,position.z,motionSeed);
      vec2 relative=(original*vec2(.5,-.5)+.5)*viewport-lensCenter;
      float beta=max(.01,length(relative)/einstein);
      float root=sqrt(beta*beta+4.);
      float imageRadius=.5*(beta+parity*root);
      float gain=.5*((beta*beta+2.)/(beta*root)+parity);
      vec2 image=lensCenter+relative*(imageRadius/beta);
      gl_Position=vec4((image/viewport-.5)*vec2(2.,-2.),.9999,1.);
      hero = light.w;
      diameter = light.x;
      extent = mix(4.0*diameter,18.+46.*hero,step(.001,hero));
      gl_PointSize = extent*dpr;
      tint = stellarColor(light.y);
      float twinkle = .89+.11*sin(clock*(.58+light.y*.61)+light.z*18.);
      energy = (.22 + .70*pow(light.x/4.1,1.25) + hero*.49) * twinkle;
      energy *= min(2.8,gain);
      if(parity<0. && (beta>2.2 || gain<.055)) gl_Position.x=3.;
      float edgeDistance=min(min(1.-original.x,1.+original.x)*viewport.x,
                             min(1.-original.y,1.+original.y)*viewport.y)*.5;
      energy*=smoothstep(0.,14.+hero*8.,edgeDistance);
      // The bounds and the lensed image share top-left CSS pixel coordinates.
      // The soft shoulder follows the projected star as it crosses the page.
      vec2 contactDistance=max(abs(image-contactBox.xy)-contactBox.zw,vec2(0.));
      float clear=length(contactDistance)-.29*extent;
      energy*=mix(.029,1.,smoothstep(0.,clamp(viewport.y*.065,26.,62.),clear));
      if(hero<.001 && light.z>clamp(viewport.x*viewport.y/970000.,.42,1.)) energy=0.;
      if(energy<.002) gl_Position.x=3.;
      twist = light.z;
    }`;
  const fragment = /* glsl */ `
    varying vec3 tint;
    varying float energy, hero, extent, diameter, twist;
    void main() {
      vec2 p = (gl_PointCoord-.5)*extent;
      float radius = length(p);
      float core = exp(-radius*radius/(.15 + diameter*diameter*.14));
      float bloom = .24*exp(-radius/(diameter*.78));
      float angle = (twist-.5)*.26 + step(.61,twist)*.64;
      vec2 axis = abs(mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*p);
      float longRay = exp(-axis.y/(.22+.3*hero)) * exp(-axis.x/(2.+6.*hero));
      float shortRay = exp(-axis.x/(.19+.21*hero)) * exp(-axis.y/(1.4+4.4*hero));
      float haze = hero*(.32*exp(-radius/(2.+3.*hero)) + .061*exp(-radius/(4.+7.*hero)));
      float softOrb = .17 * exp(-radius*radius/(diameter*diameter*.8)) * (1.-step(.36,twist));
      float falloff = 1.-smoothstep(.39,.50,radius/extent);
      vec3 radiance = mix(tint,vec3(1.),min(1.,core*1.3))*core + tint*(bloom+haze+softOrb);
      radiance += tint * hero * smoothstep(.2,.65,twist) * (longRay*.85 + shortRay*.59);
      radiance *= energy*falloff;
      float alpha = clamp(max(max(radiance.r,radiance.g),radiance.b),.00001,1.);
      gl_FragColor = vec4(radiance / alpha, alpha);
    }`;
  return new THREE.Points(geometry,additiveMaterial(THREE,uniforms,vertex,fragment));
}

function stellarStreamLayer(THREE,stream,uniforms) {
  const geometry=new THREE.BufferGeometry();
  // The simulation writes directly into this buffer. Only the NDC positions
  // and opacities change as the stream moves through the visitor's pointer.
  const position=new THREE.BufferAttribute(stream.positions,3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',position);
  geometry.setAttribute('appearance',new THREE.BufferAttribute(stream.appearance,4));
  geometry.setDrawRange(0,stream.count);

  const vertex=/* glsl */ `
    uniform float dpr;
    attribute vec4 appearance;
    varying vec3 tint;
    varying float energy, extent, coreRadius, flare, angle;
    void main() {
      float diameter=appearance.x;
      coreRadius=max(diameter*.5,.32/dpr);
      float temperature=clamp(appearance.y,0.,1.);
      vec3 cool=vec3(.62,.78,1.);
      vec3 ivory=vec3(1.,.975,.915);
      vec3 warm=vec3(1.,.695,.51);
      tint=mix(cool,ivory,smoothstep(.03,.52,temperature));
      tint=mix(tint,warm,smoothstep(.55,1.,temperature));
      flare=clamp(appearance.w,0.,1.);
      angle=.12 + step(.5,fract(temperature*23.+diameter*1.7))*.62;
      extent=max(7.,diameter*5.2+flare*27.);
      energy=.92*appearance.z*max(position.z,0.);
      gl_Position=vec4(position.xy,.99991,1.);
      gl_PointSize=extent*dpr;
      if(energy<.0001) gl_Position.x=3.;
    }`;
  const fragment=/* glsl */ `
    varying vec3 tint;
    varying float energy, extent, coreRadius, flare, angle;
    void main() {
      vec2 p=(gl_PointCoord-.5)*extent;
      float r=length(p);
      float cutoff=1.-smoothstep(.36,.50,r/extent);
      float core=exp2(-dot(p,p)/(coreRadius*coreRadius));
      float halo=.19*exp(-r/(.47+.94*coreRadius));
      vec3 beam=mix(tint,vec3(1.),.22+.30*smoothstep(.4,1.6,coreRadius))*core+tint*halo;
      if(flare>.001) {
        vec2 rays=abs(mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*p);
        float longRay=exp(-rays.y/(.18+.15*flare)-rays.x/(2.1+4.2*flare));
        float shortRay=exp(-rays.x/(.16+.13*flare)-rays.y/(1.6+3.2*flare));
        beam+=tint*flare*(.65*longRay+.46*shortRay+.12*exp(-r/(1.8+1.9*flare)));
      }
      beam*=energy*cutoff;
      float alpha=min(1.,max(beam.r,max(beam.g,beam.b)));
      gl_FragColor=vec4(beam/max(.00001,alpha),alpha);
    }`;
  const mesh=new THREE.Points(geometry,additiveMaterial(THREE,uniforms,vertex,fragment));
  mesh.name='Stellar stream';
  return mesh;
}

function meteors(THREE,uniforms) {
  const geometry=new THREE.BufferGeometry();
  const positions=[],uv=[],paths=[];
  for(let i=0;i<4;i++) {
    for(let fragment=0;fragment<3;fragment++) {
      for(const [u,v] of [[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]]) {
        positions.push(0,0,0);
        uv.push(u,v);
        paths.push(i,fragment);
      }
    }
  }
  geometry.setAttribute('position',attribute(THREE,positions,3));
  geometry.setAttribute('uv',attribute(THREE,uv,2));
  geometry.setAttribute('track',attribute(THREE,paths,2));
  const vertex=/* glsl */ `
    ${skyUniforms}
    attribute vec2 track;
    varying vec2 tail;
    varying float brightness, width, span, hue;
    float hash(float x) { return fract(sin(x*19.13+.71)*7148.37); }
    void main() {
      float shape=track.x;
      float f=track.y;
      float cycle=clock/(5.3+shape*.36)+shape*.29+.037;
      float pass=floor(cycle);
      float phase=fract(cycle)*(4.2+shape*.51);
      float event=pass*37.+shape*169.;
      vec2 start=vec2(hash(event+8.)*1.8-.99,hash(event+11.)*1.45-.35);
      vec2 dir=normalize(vec2(.88,-.29-.50*hash(event+31.)));
      if(shape==3.) dir.x=-dir.x;
      vec2 normal=vec2(-dir.y,dir.x);
      span=clamp(viewport.y*(.17+.15*hash(event+9.)),76.,300.)/ (1.+f*1.8);
      width=mix(5.5,2.4,step(.1,f));
      float travelled=smoothstep(0.,1.,min(phase,1.))*(.9+.5*hash(event+22.));
      vec2 head=start+dir*travelled/vec2(aspect,1.);
      vec2 fragments=normal*(f*2.4+phase*f*2.1)-dir*(f*8.+phase*f*5.8);
      float along=mix(-span,5.,uv.x);
      vec2 position2=head+(dir*along+normal*width*uv.y+fragments)*2./viewport;
      gl_Position=vec4(position2,.99993,1.);
      tail=vec2(along,uv.y*width);
      brightness=smoothstep(0.,.07,phase)*(1.-smoothstep(.57,1.,phase))/(1.+1.8*f);
      hue=hash(event+17.);
    }`;
  const fragment=/* glsl */ `
    varying vec2 tail;
    varying float brightness, width, span, hue;
    void main(){
      float tailProgress=clamp(1.+tail.x/span,0.,1.);
      float spine=exp(-abs(tail.y)/(.19+.46*tailProgress))*
        tailProgress*tailProgress*(1.-smoothstep(-.1,.8,tail.x));
      float head=exp(-dot(tail,tail)/2.0);
      float halo=.23*exp(-length(tail*vec2(.7,1.))*.65);
      float train=.09*exp(-abs(tail.y)/1.7)*pow(tailProgress,1.5)*step(tail.x,0.);
      vec3 tint=mix(vec3(.42,.70,1.),vec3(.99,.75,.53),smoothstep(.68,.96,hue));
      vec3 rgb=tint*(spine*.85+train+halo)+vec3(1.,.98,.93)*head;
      float alpha=clamp(max(rgb.r,max(rgb.g,rgb.b)),.00001,1.);
      gl_FragColor=vec4(rgb/alpha,alpha*brightness);
    }`;
  return new THREE.Mesh(geometry,additiveMaterial(THREE,uniforms,vertex,fragment));
}

function blackHole(THREE,uniforms) {
  const material=new THREE.ShaderMaterial({
    uniforms,transparent:true,depthWrite:false,toneMapped:false,
    vertexShader:/* glsl */ `
      uniform vec2 viewport,lensCenter;
      uniform float shadowRadius,diskAngle,diskBuild;
      varying vec2 plane;
      void main() {
        plane=position.xy;
        vec2 local=plane*vec2(1.,-1.)*shadowRadius/.515*mix(.20,1.,diskBuild);
        float c=cos(diskAngle),s=sin(diskAngle);
        vec2 pixel=lensCenter+mat2(c,s,-s,c)*local;
        gl_Position=vec4((pixel/viewport-.5)*vec2(2.,-2.),.01,1.);
      }`,
    fragmentShader:/* glsl */ `
      uniform float clock,inclination,azimuth,diskBuild;
      varying vec2 plane;

      float hash(vec2 p) {
        vec3 h = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
        h += dot(h,h.yzx+33.33);
        return fract((h.x+h.y)*h.z);
      }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p);
        f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
                   mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
      }
      float kepler(float radius) {
        return 2.65/(radius*sqrt(radius));
      }

      // Follow an overdensity and the thin wake it leaves farther out. The
      // peak is a persistent feature in local orbital coordinates. Each cloud
      // keeps its shape as it rounds the far side and emerges in front again.
      float cloud(float r,float phi,float orbit,float phase,float width,float angleWidth) {
        float angle=phi-phase-clock*kepler(orbit);
        float eddy=sin(angle)*.075;
        float radial=(r-orbit-eddy)/width;
        float head=exp(-radial*radial-(1.-cos(angle))*angleWidth);
        float wakeAngle=angle+.47;
        float wakeRadial=(r-orbit-.05+.10*sin(wakeAngle))/(width*.72);
        float wake=exp(-wakeRadial*wakeRadial-(1.-cos(wakeAngle))*(angleWidth*.31));
        return head+.32*wake;
      }

      // Emission is evaluated in the disk's own polar coordinates. Both the
      // direct view and the strongly bent far-side rays sample this same gas.
      vec3 emission(float r,float phi) {
        if(r<.66||r>2.92) return vec3(0.);
        float inner=smoothstep(.66,.85,r);
        float extent=inner*exp(-1.07*max(0.,r-.97))*(1.-smoothstep(2.12,2.92,r));

        // A two-armed spiral density wave rotates through the flow. Unequal
        // contrast and a wandering pitch break the symmetry between its arms.
        float orbitalPhi=phi+azimuth;
        float turn=orbitalPhi-1.45*clock;
        float shear=.67*sin(.92*clock-1.72*log(r));
        float phase=turn+2.06*log(r)+shear+.16*sin(turn-3.1*r);
        float armA=pow(.5+.5*cos(phase),13.);
        float armB=pow(.5-.5*cos(phase+.26),19.);
        float arms=.64*armA+.41*armB;

        float a=orbitalPhi-kepler(1.)*clock;
        float b=orbitalPhi-kepler(1.52)*clock;
        float c=orbitalPhi-kepler(2.1)*clock;
        vec2 grainAxis=mix(vec2(cos(a),sin(a)),vec2(cos(b),sin(b)),smoothstep(.86,1.5,r));
        grainAxis=mix(grainAxis,vec2(cos(c),sin(c)),smoothstep(1.48,2.25,r));
        float strands=r*20.+1.08*sin(phase*2.+r)+.73*sin(phase-3.6*r);
        float grain=noise(vec2(strands,r*1.9+dot(grainAxis,vec2(2.8,4.1))));
        float fine=noise(vec2(strands*2.3+grain*1.6,dot(grainAxis,vec2(5.,-8.))));
        float filament=.30+.88*grain+.31*fine;
        float clouds=1.45*cloud(r,orbitalPhi,.94,-.40,.12,18.)
                    +2.00*cloud(r,orbitalPhi,1.35,-2.34,.155,16.)
                    +1.62*cloud(r,orbitalPhi,1.96,.62,.185,20.)
                    +.75*cloud(r,orbitalPhi,1.62,2.85,.085,23.);
        float innerRim=exp(-abs(r-.82)/.11)*(.45+.40*grain);
        float energy=extent*((.15+arms)*filament+clouds*(.68+.45*fine)+innerRim);
        // One side approaches us, the other recedes. Gaps in the gas remain
        // visible even on the brighter side of the disk.
        float speedAlongSightline=.26*sqrt(1.-inclination*inclination);
        float doppler=1./(1.+speedAlongSightline*cos(phi)/sqrt(r));
        energy*=doppler*doppler;
        float heat=clamp(.47+.46/(r*r)-.19*r+.19*clouds+.1*arms,0.,1.);
        vec3 body=mix(vec3(.73,.105,.043),vec3(1.,.47,.16),heat);
        vec3 hot=mix(vec3(1.,.83,.55),vec3(.84,.94,1.),smoothstep(.79,.99,heat));
        return energy*body + energy*heat*heat*(.18+.56*clouds+.38*innerRim)*hot;
      }

      void main() {
        vec2 p=plane;
        float impact=length(p);
        if(impact>3.08) discard;
        float aa=clamp(fwidth(impact),.002,.033);
        float shadow=1.-smoothstep(.512-aa,.518+aa,impact);
        vec2 disk=vec2(p.x,(p.y+.025)/inclination);
        float radius=length(disk);
        float phi=atan(disk.y,disk.x+.000001);
        float foreground=1.-smoothstep(-.22,-.04,disk.y);
        vec3 light=emission(radius,phi)*mix(1.-shadow,1.,foreground);
        // Near-side gas also absorbs the bent images and photon ring behind it.
        float nearGas=foreground*smoothstep(.66,.89,radius)*(1.-smoothstep(1.88,2.77,radius));
        float transmission=exp(-nearGas*(1.35+.62*light.r));

        float viewAngle=atan(p.y,p.x+.000001);
        float upper=smoothstep(.02,.58,sin(viewAngle));
        // Consecutive far-side annuli appear progressively closer together in
        // projection. The image bends up and around the shadow, with a fainter
        // secondary view below it. Its irregularities travel with the disk.
        float bent=length(vec2(p.x*.965,(p.y+.018)*mix(.98,1.2,inclination)));
        float offset=bent-.547;
        if(upper>0. && offset>0. && offset<.395) {
          float source=.66+3.20*offset+6.6*offset*offset;
          light+=emission(source,viewAngle)*upper*.79;
        }
        float lower=smoothstep(.12,.86,-sin(viewAngle));
        float invOffset=length(vec2(p.x*.975,(p.y-.012)*1.12))-.548;
        if(lower>0. && invOffset>0. && invOffset<.19) {
          float source=.68+6.4*invOffset+22.*invOffset*invOffset;
          light+=emission(source,-viewAngle)*transmission*lower*.19*(1.-.70*smoothstep(.74,1.2,radius));
        }

        float approach=.55-.21*cos(viewAngle)+.08*sin(viewAngle);
        float lineWidth=max(aa*.72,.004);
        float photon=exp(-abs(impact-.528)/lineWidth)*min(1.,.009/lineWidth)*approach;
        float innerHaze=exp(-abs(impact-.54)/.025)*approach;
        light+=transmission*(photon*vec3(.81,.75,.68)+innerHaze*vec3(.22,.079,.026));
        float haze=exp(-abs(p.y+.025)*10.-abs(p.x)*1.4)+.17*exp(-abs(bent-.65)*8.)*upper;
        light+=vec3(.21,.073,.025)*haze*(1.-shadow)*(1.-smoothstep(2.43,2.96,impact));
        vec3 exposed=vec3(1.)-exp(-light*1.30*mix(.35,1.,diskBuild));
        float occultation=max(shadow,1.-transmission);
        float opacity=max(occultation,max(exposed.r,max(exposed.g,exposed.b)));
        if(opacity<.002) discard;
        gl_FragColor=vec4(exposed/opacity,opacity);
      }`
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(6.2,4.8),material);
}


function lensedSource(THREE,uniforms) {
  // Bound the draw to both images and the critical curve even as the unlensed
  // source travels far outside the disk. The source itself is sampled once.
  const vertexShader=/* glsl */ `
    uniform vec2 viewport,lensCenter,sourceCenter;
    uniform float einstein,sourceSize;
    varying vec2 pixel;
    varying vec2 outerImage;
    void main() {
      vec2 beta=sourceCenter-lensCenter;
      float u=max(.0001,length(beta));
      outerImage=lensCenter+beta*.5*(1.+sqrt(u*u+4.*einstein*einstein)/u);
      float margin=sourceSize*5.+15.;
      vec2 lo=min(lensCenter-einstein,outerImage)-margin;
      vec2 hi=max(lensCenter+einstein,outerImage)+margin;
      pixel=mix(max(lo,vec2(0.)),min(hi,viewport),uv);
      gl_Position=vec4((pixel/viewport-.5)*vec2(2.,-2.),.4,1.);
    }`;
  const fragmentShader=/* glsl */ `
    uniform vec2 lensCenter,sourceCenter;
    uniform float einstein,sourceSize,diskBuild;
    varying vec2 pixel;
    varying vec2 outerImage;
    void main() {
      vec2 theta=pixel-lensCenter;
      float b2=max(dot(theta,theta),.1);
      // The point-mass lens preserves surface brightness. A finite photosphere
      // traced through this inverse map forms both parities and the full ring.
      vec2 beta=theta*(1.-einstein*einstein/b2);
      vec2 q=(beta-(sourceCenter-lensCenter))/sourceSize;
      float localR2=dot(q,q);
      vec2 dx=dFdx(q), dy=dFdy(q);
      float footprint=1.+min(2.,(dot(dx,dx)+dot(dy,dy))*.14);
      float r2=localR2/footprint;
      float profile=exp(-1.45*r2)/footprint;
      float limb=1.-smoothstep(.67,1.18,sqrt(r2));
      float core=exp(-3.9*r2)/footprint;
      vec2 spot=q-vec2(-.28,.19);
      float surface=1.+.15*exp(-8.*dot(spot,spot))-.09*exp(-7.*dot(q+.31,q+.31));
      float haze=exp(-sqrt(r2)*.93)/sqrt(footprint);
      vec3 flux=vec3(.16,.46,1.)*(.62*profile+.33*haze)+
                vec3(.63,.85,1.)*(.48*limb+.44*profile)*surface+
                vec3(.96,.99,1.)*.66*core;
      // Diffraction belongs to a point-like image. It dissolves as that image
      // resolves into an extended arc, leaving the gravitational image intact.
      float separation=length(sourceCenter-lensCenter)/einstein;
      vec2 point=abs(pixel-outerImage);
      float flare=exp(-point.y/.45-point.x/(4.+sourceSize))+
                  .72*exp(-point.x/.37-point.y/(3.+sourceSize*.65));
      flux+=vec3(.53,.75,1.)*.42*smoothstep(.24,.91,separation)*flare;
      flux*=smoothstep(.12,.90,diskBuild);
      float alpha=clamp(max(flux.r,max(flux.g,flux.b)),0.,1.);
      if(alpha<.001) discard;
      gl_FragColor=vec4(min(vec3(1.),flux/max(.001,alpha)),alpha);
    }`;
  const material=additiveMaterial(THREE,uniforms,vertexShader,fragmentShader);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  mesh.name='Lensed source star';
  return mesh;
}

export function createCosmos(THREE) {
  const group=new THREE.Group();
  group.name='Gravitational lens and starfield';
  const uniforms={
    viewport:{value:new THREE.Vector2(1280,800)}, aspect:{value:1.6},dpr:{value:1},
    clock:{value:0},parallax:{value:new THREE.Vector2()},contactBox:{value:new THREE.Vector4()},
    lensCenter:{value:new THREE.Vector2()},sourceCenter:{value:new THREE.Vector2()},
    einstein:{value:85},sourceSize:{value:4},shadowRadius:{value:55},
    inclination:{value:.31},diskAngle:{value:-.095},azimuth:{value:0},diskBuild:{value:0},
    orbRadius:{value:70},orbFracture:{value:0},orbSettled:{value:0}
  };
  const stars=starLayer(THREE,starCatalogue(),uniforms);
  stars.name='Lensed field stars';
  const stream=createStarStream();
  const streamMesh=stellarStreamLayer(THREE,stream,uniforms);
  const shooting=meteors(THREE,uniforms);
  shooting.name='Meteors';
  const source=lensedSource(THREE,uniforms);
  const hole=blackHole(THREE,uniforms);
  hole.name='Accretion disk';
  const crystal=createGlassOrb(THREE,uniforms);
  const layers=[stars,streamMesh,shooting,source,crystal.dust.back,crystal.back,hole,crystal.front,crystal.dust.front];
  layers.forEach((layer,i)=>{
    layer.renderOrder=i;
    layer.frustumCulled=false;
    group.add(layer);
  });
  // The document provides exact glyph and navigation bounds. The viewport
  // estimate also keeps the contact area clear in standalone/offscreen renders.
  function measureContact() {
    const {x:width,y:height}=uniforms.viewport.value;
    const short=height<=500;
    const em=short?Math.max(46.4,Math.min(height*.13,68)):Math.max(68,Math.min(width*.074,140.8));
    const block=1.1*em+(short?5:Math.max(11.2,Math.min(height*.019,25.6)))+44;
    const y=height*(width<=620&&!short?.64:.67)+.25*block;
    const box=uniforms.contactBox.value;
    box.set(width*.5,y,Math.min(width*.5,Math.max(116,2.46*em))+7,.5*block+5);

    if(typeof document==='undefined'||typeof document.createRange!=='function') return;
    const heading=document.querySelector('#contact h1');
    const navigation=document.querySelector('#contact nav');
    const canvas=document.getElementById('sky');
    if(!heading||!navigation||!canvas) return;
    const range=document.createRange();
    if(typeof range.getBoundingClientRect!=='function') return;
    range.selectNodeContents(heading);
    const title=range.getBoundingClientRect();
    const links=navigation.getBoundingClientRect();
    const sky=canvas.getBoundingClientRect();
    if(!title.width||!links.width||!sky.width) return;
    const left=Math.min(title.left,links.left)-sky.left, right=Math.max(title.right,links.right)-sky.left;
    const top=Math.min(title.top,links.top)-sky.top, bottom=Math.max(title.bottom,links.bottom)-sky.top;
    box.set(.5*(left+right),.5*(top+bottom),.5*(right-left)+7,.5*(bottom-top)+5);
  }
  const fonts=typeof document!=='undefined'?document.fonts:null;
  fonts?.addEventListener('loadingdone',measureContact);
  function resize(width,height,ratio=1) {
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) return;
    uniforms.viewport.value.set(width,height);
    uniforms.aspect.value=width/height;
    uniforms.dpr.value=ratio;
    measureContact();
  }
  measureContact();
  function update(frame) {
    const {x:width,y:height}=uniforms.viewport.value;
    const lens=sampleLens(width,height,frame);
    uniforms.clock.value=frame.time??0;
    uniforms.parallax.value.set(Math.sin(frame.yaw||0),Math.sin(frame.pitch||0));
    uniforms.lensCenter.value.set(lens.cx,lens.cy);
    uniforms.sourceCenter.value.set(lens.sourceX,lens.sourceY);
    uniforms.einstein.value=lens.einstein;
    uniforms.sourceSize.value=lens.sourceSize;
    uniforms.shadowRadius.value=lens.radius;
    uniforms.inclination.value=lens.inclination;
    uniforms.diskAngle.value=lens.angle;
    uniforms.azimuth.value=frame.yaw||0;
    crystal.update(lens,frame);
    source.visible=uniforms.diskBuild.value>.12;
    stream.update(frame,width,height,lens);
    streamMesh.geometry.attributes.position.needsUpdate=true;
    shooting.visible=!frame.reduceMotion;
  }
  function dispose() {
    fonts?.removeEventListener('loadingdone',measureContact);
    crystal.dispose();
    for(const layer of [stars,streamMesh,shooting,source,hole]) {
      layer.geometry.dispose();
      layer.material.dispose();
    }
  }
  return {group,update,resize,brush:(x,y)=>stream.hover(x,y),dispose};
}
