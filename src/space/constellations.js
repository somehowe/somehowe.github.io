import { sampleLens } from './lens.js';

const clamp = (value, min, max) => Math.min(max,Math.max(min,value));
const smooth = value => { const t=clamp(value,0,1); return t*t*(3-2*t); };
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const colors = ['186,220,255','209,225,255','155,206,250','226,237,255'];

function noise(col,row,channel) {
  let n=Math.imul(col+1619,374761393)^Math.imul(row+31337,668265263)^Math.imul(channel+17,1274126177);
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}

export function createConstellations(canvas) {
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return null;
  let width=0,height=0,requestedRatio=1,spacing=43,clock=0;
  let lens,cursor,active,traveled=0,painted=false,disposed=false;
  const fading=[];

  // Each cell holds a repeatable catalogue star. A gesture samples only its
  // local neighbourhood, so an otherwise empty corner of the sky still works.
  function star(col,row) {
    return {
      col,row,x:(col+.14+.72*noise(col,row,0))*spacing,y:(row+.14+.72*noise(col,row,1))*spacing,
      magnitude:noise(col,row,2),tint:colors[Math.floor(noise(col,row,3)*colors.length)]
    };
  }
  function crossesHorizon(a,b) {
    const dx=b.x-a.x,dy=b.y-a.y,sq=dx*dx+dy*dy;
    const t=sq?clamp(((lens.cx-a.x)*dx+(lens.cy-a.y)*dy)/sq,0,1):0;
    return Math.hypot(a.x+t*dx-lens.cx,a.y+t*dy-lens.cy)<lens.radius*1.43+4;
  }
  function nearest(point,from,group,direction,reach=1.04) {
    const col=Math.floor(point.x/spacing),row=Math.floor(point.y/spacing);
    let best,bestScore=Infinity;
    for(let j=row-1;j<=row+1;j++)for(let i=col-1;i<=col+1;i++){
      const candidate=star(i,j),d=distance(point,candidate)/spacing;
      if(d>reach || candidate.x<3 || candidate.y<3 || candidate.x>width-3 || candidate.y>height-3)continue;
      if(crossesHorizon(from??point,candidate))continue;
      if(group?.nodes.some(node=>node.col===i && node.row===j))continue;
      let score=d-.10*candidate.magnitude;
      if(from){
        const dx=candidate.x-from.x,dy=candidate.y-from.y;
        const length=Math.hypot(dx,dy);
        if(length<spacing*.47 || length>spacing*1.91)continue;
        const advance=(dx*direction.x+dy*direction.y)/length;
        if(advance<-.15)continue;
        score+=.11*(1-advance)+.12*Math.abs(length/spacing-1);
      }
      if(score<bestScore){bestScore=score;best=candidate;}
    }
    return best;
  }
  function finish(duration=.87) {
    if(active) {
      // A release just after the chain rolls over must let the previous trace
      // die out at its current brightness rather than removing it in one frame.
      for(const old of fading){
        const remaining=opacity(old),end=old.closed+old.fade;
        old.remaining=remaining;
        old.closed=clock;
        old.fade=clamp(end-clock,.01,.45);
      }
      active.remaining=opacity(active);
      active.closed=clock;
      active.fade=duration;
      fading.push(active);
      if(fading.length>2)fading.shift();
      active=null;
    }
  }
  function begin(point) {
    const first=nearest(point,null,null,null,1.45);
    if(!first)return;
    first.born=clock;
    active={nodes:[first],edges:[],head:first,steps:1,latest:clock,lastPick:point};
  }
  function link(group,from,node,branch=false) {
    node.born=clock;
    const duration=.10+.085*distance(from,node)/spacing;
    group.edges.push({from,to:node,start:clock,duration,branch});
    group.nodes.push(node);
  }
  function extend(point,direction) {
    if(!active){begin(point);return;}
    if(distance(point,active.lastPick)<spacing*.48)return;
    if(active.steps>=7){
      finish();
      begin(point);
      return;
    }
    const head=active.head;
    const next=nearest(point,head,active,direction);
    if(!next){
      if(distance(point,head)>spacing*2.1){finish();begin(point);}
      return;
    }
    link(active,head,next);
    active.head=next;
    active.lastPick=point;
    active.latest=clock;
    active.steps++;
    // A short offshoot gives a drawn asterism its shape without turning it
    // into a mesh. The catalogue chooses a fixed side for this constellation.
    if(active.steps===4){
      const sign=active.nodes[0].magnitude>.5?1:-1;
      const normal={x:-direction.y*sign,y:direction.x*sign};
      const target={x:head.x+spacing*.92*normal.x,y:head.y+spacing*.92*normal.y};
      const spur=nearest(target,head,active,normal,.69);
      if(spur)link(active,head,spur,true);
    }
  }
  function leave() {
    // Keep the most recent chain in its own slot while the cursor is away, so
    // lifting a finger cannot evict a still-visible earlier chain.
    if(active && active.closed===undefined){
      active.remaining=opacity(active);
      active.closed=clock;
      active.fade=1.25;
    }
    cursor=null;
    traveled=0;
  }
  function trace(x,y) {
    if(disposed || !lens || !Number.isFinite(x) || !Number.isFinite(y))return;
    const point={x,y};
    if(x<0 || x>width || y<0 || y>height || crossesHorizon(point,point)){
      leave();
      return;
    }
    const length=cursor?distance(cursor,point):0;
    if(!cursor || length>spacing*3.65 || crossesHorizon(cursor,point) || (active && clock-active.latest>1.85)){
      finish(.65);
      begin(point);
      cursor=point;
      traveled=0;
      return;
    }
    if(length<.6)return;
    const direction={x:(x-cursor.x)/length,y:(y-cursor.y)/length};
    const step=spacing*.71;
    for(let along=step-traveled;along<=length;along+=step){
      extend({x:cursor.x+direction.x*along,y:cursor.y+direction.y*along},direction);
    }
    traveled=(traveled+length)%step;
    cursor=point;
  }
  function clear() {
    active=cursor=null;
    fading.length=0;
    traveled=0;
    if(painted)ctx.clearRect(0,0,width,height);
    painted=false;
  }
  function resize(w,h,dpr=requestedRatio) {
    if(disposed || !Number.isFinite(w) || !Number.isFinite(h) || !(w>0 && h>0))return;
    const nextRatio=Number.isFinite(dpr)&&dpr>0?dpr:1;
    if(w===width && h===height && nextRatio===requestedRatio)return;
    clear();
    width=w;height=h;requestedRatio=nextRatio;
    const ratio=Math.min(nextRatio,2,Math.sqrt(3000000/(w*h)));
    canvas.width=Math.max(1,Math.floor(w*ratio));
    canvas.height=Math.max(1,Math.floor(h*ratio));
    ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
    spacing=clamp(Math.min(w,h)*.071,30,47);
    lens=sampleLens(w,h);
  }
  function segment(a,b,thickness,color,alpha) {
    ctx.lineWidth=thickness;
    ctx.strokeStyle=color;
    ctx.globalAlpha=alpha;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  function drawStar(node,strength) {
    const r=.85+node.magnitude*.79;
    const halo=ctx.createRadialGradient(node.x,node.y,0,node.x,node.y,r*4.9);
    halo.addColorStop(0,'rgba('+node.tint+',.43)');
    halo.addColorStop(.27,'rgba('+node.tint+',.18)');
    halo.addColorStop(1,'rgba('+node.tint+',0)');
    ctx.globalAlpha=strength;
    ctx.fillStyle=halo;
    ctx.fillRect(node.x-r*5,node.y-r*5,r*10,r*10);
    ctx.fillStyle='rgb('+node.tint+')';
    ctx.beginPath();ctx.arc(node.x,node.y,r,0,Math.PI*2);ctx.fill();
    if(node.magnitude>.73){
      const s=r*2.65;
      ctx.globalAlpha=strength*.62;
      ctx.beginPath();
      ctx.moveTo(node.x,node.y-s);
      ctx.lineTo(node.x+r*.30,node.y-r*.23);ctx.lineTo(node.x+s*.77,node.y);
      ctx.lineTo(node.x+r*.30,node.y+r*.23);ctx.lineTo(node.x,node.y+s);
      ctx.lineTo(node.x-r*.30,node.y+r*.23);ctx.lineTo(node.x-s*.77,node.y);
      ctx.lineTo(node.x-r*.30,node.y-r*.23);ctx.closePath();ctx.fill();
    }
    ctx.globalAlpha=strength*.92;
    ctx.fillStyle='#f1f7ff';
    ctx.beginPath();ctx.arc(node.x,node.y,r*.49,0,Math.PI*2);ctx.fill();
  }
  function opacity(group) {
    if(!group)return 0;
    if(group.closed!==undefined)return group.remaining*(1-smooth((clock-group.closed)/group.fade));
    return 1-smooth((clock-group.latest-.65)/1.35);
  }
  function drawGroup(group,alpha,still) {
    for(const edge of group.edges){
      const t=still?1:smooth((clock-edge.start)/edge.duration);
      if(t<=0)continue;
      const {from,to}=edge;
      const head={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t};
      const strength=alpha*(edge.branch?.70:1);
      segment(from,head,2.45,'#719dce',strength*.105);
      segment(from,head,.83,'#bedbff',strength*.63);
      if(t<1){
        ctx.globalAlpha=strength*.70;
        ctx.fillStyle='#e6f5ff';
        ctx.beginPath();ctx.arc(head.x,head.y,1.05,0,Math.PI*2);ctx.fill();
      }
    }
    for(const node of group.nodes){
      const age=clock-node.born;
      const reveal=still?1:.22+.78*smooth(age/.21);
      drawStar(node,alpha*reveal*(.78+.22*node.magnitude));
    }
  }
  function render(frame={},w=width,h=height) {
    if(disposed)return;
    if(w!==width || h!==height)resize(w,h);
    if(!lens)return;
    const nextClock=Number.isFinite(frame.time)?frame.time:clock;
    if(nextClock<clock)clear();
    clock=nextClock;
    const activeAlpha=opacity(active);
    for(let i=fading.length-1;i>=0;i--)if(!opacity(fading[i]))fading.splice(i,1);
    if(!activeAlpha)active=null;
    if(!painted && !fading.length && !active)return;
    ctx.clearRect(0,0,width,height);
    painted=Boolean(fading.length||active);
    if(!painted)return;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.lineCap='round';
    for(const group of fading)drawGroup(group,opacity(group),frame.reduceMotion);
    if(active)drawGroup(active,activeAlpha,frame.reduceMotion);
    ctx.restore();
  }
  function dispose(){clear();disposed=true;}
  return {resize,trace,leave,render,clear,dispose};
}
