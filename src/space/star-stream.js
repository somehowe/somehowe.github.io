const TAU = Math.PI * 2;
const count = 1152;
const clamp01 = x => Math.max(0,Math.min(1,x));
const smooth = x => { const t = clamp01(x); return t*t*(3-2*t); };

// Height of the unlensed stream, in CSS pixels. Its primary image is what the
// visitor sees; ray-trace the pointer back to this curve to find the brush.
function trackHeight(u,width,height) {
  const wide = smooth(width/height-.58);
  return height*(.514+.032*wide-(.339+.045*wide)*u-.064*Math.sin(Math.PI*u)+.017*Math.sin(TAU*u+.36));
}

export function sampleBrush(lens,px,py,width,height) {
  const dx=px-lens.cx, dy=py-lens.cy;
  const distance2=dx*dx+dy*dy;
  if (distance2 < lens.radius*lens.radius) return {x:0,y:0,weight:0};
  const inverse=1-lens.einstein*lens.einstein/distance2;
  const sx=lens.cx+dx*inverse, sy=lens.cy+dy*inverse;
  const gap=Math.abs(sy-trackHeight(sx/width,width,height));
  const aroundStream=1-smooth(gap/Math.max(42,Math.min(100,height*.14)));
  const fromStarX=lens.sourceX-sx, fromStarY=lens.sourceY-sy;
  const fromStar=Math.hypot(fromStarX,fromStarY);
  const aroundStar=1-smooth(fromStar/(lens.einstein*.92));
  const weight=Math.max(aroundStar,aroundStream*(.35+.65*Math.exp(-fromStar/(3*lens.einstein))));
  const reach=Math.min(45,.44*lens.einstein)*weight;
  const divisor=Math.max(fromStar,lens.sourceSize);
  return {x:reach*fromStarX/divisor, y:reach*fromStarY/divisor, weight};
}

function makeCatalogue(appearance) {
  let state = 387421;
  const random = () => {
    state = (Math.imul(state,1664525)+1013904223) >>> 0;
    return state/4294967296;
  };
  const bell = () => random()+random()+random()+random()-2;
  const knots = [.13,.29,.47,.69,.84];
  const stars = [];
  for (let i=0; i<count; i++) {
    const longitude = random()<.33 ? knots[i%knots.length]+bell()*.057 : random();
    const lane = random();
    const branch = lane<.21 ? 1 : lane<.31 ? -1 : 0;
    const phase = random()*TAU;
    const bright = random()<.022;
    const size = bright ? 2.8+random()*1.4 : .8+1.8*random()**2.7;
    const shade = random();
    const temperature = shade<.72 ? random()*.52 : .5+random()*.45;
    appearance.set([size,temperature,.47+size*.13+random()*.20,bright ? .42+.55*random() : 0],4*i);
    stars.push({
      longitude, branch, phase,
      crossTrack:bell()*(lane>.87 ? 1.85 : lane<.54 ? .48 : .93),
      speed:3.8+random()*4.3, affinity:.69+random()*.31,
      fallbackX:Math.cos(phase), fallbackY:Math.sin(phase),
      x:0,y:0,vx:0,vy:0
    });
  }
  return stars;
}

// The same moving catalogue supplies both graphics backends. Positions are
// normalized for projection, while the brush, star speeds and springs use CSS
// pixels so they feel equally light on a phone and a large display.
export function createStarStream() {
  const positions = new Float32Array(count*3);
  const appearance = new Float32Array(count*4);
  const stars = makeCatalogue(appearance);
  let pointerX, pointerY, lastX, lastY;
  let previousTime;

  function hover(x,y) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pointerX=x;
      pointerY=y;
    } else {
      pointerX=pointerY=lastX=lastY=undefined;
    }
  }

  function update(frame,width,height,lens) {
    if (!(width>0 && height>0)) return;
    const {time:clock=0,reduceMotion=false} = frame;
    const jump = previousTime !== undefined && (clock<previousTime || clock-previousTime>1);
    const dt = Math.max(0,Math.min(.10,clock-(previousTime ?? clock)));
    previousTime=clock;
    const visible = Math.round(count*Math.min(1,Math.max(.43,width*height/900000)));
    const spread = Math.min(41,Math.max(20,Math.min(width,height)*.048));
    const radius = Math.min(118,Math.max(65,Math.min(width,height)*.137));
    const strength = Math.min(32,Math.max(19,radius*.27));
    const active = !reduceMotion && pointerX!==undefined;
    const cx=(1+(pointerX ?? 0))*width*.5, cy=(1-(pointerY ?? 0))*height*.5;
    let fromX=(1+(lastX ?? pointerX ?? 0))*width*.5;
    let fromY=(1-(lastY ?? pointerY ?? 0))*height*.5;
    // Re-entry and window changes start a fresh brush stroke.
    if (jump || Math.hypot(cx-fromX,cy-fromY)>radius*3) { fromX=cx; fromY=cy; }
    const dx=cx-fromX, dy=cy-fromY, length2=dx*dx+dy*dy;
    const swept=Math.sqrt(length2);
    const reach=radius+swept;
    const spring=13, decay=Math.exp(-spring*dt);

    for (let i=0; i<count; i++) {
      const star=stars[i], index=i*3;
      if (i>=visible) {
        positions[index+2]=0;
        star.x=star.y=star.vx=star.vy=0;
        continue;
      }
      const travel=star.longitude+clock*star.speed/(width*1.22);
      const u=(travel-Math.floor(travel))*1.22-.11;
      const arch=Math.sin(Math.PI*u);
      // A dense tilted spine with two looser wisps that open and rejoin.
      const branch=star.branch*(.25+arch*arch)*spread*1.13;
      const cross=star.crossTrack*spread*(.83+.27*Math.cos(TAU*u*1.7-.4));
      let x=u*width;
      let y=trackHeight(u,width,height)+cross+branch+2.4*Math.sin(star.phase+clock*.085);
      const edge=smooth(Math.min(x,width-x)/17);
      let alpha=edge*(.91+.09*Math.sin(star.phase+clock*.59));
      let goalX=0, goalY=0;

      if (lens) {
        const ox=x-lens.cx, oy=y-lens.cy;
        const offset=Math.hypot(ox,oy);
        // Positive-parity solution of beta = theta - theta_E^2 / theta.
        // Keep these tiny field stars secondary to the resolved transit star.
        const imageRadius=(offset+Math.hypot(offset,2*lens.einstein))*.5;
        const scale=imageRadius/Math.max(.001,offset);
        x=lens.cx+ox*scale;
        y=lens.cy+oy*scale;
        alpha*=.43+.57*smooth(offset/(2.7*lens.einstein));
      }
      if (jump) star.x=star.y=star.vx=star.vy=0;
      if (active && Math.abs(x-cx)<reach && Math.abs(y-cy)<reach) {
        // Use the path since the last paint, so a fast mouse still catches
        // the stars between its two reported locations.
        const along=length2>0 ? clamp01(((x-fromX)*dx+(y-fromY)*dy)/length2) : 1;
        const ax=x-(fromX+dx*along), ay=y-(fromY+dy*along);
        const distance=Math.hypot(ax,ay);
        if (distance<radius) {
          const pressure=(1-smooth(distance/radius))*star.affinity;
          const nx=distance>.01 ? ax/distance : star.fallbackX;
          const ny=distance>.01 ? ay/distance : star.fallbackY;
          goalX=pressure*strength*nx;
          goalY=pressure*strength*ny;
          if (swept>.01) {
            const kick=pressure*Math.min(36,swept)*2.0;
            star.vx+=kick*(nx*.70+dx/swept*.55);
            star.vy+=kick*(ny*.70+dy/swept*.55);
          }
          alpha*=1+.09*pressure;
        }
      }
      // Exact critically damped step. A held cursor opens a small gap. On
      // departure each star settles into its own moving lane without jitter.
      if (goalX || goalY || star.x || star.y || star.vx || star.vy) {
        const ex=star.x-goalX, ey=star.y-goalY;
        const vx=star.vx+spring*ex, vy=star.vy+spring*ey;
        star.x=goalX+(ex+vx*dt)*decay;
        star.y=goalY+(ey+vy*dt)*decay;
        star.vx=(star.vx-spring*vx*dt)*decay;
        star.vy=(star.vy-spring*vy*dt)*decay;
        if (!goalX && !goalY && Math.abs(star.x)+Math.abs(star.y)+Math.abs(star.vx)+Math.abs(star.vy)<.008) {
          star.x=star.y=star.vx=star.vy=0;
        }
      }
      x+=star.x;
      y+=star.y;

      positions[index]=2*x/width-1;
      positions[index+1]=1-2*y/height;
      positions[index+2]=Math.min(1,alpha);
    }
    lastX=active ? pointerX : undefined;
    lastY=active ? pointerY : undefined;
  }

  return {count,positions,appearance,update,hover};
}
