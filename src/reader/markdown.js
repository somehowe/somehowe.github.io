import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';

for (const [name, language] of Object.entries({cpp, python, javascript, typescript, sql, bash, json})) hljs.registerLanguage(name, language);

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
let renderSerial = 0;

export function readingTime(source = '') {
  return Math.max(1, Math.ceil(String(source).trim().split(/\s+/).filter(Boolean).length / 220));
}

/** Pure search trace, also useful for a different target in an authored figure. */
export function binarySearchSteps(values, target) {
  const steps = [];
  let left = 0, right = values.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const found = values[mid] === target;
    steps.push({left, right, mid, found, value:values[mid], done:found,
      description:found ? `${values[mid]} equals the target. Found at index ${mid}.` : values[mid] < target ? `${values[mid]} is smaller than ${target}. Keep the right half.` : `${values[mid]} is greater than ${target}. Keep the left half.`});
    if (found) return steps;
    if (values[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  steps.push({left, right, mid:null, found:false, done:true, description:`No candidates remain. ${target} is not in this array.`});
  return steps;
}

function mountBinaryFigure(element) {
  const values = [2, 5, 8, 12, 16, 23, 38, 56, 72];
  element.className = 'binary-figure';
  const title = document.createElement('h4'); title.textContent = 'Try binary search';
  const introduction = document.createElement('p'); introduction.textContent = 'Choose a target and watch the search interval shrink. Targets between array values show an unsuccessful search.';
  const label = document.createElement('label'); label.className = 'binary-target-label'; label.textContent = 'Target';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '2'; slider.max = '72'; slider.value = '23'; slider.step = '1'; slider.setAttribute('aria-label', 'Binary search target');
  const output = document.createElement('output'); output.textContent = slider.value;
  label.append(slider, output);
  const cells = document.createElement('div'); cells.className = 'binary-cells'; cells.setAttribute('role','list'); cells.setAttribute('aria-label','Sorted array');
  const nodes = values.map((value, index) => {
    const cell = document.createElement('div'); cell.className = 'binary-cell'; cell.setAttribute('role','listitem');
    const number = document.createElement('strong'); number.textContent = value;
    const indexLabel = document.createElement('small'); indexLabel.textContent = index;
    cell.append(number, indexLabel); cells.append(cell); return cell;
  });
  const controls = document.createElement('div'); controls.className = 'binary-controls';
  const stepButton = document.createElement('button'); stepButton.type = 'button'; stepButton.textContent = 'Next comparison →';
  const resetButton = document.createElement('button'); resetButton.type = 'button'; resetButton.textContent = 'Reset';
  const counter = document.createElement('span'); counter.className = 'binary-counter';
  controls.append(stepButton, resetButton, counter);
  const status = document.createElement('p'); status.className = 'binary-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const legend = document.createElement('p'); legend.className = 'binary-legend'; legend.textContent = 'Outlined = remaining interval · Filled = midpoint · Faded = ruled out';
  element.replaceChildren(title, introduction, label, cells, controls, status, legend);
  let steps, current;
  function draw() {
    const step = steps[current];
    nodes.forEach((node, index) => {
      node.classList.toggle('binary-eliminated', Boolean(step && (index < step.left || index > step.right)));
      node.classList.toggle('binary-mid', Boolean(step && index === step.mid));
      node.classList.toggle('binary-found', Boolean(step?.found && index === step.mid));
      node.setAttribute('aria-label', `${values[index]}, index ${index}${step && index === step.mid ? ', midpoint' : ''}${step?.found && index === step.mid ? ', target found' : ''}`);
    });
    status.textContent = step ? step.description : 'The array is sorted. Compare the target with the midpoint to begin.';
    const comparisons = steps.slice(0,current + 1).filter(item => item.mid !== null).length;
    counter.textContent = `${comparisons} ${comparisons === 1 ? 'comparison' : 'comparisons'}`;
    stepButton.disabled = Boolean(step?.done);
    stepButton.textContent = step?.done ? 'Search complete' : 'Next comparison →';
  }
  function reset() { steps = binarySearchSteps(values, Number(slider.value)); current = -1; output.value = slider.value; output.textContent = slider.value; draw(); }
  slider.addEventListener('input', reset);
  resetButton.addEventListener('click', reset);
  stepButton.addEventListener('click', () => { if (current < steps.length - 1) { current++; draw(); } });
  reset();
}

function allowedUrl(value, image = false) {
  if (!value) return false;
  if (value.startsWith('#')) return !image;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value, document.baseURI);
    return ['https:', 'http:'].includes(url.protocol) || (!image && url.protocol === 'mailto:');
  } catch { return false; }
}

/** Render untrusted Markdown without trusting author-supplied HTML or LaTeX commands. */
export function renderMarkdown(container, source = '') {
  const scope = `article-${++renderSerial}`;
  const mathematics = [];
  const definitions = new Map();
  const references = new Map();
  const mathHtml = (expression, displayMode) => {
    const index = mathematics.push({expression, displayMode}) - 1;
    return `<${displayMode ? 'div' : 'span'} data-article-math="${scope}-${index}" class="${displayMode ? 'math-block' : 'math-inline'}"></${displayMode ? 'div' : 'span'}>`;
  };
  const parser = new Marked({gfm:true, breaks:false});
  parser.use({extensions:[
    {name:'articleDisplayMath', level:'block', start:text => text.search(/\$\$|\\\[/), tokenizer(text) {
      const match = /^(?: {0,3})(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:[ \t]*\n|$)/.exec(text);
      if (match) return {type:'articleDisplayMath',raw:match[0],expression:match[1] ?? match[2]};
    }, renderer:token => mathHtml(token.expression, true)},
    {name:'articleInlineMath', level:'inline', start:text => text.search(/\$|\\\(/), tokenizer(text) {
      const display = /^\$\$([\s\S]+?)\$\$/.exec(text);
      if (display) return {type:'articleInlineMath',raw:display[0],expression:display[1],displayMode:true};
      const match = /^(?:\$(?!\$)((?:\\[^\n]|[^$\\\n])+?)\$(?!\$)|\\\(([\s\S]+?)\\\))/.exec(text);
      if (match && (match[2] !== undefined || match[1].trim() === match[1])) return {type:'articleInlineMath',raw:match[0],expression:match[1] ?? match[2],displayMode:false};
    }, renderer:token => mathHtml(token.expression, token.displayMode)},
    {name:'articleFootnoteDefinition', level:'block', start:text => text.indexOf('[^'), tokenizer(text) {
      const match = /^\[\^([\w-]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/.exec(text);
      if (match) { definitions.set(match[1],match[2].replace(/\n(?: {2,}|\t)/g,'\n')); return {type:'articleFootnoteDefinition',raw:match[0]}; }
    }, renderer:() => ''},
    {name:'articleFootnoteReference', level:'inline', start:text => text.indexOf('[^'), tokenizer(text) {
      const match = /^\[\^([\w-]+)\]/.exec(text);
      if (match) return {type:'articleFootnoteReference',raw:match[0],key:match[1]};
    }, renderer(token) {
      if (!definitions.has(token.key)) return escapeHtml(token.raw);
      if (!references.has(token.key)) references.set(token.key,{number:references.size + 1,count:0});
      const reference = references.get(token.key); reference.count++;
      return `<sup class="footnote-ref"><a href="#fn-${scope}-${token.key}" id="fnref-${scope}-${token.key}-${reference.count}" aria-label="Footnote ${reference.number}">${reference.number}</a></sup>`;
    }}
  ],renderer:{code({text,lang}) {
    const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
    if (language === 'demo' && text.trim() === 'binary-search') return '<div data-article-demo="binary-search"></div>';
    const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(text,{language,ignoreIllegals:true}).value : escapeHtml(text);
    return `<pre data-code-language="${escapeHtml(language || 'text')}"><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${highlighted}</code></pre>`;
  }}});
  let html = parser.parse(String(source));
  if (references.size) {
    html += `<section class="footnotes" aria-label="Footnotes"><ol>${[...references].map(([key,reference]) => `<li id="fn-${scope}-${key}">${parser.parseInline(definitions.get(key))} <a class="footnote-back" href="#fnref-${scope}-${key}-1" aria-label="Back to footnote ${reference.number}">↩</a></li>`).join('')}</ol></section>`;
  }
  container.classList.add('prose');
  container.innerHTML = DOMPurify.sanitize(html,{FORBID_TAGS:['script','style','iframe','object','embed','form','input','button','textarea','select','link','meta','svg','math'],FORBID_ATTR:['style'],ADD_ATTR:['target']});
  container.querySelectorAll('a').forEach(anchor => {
    if (!allowedUrl(anchor.getAttribute('href'))) anchor.removeAttribute('href');
    else if (/^https?:/i.test(anchor.getAttribute('href'))) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
  });
  container.querySelectorAll('img').forEach(image => {
    if (!allowedUrl(image.getAttribute('src'),true)) image.removeAttribute('src');
    image.loading = 'lazy'; image.decoding = 'async';
  });
  mathematics.forEach(({expression,displayMode},index) => {
    container.querySelectorAll(`[data-article-math="${scope}-${index}"]`).forEach(element => {
      try { katex.render(expression,element,{displayMode,throwOnError:false,trust:false,strict:'warn',maxExpand:1000,maxSize:20}); }
      catch { element.textContent = expression; element.classList.add('math-error'); }
      element.removeAttribute('data-article-math');
    });
  });
  const usedIds = new Set();
  const headings = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((heading,index) => {
    const base = heading.textContent.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-') || `section-${index + 1}`;
    let id = base, suffix = 1;
    while (usedIds.has(id) || document.getElementById(id) && document.getElementById(id) !== heading) id = `${base}-${++suffix}`;
    usedIds.add(id); heading.id = id;
    return {id,text:heading.textContent,level:Number(heading.tagName.slice(1))};
  });
  const handlers = [];
  container.querySelectorAll('pre').forEach(pre => {
    const wrapper = document.createElement('div'); wrapper.className = 'code-block';
    const header = document.createElement('div'); header.className = 'code-header';
    const language = document.createElement('span'); language.textContent = pre.dataset.codeLanguage || 'text';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'code-copy'; button.textContent = 'Copy'; button.setAttribute('aria-label','Copy code');
    const status = document.createElement('span'); status.className = 'code-status'; status.setAttribute('role','status');
    const listener = async () => {
      try { await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent); status.textContent = 'Copied'; button.textContent = 'Copied'; }
      catch { status.textContent = 'Copy unavailable. Select the code to copy it.'; }
    };
    button.addEventListener('click',listener); handlers.push(() => button.removeEventListener('click',listener));
    header.append(language,status,button); pre.before(wrapper); wrapper.append(header,pre);
  });
  container.querySelectorAll('[data-article-demo="binary-search"]').forEach(mountBinaryFigure);
  return {headings,dispose:() => handlers.forEach(remove => remove())};
}
