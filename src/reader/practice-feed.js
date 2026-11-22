// Public GitHub/LeetHub activity, never a claim about a LeetCode streak.
const REPO = 'somehowe/leetcode-practice';
const REPO_URL = `https://github.com/${REPO}`;
const API = `https://api.github.com/repos/${REPO}`;
const CACHE_KEY = 'ryan-howe-practice-v1';
const TTL = 15 * 60 * 1000;
const TIME_ZONE = 'America/New_York';
const CODE_FILE = /\.(?:cpp|cc|c|py|js|ts|java|rs|go|cs)$/i;
const byId = id => document.getElementById(id);

function safeUrl(value, kind = 'github') {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (kind === 'leetcode') return url.hostname === 'leetcode.com' && url.pathname.startsWith('/problems/') ? url.href : null;
    return url.hostname === 'github.com' && url.pathname.startsWith(`/${REPO}/`) ? url.href : null;
  } catch { return null; }
}

function validProblems(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.filter(item => {
    if (!item || !/^\d+-[a-z0-9-]+$/.test(item.path || '') || !Number.isFinite(Date.parse(item.date)) || !safeUrl(item.codeUrl) || typeof item.title !== 'string' || !item.title.trim()) return false;
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 6);
}

function readCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY));
    return cache && Number.isFinite(cache.checkedAt) && validProblems(cache.problems).length ? {...cache, problems:validProblems(cache.problems)} : null;
  } catch { return null; }
}

function writeCache(value) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ }
}

async function fetchJson(url, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {signal:controller.signal, headers:{Accept:'application/vnd.github+json'}});
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function dayKey(value) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}

function dateLabel(value, short = false) {
  return new Intl.DateTimeFormat('en-US', {timeZone:TIME_ZONE,month:'short',day:'numeric',...(short ? {} : {year:'numeric'})}).format(new Date(value));
}

function putText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function attachLink(id, value, label) {
  const element = byId(id);
  const url = safeUrl(value);
  if (!element || !url) return;
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener noreferrer';
  if (label) element.setAttribute('aria-label', label);
}

function display(problems, state, checkedAt) {
  const latest = problems[0];
  if (!latest) return;
  const isToday = dayKey(latest.date) === dayKey(Date.now());
  putText('practice-title', latest.title);
  putText('practice-date', `${isToday ? "Today's documented solve" : 'Latest documented solve'} · ${dateLabel(latest.date)}`);
  putText('practice-topic', latest.difficulty || 'C++');
  putText('practice-number', `#${latest.number}`);
  putText('practice-count', `${problems.length} recent problems`);
  putText('practice-status', state === 'live' ? 'Synced from GitHub' : state === 'cache' ? 'Recent GitHub cache' : state === 'stale' ? 'Offline · showing saved activity' : `Snapshot · ${dateLabel(checkedAt)}`);
  const status = byId('practice-status');
  if (status) status.dataset.state = state;
  attachLink('practice-link', latest.codeUrl, `Read the code for ${latest.title} on GitHub`);
  attachLink('practice-source', `${REPO_URL}/commits/main/`);
  const problemLink = byId('practice-problem-link');
  if (problemLink) {
    const url = safeUrl(latest.leetcodeUrl || `https://leetcode.com/problems/${latest.slug}/`, 'leetcode');
    if (url) { problemLink.href = url; problemLink.target = '_blank'; problemLink.rel = 'noopener noreferrer'; }
  }
  const topics = byId('practice-topics');
  if (topics) {
    topics.replaceChildren();
    const values = Array.isArray(latest.topics) && latest.topics.length ? latest.topics.slice(0, 3) : ['C++', 'Problem solving'];
    values.forEach(topic => {
      const tag = document.createElement('span');
      tag.textContent = String(topic);
      tag.className = 'tag';
      topics.append(tag);
    });
  }
  const list = byId('practice-list');
  if (list) {
    list.replaceChildren();
    problems.forEach((problem, index) => {
      const row = document.createElement('a');
      row.className = 'practice-row';
      row.href = safeUrl(problem.codeUrl);
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
      row.setAttribute('aria-label', `${problem.title}, documented ${dateLabel(problem.date)}. Read solution on GitHub.`);
      const cells = [
        ['practice-row-index', String(index + 1).padStart(2, '0')],
        ['practice-row-title', problem.title],
        ['practice-row-date', dateLabel(problem.date, true)],
        ['practice-row-arrow', '↗']
      ];
      cells.forEach(([className, value]) => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = value;
        if (className.endsWith('arrow')) span.setAttribute('aria-hidden', 'true');
        row.append(span);
      });
      list.append(row);
    });
  }
}

function problemFromCommit(commit, file, known) {
  const folder = file.filename.split('/')[0];
  const match = folder.match(/^(\d+)-([a-z0-9-]+)$/);
  if (!match || !CODE_FILE.test(file.filename) || file.status === 'removed' || !/^[a-f0-9]{40}$/.test(commit.sha)) return null;
  const old = known.find(item => item.path === folder);
  const slug = match[2];
  const title = old?.title || slug.split('-').map(word => /^(?:ii|iii|iv|vi|vii|viii|ix)$/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return {
    title, number:Number(match[1]), slug, path:folder,
    date:commit.commit?.committer?.date || commit.commit?.author?.date,
    sha:commit.sha,
    codeUrl:`${REPO_URL}/blob/${commit.sha}/${file.filename.split('/').map(encodeURIComponent).join('/')}`,
    commitUrl:`${REPO_URL}/commit/${commit.sha}`,
    leetcodeUrl:`https://leetcode.com/problems/${slug}/`,
    difficulty:old?.difficulty || null, topics:old?.topics || []
  };
}

async function getLive(known) {
  const commits = await fetchJson(`${API}/commits?per_page=15`);
  if (!Array.isArray(commits)) throw new Error('Activity response was not a list');
  // LeetHub creates separate README and stats commits; inspect code submissions only.
  const candidates = commits.filter(c => /^Time:.*- LeetHub\s*$/s.test(c.commit?.message || '') && /^[a-f0-9]{40}$/.test(c.sha)).slice(0, 3);
  if (!candidates.length) throw new Error('No recent code submissions in this page');
  const details = await Promise.allSettled(candidates.map(c => fetchJson(`${API}/commits/${c.sha}`)));
  const live = [];
  details.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value.files)) return;
    result.value.files.forEach(file => {
      const problem = problemFromCommit(candidates[index], file, known);
      if (problem) live.push(problem);
    });
  });
  if (!live.length) throw new Error('Could not read recent solution files');
  // Known entries retain older, verified history without extra API requests.
  return validProblems([...live, ...known]);
}

export async function initPractice() {
  if (!byId('practice-title')) return;
  const refresh = byId('practice-refresh');
  const status = byId('practice-status');
  if (status) { status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); }
  let busy = false;
  let snapshot = null;
  try { snapshot = await fetchJson(new URL('/practice-snapshot.json', location.origin).href, 4000); } catch { /* GitHub or cache can still supply the feed. */ }
  const initialCache = readCache();
  const fallback = validProblems(snapshot?.problems);
  if (initialCache) display(initialCache.problems, 'cache', initialCache.checkedAt);
  else if (fallback.length) display(fallback, 'snapshot', snapshot.fetchedAt);
  else putText('practice-status', 'Loading documented practice…');

  async function update(force = false) {
    if (busy) return;
    const cache = readCache();
    if (!force && cache && Date.now() - cache.checkedAt < TTL && Date.now() >= cache.checkedAt) {
      display(cache.problems, 'cache', cache.checkedAt);
      return;
    }
    busy = true;
    if (refresh) { refresh.disabled = true; refresh.setAttribute('aria-busy','true'); }
    putText('practice-status', 'Checking GitHub…');
    try {
      const problems = await getLive(validProblems([...(cache?.problems || []), ...fallback]));
      const checkedAt = Date.now();
      writeCache({checkedAt, problems});
      display(problems, 'live', checkedAt);
    } catch {
      if (cache) display(cache.problems, 'stale', cache.checkedAt);
      else if (fallback.length) display(fallback, 'snapshot', snapshot.fetchedAt);
      else {
        putText('practice-title', 'Explore my practice notebook');
        putText('practice-date', 'The live source is temporarily unavailable.');
        putText('practice-status', 'GitHub unavailable · try refreshing');
        attachLink('practice-link', `${REPO_URL}/tree/main`, 'Open Ryan’s LeetCode practice repository');
      }
    } finally {
      busy = false;
      if (refresh) { refresh.disabled = false; refresh.removeAttribute('aria-busy'); }
    }
  }
  refresh?.addEventListener('click', () => update(true));
  await update();
}
