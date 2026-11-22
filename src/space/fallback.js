import { sampleLens, lensImages } from './lens.js';
import { createStarStream } from './star-stream.js';
import { createCrystalCanvas } from './orb-canvas.js';

const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const between = (a, b, t) => a.map((v, i) => mix(v, b[i], t));

function generator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Ordinary stars reuse tiny sprites with the same Gaussian core and colored
// halo as the WebGL shader. Bright stars add their own diffraction spikes.
function streamSprites(ownerDocument, stream) {
  const cache=new Map(), sprites=[];
  function smooth(start,end,value) {
    const t=clamp((value-start)/(end-start));
    return t*t*(3-2*t);
  }
  for(let i=0;i<stream.count;i++) {
    const style=i*4;
    const diameter=Math.round(stream.appearance[style]*4)/4;
    const temperature=Math.round(stream.appearance[style+1]*8)/8;
    const flare=Math.round(clamp(stream.appearance[style+3])*4)/4;
    const phase=(stream.appearance[style+1]*23+stream.appearance[style]*1.7)%1;
    const axis=flare>0&&phase>=.5 ? 1 : 0;
    const key=[diameter,temperature,flare,axis].join('/');
    let sprite=cache.get(key);
    if(sprite) {
      sprites.push(sprite);
      continue;
    }
    const extent=Math.max(7,diameter*5.2+flare*27);
    const size=Math.ceil(extent*2);
    const image=ownerDocument.createElement('canvas');
    image.width=image.height=size;
    const layer=image.getContext('2d');
    if(!layer)return null;
    const pixels=layer.createImageData(size,size), data=pixels.data;
    const radius=Math.max(diameter*.5,.31);
    const tint=between(between([.62,.78,1],[1,.975,.915],smooth(.03,.52,temperature)),
      [1,.695,.51],smooth(.55,1,temperature));
    const core=between(tint,[1,1,1],.22+.30*smooth(.4,1.6,radius));
    const angle=.12+axis*.62;
    const cos=Math.cos(angle),sin=Math.sin(angle);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const px=((x+.5)/size-.5)*extent, py=((y+.5)/size-.5)*extent;
      const r=Math.hypot(px,py), cutoff=1-smooth(.36,.5,r/extent);
      if(!cutoff)continue;
      const center=2**(-(px*px+py*py)/(radius*radius));
      let halo=.19*Math.exp(-r/(.47+.94*radius));
      if(flare>.001) {
        const rx=Math.abs(px*cos-py*sin),ry=Math.abs(px*sin+py*cos);
        const long=Math.exp(-ry/(.18+.15*flare)-rx/(2.1+4.2*flare));
        const short=Math.exp(-rx/(.16+.13*flare)-ry/(1.6+3.2*flare));
        halo+=flare*(.65*long+.46*short+.12*Math.exp(-r/(1.8+1.9*flare)));
      }
      const gain=cutoff;
      const red=(core[0]*center+tint[0]*halo)*gain;
      const green=(core[1]*center+tint[1]*halo)*gain;
      const blue=(core[2]*center+tint[2]*halo)*gain;
      const alpha=clamp(Math.max(red,green,blue));
      if(alpha<.002)continue;
      const offset=4*(y*size+x);
      data[offset]=255*red/alpha;
      data[offset+1]=255*green/alpha;
      data[offset+2]=255*blue/alpha;
      data[offset+3]=255*alpha;
    }
    layer.putImageData(pixels,0,0);
    sprite={image,extent};
    sprites.push(sprite);
    cache.set(key,sprite);
  }
  return sprites;
}

export function createFallback(canvas) {
  let context;
  try { context=canvas.getContext('2d',{alpha:true}); } catch { return null; }
  if (!context) return null;
  const stream=createStarStream();
  const sprites=streamSprites(canvas.ownerDocument,stream);
  const disk=createAccretionDisk(canvas.ownerDocument);
  const crystal=createCrystalCanvas(canvas.ownerDocument);
  const drawSource=createSource(canvas.ownerDocument);
  let width=0, height=0, pixelRatio=1, background=null, disposed=false;
  let foregroundCount=0, beaconSprites=[];
  let copyCenterY=0, copyHalfWidth=1, copyHalfHeight=1;
  const random = generator(87293);
  const starColors = [
    '188,229,255', '245,245,250', '247,201,159',
    '165,176,255', '218,172,236', '127,221,223',
  ];
  const foreground = Array.from({length:172},(_,i)=>({
    u:random(),v:random(),distance:.25+.75*random(),color:starColors[i%6],seed:random(),beacon:i%37===11,
  }));
  const meteors = [
    { x:.26, y:.27, slope:-.52, direction:1, offset:.38, period:7.7, color:starColors[0] },
    { x:.72, y:.23, slope:.34, direction:-1, offset:2.31, period:9.7, color:starColors[2] },
    { x:.77, y:.69, slope:-.7, direction:1, offset:4.62, period:8.5, color:starColors[3] },
    { x:.25, y:.81, slope:.39, direction:-1, offset:6.1, period:10.8, color:starColors[5] },
  ];
  function point(layer, x, y, size, color, opacity) {
    layer.fillStyle = 'rgba('+color+','+opacity+')';
    layer.beginPath(); layer.arc(x,y,size,0,TAU); layer.fill();
  }

  function skyBrightness(x,y) {
    // The outer sky can carry bright foreground stars. Smoothly attenuate
    // those passing through the centered name and contact links.
    const distance=Math.max(Math.abs(x-width*.5)/copyHalfWidth,Math.abs(y-copyCenterY)/copyHalfHeight);
    const t=clamp((distance-.68)/.64);
    return .19+.81*t*t*(3-2*t);
  }

  function beacon(layer, x, y, size, color) {
    const spread = size*11;
    const glow = layer.createRadialGradient(x,y,0,x,y,spread);
    glow.addColorStop(0,'rgba('+color+',.85)');
    glow.addColorStop(.07,'rgba('+color+',.48)');
    glow.addColorStop(.24,'rgba('+color+',.15)');
    glow.addColorStop(.62,'rgba('+color+',.035)');
    glow.addColorStop(1,'rgba('+color+',0)');
    layer.fillStyle=glow;
    layer.fillRect(x-spread,y-spread,2*spread,2*spread);
    // Hairline diffraction picks out only the most luminous beacons.
    layer.save(); layer.translate(x,y); layer.rotate(-.14);
    for(let i=0; i<4; i++) {
      const length = size*(i%2 ? 4.7 : 6.1);
      const spike = layer.createLinearGradient(0,0,length,0);
      spike.addColorStop(0,'rgba(254,250,244,.91)');
      spike.addColorStop(.31,'rgba('+color+',.56)');
      spike.addColorStop(1,'rgba('+color+',0)');
      layer.fillStyle=spike;
      layer.beginPath(); layer.moveTo(0,-size*.22); layer.lineTo(length,0);
      layer.lineTo(0,size*.22); layer.closePath(); layer.fill();
      layer.rotate(Math.PI/2);
    }
    point(layer,0,0,size*.56,'252,249,241',.98);
    layer.restore();
  }

  function paintBackdrop() {
    // The distant stars share a slowly drifting layer. Nearer stars move independently.
    background = canvas.ownerDocument.createElement('canvas');
    background.width = Math.max(1, Math.round(width * pixelRatio));
    background.height = Math.max(1, Math.round(height * pixelRatio));
    const layer = background.getContext('2d');
    if (!layer) { background = null; return; }
    layer.scale(pixelRatio,pixelRatio);
    const rand=generator(372);
    const count=Math.min(1030,Math.round(width*height/1010));
    for(let i=0; i<count; i++) {
      const x=rand()*width, y=rand()*height, bright=rand()**5;
      const color=starColors[i%6];
      point(layer,x,y,.21+bright*.84,color,(.19+bright*.72)*skyBrightness(x,y));
    }
    const clusters = [
      [.17,.31,.079,.034, -.58, 0], [.76,.17,.079,.022,.44, 3],
      [.84,.64,.061,.033,-.45, 2], [.24,.80,.052,.030,.22, 5],
    ];
    for(const [cx,cy,sx,sy,tilt,color] of clusters) {
      // Random sums concentrate stars in the cores of asymmetrical elliptical clusters.
      const cosine=Math.cos(tilt), sine=Math.sin(tilt);
      for(let i=0; i<54; i++) {
        const dx=(rand()+rand()+rand()-1.5)*width*sx;
        const dy=(rand()+rand()+rand()-1.5)*height*sy;
        const x=width*cx+dx*cosine-dy*sine, y=height*cy+dx*sine+dy*cosine;
        const bright=rand()**3;
        const hue=starColors[rand()<.67?color:Math.floor(rand()*6)];
        point(layer,x,y,.23+bright,hue,(.25+bright*.67)*skyBrightness(x,y));
      }
    }
    for(const [x,y,lum,color] of [[.183,.306,2.4,0],[.766,.171,1.9,3],[.829,.657,2.1,2],[.25,.79,1.5,5]]) {
      layer.globalAlpha=skyBrightness(x*width,y*height);
      beacon(layer,x*width,y*height,lum,starColors[color]);
    }
    beaconSprites=starColors.map(color=>{
      const image=canvas.ownerDocument.createElement('canvas');
      image.width=image.height=64;
      const sprite=image.getContext('2d');
      if(!sprite)return null;
      sprite.scale(2,2);
      beacon(sprite,16,16,1.38,color);
      return image;
    });
  }

  function drawStream(frame,lens) {
    stream.update(frame,width,height,lens);
    if(!sprites)return;
    const {positions,appearance,count}=stream;
    context.save();
    context.globalCompositeOperation='lighter';
    for(let i=0;i<count;i++) {
      const pos=i*3, alpha=positions[pos+2];
      if(!(alpha>.004))continue;
      const {image,extent:spread}=sprites[i];
      const left=(positions[pos]+1)*width*.5-spread*.5;
      const top=(1-positions[pos+1])*height*.5-spread*.5;
      if(left>width||top>height||left+spread<0||top+spread<0)continue;
      context.globalAlpha=clamp(.92*alpha*appearance[i*4+2]);
      context.drawImage(image,left,top,spread,spread);
    }
    context.restore();
  }

  function streaks(time) {
    for(const meteor of meteors) {
      const phase=((time+meteor.offset)%meteor.period)/1.05;
      if(phase>=1)continue;
      const travel=Math.min(480,width*.39), trail=Math.min(190,width*.22);
      const distance=(phase-.5)*travel*meteor.direction;
      const x=meteor.x*width+distance, y=meteor.y*height+distance*meteor.slope;
      const tx=x-trail*meteor.direction, ty=y-trail*meteor.direction*meteor.slope;
      const intensity=Math.sin(Math.PI*phase)*.68*Math.min(skyBrightness(tx,ty),skyBrightness(x,y),
        skyBrightness((tx+x)*.5,(ty+y)*.5));
      const g=context.createLinearGradient(tx,ty,x,y);
      g.addColorStop(0,'rgba('+meteor.color+',0)');
      g.addColorStop(.72,'rgba('+meteor.color+','+intensity*.22+')');
      g.addColorStop(1,'rgba(239,246,255,'+intensity*.97+')');
      context.strokeStyle=g; context.lineWidth=1.1;
      context.beginPath(); context.moveTo(tx,ty); context.lineTo(x,y); context.stroke();
      point(context,x,y,1.18,meteor.color,intensity*.9);
    }
  }

  function resize() {
    if(disposed)return;
    const rect=canvas.getBoundingClientRect();
    width=Math.max(1,rect.width);
    height=Math.max(1,rect.height);
    pixelRatio=Math.min(1.75,canvas.ownerDocument.defaultView?.devicePixelRatio||1);
    canvas.width=Math.round(width*pixelRatio);
    canvas.height=Math.round(height*pixelRatio);
    foregroundCount=clamp(Math.round(width*height/5600),98,foreground.length);
    copyCenterY=(width<=620 ? .697 : .712)*height;
    copyHalfWidth=Math.min(width*.44,Math.max(165,width*.215));
    copyHalfHeight=Math.max(48,height*.105);
    paintBackdrop();
  }

  function render(frame={}) {
    if(disposed)return;
    const lens=sampleLens(width,height,frame);
    const t=Number.isFinite(frame.time) ? frame.time : 0;
    // Clear physical pixels, including the rounded edge at fractional DPR.
    // Empty space exposes the same CSS galaxy under either live renderer.
    context.setTransform(1,0,0,1,0,0);
    context.clearRect(0,0,canvas.width,canvas.height);
    context.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    if(background) {
      const dx=Math.sin(t*.11)*8,dy=Math.sin(t*.09)*4;
      context.drawImage(background,dx,dy,width,height);
    }
    for(let i=0;i<foregroundCount;i++) {
      const star=foreground[i];
      const depth=star.distance;
      const wobble=Math.sin(star.seed*TAU+t*.12)-Math.sin(star.seed*TAU);
      const x=((star.u*width+t*(3+depth*8))%(width+24))-12;
      const y=((star.v*height+t*(1+depth*1.8)+wobble*(1+3*depth))%(height+24))-12;
      const brightness=skyBrightness(x,y)*(.38+.19*Math.sin(t*(.54+.32*depth)+star.seed*TAU)+depth*.29);
      const sprite=star.beacon && beaconSprites[i%starColors.length];
      if(sprite) {
        const spread=23+depth*7;
        context.globalAlpha=brightness;
        context.drawImage(sprite,x-spread*.5,y-spread*.5,spread,spread);
        context.globalAlpha=1;
      } else point(context,x,y,.22+depth*.65+.18*star.seed**4,star.color,brightness);
    }
    drawStream(frame,lens);
    streaks(t);
    const orb=crystal.prepare(context,lens,frame,pixelRatio);
    const sourceGain=clamp((orb.disk-.12)/.78);
    if(sourceGain>0) {
      context.save();
      context.globalAlpha=sourceGain*sourceGain*(3-2*sourceGain);
      drawSource(context,lens,pixelRatio);
      context.restore();
    }
    crystal.draw(context,lens,false);
    const seed={...lens,radius:lens.radius*mix(.20,1,orb.disk)};
    disk(context,seed,t,mix(.35,1,orb.disk));
    crystal.draw(context,lens,true);
  }

  function brush(x,y) {
    if(!disposed)stream.hover(x,y);
  }

  function dispose() {
    disposed=true;
    background=null;
    beaconSprites=[];
    context.setTransform(1,0,0,1,0,0);
    context.clearRect(0,0,canvas.width,canvas.height);
  }

  resize();
  return {render,resize,brush,dispose};
}

// Trace screen rays through an extended source. Along an image-plane ray
// theta, the emitting location is beta = theta * (1 - E²/|theta|²).
function createSource(ownerDocument) {
  const levels=2048, limit=5.0;
  const colors=new Uint32Array(levels);
  for(let i=0;i<levels;i++) {
    const dist2=i*limit*limit/(levels-1);
    const red=clamp(1.04*Math.exp(-2.9*dist2)+.25*Math.exp(-.66*dist2)+.033*Math.exp(-.15*dist2));
    const green=clamp(1.08*Math.exp(-2.3*dist2)+.37*Math.exp(-.63*dist2)+.066*Math.exp(-.15*dist2));
    const blue=clamp(1.18*Math.exp(-1.8*dist2)+.51*Math.exp(-.52*dist2)+.15*Math.exp(-.16*dist2));
    const alpha=Math.max(red,green,blue);
    if(alpha<.002)continue;
    colors[i]=Math.round(255*red/alpha)|(Math.round(255*green/alpha)<<8)|
      (Math.round(255*blue/alpha)<<16)|(Math.round(255*alpha)<<24);
  }
  const patches=[{},{}].map(()=>{
    const image=ownerDocument.createElement('canvas');
    return {image,ctx:image.getContext('2d'),pixels:null,packed:null};
  });
  return (context,lens,pixelRatio)=>{
    const {cx,cy,sourceX,sourceY,sourceSize,einstein}=lens;
    const dx=sourceX-cx,dy=sourceY-cy;
    const distance=Math.hypot(dx,dy), axis=Math.atan2(dy,dx);
    const squaredE=einstein*einstein, outerLight=sourceSize*limit;
    const imageRadius=beta=>(beta+Math.hypot(beta,2*einstein))*.5;
    const outside=imageRadius(distance+outerLight);
    const samples=Math.min(1.5,pixelRatio);
    const gain=(levels-1)/(outerLight*outerLight);
    // Tight bounds for the two opposing patches when the source misses the
    // axis. During alignment they merge continuously into an annulus.
    context.save();
    context.globalCompositeOperation='lighter';
    context.translate(cx,cy);
    context.rotate(axis);
    function paint(patch,left,right,halfHeight) {
      if(!patch.ctx)return;
      const x0=Math.floor(left*samples)-1,y0=-Math.ceil(halfHeight*samples)-1;
      const w=Math.ceil(right*samples)-x0+1, h=-2*y0;
      if(!patch.pixels || w>patch.image.width || h>patch.image.height) {
        patch.image.width=Math.max(patch.pixels ? patch.image.width : 1,Math.ceil(w/32)*32);
        patch.image.height=Math.max(patch.pixels ? patch.image.height : 1,Math.ceil(h/32)*32);
        patch.pixels=patch.ctx.createImageData(patch.image.width,patch.image.height);
        patch.packed=new Uint32Array(patch.pixels.data.buffer);
      }
      const stride=patch.image.width, data=patch.packed;
      // The extended source is symmetric about the projected transit axis.
      for(let y=0;y<h/2;y++) {
        const py=(y0+y+.5)/samples,py2=py*py;
        const row=y*stride, reflected=(h-1-y)*stride;
        for(let x=0;x<w;x++) {
          const px=(x0+x+.5)/samples;
          const factor=1-squaredE/(px*px+py2);
          const hx=px*factor-distance;
          const value=(hx*hx+py2*factor*factor)*gain;
          const color=value<levels ? colors[value|0] : 0;
          data[row+x]=data[reflected+x]=color;
        }
      }
      patch.ctx.putImageData(patch.pixels,0,0,0,0,w,h);
      context.drawImage(patch.image,0,0,w,h,x0/samples,y0/samples,w/samples,h/samples);
    }
    if(distance<=outerLight)paint(patches[0],-outside,outside,outside);
    else {
      const inside=imageRadius(distance-outerLight);
      const sin=outerLight/distance,cos=Math.sqrt(1-sin*sin);
      paint(patches[0],inside*cos,outside,outside*sin);
      paint(patches[1],-squaredE/inside,-squaredE/outside*cos,squaredE/inside*sin);
    }
    context.restore();

    const sparkle=clamp((distance/einstein-.39)/1.1);
    if(sparkle<=.001)return;
    context.save();
    context.globalCompositeOperation='lighter';
    for(const image of lensImages(lens)) {
      const radius=sourceSize*clamp(Math.sqrt(image.magnification),0,1.4);
      if(radius<.4)continue;
      context.save();context.translate(image.x,image.y);context.rotate(-.13);
      for(let i=0;i<4;i++) {
        const length=radius*(i%2 ? 2.5 : 3.9);
        const g=context.createLinearGradient(0,0,length,0);
        g.addColorStop(0,'rgba(233,249,255,'+.80*sparkle+')');
        g.addColorStop(.29,'rgba(146,198,255,'+.28*sparkle+')');
        g.addColorStop(1,'rgba(111,171,255,0)');
        context.fillStyle=g;
        context.beginPath();context.moveTo(0,-.5);context.lineTo(length,0);
        context.lineTo(0,.5);context.closePath();context.fill();
        context.rotate(Math.PI/2);
      }
      context.restore();
    }
    context.restore();
  };
}

// The direct image is an inclined sheet. Its far-side, strongly bent image
// uses the same orbiting gas texture compressed around the spherical shadow.
function createAccretionDisk(ownerDocument) {
  const scale=72, baseTilt=.32, inner=.66, outer=2.78, rows=64, angles=512;
  const streams=5, channels=new Uint8Array(rows), overlap=new Float32Array(rows);
  const clockOffsets=new Uint16Array(streams), speeds=new Float32Array(streams);
  const flow=new Float32Array(rows*angles), palette=new Uint32Array(rows*256);
  const clampStep=(a,b,x)=>{const s=clamp((x-a)/(b-a));return s*s*(3-2*s);};
  for(let s=0;s<streams;s++) {
    const orbit=mix(inner,outer,s/(streams-1));
    speeds[s]=2.65/(orbit*Math.sqrt(orbit));
  }
  for(let row=0;row<rows;row++) {
    const u=row/(rows-1), r=mix(inner,outer,u), log=Math.log(r);
    const channel=u*(streams-1);
    channels[row]=Math.min(streams-2,Math.floor(channel));
    overlap[row]=clampStep(0,1,channel-channels[row]);
    const extent=clampStep(.66,.83,r)*Math.exp(-.80*Math.max(0,r-.97))*
      (1-clampStep(2.02,outer,r));
    for(let i=0;i<angles;i++) {
      const a=i*TAU/angles;
      const phase=a+2.05*log+.41*Math.sin(a+1.9*r);
      const arm=.62*((1+Math.cos(phase))*.5)**12+.35*((1-Math.cos(phase+.3))*.5)**17;
      let clouds=0;
      for(const [orbit,lead,width,gain] of [[.94,-.65,.15,1.5],[1.35,-2.25,.19,2.1],[1.96,.55,.23,1.8],[1.62,2.7,.15,.92]]) {
        const local=a-lead, radial=(r-orbit-.065*Math.sin(local))/width;
        clouds+=gain*Math.exp(-radial*radial-(1-Math.cos(local))*13);
        clouds+=gain*.33*Math.exp(-((radial-.55)**2)-(1-Math.cos(local+.44))*5.2);
      }
      const bands=r*53+2.1*Math.sin(phase*2+r)+2.6*Math.sin(a-2.6*r);
      const filament=.68+.24*Math.sin(bands)+.13*Math.sin(bands*2.3+6*Math.cos(a));
      const innerLine=Math.exp(-Math.abs(r-.83)/.11)*.46;
      flow[row*angles+i]=extent*((.19+arm)*filament+clouds*(.7+.36*filament)+innerLine);
    }
    for(let j=0;j<256;j++) {
      const e=j*2.75/255;
      const heat=clamp(.48+.43/(r*r)-.17*r+.22*e);
      const glow=Math.max(0,e-.47)*heat*heat;
      const red=1-Math.exp(-(e*(.80+.36*heat)+.48*glow)*1.38);
      const green=1-Math.exp(-(e*(.20+.42*heat)+.71*glow)*1.28);
      const blue=1-Math.exp(-(e*(.073+.19*heat)+.85*glow)*1.12);
      const alpha=clamp(Math.max(red,green,blue)*1.15);
      if(alpha<=0)continue;
      palette[row*256+j]=Math.round(red*255/alpha) | (Math.round(255*green/alpha)<<8) |
        (Math.round(255*blue/alpha)<<16) | (Math.round(255*alpha)<<24);
    }
  }

  // Positions and Doppler factors depend only on viewing geometry. Use
  // integer lookups for each frame's rotating, radially sheared emission.
  function sheet(extentX,extentY,direct) {
    const canvas=ownerDocument.createElement('canvas');
    const w=Math.ceil(extentX*scale)*2, h=Math.ceil(extentY*scale)*2;
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    if(!ctx)return null;
    const pixels=ctx.createImageData(w,h), rgba=new Uint32Array(pixels.data.buffer);
    const indexes=[],radial=[],azimuth=[],brightness=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const px=(x+.5-w*.5)/scale,py=-(y+.5-h*.5)/scale;
      let r,phi,gain=1;
      if(direct) {
        const deep=py/baseTilt;
        r=Math.hypot(px,deep);phi=Math.atan2(deep,px);
      } else if(py>=0) {
        const offset=Math.hypot(px*.965,(py+.018)*1.025)-.547;
        if(offset<=0||offset>.395)continue;
        r=.66+3.2*offset+6.6*offset*offset;
        phi=Math.atan2(py,px);
        gain=.83*clampStep(.02,.58,Math.sin(phi));
      } else {
        const offset=Math.hypot(px*.975,(py-.012)*1.12)-.548;
        if(offset<=0||offset>.19)continue;
        r=.68+6.4*offset+22*offset*offset;
        phi=Math.atan2(-py,px);
        gain=.23*clampStep(.12,.86,Math.sin(phi));
      }
      if(r<inner||r>outer||gain<=.001)continue;
      indexes.push(y*w+x);
      radial.push(Math.round((r-inner)/(outer-inner)*(rows-1)));
      azimuth.push(Math.floor(phi*angles/TAU)&(angles-1));
      brightness.push(gain/(1+.24*Math.cos(phi)/Math.sqrt(r))**2);
    }
    const ids=Uint32Array.from(indexes), rs=Uint8Array.from(radial);
    const aa=Uint16Array.from(azimuth), gs=Float32Array.from(brightness);
    return {canvas,w,h,update() {
      for(let i=0;i<ids.length;i++) {
        const row=rs[i], a=aa[i], stream=channels[row], start=row*angles;
        const lead=flow[start+((a-clockOffsets[stream])&(angles-1))];
        const trail=flow[start+((a-clockOffsets[stream+1])&(angles-1))];
        const j=clamp(Math.round(mix(lead,trail,overlap[row])*gs[i]*(255/2.75)),0,255);
        rgba[ids[i]]=palette[row*256+j];
      }
      ctx.putImageData(pixels,0,0);
    }};
  }
  const direct=sheet(outer+.03,(outer+.03)*baseTilt,true);
  const bent=sheet(1,1,false);
  let previousFrame=-1;
  return (ctx,lens,time,brightness)=>{
    const {cx,cy,radius,angle,inclination}=lens;
    const unit=radius/.515, sc=unit/scale;
    const frame=Math.floor(time*30);
    if(frame!==previousFrame) {
      for(let i=0;i<streams;i++)clockOffsets[i]=Math.floor(time*speeds[i]*angles/TAU)&(angles-1);
      direct?.update();bent?.update();previousFrame=frame;
    }
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(angle);
    ctx.globalAlpha=brightness;
    ctx.save();
    ctx.scale(1,inclination*.82);
    const width=unit*2.78;
    const haze=ctx.createRadialGradient(0,0,radius*.15,0,0,width);
    haze.addColorStop(0,'rgba(202,83,37,.12)');
    haze.addColorStop(.41,'rgba(170,65,25,.08)');
    haze.addColorStop(.72,'rgba(125,54,26,.031)');
    haze.addColorStop(1,'rgba(129,52,24,0)');
    ctx.fillStyle=haze;ctx.fillRect(-width,-width,width*2,width*2);
    ctx.restore();
    const shift=.025*unit;
    const nearScale=sc*inclination/baseTilt;
    if(direct) {
      const {canvas,w,h}=direct;
      ctx.globalCompositeOperation='screen';
      ctx.drawImage(canvas,0,0,w,h/2,-w*sc/2,shift-h*nearScale/2,w*sc,h*nearScale/2);
      ctx.globalCompositeOperation='source-over';
    }
    // A black occulting body remains round as the surrounding sheet inclines.
    ctx.globalAlpha=1;
    const rim=ctx.createRadialGradient(0,0,0,0,0,radius*1.20);
    rim.addColorStop(0,'#010205');
    rim.addColorStop(.829,'#010205');
    rim.addColorStop(.840,'rgba(101,72,54,.88)');
    rim.addColorStop(.854,'rgba(201,159,117,.64)');
    rim.addColorStop(.865,'rgba(172,101,55,.28)');
    rim.addColorStop(.907,'rgba(164,76,33,.08)');
    rim.addColorStop(1,'rgba(145,65,28,0)');
    ctx.fillStyle=rim;
    ctx.beginPath();ctx.arc(0,0,radius*1.20,0,TAU);ctx.fill();
    if(bent) {
      const {canvas,w,h}=bent;
      ctx.globalAlpha=brightness;
      ctx.globalCompositeOperation='screen';
      ctx.drawImage(canvas,-w*sc/2,-h*sc/2,w*sc,h*sc);
      ctx.globalCompositeOperation='source-over';
    }
    if(direct) {
      const {canvas,w,h}=direct;
      ctx.globalAlpha=.80*brightness;
      ctx.drawImage(canvas,0,h/2,w,h/2,-w*sc/2,shift,w*sc,h*nearScale/2);
    }
    ctx.restore();
  };
}
