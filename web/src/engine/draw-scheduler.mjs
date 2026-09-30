const realClock = {
  now: () => performance.now(),
  frame: callback => requestAnimationFrame(callback),
  timeout: (callback, delay) => setTimeout(callback, delay),
  clear: id => clearTimeout(id),
};

export class DrawScheduler {
  constructor(draw, clock = realClock) {
    this.draw = draw;
    this.clock = clock;
    this.lastDrawAt = null;
    this.queued = false;
    this.timer = null;
    this.disposed = false;
  }

  request({loading = false} = {}) {
    if (this.disposed) return;
    if (!loading && this.timer !== null) {
      this.clock.clear(this.timer);
      this.timer = null;
    }
    if (this.queued) return;
    const remaining = loading && this.lastDrawAt !== null ? 100 - (this.clock.now() - this.lastDrawAt) : 0;
    if (remaining > 0) {
      if (this.timer === null) this.timer = this.clock.timeout(() => {
        this.timer = null;
        this.request({loading:true});
      }, remaining);
      return;
    }
    this.queued = true;
    this.clock.frame(time => {
      this.queued = false;
      if (this.disposed) return;
      this.lastDrawAt = this.clock.now();
      this.draw(time);
    });
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
  }
}
