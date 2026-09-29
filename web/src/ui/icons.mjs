// Inline SVG icons (24 × 24, stroked with currentColor). No network resources.

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const ICONS = {
  overworld: svg('<circle cx="16.5" cy="7" r="2.5"/><path d="M2.5 19.5 8.5 11l4 5 2.5-3 6.5 6.5z" fill="currentColor" fill-opacity=".25"/>'),
  nether: svg('<path d="M12 2.8c.9 3.9 5.3 5.6 5.3 10.4a5.3 5.3 0 0 1-10.6 0c0-2.6 1.6-3.8 2.1-5.8 1 1.5 1.6 2.6 3.1 3.1.6-2.6-.5-5.1.1-7.7z" fill="currentColor" fill-opacity=".25"/>'),
  end: svg('<path d="M2 12s3.6-6.2 10-6.2S22 12 22 12s-3.6 6.2-10 6.2S2 12 2 12z"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>'),
  other: svg('<circle cx="12" cy="12" r="5.2" fill="currentColor" fill-opacity=".25"/><path d="M5.1 15.2C2.6 17.7 2.9 19.6 6.6 19c3.1-.5 7.2-2.6 10.2-5.2 3.1-2.6 4.6-5 3.5-6-.6-.6-1.8-.6-3.4-.1"/>'),
  chevronDown: svg('<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  link: svg('<path d="M10 13.5a4.6 4.6 0 0 0 6.6.4l2.8-2.8a4.6 4.6 0 0 0-6.5-6.5l-1.6 1.6"/><path d="M14 10.5a4.6 4.6 0 0 0-6.6-.4l-2.8 2.8a4.6 4.6 0 0 0 6.5 6.5l1.6-1.6"/>'),
  help: svg('<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6.9c0 2-2.8 2.5-2.8 4.4"/><circle cx="12" cy="17.7" r=".4" fill="currentColor"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  info: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".4" fill="currentColor"/>'),
  warning: svg('<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5"/><circle cx="12" cy="17" r=".4" fill="currentColor"/>'),
  error: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.6" r=".4" fill="currentColor"/>'),
  clock: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.2 2"/>'),
  offline: svg('<path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.6 5.2A15 15 0 0 1 22 8.8M5.3 12.6a10 10 0 0 1 3.4-2M13.5 10.2a10 10 0 0 1 5.2 2.4M8.8 16.2a5 5 0 0 1 6.4 0"/><circle cx="12" cy="19.5" r=".5" fill="currentColor"/><path d="m3 3 18 18"/>'),
  display: svg('<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20.5h8M12 16.5v4M8.5 8.5l7 4.5M15.5 8.5l-7 4.5"/>'),
};
