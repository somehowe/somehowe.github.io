import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {sampleLens,stillTime} from '../src/space/lens.js';
import {dustOnlyAge} from '../src/space/orb.js';

const [html,css,bundle]=await Promise.all([
  readFile('src/space/index.html','utf8'),
  readFile('src/space/style.css','utf8'),
  build({
    entryPoints:['src/space/main.js'],bundle:true,format:'iife',write:false,loader:{'.css':'empty'},
    plugins:[{
      name:'record-landing-frames',
      setup(build) {
        build.onResolve({filter:/^\.\/(renderer|fallback|constellations)\.js$/},({path})=>({path,namespace:'test-scene'}));
        build.onLoad({filter:/.*/,namespace:'test-scene'},({path})=>({
          contents:path.includes('constellations') ? 'export const createConstellations=canvas=>window.openTrail(canvas);' : path.includes('renderer')
            ? 'export const createRenderer=canvas=>window.openScene("webgl",canvas);'
            : 'export const createFallback=canvas=>window.openScene("canvas",canvas);'
        }));
      }
    }]
  })
]);

function page(t,{canvas=true,webgl=true,reduced=false}={}) {
  const {window}=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>window.close());
  const doc=window.document;
  const style=doc.createElement('style');
  style.textContent=css;
  doc.head.append(style);
  const sky=doc.querySelector('#sky');
  sky.getBoundingClientRect=()=>({left:20,top:30,width:800,height:600});
  const preference=new window.EventTarget();
  preference.matches=reduced;
  window.matchMedia=()=>preference;
  const queue=new Map();
  let id=0;
  window.requestAnimationFrame=cb=>{queue.set(++id,cb);return id;};
  window.cancelAnimationFrame=key=>queue.delete(key);
  const scenes=[];
  const traces=[];
  window.openTrail=()=>({
    trace(x,y){traces.push([Math.round(x),Math.round(y)]);}, leave(){traces.push('leave');},
    clear(){traces.push('clear');}, render(){}, resize(){}, dispose(){}
  });
  window.openScene=(kind,element)=>{
    if(kind==='webgl'&&!webgl) throw Error('WebGL unavailable');
    if(kind==='canvas'&&!canvas) return null;
    const scene={
      kind,element,frames:[],brushes:[],disposed:false,
      render(frame){this.frames.push({...frame});},
      resize(){},
      brush(...xy){this.brushes.push(xy);},
      dispose(){this.disposed=true;}
    };
    scenes.push(scene);
    return scene;
  };
  return {
    doc,window,sky,scenes,queue,preference,traces,
    async start() {window.eval(bundle.outputFiles[0].text);await new Promise(resolve=>setImmediate(resolve));},
    tick(timestamp){
      const pending=[...queue.values()];
      queue.clear();
      for(const cb of pending) cb(timestamp);
    },
    key(key){
      const event=new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});
      sky.dispatchEvent(event);
      assert.equal(event.defaultPrevented,true);
    },
    point(type,x,y,target=sky,pointerType='mouse'){
      target.dispatchEvent(new window.PointerEvent(type,{
        pointerId:1,pointerType,isPrimary:true,button:0,bubbles:true,clientX:x+20,clientY:y+30
      }));
    }
  };
}

function checkContacts({doc,window}) {
  const contact=doc.querySelector('#contact');
  assert.equal(contact.querySelector('h1').textContent.trim(),'Ryan Howe');
  assert.notEqual(window.getComputedStyle(contact).display,'none');
  assert.equal(window.getComputedStyle(contact).visibility,'visible');
  const links=[...contact.querySelectorAll('nav a')];
  assert.deepEqual(links.map(a=>[a.textContent.trim(),a.href]),[
    ['GitHub','https://github.com/somehowe'],
    ['LinkedIn','https://www.linkedin.com/in/ryan-howe-b8230034b/'],
    ['Email','mailto:r3howe@uwaterloo.ca']
  ]);
  for(const link of links) {
    assert.equal(window.getComputedStyle(link).pointerEvents,'auto');
    link.focus();
    assert.equal(doc.activeElement,link);
  }
}

test('contact links and responsive still are usable before scripts and with no canvas support', async t=>{
  const ui=page(t,{canvas:false,webgl:false});
  const {doc,window}=ui;
  const still=doc.querySelector('#still');
  const tools=doc.querySelector('#scene-tools');
  checkContacts(ui);
  assert.equal(window.getComputedStyle(still).visibility,'visible');
  assert.ok(still.querySelector('source[media][srcset]'));
  assert.ok(still.querySelector('img[src]'));
  assert.equal(tools.hidden,true);
  assert.equal(doc.querySelector('#orb-target').hidden,true);
  await ui.start();
  assert.equal(ui.scenes.length,0);
  assert.equal(doc.querySelectorAll('canvas').length,1);
  assert.equal(window.getComputedStyle(still).visibility,'visible');
  assert.equal(tools.hidden,true);
  assert.equal(ui.sky.hasAttribute('tabindex'),false);
  checkContacts(ui);
});

test('orb activation turns on the fracture clock, survives context loss, and can replay', async t=>{
  const ui=page(t);
  await ui.start();
  const scene=ui.scenes.at(-1);
  const button=ui.doc.querySelector('#orb-target'), reset=ui.doc.querySelector('#reform');
  assert.equal(scene.frames.at(-1).breakAge,null);
  assert.equal(button.hidden,false);
  ui.point('pointerdown',400,216,button);
  ui.point('pointermove',470,232,button);
  ui.point('pointerup',470,232,button);
  button.dispatchEvent(new ui.window.MouseEvent('click',{detail:1,bubbles:true}));
  assert.equal(button.hidden,false,'orbiting from the orb should not break it');
  ui.point('pointerdown',400,216,button,'touch');
  ui.point('pointerup',400,216,button,'touch');
  button.dispatchEvent(new ui.window.MouseEvent('click',{detail:1,bubbles:true}));
  assert.equal(button.hidden,true);
  assert.equal(reset.hidden,false);
  ui.tick(100);ui.tick(180);
  const elapsed=scene.frames.at(-1).breakAge;
  assert.ok(elapsed>0 && elapsed<1);
  scene.element.dispatchEvent(new ui.window.Event('webglcontextlost',{cancelable:true}));
  const fallback=ui.scenes.at(-1);
  assert.equal(fallback.frames.at(-1).breakAge,elapsed);
  const pause=ui.doc.querySelector('#motion');
  pause.click();ui.tick(2000);
  assert.equal(fallback.frames.at(-1).breakAge,elapsed);
  reset.click();ui.tick(2300);
  assert.equal(fallback.frames.at(-1).breakAge,null);
  assert.equal(ui.doc.activeElement,button);
  button.click();ui.tick(2400);
  const still=fallback.frames.at(-1);
  assert.ok(still.breakAge>=dustOnlyAge,'paused activation shows only dust');
  const lens=sampleLens(800,600,{...still,yaw:0,pitch:0,brushX:0,brushY:0});
  assert.ok(Math.hypot(lens.sourceX-lens.cx,lens.sourceY-lens.cy)<1e-6);
  assert.match(ui.doc.querySelector('#orb-status').textContent,/has dissolved/);
  checkContacts(ui);
});

test('hover, pressed mouse drags, and touch swipes trace in sky coordinates', async t=>{
  const ui=page(t);
  await ui.start();
  ui.point('pointermove',130,120);
  ui.point('pointerdown',140,115);
  ui.point('pointermove',175,125);
  assert.deepEqual(ui.traces.slice(0,3),[[130,120],[140,115],[175,125]]);
  ui.point('pointerup',175,125);
  ui.point('pointerdown',250,400,ui.sky,'touch');
  ui.point('pointermove',290,430,ui.sky,'touch');
  ui.point('pointerup',290,430,ui.sky,'touch');
  assert.deepEqual(ui.traces.slice(-3),[[250,400],[290,430],'leave']);
  ui.key('Home');
  assert.equal(ui.traces.at(-1),'clear');
});

test('WebGL replaces the first canvas and context loss restores a working fallback at the same phase', async t=>{
  const ui=page(t);
  await ui.start();
  const [first,accelerated]=ui.scenes;
  assert.equal(first.kind,'canvas');
  assert.ok(first.frames.length);
  assert.equal(first.disposed,true);
  assert.equal(accelerated.element,ui.doc.querySelector('#space-stage'));
  ui.tick(100);ui.tick(175);
  const {time}=accelerated.frames.at(-1);
  assert.ok(time>0);
  const loss=new ui.window.Event('webglcontextlost',{cancelable:true});
  accelerated.element.dispatchEvent(loss);
  const restored=ui.scenes.at(-1);
  assert.equal(loss.defaultPrevented,true);
  assert.equal(accelerated.disposed,true);
  assert.equal(restored.kind,'canvas');
  assert.equal(restored.element,ui.doc.querySelector('#space-stage'));
  assert.equal(restored.frames.at(-1).time,time);
  assert.equal(ui.doc.querySelectorAll('canvas').length,1);
  assert.equal(ui.doc.querySelector('#scene-tools').hidden,false);
  ui.tick(250);
  assert.ok(restored.frames.at(-1).time>time);
  checkContacts(ui);
});

test('drag and keyboard orbit, pointer brush, pause and play work with the Canvas fallback alone', async t=>{
  const ui=page(t,{webgl:false});
  await ui.start();
  const [scene]=ui.scenes;
  const button=ui.doc.querySelector('#motion');
  assert.equal(ui.scenes.length,1);
  assert.equal(ui.sky.tabIndex,0);
  ui.tick(100);ui.tick(180);
  ui.point('pointermove',600,150);
  assert.deepEqual(scene.brushes.at(-1),[.5,.5]);
  ui.point('pointerdown',400,200);
  ui.point('pointermove',480,170);
  assert.equal(ui.sky.hasAttribute('data-dragging'),true);
  ui.tick(260);
  assert.ok(scene.frames.at(-1).yaw>0);
  assert.ok(scene.frames.at(-1).pitch>0);
  ui.point('pointerup',480,170);
  assert.equal(ui.sky.hasAttribute('data-dragging'),false);
  const beforePause=scene.frames.at(-1).time;
  button.click();
  ui.tick(10000);
  assert.equal(button.getAttribute('aria-label'),'Play animation');
  assert.equal(scene.frames.at(-1).time,beforePause);
  assert.equal(scene.frames.at(-1).reduceMotion,true);
  assert.equal(ui.queue.size,0);
  const prevYaw=scene.frames.at(-1).yaw;
  ui.sky.focus();
  ui.key('ArrowRight');ui.tick(11000);
  assert.ok(scene.frames.at(-1).yaw>prevYaw);
  ui.key('Home');ui.tick(12000);
  const reset=scene.frames.at(-1);
  assert.deepEqual([reset.yaw,reset.pitch,reset.brushX,reset.brushY],[0,0,0,0]);
  assert.equal(reset.time,beforePause);
  button.click();
  ui.tick(15000);
  assert.equal(scene.frames.at(-1).time,beforePause);
  ui.tick(15050);
  assert.ok(Math.abs(scene.frames.at(-1).time-beforePause-.05)<1e-8);
  assert.equal(button.getAttribute('aria-label'),'Pause animation');
  checkContacts(ui);
});

test('reduced motion starts on the composed still and respects a changed system preference', async t=>{
  const ui=page(t,{reduced:true});
  await ui.start();
  const scene=ui.scenes.at(-1);
  ui.tick(50);
  assert.equal(scene.frames.at(-1).time,stillTime);
  assert.equal(scene.frames.at(-1).reduceMotion,true);
  assert.equal(ui.queue.size,0);
  ui.point('pointermove',600,150);
  assert.deepEqual(scene.brushes.at(-1),[]);
  assert.deepEqual(ui.traces.at(-1),[600,150]);
  assert.equal(ui.queue.size,0,'direct tracing does not restart the sky animation');
  ui.point('pointerleave',600,150);
  assert.equal(ui.traces.at(-1),'clear');
  const button=ui.doc.querySelector('#motion');
  assert.equal(button.getAttribute('aria-label'),'Play animation');
  ui.preference.matches=false;
  ui.preference.dispatchEvent(new ui.window.Event('change'));
  ui.tick(600);ui.tick(660);
  assert.ok(scene.frames.at(-1).time>stillTime);
  const playingTime=scene.frames.at(-1).time;
  ui.preference.matches=true;
  ui.preference.dispatchEvent(new ui.window.Event('change'));
  ui.tick(900);
  assert.equal(scene.frames.at(-1).time,playingTime);
  assert.equal(scene.frames.at(-1).reduceMotion,true);
  assert.equal(ui.queue.size,0);
});
