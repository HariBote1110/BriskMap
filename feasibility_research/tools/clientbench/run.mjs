import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = dirname(fileURLToPath(import.meta.url));
const zeroCpu = () => ({ total: 0, byType: {} });

export function parsePsTime(value) {
  const [clock, dayText] = value.includes('-') ? [value.split('-')[1], value.split('-')[0]] : [value, '0'];
  const parts = clock.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) throw new Error(`Invalid ps time: ${value}`);
  const seconds = parts.pop();
  const minutes = parts.pop();
  const hours = parts.pop() ?? 0;
  return Math.round((Number(dayText) * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function collectProcessCpu(listing, rootPid) {
  const rows = listing.split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map(match => ({ pid: Number(match[1]), ppid: Number(match[2]), ms: parsePsTime(match[3]), command: match[4] }));
  const descendants = new Set([Number(rootPid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; }
  }
  const result = zeroCpu();
  for (const row of rows) {
    if (!descendants.has(row.pid)) continue;
    const type = row.pid === Number(rootPid) ? 'browser' : /(?:^|\s)--type=([^\s]+)/.exec(row.command)?.[1] ?? 'other';
    result.total += row.ms;
    result.byType[type] = (result.byType[type] ?? 0) + row.ms;
  }
  return result;
}

export function sampleCpu(pid) {
  try { return collectProcessCpu(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,command='], { encoding: 'utf8' }), pid); }
  catch { return zeroCpu(); }
}

export function subtractCpu(after, before) {
  const byType = {};
  for (const type of new Set([...Object.keys(after.byType), ...Object.keys(before.byType)]))
    byType[type] = Math.max(0, (after.byType[type] ?? 0) - (before.byType[type] ?? 0));
  return { total: Math.max(0, after.total - before.total), byType };
}

export function detectSettle(events, { now, start, ready = true, quietMs = 2000, timeoutMs = 180000, uploadDoneAt = start }) {
  let inFlight = 0;
  const pending = new Map();
  let lastNetwork = start;
  let lastFinish = start;
  let lastLongTaskEnd = start;
  for (const event of events) {
    if (event.at > now) continue;
    if (event.kind === 'request') {
      if (event.key) pending.set(event.key, { at: event.at, url: event.url });
      else inFlight++;
      lastNetwork = Math.max(lastNetwork, event.at);
    }
    if (event.kind === 'response') {
      const request = pending.get(event.key);
      if (request) request.responseAt = event.at;
      lastNetwork = Math.max(lastNetwork, event.at);
    }
    if (event.kind === 'finish' || event.kind === 'fail') {
      if (event.key) pending.delete(event.key);
      else inFlight = Math.max(0, inFlight - 1);
      lastNetwork = Math.max(lastNetwork, event.at);
      if (event.kind === 'finish') lastFinish = Math.max(lastFinish, event.at);
    }
    if (event.kind === 'longtask') lastLongTaskEnd = Math.max(lastLongTaskEnd, event.end);
  }
  const expiryAt = request => Math.min(request.at + 10000, (request.responseAt ?? Infinity) + 5000);
  const unfinished = [...pending.values()].filter(request => now >= expiryAt(request));
  const unfinishedFields = unfinished.length ? { unfinishedCount: unfinished.length, unfinishedUrls: unfinished.slice(0, 20).map(request => request.url) } : {};
  for (const request of unfinished) lastFinish = Math.max(lastFinish, expiryAt(request));
  const settled = ready && inFlight === 0 && pending.size === unfinished.length && now - lastNetwork >= quietMs && now - lastLongTaskEnd >= quietMs;
  if (settled) return { settled: true, timedOut: false, settleMs: Math.max(lastFinish, lastLongTaskEnd, uploadDoneAt) - start, ...unfinishedFields };
  return { settled: false, timedOut: now - start >= timeoutMs, ...unfinishedFields };
}

// Nearest-rank percentile: sorted value at ceil(p * sample count), with a minimum rank of one.
export function orbitStatistics(timestamps) {
  const deltas = timestamps.slice(1).map((time, index) => time - timestamps[index]).filter(value => value > 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return {
    frames: deltas.length,
    fps_mean: deltas.length ? 1000 * deltas.length / deltas.reduce((sum, value) => sum + value, 0) : 0,
    frame_ms_p50: percentile(0.5), frame_ms_p95: percentile(0.95), frame_ms_p99: percentile(0.99),
    frames_over_33ms: deltas.filter(value => value > 33).length,
    frames_over_50ms: deltas.filter(value => value > 50).length,
  };
}

export function classifyUrl(viewer, url) {
  const path = new URL(url).pathname;
  if (viewer === 'bluemap') {
    if (/\/maps\/[^/]+\/tiles\/0\//.test(path)) return 'hires';
    if (/\/maps\/[^/]+\/tiles\/[123]\//.test(path)) return 'lowres';
  }
  if (viewer === 'brisk' && path.startsWith('/data/')) return 'data';
  return 'other';
}

function argumentsFrom(argv) {
  const options = { scenarios: join(base, 'scenarios.json'), runs: 3, out: join(base, 'results.jsonl'), headless: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') { options.help = true; continue; }
    if (arg === '--headless') { options.headless = true; continue; }
    if (!['--chrome', '--scenarios', '--runs', '--out', '--only'].includes(arg) || !argv[i + 1]) throw new Error(`Unknown or incomplete option: ${arg}`);
    options[arg.slice(2)] = argv[++i];
  }
  options.runs = Number(options.runs);
  if (!options.help && (!options.chrome || !Number.isInteger(options.runs) || options.runs < 1)) throw new Error('Use --chrome BIN and --runs positive integer');
  if (options.only && (!/^(bluemap|brisk):[^:]+:[^:]+$/.test(options.only))) throw new Error('Use --only viewer:case:scenario');
  return options;
}

function pageUrl(viewer, scenario, setting, y) {
  const { distance, rotation, angle } = scenario;
  if (viewer === 'bluemap') return `http://192.168.0.175:8100/#overworld:0:${y}:0:${distance}:${rotation}:${angle}:0:0:perspective`;
  const query = new URLSearchParams({ x: '0', y: String(y), z: '0', distance: String(distance), rotation: String(rotation), angle: String(angle), radius: String(setting.radius), workers: '4', data: '/data/' });
  return `http://192.168.0.175:8200/viewer/index.html?${query}`;
}

export async function runOne({ viewer, caseName, scenarioName, runNumber, scenario, setting, chrome, headless, out, targetY, url, append = true, launch = launchChrome }) {
  const browser = await launch(chrome, { headless });
  try {
    const { client, child, version } = browser;
    const requests = new Map();
    const active = new Set();
    const seen = new Set();
    const events = [];
    const counts = {};
    const transfers = {};
    const nonNetworkByScheme = {};
    let nonNetworkRequests = 0;
    let transferBytes = 0;
    let networkErrors = 0;
    let attachmentError;
    let navigationAt = Date.now();
    let frameNavigatedAt = null;
    const classify = url => classifyUrl(viewer, url);
    client.on('Page.frameNavigated', () => { frameNavigatedAt = Date.now(); });
    client.on('Target.attachedToTarget', event => {
      if (!['worker', 'shared_worker', 'service_worker'].includes(event.targetInfo?.type)) return;
      void (async () => {
        await client.send('Network.enable', {}, event.sessionId);
        await client.send('Runtime.runIfWaitingForDebugger', {}, event.sessionId);
      })().catch(cause => { attachmentError ??= String(cause); });
    });
    client.on('Network.requestWillBeSent', event => {
      const at = Date.now();
      const key = event.requestId;
      if (seen.has(key) && !event.redirectResponse) return;
      seen.add(key);
      if (active.has(key)) {
        const previousClass = requests.get(key) ?? 'other';
        const redirectBytes = event.redirectResponse?.encodedDataLength ?? 0;
        transferBytes += redirectBytes;
        transfers[previousClass] = (transfers[previousClass] ?? 0) + redirectBytes;
        active.delete(key);
        events.push({ at, kind: 'finish', key });
      }
      const url = event.request.url;
      const scheme = new URL(url).protocol.slice(0, -1).toLowerCase();
      if (!['http', 'https', 'ws', 'wss'].includes(scheme)) {
        nonNetworkRequests++;
        nonNetworkByScheme[scheme] = (nonNetworkByScheme[scheme] ?? 0) + 1;
        requests.delete(key);
        return;
      }
      const classification = classify(url);
      counts[classification] = (counts[classification] ?? 0) + 1;
      requests.set(key, classification);
      active.add(key);
      events.push({ at, kind: 'request', key, url });
    });
    client.on('Network.responseReceived', event => {
      const key = event.requestId;
      if (active.has(key)) events.push({ at: Date.now(), kind: 'response', key });
    });
    client.on('Network.loadingFinished', event => {
      const at = Date.now();
      const key = event.requestId;
      if (!active.has(key)) return;
      const classification = requests.get(key);
      const size = event.encodedDataLength ?? 0;
      transferBytes += size;
      transfers[classification] = (transfers[classification] ?? 0) + size;
      active.delete(key);
      events.push({ at, kind: 'finish', key });
    });
    client.on('Network.loadingFailed', event => {
      const key = event.requestId;
      if (!active.delete(key)) return;
      networkErrors++;
      events.push({ at: Date.now(), kind: 'fail', key });
    });
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Page.enable');
    await client.send('Performance.enable');
    await client.send('Runtime.enable');
    let source = readFileSync(join(base, 'instrument.js'), 'utf8');
    if (viewer === 'bluemap') source = `localStorage.setItem('bluemap-hiresViewDistance', ${JSON.stringify(String(setting.hires))}); localStorage.setItem('bluemap-lowresViewDistance', ${JSON.stringify(String(setting.lowres))});\n` + source;
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const cpuStart = sampleCpu(child.pid);
    navigationAt = Date.now();
    await client.send('Page.navigate', { url: url ?? pageUrl(viewer, scenario, setting, targetY) });
    let settled = { settled: false, timedOut: false };
    let page = {};
    let error;
    while (true) {
      try {
        page = await client.evaluate(`({longTasks: window.__longTasks || [], ready: window.__briskReady === true, error: window.__briskError || null, stats: window.__briskStats || null})`) ?? {};
      } catch (cause) { error = String(cause); }
      const longTaskEvents = (page.longTasks ?? []).map(task => ({ kind: 'longtask', at: navigationAt + task.start, end: navigationAt + task.start + task.duration }));
      const upload = page.stats?.t_upload_done_ms;
      settled = detectSettle([...events, ...longTaskEvents], { now: Date.now(), start: navigationAt, ready: viewer === 'bluemap' || page.ready, uploadDoneAt: Number.isFinite(upload) ? navigationAt + upload : navigationAt });
      if (settled.settled || settled.timedOut || page.error || attachmentError) break;
      await sleep(100);
    }
    const cpuSettle = sampleCpu(child.pid);
    const loadCpu = subtractCpu(cpuSettle, cpuStart);
    error ??= attachmentError;
    let heapMb = null, gl = { buffer_bytes: 0, texture_bytes: 0 }, y = targetY, distances;
    try {
      const metrics = await client.send('Performance.getMetrics');
      heapMb = (metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576;
      gl = await client.evaluate('window.__glStats') ?? gl;
      if (viewer === 'bluemap') {
        const info = await client.evaluate(`({y: window.bluemap?.mapViewer?.controlsManager?.position?.y, hires: window.bluemap?.mapViewer?.data?.loadedHiresViewDistance, lowres: window.bluemap?.mapViewer?.data?.loadedLowresViewDistance})`);
        y = info?.y ?? y;
        distances = { hires: info?.hires ?? null, lowres: info?.lowres ?? null };
      }
    } catch (cause) { error ??= String(cause); }
    const name = `${viewer}-${caseName}-${scenarioName}-${runNumber}.png`;
    try {
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(dirname(resolve(out)), name), Buffer.from(screenshot.data, 'base64'));
    } catch (cause) { error ??= `Screenshot: ${cause}`; }
    let orbit = orbitStatistics([]);
    let orbitCpu = zeroCpu();
    if (!settled.timedOut && !page.error) {
      try {
        const before = sampleCpu(child.pid);
        const frames = await client.evaluate(`new Promise(resolve => {
          window.__frames = [];
          window.__recordFrames = true;
          const initial = ${JSON.stringify(scenario.rotation)};
          let start;
          const tick = time => {
            if (start === undefined) start = time;
            const progress = Math.min((time - start) / 10000, 1);
            const rotation = initial + progress * 2 * Math.PI;
            ${viewer === 'bluemap' ? 'window.bluemap.mapViewer.controlsManager.rotation = rotation;' : 'window.__setCamera({ rotation });'}
            if (progress < 1) requestAnimationFrame(tick);
            else { window.__recordFrames = false; resolve(window.__frames); }
          };
          requestAnimationFrame(tick);
        })`);
        orbit = orbitStatistics(frames ?? []);
        orbitCpu = subtractCpu(sampleCpu(child.pid), before);
      } catch (cause) { error ??= `Orbit: ${cause}`; }
    }
    const result = {
      viewer, case: caseName, scenario: scenarioName, run: runNumber,
      target: { x: 0, y, z: 0 }, distance: scenario.distance, rotation: scenario.rotation, angle: scenario.angle,
      settle_ms: settled.settleMs ?? null, timed_out: settled.timedOut,
      requests_total: Object.values(counts).reduce((sum, value) => sum + value, 0), requests_by_class: counts,
      requests_unfinished: settled.unfinishedCount ?? 0, requests_unfinished_urls: settled.unfinishedUrls ?? [],
      non_network_requests: nonNetworkRequests, non_network_by_scheme: nonNetworkByScheme,
      transfer_bytes: transferBytes, transfer_by_class: transfers,
      cpu_ms_load_total: loadCpu.total, cpu_ms_load_by_type: loadCpu.byType,
      gl_buffer_bytes: gl.buffer_bytes, gl_texture_bytes: gl.texture_bytes,
      js_heap_used_mb: heapMb, long_tasks_count: page.longTasks?.length ?? 0,
      long_tasks_total_ms: (page.longTasks ?? []).reduce((sum, task) => sum + task.duration, 0),
      orbit, cpu_ms_orbit_total: orbitCpu.total, cpu_ms_orbit_by_type: orbitCpu.byType,
      ...(viewer === 'brisk' ? { brisk_stats: page.stats } : { bluemap_view_distances: distances ?? null }),
      chrome_version: version.Browser, user_agent: version['User-Agent'], started_at: new Date(navigationAt).toISOString(),
      ...(error || page.error || settled.timedOut || networkErrors ? { error: error ?? page.error ?? (settled.timedOut ? 'Settle timeout' : `${networkErrors} network requests failed`) } : {}),
      ...(frameNavigatedAt ? { frame_navigated_at: new Date(frameNavigatedAt).toISOString() } : {}),
    };
    if (append) appendFileSync(out, JSON.stringify(result) + '\n');
    return result;
  } finally { await browser.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFrom(argv);
  if (options.help) { console.log('Usage: node run.mjs --chrome <binary> --scenarios scenarios.json --runs 3 --out results.jsonl [--only viewer:case:scenario] [--headless]'); return; }
  const configuration = JSON.parse(readFileSync(resolve(options.scenarios), 'utf8'));
  mkdirSync(dirname(resolve(options.out)), { recursive: true });
  const only = options.only?.split(':');
  for (const [caseName, setting] of Object.entries(configuration.cases)) {
    for (const [scenarioName, scenario] of Object.entries(configuration.scenarios)) {
      for (let runNumber = 1; runNumber <= options.runs; runNumber++) {
        if (only && (only[1] !== caseName || only[2] !== scenarioName)) continue;
        const common = { caseName, scenarioName, runNumber, scenario, setting, chrome: options.chrome, headless: options.headless, out: options.out };
        if (setting.radius === undefined && only?.[0] === 'brisk') continue;
        const blue = await runOne({ ...common, viewer: 'bluemap', targetY: 70, append: !only || only[0] === 'bluemap' });
        if (!only || only[0] === 'bluemap') console.log(JSON.stringify(blue));
        if (setting.radius !== undefined && (!only || only[0] === 'brisk')) {
          const brisk = await runOne({ ...common, viewer: 'brisk', targetY: blue.target.y });
          console.log(JSON.stringify(brisk));
        }
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error); process.exitCode = 1; });
