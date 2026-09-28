const display = document.getElementById('result');
const params = new URLSearchParams(location.search);
const count = Number(params.get('regions') ?? Infinity);
const impl = params.get('impl') ?? 'js', mode = params.get('mode') ?? 'culled';
const workerCounts = (params.get('workers') ?? '1,2,4,8').split(',').map(Number);
const passes = Number(params.get('passes') ?? 5);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function requireResponse(response) { if (!response.ok) throw new Error(`${response.url}: HTTP ${response.status}`); return response; }
function messages(worker) {
  const queue = [], waiters = [];
  worker.onmessage = ({ data }) => { if (data.type === 'error') { const waiter = waiters.shift(); if (waiter) waiter.reject(new Error(data.message)); else queue.push(data); }
    else { const waiter = waiters.shift(); if (waiter) waiter.resolve(data); else queue.push(data); } };
  worker.onerror = event => { const failure = { type: 'error', message: event.message ?? 'Worker failed' }; const waiter = waiters.shift(); if (waiter) waiter.reject(new Error(failure.message)); else queue.push(failure); };
  return () => queue.length ? (queue[0].type === 'error' ? Promise.reject(new Error(queue.shift().message)) : Promise.resolve(queue.shift())) : new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}
async function run() {
  if (!['js', 'wasm'].includes(impl) || !['culled', 'greedy'].includes(mode) || !Number.isInteger(passes) || passes < 1 || workerCounts.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Invalid query parameters');
  const files = (await requireResponse(await fetch('/data/index.json')).json()).slice(0, count);
  if (!files.length) throw new Error('No .b3d region files');
  const report = { impl, mode, regions: files.length, passes, hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent, results: [] };
  for (const workerCount of workerCounts) {
    const workers = Array.from({ length: workerCount }, () => new Worker('./worker.mjs', { type: 'module' }));
    const next = workers.map(messages);
    try {
      await Promise.all(next.map(take => take()));
      const regionBytes = await Promise.all(files.map(async file => (await requireResponse(await fetch(`/data/${encodeURIComponent(file)}`))).arrayBuffer()));
      const decodeStart = performance.now();
      for (let i = 0; i < files.length; i++) workers[i % workerCount].postMessage({ type: 'decode', id: i, bytes: regionBytes[i] }, [regionBytes[i]]);
      const decoded = await Promise.all(workers.map(async (_, wi) => {
        const regions = [];
        for (let i = wi; i < files.length; i += workerCount) regions.push(await next[wi]());
        return regions;
      }));
      const decodeMs = performance.now() - decodeStart;
      const sorted = decoded.flat().sort((a, b) => a.id - b.id).flatMap(item => item.chunks);
      const assignments = Array.from({ length: workerCount }, () => []);
      const transfer = Array.from({ length: workerCount }, () => []);
      sorted.forEach((chunk, index) => {
        const wi = index % workerCount;
        assignments[wi].push(chunk);
        transfer[wi].push(chunk.positions.buffer, chunk.paletteIndices.buffer, chunk.masks.buffer);
      });
      for (let wi = 0; wi < workerCount; wi++) workers[wi].postMessage({ type: 'assign', impl, chunks: assignments[wi] }, transfer[wi]);
      await Promise.all(next.map(take => take()));
      const measurements = [];
      for (let pass = 0; pass < passes; pass++) {
        const start = performance.now();
        for (const worker of workers) worker.postMessage({ type: 'mesh', impl, mode });
        const totals = await Promise.all(next.map(async (take, wi) => {
          let received = 0;
          for (;;) {
            const message = await take();
            if (message.type === 'finished') return message;
            if (message.type === 'buffers' && ++received % 32 === 0) workers[wi].postMessage({ type: 'ack' });
          }
        }));
        measurements.push({ wallMs: performance.now() - start, chunks: totals.reduce((n, item) => n + item.chunks, 0), quads: totals.reduce((n, item) => n + item.quads, 0), vertexBytes: totals.reduce((n, item) => n + item.vertexBytes, 0) });
      }
      const times = measurements.map(item => item.wallMs);
      report.results.push({ workers: workerCount, decode_ms: decodeMs, wall_ms_median: median(times), wall_ms_min: Math.min(...times), wall_ms_max: Math.max(...times), chunks: measurements[0].chunks, quads: measurements[0].quads, vertex_bytes: measurements[0].vertexBytes });
      display.textContent = JSON.stringify(report, null, 2);
    } finally { workers.forEach(worker => worker.terminate()); }
  }
  window.__benchResult = report; window.__benchDone = true;
}
run().catch(error => { window.__benchResult = { error: String(error?.stack ?? error) }; window.__benchDone = true; display.textContent = JSON.stringify(window.__benchResult, null, 2); });
