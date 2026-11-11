/**
 * GPU time of whole frames, where the browser exposes it
 * (`EXT_disjoint_timer_query_webgl2`: Chrome and Edge on desktop; Safari and
 * most phones do not, and then `available` is false and nothing is measured).
 *
 * Queries are asynchronous: a result is read a few frames later from a small
 * ring, never waited for. A disjoint event (power state change, context
 * switch) discards the results in flight.
 */
type TimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

const RING = 4;

export class GpuTimer {
  readonly available: boolean;
  private readonly gl: WebGL2RenderingContext | null;
  private readonly extension: TimerExtension | null;
  private readonly queries: (WebGLQuery | null)[] = [];
  private readonly pending: boolean[] = [];
  private head = 0;
  private running = false;

  constructor(context: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext ? context : null;
    const extension = gl ? (gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null) : null;
    this.gl = gl;
    this.extension = extension;
    this.available = Boolean(gl && extension);
    if (this.available && gl) {
      for (let index = 0; index < RING; index += 1) {
        this.queries.push(gl.createQuery());
        this.pending.push(false);
      }
    }
  }

  /** Starts timing a frame; skipped if every query is still in flight. */
  begin(): void {
    const gl = this.gl;
    const extension = this.extension;
    if (!gl || !extension || this.running || this.pending[this.head]) return;
    const query = this.queries[this.head];
    if (!query) return;
    gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
    this.running = true;
  }

  end(): void {
    const gl = this.gl;
    const extension = this.extension;
    if (!gl || !extension || !this.running) return;
    gl.endQuery(extension.TIME_ELAPSED_EXT);
    this.pending[this.head] = true;
    this.head = (this.head + 1) % RING;
    this.running = false;
  }

  /** Oldest finished measurement in milliseconds, or null if none is ready. */
  poll(): number | null {
    const gl = this.gl;
    const extension = this.extension;
    if (!gl || !extension) return null;
    const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
    let result: number | null = null;
    for (let offset = 0; offset < RING; offset += 1) {
      const index = (this.head + offset) % RING;
      const query = this.queries[index];
      if (!this.pending[index] || !query) continue;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending[index] = false;
      if (disjoint) continue;
      result = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
    }
    return result;
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.running && this.extension) gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    for (const query of this.queries) if (query) gl.deleteQuery(query);
    this.queries.length = 0;
  }
}
