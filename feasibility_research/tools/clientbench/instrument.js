(() => {
  window.__glStats = { buffer_bytes: 0, texture_bytes: 0, calls: 0 };
  window.__longTasks = [];
  window.__frames = [];
  window.__recordFrames = false;
  const bytes = value => ArrayBuffer.isView(value) || value instanceof ArrayBuffer ? value.byteLength : 0;
  const slicedBytes = (value, offset, length) => {
    const width = value?.BYTES_PER_ELEMENT ?? 1;
    const available = Math.max(0, bytes(value) - (offset ?? 0) * width);
    return length === undefined ? available : Math.min(available, length * width);
  };
  const imageBytes = value => {
    if (!value) return 0;
    const width = value.videoWidth ?? value.width;
    const height = value.videoHeight ?? value.height;
    return typeof width === 'number' && typeof height === 'number' ? width * height * 4 : 0;
  };
  const textureBytes = (name, args) => {
    if (name.startsWith('compressed')) {
      const dataIndex = name.includes('3D') ? 7 : 6;
      const data = args[dataIndex];
      if (bytes(data)) return slicedBytes(data, args[dataIndex + 1], args[dataIndex + 2]);
      return Number(data) || 0;
    }
    const sourceIndex = name === 'texImage2D' ? (args.length <= 6 ? 5 : 8)
      : name === 'texImage3D' ? 9 : name === 'texSubImage2D' ? (args.length <= 7 ? 6 : 8) : 10;
    const source = args[sourceIndex];
    if (args.length <= 6) return imageBytes(source) || bytes(source);
    if (source === null) return 0;
    if (bytes(source)) return slicedBytes(source, args[sourceIndex + 1]);
    if (imageBytes(source)) return imageBytes(source);
    const dimensions = name.includes('3D') ? 3 : 2;
    const width = Number(args[name.startsWith('texSub') ? (dimensions === 3 ? 5 : 4) : 3]) || 0;
    const height = Number(args[name.startsWith('texSub') ? (dimensions === 3 ? 6 : 5) : 4]) || 0;
    const depth = dimensions === 3 ? Number(args[name.startsWith('texSub') ? 7 : 5]) || 0 : 1;
    return width * height * depth * 4;
  };
  for (const constructor of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!constructor) continue;
    for (const name of ['bufferData', 'bufferSubData', 'texImage2D', 'texImage3D', 'texSubImage2D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexImage3D']) {
      const original = constructor.prototype[name];
      if (typeof original !== 'function' || original.__instrumented) continue;
      const wrapped = function (...args) {
        const upload = name.startsWith('buffer')
          ? name === 'bufferData' && typeof args[1] === 'number' ? args[1]
            : name === 'bufferData' ? slicedBytes(args[1], args[3], args[4]) : slicedBytes(args[2], args[3], args[4])
          : textureBytes(name, args);
        window.__glStats[name.startsWith('buffer') ? 'buffer_bytes' : 'texture_bytes'] += upload;
        window.__glStats.calls++;
        return original.apply(this, args);
      };
      wrapped.__instrumented = true;
      constructor.prototype[name] = wrapped;
    }
  }
  if (globalThis.PerformanceObserver) {
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* Unsupported entry type. */ }
  }
  const frame = timestamp => {
    if (window.__recordFrames) window.__frames.push(timestamp);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
