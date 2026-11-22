import { initPractice } from './practice-feed.js';
import './practice-view.css';

const EXAMPLE = [
  'XXXXXXX',
  'XOOXOOX',
  'XXOXOXX',
  'OXXXOOX',
  'OOXXXOX',
  'XOXXXXX'
].map(row => [...row]);

const copyBoard = board => board.map(row => [...row]);
const key = (r, c) => `${r},${c}`;

/** A deterministic, self-contained explanation of the boundary-first BFS. */
export function makeFloodSteps(input) {
  if (!Array.isArray(input) || !input.length || !Array.isArray(input[0]) || !input[0].length) throw new TypeError('Expected a nonempty rectangular O/X board.');
  const rows = input.length;
  const cols = input[0].length;
  if (input.some(row => !Array.isArray(row) || row.length !== cols || row.some(cell => cell !== 'O' && cell !== 'X'))) throw new TypeError('Expected a rectangular board containing only O and X.');
  const board = copyBoard(input);
  const safe = new Set();
  const seen = new Set();
  const flipped = new Set();
  const queue = [];
  const steps = [];
  const openCount = board.flat().filter(cell => cell === 'O').length;
  function record(phase, message, current = null) {
    steps.push({ phase, message, current, board:copyBoard(board), safe:[...safe], frontier:queue.map(([r,c]) => key(r,c)), flipped:[...flipped], openCount, preserved:safe.size, changed:flipped.size });
  }
  record('ready', 'An O survives if it can reach an edge through other O cells. Click cells to change the board, then step through the search.');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r === 0 || c === 0 || r === rows - 1 || c === cols - 1) && board[r][c] === 'O') {
        seen.add(key(r,c));
        queue.push([r,c]);
      }
    }
  }
  record('boundary', queue.length ? `${queue.length} O ${queue.length === 1 ? 'cell touches' : 'cells touch'} an edge. Start the queue here: these are the entry points to the safe region.` : 'No O cells touch an edge. Every O is enclosed, so there is no safe region to explore.');
  while (queue.length) {
    const [r,c] = queue.shift();
    safe.add(key(r,c));
    let added = 0;
    for (const [nr,nc] of [[r-1,c],[r,c+1],[r+1,c],[r,c-1]]) {
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === 'O' && !seen.has(key(nr,nc))) {
        seen.add(key(nr,nc));
        queue.push([nr,nc]);
        added++;
      }
    }
    record('traverse', `Row ${r+1}, column ${c+1} is connected to an edge. Mark it safe${added ? ` and add ${added} unseen ${added === 1 ? 'neighbor' : 'neighbors'} to the queue` : '; no new neighbors to add'}.`, [r,c]);
  }
  record('inspect', `The search is complete. ${safe.size} ${safe.size === 1 ? 'O is' : 'Os are'} connected to an edge. Any remaining O must be enclosed.`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === 'O' && !safe.has(key(r,c))) {
        board[r][c] = 'X';
        flipped.add(key(r,c));
        record('flip', `Row ${r+1}, column ${c+1} has no path to an edge. Capture it by changing O to X.`, [r,c]);
      }
    }
  }
  record('complete', `Done. Preserved ${safe.size} edge-connected ${safe.size === 1 ? 'O' : 'Os'} and captured ${flipped.size} enclosed ${flipped.size === 1 ? 'cell' : 'cells'}. Try changing the board to test a different shape.`);
  return steps;
}

export async function mountPractice(container) {
  container.innerHTML = `
    <div class="practice-page">
      <header class="practice-page-heading"><p class="practice-overline">The notebook / practice</p><h1>Practice</h1><p>Problems I’ve worked through, and a closer look at how they work.</p></header>
      <section class="practice-feed-section" aria-labelledby="practice-feed-heading">
        <div class="practice-section-heading"><h2 id="practice-feed-heading">From the practice repo</h2><a id="practice-source" href="https://github.com/somehowe/leetcode-practice" target="_blank" rel="noopener noreferrer">All solutions ↗</a></div>
        <div class="practice-feed-layout">
          <article class="practice-latest"><div class="practice-feed-status"><span class="practice-source-dot" aria-hidden="true"></span><span id="practice-status" role="status">Checking GitHub…</span></div><p class="practice-overline">Latest documented problem <span id="practice-number"></span></p><h3 id="practice-title">Opening the notebook</h3><p id="practice-date" class="practice-date">Loading recent activity</p><div class="practice-latest-tags"><span id="practice-topic"></span><div id="practice-topics"></div></div><div class="practice-links"><a id="practice-link" href="https://github.com/somehowe/leetcode-practice" target="_blank" rel="noopener noreferrer">Read the solution ↗</a><a id="practice-problem-link" href="https://leetcode.com/problems/surrounded-regions/" target="_blank" rel="noopener noreferrer">Open problem ↗</a></div><div class="practice-feed-footer"><span id="practice-count">Recent documented work</span><button id="practice-refresh" type="button">Refresh ↻</button></div></article>
          <div class="practice-recent"><h3>Recent solutions</h3><div id="practice-list"><p class="practice-feed-placeholder">Looking up the latest entries…</p></div></div>
        </div>
        <p class="practice-source-note">GitHub / LeetHub sync activity. Dates describe the repository history, rather than a verified LeetCode streak.</p>
      </section>
      <section class="flood-section" aria-labelledby="flood-title">
        <div class="practice-section-heading"><div><p class="practice-overline">An interactive explanation</p><h2 id="flood-title">What counts as surrounded?</h2></div><a href="https://leetcode.com/problems/surrounded-regions/" target="_blank" rel="noopener noreferrer">LeetCode #130 ↗</a></div>
        <p class="flood-intro">A group of O cells is captured only when it can’t reach the edge. Instead of finding every enclosed region, start at the boundary and find everything that <em>isn’t</em> enclosed.</p>
        <div class="flood-workspace">
          <div class="flood-board-area"><div class="flood-board-caption"><span id="flood-mode">Click any cell to edit</span><span>6 rows × 7 columns</span></div><div class="flood-board" id="flood-board" role="group" aria-label="Editable six by seven O and X board. Press Enter or Space on a cell to toggle it."></div><div class="flood-legend" aria-label="Cell colors"><span><i class="flood-key frontier"></i>Queued</span><span><i class="flood-key safe"></i>Edge-connected</span><span><i class="flood-key flipped"></i>Captured</span></div><p class="flood-edit-hint">Toggle O / X before starting. Reset keeps your edits.</p></div>
          <div class="flood-explanation"><ol class="flood-phases"><li data-phase="boundary"><span>1</span>Start at the edges</li><li data-phase="traverse"><span>2</span>Follow connected Os</li><li data-phase="flip"><span>3</span>Capture what’s left</li></ol><div class="flood-step-label"><span id="flood-phase">Ready to explore</span><span id="flood-step-count">0 / 0</span></div><p class="flood-message" id="flood-message" role="status" aria-live="polite" aria-atomic="true"></p><div class="flood-counters"><div><strong id="flood-preserved">0</strong><span>preserved</span></div><div><strong id="flood-captured">0</strong><span>captured</span></div><div><strong id="flood-queued">0</strong><span>in queue</span></div></div></div>
        </div>
        <div class="flood-controls"><div class="flood-main-controls"><button type="button" id="flood-step" class="flood-primary">Step forward <span aria-hidden="true">→</span></button><button type="button" id="flood-play" aria-pressed="false">Run</button><button type="button" id="flood-reset">Reset</button></div><button type="button" id="flood-restore" class="flood-restore">Restore example</button></div>
        <div class="flood-scrubber"><label for="flood-timeline">Scrub through the search</label><input id="flood-timeline" type="range" min="0" max="1" value="0" step="1" aria-label="Walkthrough step"></div>
        <div class="flood-footnote"><p><strong>The cost:</strong> each cell is visited a constant number of times. Time O(rows × columns); queue space O(rows × columns).</p><p>This runs a JavaScript explanation of boundary-first breadth-first search. Ryan’s C++ solution is linked in the practice repo above.</p></div>
        <details class="flood-code"><summary>The idea in a few lines</summary><pre><code>queue ← all O cells on the boundary
while queue is not empty:
    cell ← queue.pop_front()
    mark cell safe
    queue unseen O neighbors

for each cell:
    if cell is O and not safe:
        cell ← X</code></pre></details>
      </section>
    </div>`;

  let initial = copyBoard(EXAMPLE);
  let steps = makeFloodSteps(initial);
  let index = 0;
  let timer = null;
  let disposed = false;
  const lifecycle = new AbortController();
  const options = {signal:lifecycle.signal};
  const find = selector => container.querySelector(selector);
  const boardElement = find('#flood-board');
  const cellButtons = [];
  const phaseNames = {ready:'Ready to explore',boundary:'Seed the queue',traverse:'Explore from the boundary',inspect:'Check what remains',flip:'Capture enclosed cells',complete:'Search complete'};
  const motionReduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    find('#flood-play').textContent = 'Run';
    find('#flood-play').setAttribute('aria-pressed','false');
  }
  function render() {
    if (disposed) return;
    const state = steps[index];
    const safe = new Set(state.safe);
    const frontier = new Set(state.frontier);
    const flipped = new Set(state.flipped);
    for (let r = 0; r < initial.length; r++) {
      for (let c = 0; c < initial[0].length; c++) {
        const button = cellButtons[r][c];
        const coordinate = key(r,c);
        let cellState = flipped.has(coordinate) ? 'flipped' : safe.has(coordinate) ? 'safe' : frontier.has(coordinate) ? 'frontier' : state.board[r][c] === 'O' ? 'open' : 'wall';
        button.textContent = state.board[r][c];
        button.dataset.state = cellState;
        button.classList.toggle('flood-current', state.current?.[0] === r && state.current?.[1] === c);
        button.setAttribute('aria-label', `Row ${r+1}, column ${c+1}: ${state.board[r][c]}${cellState === 'safe' ? ', connected to an edge' : cellState === 'frontier' ? ', queued for exploration' : cellState === 'flipped' ? ', captured' : ''}${index === 0 ? '. Activate to toggle.' : '.'}`);
        button.setAttribute('aria-pressed', String(state.board[r][c] === 'O'));
        button.disabled = index > 0;
      }
    }
    find('#flood-mode').textContent = index === 0 ? 'Click any cell to edit' : state.phase === 'complete' ? 'Result · reset to edit' : 'Exploring · reset to edit';
    find('#flood-phase').textContent = phaseNames[state.phase];
    find('#flood-step-count').textContent = `${index} / ${steps.length-1}`;
    find('#flood-message').textContent = state.message;
    find('#flood-preserved').textContent = state.preserved;
    find('#flood-captured').textContent = state.changed;
    find('#flood-queued').textContent = state.frontier.length;
    const complete = index === steps.length-1;
    find('#flood-step').disabled = complete;
    find('#flood-play').disabled = complete;
    const timeline = find('#flood-timeline');
    timeline.max = steps.length-1;
    timeline.value = index;
    timeline.setAttribute('aria-valuetext', `Step ${index} of ${steps.length-1}: ${phaseNames[state.phase]}`);
    const activePhase = ['ready','boundary'].includes(state.phase) ? 'boundary' : ['traverse','inspect'].includes(state.phase) ? 'traverse' : 'flip';
    container.querySelectorAll('.flood-phases li').forEach(item => {
      item.classList.toggle('flood-phase-active', item.dataset.phase === activePhase);
      if (item.dataset.phase === activePhase) item.setAttribute('aria-current','step');
      else item.removeAttribute('aria-current');
    });
    if (complete) stop();
  }

  initial.forEach((row,r) => {
    cellButtons[r] = [];
    row.forEach((_,c) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'flood-cell';
      button.addEventListener('click', () => {
        if (index > 0 || timer !== null) return;
        initial[r][c] = initial[r][c] === 'O' ? 'X' : 'O';
        steps = makeFloodSteps(initial);
        render();
      },options);
      button.addEventListener('keydown', event => {
        const neighbors = {ArrowUp:[r-1,c],ArrowDown:[r+1,c],ArrowLeft:[r,c-1],ArrowRight:[r,c+1]};
        const next = neighbors[event.key];
        if (next && cellButtons[next[0]]?.[next[1]]) { event.preventDefault(); cellButtons[next[0]][next[1]].focus(); }
      },options);
      cellButtons[r][c] = button;
      boardElement.append(button);
    });
  });

  find('#flood-step').addEventListener('click', () => { stop(); if (index < steps.length-1) index++; render(); },options);
  find('#flood-play').addEventListener('click', () => {
    if (timer !== null) { stop(); return; }
    if (index >= steps.length-1) return;
    find('#flood-play').textContent = 'Pause';
    find('#flood-play').setAttribute('aria-pressed','true');
    index++;
    render();
    if (index < steps.length-1) timer = setInterval(() => { if (disposed) return; index++; render(); },motionReduced ? 1100 : 650);
  },options);
  find('#flood-reset').addEventListener('click', () => { stop(); index = 0; steps = makeFloodSteps(initial); render(); },options);
  find('#flood-restore').addEventListener('click', () => { stop(); index = 0; initial = copyBoard(EXAMPLE); steps = makeFloodSteps(initial); render(); },options);
  find('#flood-timeline').addEventListener('input', event => { stop(); index = Number(event.target.value); render(); },options);
  render();

  // Mount returns promptly so navigation can tear down the simulation while the
  // independent public activity request is still in flight.
  void (async () => {
    try { await initPractice(); }
    catch {
      if (!disposed) {
        find('#practice-status').textContent = 'Activity temporarily unavailable';
        find('#practice-title').textContent = 'Open the practice notebook';
        find('#practice-date').textContent = 'The source repository is available below.';
        find('#practice-list').replaceChildren();
      }
    }
  })();

  return () => {
    stop();
    disposed = true;
    lifecycle.abort();
  };
}
