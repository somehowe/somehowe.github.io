import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>',{url:'https://ryan.example/writing/example'});
after(() => window.close());
for (const name of ['window','document','navigator','Node','Element','HTMLElement']) Object.defineProperty(globalThis,name,{value:name === 'window' ? window : window[name],configurable:true});
const result = await build({entryPoints:['src/reader/markdown.js'],bundle:true,platform:'browser',format:'esm',loader:{'.css':'empty'},write:false,logLevel:'silent'});
await mkdir('.build',{recursive:true});
await writeFile('.build/markdown-renderer-test.mjs',result.outputFiles[0].text);
const { renderMarkdown, binarySearchSteps, readingTime } = await import(pathToFileURL(`${process.cwd()}/.build/markdown-renderer-test.mjs`).href);
function render(source) {
  document.body.replaceChildren();
  const target = document.createElement('div'); document.body.append(target);
  return {target,...renderMarkdown(target,source)};
}

test('Markdown strips executable author HTML and unsafe URL protocols',() => {
  const {target} = render('<script>alert(1)</script><iframe src="https://bad.example"></iframe><img src="x" onerror="alert(1)" style="position:fixed"><a href="javascript:alert(1)">bad</a>\n\n[another](javascript:alert(2))\n\n[good](https://example.com)');
  assert.equal(target.querySelector('script,iframe,svg,form'),null);
  assert.equal(target.querySelector('[onerror],[style]'),null);
  assert.equal(target.querySelector('a[href^="javascript:"]'),null);
  const link = target.querySelector('a[href="https://example.com"]');
  assert.equal(link.target,'_blank'); assert.equal(link.rel,'noopener noreferrer');
});

test('Math renders with KaTeX while inline and fenced code remain literal',() => {
  const {target} = render('Inline $x^2 + y^2$ and \\(a+b\\).\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\n\\[z^2\\]\n\n`$literal$`\n\n```cpp\nconst char* expression = "$not_math$";\n```');
  assert.equal(target.querySelectorAll('.katex').length,4);
  assert.equal(target.querySelectorAll('pre .katex,code .katex').length,0);
  assert.ok(target.textContent.includes('$literal$'));
  assert.ok(target.querySelector('pre').textContent.includes('$not_math$'));
  assert.equal(target.querySelector('.code-copy').textContent,'Copy');
  assert.equal(target.querySelector('.code-header span').textContent,'cpp');
});

test('LaTeX cannot insert executable commands or trusted links',() => {
  const {target} = render('$\\href{javascript:alert(1)}{click}$');
  assert.equal(target.querySelector('a[href^="javascript:"]'),null);
  assert.equal(target.querySelector('script'),null);
});

test('Escaped dollars stay literal and multiline equation environments render',() => {
  const {target} = render('A price: \\$5, and a literal \\$variable\\$.\n\n$$\n\\begin{aligned}\nf(x) &= x^2 \\\\\nf\'(x) &= 2x\n\\end{aligned}\n$$');
  assert.equal(target.querySelectorAll('.katex').length,1);
  assert.ok(target.textContent.includes('$5'));
  assert.ok(target.textContent.includes('$variable$'));
  assert.equal(target.querySelector('.katex-error'),null);
});

test('Heading anchors are unique and footnotes link both directions',() => {
  const {target,headings} = render('## One heading\n\nA statement.[^proof]\n\n## One heading\n\n[^proof]: A **short** explanation.');
  assert.deepEqual(headings.map(h=>h.id),['one-heading','one-heading-2']);
  assert.equal(headings[0].level,2);
  const reference = target.querySelector('.footnote-ref a');
  assert.ok(reference);
  assert.ok(target.querySelector(reference.getAttribute('href')));
  assert.ok(target.querySelector('.footnotes strong'));
  assert.ok(target.querySelector('.footnote-back'));
});

test('Binary search trace finds existing targets and terminates for missing targets',() => {
  const values = [2,5,8,12,16,23,38,56,72];
  for (let target=1;target<=73;target++) {
    const steps = binarySearchSteps(values,target);
    assert.ok(steps.length<=5);
    assert.equal(steps.at(-1).done,true);
    assert.equal(steps.at(-1).found,values.includes(target));
    if (values.includes(target)) assert.equal(steps.at(-1).mid,values.indexOf(target));
    for (const step of steps) if (step.mid !== null) assert.ok(step.mid>=step.left && step.mid<=step.right);
  }
});

test('Authored demo figure is interactive and can reset to an unsuccessful search',() => {
  const {target} = render('```demo\nbinary-search\n```');
  const figure = target.querySelector('.binary-figure'); assert.ok(figure);
  const next = figure.querySelector('.binary-controls button');
  for (let i=0;i<10&&!next.disabled;i++) next.click();
  assert.ok(figure.querySelector('.binary-status').textContent.includes('Found at index'));
  assert.equal(figure.querySelectorAll('.binary-found').length,1);
  const slider = figure.querySelector('input'); slider.value='4'; slider.dispatchEvent(new window.Event('input'));
  assert.equal(next.disabled,false);
  for (let i=0;i<10&&!next.disabled;i++) next.click();
  assert.ok(figure.querySelector('.binary-status').textContent.includes('not in this array'));
  assert.equal(figure.querySelectorAll('.binary-found').length,0);
});

test('Reading time has a useful one-minute minimum',() => {
  assert.equal(readingTime(''),1);
  assert.equal(readingTime('word '.repeat(500)),3);
});
