// Event-driven timing helpers: no loops, only timers armed by calls.

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

// Leading + trailing throttle: the first call runs at once, later calls within
// the interval are coalesced into one call with the latest arguments.
export function createThrottle(fn, intervalMs, clock = realClock) {
  let last = -Infinity;
  let timer = null;
  let pendingArgs = null;

  const run = () => {
    timer = null;
    last = clock.now();
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  };

  const throttled = (...args) => {
    pendingArgs = args;
    const wait = last + intervalMs - clock.now();
    if (wait <= 0 && timer === null) run();
    else if (timer === null) timer = clock.setTimeout(run, wait);
  };
  throttled.cancel = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  throttled.flush = () => {
    if (timer === null) return;
    clock.clearTimeout(timer);
    run();
  };
  return throttled;
}

// Returns a function that answers true at most once per interval.
export function createRateLimiter(intervalMs, now = realClock.now) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < intervalMs) return false;
    last = t;
    return true;
  };
}
