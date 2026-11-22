import { createOrb, dustOnlyAge, erosionStartAge } from './orb.js';

const clamp = (value, low=0, high=1) => Math.min(high,Math.max(low,value));
const mix = (a,b,t) => a+(b-a)*t;
const rgba = (r,g,b,a) => 'rgba('+Math.round(clamp(r,0,255))+','+Math.round(clamp(g,0,255))+','+Math.round(clamp(b,0,255))+','+clamp(a)+')';

// Studio lights reflected in the two faces of a thin optical crystal.
// Directions are in screen space with the observer on the positive z axis.
function reflection(nx,ny,nz) {
  if(nz<0) { nx=-nx;ny=-ny;nz=-nz; }
  const rx=2*nz*nx, ry=2*nz*ny, rz=2*nz*nz-1;
  const fresnel=.045+.955*(1-nz)**3;
  const top=ry+.63-.24*rx;
  const side=rx-.72+.24*ry;
  const softbox=Math.exp(-top*top/.027-(rx+.38)**2/.60-(rz-.26)**2/1.25);
  const strip=Math.exp(-side*side/.008-(ry+.10)**2/.50-(rz+.04)**2/1.50);
  const window=Math.exp(-((rx+.82)**2/.16+(ry+.21)**2/.25+(rz+.23)**2/1.3));
  const warm=Math.exp(-((rx-.43)**2/.42+(ry-.66)**2/.093+(rz+.07)**2/.79));
  return {fresnel,softbox,strip,window,warm};
}

// Clip a reflected rectangular panel against an individual triangular cut.
// Its projected boundary crosses several facets, shifting at each polished join.
function panel(context,points,loU,hiU,loV,hiV,color,loZ=-1,hiZ=1) {
  const [a,b,c]=points;
  if(Math.min(a[2],b[2],c[2])>hiU||Math.max(a[2],b[2],c[2])<loU||
     Math.min(a[3],b[3],c[3])>hiV||Math.max(a[3],b[3],c[3])<loV||
     Math.min(a[4],b[4],c[4])>hiZ||Math.max(a[4],b[4],c[4])<loZ)return;
  let poly=points;
  for(const [channel,bound,sign] of [[4,loZ,1],[4,hiZ,-1],[2,loU,1],[2,hiU,-1],[3,loV,1],[3,hiV,-1]]) {
    const next=[];
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length];
      const da=(a[channel]-bound)*sign,db=(b[channel]-bound)*sign;
      if(da>=0)next.push(a);
      if((da>=0)!==(db>=0)) {
        const t=da/(da-db);
        next.push(a.map((v,k)=>mix(v,b[k],t)));
      }
    }
    if(next.length<3)return;
    poly=next;
  }
  context.beginPath();context.moveTo(poly[0][0],poly[0][1]);
  for(let i=1;i<poly.length;i++)context.lineTo(poly[i][0],poly[i][1]);
  context.closePath();context.fillStyle=color;context.fill();
}

export function createCrystalCanvas(ownerDocument) {
  const orb=createOrb();
  const order=Array.from({length:orb.count},(_,i)=>i);
  const sample=ownerDocument.createElement('canvas');
  const sampleContext=sample.getContext('2d');
  const dust=[];
  let random=0x94f316a9;
  function grainRandom() {
    random=(Math.imul(random,1664525)+1013904223)>>>0;
    return random/4294967296;
  }
  for(let i=0;i<orb.count;i++) {
    for(let j=0;j<2+(i%3);j++) {
      dust.push({facet:i,delay:.23+.6*grainRandom(),offset:(grainRandom()-.5)*.45,
        lead:(grainRandom()-.5)*.29,lift:(grainRandom()-.5)*.085,phase:grainRandom()*2*Math.PI,
        size:.31+.91*grainRandom()**2,light:.36+.64*grainRandom(),gold:grainRandom()>.38});
    }
  }
  function orbitalShear(facet,offset) {
    const guiding=orb.orbits[facet];
    return 2.65*((.515*(guiding+offset))**-1.5-(.515*guiding)**-1.5);
  }
  for(const grain of dust)grain.shear=orbitalShear(grain.facet,grain.offset);
  // Each grain of fine material has a home on a particular edge. Sample the
  // inverse of smoothstep so nearly equal amounts of grit come off for equal
  // increments of the parent facet's erosion, including on a direct seek.
  const fines=[];
  for(let facet=0;facet<orb.count;facet++) {
    const count=7+facet%4;
    for(let j=0;j<count;j++) {
      const threshold=(j+.08+.77*grainRandom())/count;
      const releaseFraction=.5-Math.sin(Math.asin(1-2*threshold)/3);
      const release=erosionStartAge+releaseFraction*(orb.erosionEnds[facet]-erosionStartAge);
      const edge=(j+facet)%3;
      const along=.14+.72*grainRandom(),offset=(grainRandom()-.5)*.44;
      fines.push({facet,threshold,release,edge,along,offset,shear:orbitalShear(facet,offset),lead:(grainRandom()-.5)*.15,
        lift:(grainRandom()-.5)*.072,phase:grainRandom()*Math.PI*2,
        size:.27+.65*grainRandom()**1.8,light:.48+.52*grainRandom(),heat:grainRandom()});
    }
  }
  const colors=['159,208,241','229,210,184','255,188,123','255,164,103'];
  const levels=10;
  const paints=colors.flatMap(color=>Array.from({length:levels},(_,i)=>'rgba('+color+','+(.5+i)*.84/levels+')'));
  const batches=Array.from({length:2},()=>paints.map(()=>[]));
  function addGrain(grain,pass,hue,light) {
    if(light<.02)return;
    const level=Math.min(levels-1,Math.floor(light*levels/.84));
    batches[pass][hue*levels+level].push(grain);
  }
  let captureHalf=1, shell=1, rim, hasFacets=true;
  // Copy the actual local background once. Each facet sees it through a
  // different refracting plane, so the stream breaks at the facet junctions.
  function prepare(context,lens,frame,pixelRatio) {
    orb.update(lens,frame);
    const age=Number.isFinite(frame.breakAge) ? frame.breakAge : 0;
    hasFacets=age<dustOnlyAge;
    if(hasFacets)order.sort((a,b)=>orb.depth[a]-orb.depth[b]);
    shell=(1-orb.fracture)**2;
    if(shell>.01 && sampleContext) {
      captureHalf=orb.radius*1.72;
      const resolution=clamp(Math.ceil(captureHalf*2*Math.min(pixelRatio,1.35)),12,128);
      if(sample.width!==resolution || sample.height!==resolution)sample.width=sample.height=resolution;
      sampleContext.clearRect(0,0,resolution,resolution);
      sampleContext.drawImage(context.canvas,
        (lens.cx-captureHalf)*pixelRatio,(lens.cy-captureHalf)*pixelRatio,2*captureHalf*pixelRatio,2*captureHalf*pixelRatio,
        0,0,resolution,resolution);
      rim=context.createRadialGradient(lens.cx,lens.cy,0,lens.cx,lens.cy,orb.radius);
      rim.addColorStop(0,'rgba(96,180,212,0)');
      rim.addColorStop(.69,'rgba(96,180,212,0)');
      rim.addColorStop(.88,'rgba(105,189,226,.047)');
      rim.addColorStop(.958,'rgba(173,222,238,.16)');
      rim.addColorStop(.985,'rgba(209,241,249,.39)');
      rim.addColorStop(1,'rgba(217,245,249,.55)');
    } else rim=null;
    const dc=Math.cos(lens.angle),ds=Math.sin(lens.angle),inc=lens.inclination;
    const tilt=Math.sqrt(1-inc*inc), R=lens.radius;
    const sizeScale=clamp(R/77,.72,1.34);
    for(const pass of batches)for(const batch of pass)batch.length=0;
    for(const grain of dust) {
      const elapsed=age-grain.delay;
      grain.opacity=0;
      if(elapsed<=0)continue;
      const q=1-Math.exp(-elapsed*1.9), k=grain.facet*9, positions=orb.positions;
      const x=(positions[k]+positions[k+3]+positions[k+6])/3-lens.cx;
      const y=(positions[k+1]+positions[k+4]+positions[k+7])/3-lens.cy;
      const z=orb.depth[grain.facet], u=x*dc+y*ds, cross=x*ds-y*dc;
      const v=cross*inc-z*tilt, height=cross*tilt+z*inc;
      // Grains leave their parent fragment's current position. Slightly
      // different radii give the fine material a different angular speed.
      const r=Math.max(.65,Math.hypot(u,v)/R);
      const rDust=Math.max(.58,r+grain.offset*q);
      const phi=Math.atan2(v,u)+q*grain.lead+grain.shear*elapsed;
      const U=R*rDust*Math.cos(phi),V=R*rDust*Math.sin(phi);
      const H=height*(1-q*.45)+q*R*grain.lift*Math.sin(phi+grain.phase);
      const transverse=V*inc+H*tilt;
      grain.x=lens.cx+U*dc+transverse*ds;
      grain.y=lens.cy+U*ds-transverse*dc;
      grain.z=-V*tilt+H*inc;
      const erosion=orb.erosion[grain.facet];
      grain.opacity=q*grain.light*(.48+.29*Math.cos(phi+grain.phase)**2)*(1-.26*erosion);
      grain.radius=grain.size*sizeScale*(1-.28*erosion);
    }
    if(age>erosionStartAge)for(const grain of fines) {
      const id=grain.facet, erosion=orb.erosion[id];
      if(erosion<grain.threshold)continue;
      const elapsed=age-grain.release;
      if(elapsed<=0)continue;
      const q=1-Math.exp(-2.25*elapsed), attached=(1-q)**2;
      const p=orb.positions,k=id*9, a=k+3*grain.edge,b=k+3*((grain.edge+1)%3);
      const x=(p[k]+p[k+3]+p[k+6])/3, y=(p[k+1]+p[k+4]+p[k+7])/3;
      const X=mix(x,mix(p[a],p[b],grain.along),attached)-lens.cx;
      const Y=mix(y,mix(p[a+1],p[b+1],grain.along),attached)-lens.cy;
      const Z=mix(orb.depth[id],mix(p[a+2],p[b+2],grain.along),attached);
      const u=X*dc+Y*ds, cross=X*ds-Y*dc, v=cross*inc-Z*tilt;
      const H=(cross*tilt+Z*inc)*(1-.53*q);
      // The lag integrates the gradual release into the new orbital speed.
      // It is zero at the edge and depends only on time since that edge eroded.
      const phi=Math.atan2(v,u)+grain.lead*q+grain.shear*(elapsed-q/2.25);
      const r=Math.hypot(u,v)+R*grain.offset*q;
      const U=r*Math.cos(phi), V=r*Math.sin(phi);
      const height=H+R*grain.lift*q*Math.sin(phi+grain.phase), transverse=V*inc+height*tilt;
      grain.x=lens.cx+U*dc+transverse*ds;
      grain.y=lens.cy+U*ds-transverse*dc;
      grain.radius=grain.size*sizeScale*(1-.17*q);
      const glow=q*grain.light*(.58+.32*Math.cos(phi+grain.phase)**2);
      const heat=clamp(grain.heat*.49+q*(.40+.18*erosion));
      const hue=Math.min(3,Math.floor(heat*4));
      const nearer=clamp(.5+(-V*tilt+height*inc)/(.14*R));
      addGrain(grain,0,hue,glow*(1-nearer));
      addGrain(grain,1,hue,glow*nearer);
    }
    return orb;
  }

  function draw(context,lens,front) {
    const {positions,normals,colors,opacity,depth,radius,fracture,settled}=orb;
    context.save();
    context.lineJoin='round';
    for(const grain of dust) {
      if(grain.opacity<.01||(grain.z>=0)!==front)continue;
      context.beginPath();context.arc(grain.x,grain.y,grain.radius,0,Math.PI*2);
      context.fillStyle=grain.gold ? rgba(255,192,121,grain.opacity) : rgba(196,226,246,grain.opacity*.86);
      context.fill();
    }
    // Subpixel grains share a handful of emissive paints. Each batch costs
    // one fill even after all of the original surfaces have disintegrated.
    const pass=batches[Number(front)];
    for(let i=0;i<pass.length;i++) {
      if(!pass[i].length)continue;
      context.beginPath();
      for(const g of pass[i]) {
        context.moveTo(g.x+g.radius,g.y);
        context.arc(g.x,g.y,g.radius,0,Math.PI*2);
      }
      context.fillStyle=paints[i];context.fill();
    }
    if(!hasFacets){context.restore();return;}
    for(const id of order) {
      if((depth[id]>=0)!==front || opacity[id]<.002)continue;
      const p=id*9,n=id*3;
      const x0=positions[p],y0=positions[p+1],x1=positions[p+3],y1=positions[p+4],x2=positions[p+6],y2=positions[p+7];
      const area=Math.abs((x1-x0)*(y2-y0)-(y1-y0)*(x2-x0))*.5;
      if(area<.035)continue;
      const x=[x0,x1,x2],y=[y0,y1,y2];
      const nx=normals[n],ny=normals[n+1],nz=normals[n+2];
      const normal=reflection(nx,ny,nz);
      const facing=nx<0 ? 1 : 0;
      const quiet=1-fracture;
      const flash=Math.sin(fracture*Math.PI);
      const joined=shell*Number(front);
      // A faint interior surface sits underneath the ice-colored outer shell.
      const frontLight=clamp(.5+depth[id]/radius);
      const strength=opacity[id]*mix(.55+.45*frontLight,1,fracture);
      context.beginPath();
      context.moveTo(x0,y0);context.lineTo(x1,y1);context.lineTo(x2,y2);context.closePath();
      if (joined>.02 && sampleContext) {
        const left=Math.min(x0,x1,x2), top=Math.min(y0,y1,y2);
        const w=Math.max(x0,x1,x2)-left, h=Math.max(y0,y1,y2)-top;
        const scale=sample.width/(2*captureHalf), bend=.77+Math.abs(nz)*.26;
        const sx=((left-lens.cx)*bend-nx*radius*.37+captureHalf)*scale;
        const sy=((top-lens.cy)*bend-ny*radius*.37+captureHalf)*scale;
        context.save();
        context.clip();
        context.globalAlpha=joined*(.19+.06*Math.abs(nz));
        context.drawImage(sample,sx,sy,w*bend*scale,h*bend*scale,left,top,w,h);
        context.restore();
      }
      const samples=[];
      const aperture=[];
      let lightest=0,darkest=0;
      for(let k=0;k<3;k++) {
        // Slight edge bevels bend the reflection as it crosses a cut plane.
        // The front face retains smooth gradients while each join stays crisp.
        const rounding=.58*quiet;
        let vx=mix(nx,(x[k]-lens.cx)/radius,rounding);
        let vy=mix(ny,(y[k]-lens.cy)/radius,rounding);
        let vz=mix(nz,positions[p+k*3+2]/radius,rounding);
        const length=Math.hypot(vx,vy,vz)||1;
        vx/=length;vy/=length;vz/=length;
        const {fresnel,softbox,strip,window,warm}=reflection(vx,vy,vz);
        if(front && quiet>.05) {
          const bevel=.86*quiet;
          let ax=mix(nx,(x[k]-lens.cx)/radius,bevel);
          let ay=mix(ny,(y[k]-lens.cy)/radius,bevel);
          let az=mix(nz,positions[p+k*3+2]/radius,bevel);
          const al=Math.hypot(ax,ay,az)||1;ax/=al;ay/=al;az/=al;
          aperture.push({rx:2*ax*az,ry:2*ay*az,rz:2*az*az-1});
        }
        const heat=warm*(.67+.33*settled);
        const cyan=.25*fresnel+.24*window+.21*strip;
        const ice=softbox*.89+strip*.66+window*.29;
        const interior=.07+.14*Math.max(0,vy)+.11*Math.max(0,-vx);
        const strengthOfLight=ice+heat*.59+fresnel*.56;
        const alpha=clamp(strength*(.37+interior+.78*ice+.55*heat+.48*fresnel+.20*fracture));
        const rgb=[
          11+colors[n]*108+168*ice+188*heat+87*fresnel,
          24+colors[n+1]*114+160*ice+85*heat+85*cyan+65*fresnel,
          37+colors[n+2]*125+151*ice+23*heat+102*cyan+63*fresnel,
        ];
        samples.push({tone:strengthOfLight,color:rgba(...rgb,alpha)});
        if(samples[k].tone<samples[darkest].tone)darkest=k;
        if(samples[k].tone>samples[lightest].tone)lightest=k;
      }
      if(lightest!==darkest && samples[lightest].tone-samples[darkest].tone>.025) {
        const grad=context.createLinearGradient(x[darkest],y[darkest],x[lightest],y[lightest]);
        grad.addColorStop(0,samples[darkest].color);
        grad.addColorStop(1,samples[lightest].color);
        context.fillStyle=grad;
      } else context.fillStyle=samples[lightest].color;
      context.fill();
      if(rim && front) {
        context.save();context.globalAlpha=joined;context.fillStyle=rim;context.fill();context.restore();
      }
      if(front && quiet>.05) {
        context.save();context.globalAlpha=quiet*quiet;
        // A cool glazing reflection catches the brow of the orb. The narrow
        // blue and ivory shoulders refract differently across adjacent planes.
        const upper=aperture.map(({rx,ry,rz},k)=>[x[k],y[k],ry+.74-.16*rx,rx,rz]);
        panel(context,upper,-.145,.125,-.87,.21,'rgba(129,196,230,.27)',-1,.08);
        panel(context,upper,-.071,.070,-.85,.17,'rgba(199,231,242,.53)',-1,.03);
        panel(context,upper,-.036,.035,-.83,.14,'rgba(239,249,247,.76)',-1,.02);
        panel(context,upper,.043,.065,-.77,.10,'rgba(151,209,250,.43)',-1,0);
        const side=aperture.map(({rx,ry,rz},k)=>[x[k],y[k],rx+.77+.24*ry,ry,rz]);
        panel(context,side,-.077,.075,-.73,.17,'rgba(135,204,234,.32)',-.27,1);
        panel(context,side,-.021,.016,-.70,.13,'rgba(225,247,249,.61)',-.23,1);
        const amber=aperture.map(({rx,ry,rz},k)=>[x[k],y[k],ry-.58+.27*rx,rx,rz]);
        panel(context,amber,-.12,.09,-.42,.87,'rgba(218,145,91,.26)',-1,-.1);
        panel(context,amber,-.024,.036,-.33,.82,'rgba(244,201,143,.55)',-1,-.14);
        context.restore();
      }
      const edge=clamp((normal.fresnel*.36+normal.softbox*.23+normal.window*.21+.04*facing)*strength+.57*flash);
      if(edge>.065) {
        const k=(id+facing)%3, j=(k+1)%3;
        context.beginPath();context.moveTo(x[k],y[k]);context.lineTo(x[j],y[j]);
        context.strokeStyle=rgba(185+46*flash,220+25*flash,234+16*flash,edge);
        context.lineWidth=clamp(radius*.0065,.42,1.0);
        context.stroke();
      }
      if(orb.seamStrength>.001 && nz>.025) {
        // The same sparse edge mask used by WebGL follows the actual pane
        // corners. Clip each half of a shared bevel to its own visible face.
        const seam=orb.seamEdges;
        if(seam[n] || seam[n+1] || seam[n+2]) {
          context.save();
          context.beginPath();context.moveTo(x0,y0);context.lineTo(x1,y1);context.lineTo(x2,y2);context.closePath();
          context.clip();
          context.lineWidth=clamp(radius*.0075,.55,.85);
          context.lineCap='round';
          const facing=clamp((nz-.025)/.225);
          for(let edge=0;edge<3;edge++)if(seam[n+edge]) {
            const next=(edge+1)%3;
            context.beginPath();context.moveTo(x[edge],y[edge]);context.lineTo(x[next],y[next]);
            context.strokeStyle=rgba(181,218,237,orb.seamStrength*seam[n+edge]*facing);
            context.stroke();
          }
          context.restore();
        }
      }
    }
    context.restore();
  }

  return {prepare,draw};
}
