import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('dossier.html opens the real Work listing rather than a not-found view',async t=>{
  const html=await readFile('src/reader/dossier.html','utf8');
  const bundle=await build({entryPoints:['src/reader/main.js'],bundle:true,format:'esm',write:false,loader:{'.css':'empty'},logLevel:'silent'});
  const {window}=new JSDOM(html,{url:'https://example.test/dossier.html',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>window.close());
  window.fetch=async()=>new Response(JSON.stringify({posts:[]}),{headers:{'content-type':'application/json'}});
  window.scrollTo=()=>{};
  await window.eval(`(async()=>{${bundle.outputFiles[0].text}\n})()`);
  assert.equal(window.document.querySelector('#content h1')?.textContent,'Work');
  assert.ok(window.document.querySelectorAll('.project-row').length>=5);
  assert.equal(window.document.title,'Work · Ryan Howe');
  assert.equal(window.document.querySelector('[data-nav="/work"]').getAttribute('aria-current'),'page');
});
