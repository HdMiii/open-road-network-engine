// Optional progress reporting for full-map centrality computations.
//
// A full-map analysis runs one shortest-path search per segment, so the natural
// progress signal is "roots completed / total roots". These helpers let the
// per-root drivers report that signal without affecting any computed value: the
// ticker only ever *calls back*; it never changes iteration order, reached
// counts, or results, so analysis parity is preserved.

export type AnalysisProgressCallback = (completed: number, total: number) => void;

export type ProgressTick = (completed: number) => void;

// Returns a `tick(completed)` to call at the top of a per-root loop. It forwards
// to `onProgress` at most ~`steps` times across the whole run, and never at
// completed === 0 (callers emit an explicit "started" event for that). When no
// callback is supplied it returns a no-op so the hot path stays allocation- and
// branch-free beyond a single function call per root.
export function makeProgressTicker(
  total: number,
  onProgress?: AnalysisProgressCallback,
  steps = 100
): ProgressTick {
  if (!onProgress || total <= 0) return () => {};
  const stride = Math.max(1, Math.floor(total / steps));
  return (completed) => {
    if (completed > 0 && completed % stride === 0) onProgress(completed, total);
  };
}
