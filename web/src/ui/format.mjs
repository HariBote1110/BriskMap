// Display formatting helpers (pure).

const MINUS = '−';
const EN_DASH = '–';

// Block coordinate containing the point, as Minecraft shows it (floor).
export function formatCoord(value) {
  if (!Number.isFinite(value)) return EN_DASH;
  const n = Math.floor(value);
  if (n === 0) return '0';
  return n < 0 ? `${MINUS}${-n}` : String(n);
}

export function dimensionKind(dimension) {
  const d = String(dimension ?? '').toLowerCase().replace(/^minecraft:/, '');
  if (d === 'overworld' || d === 'normal') return 'overworld';
  if (d === 'the_nether' || d === 'nether') return 'nether';
  if (d === 'the_end' || d === 'end') return 'end';
  return 'other';
}

const ratio = (done, total) => Math.min(1, Math.max(0, done / total));

// { fraction } while loading (fraction null when totals are unknown), else null.
export function progressInfo(status) {
  if (!status || status.phase !== 'loading') return null;
  const parts = [];
  if (status.regionsTotal > 0) parts.push(ratio(status.regionsLoaded, status.regionsTotal));
  if (status.mode === '3d' && status.chunksTotal > 0) parts.push(ratio(status.chunksReady, status.chunksTotal));
  if (parts.length === 0) return { fraction: null };
  return { fraction: parts.reduce((a, b) => a + b, 0) / parts.length };
}

export function progressText(status, t) {
  const parts = [];
  if (status.regionsTotal > 0) {
    parts.push(t('progress.regions', { done: status.regionsLoaded, total: status.regionsTotal }));
  }
  if (status.chunksTotal > 0) {
    parts.push(t('progress.chunks', { done: status.chunksReady, total: status.chunksTotal }));
  }
  return parts.length ? parts.join(' · ') : t('progress.loading');
}

// Text for the polite live region: only when the phase changes.
export function phaseAnnouncement(previousPhase, status, t) {
  if (!status || status.phase === previousPhase) return null;
  if (status.phase === 'error') return t('announce.error', { message: status.message ?? '' });
  return t(`announce.${status.phase}`);
}
