/**
 * Live lap delta: how far ahead of or behind your own best lap you are, updated at twenty
 * points round the lap. Best laps are kept per track and speed class in this browser.
 */
const SPLITS = 20;

export class LapDelta {
  private best: number[] | null = null;
  private current: number[] = [];
  private lapStart = 0;
  private last = -1;
  private clean = false;
  private readonly key: string;
  /** Seconds against the best lap at the last split passed; null until there is a best to compare with. */
  value: number | null = null;

  constructor(trackId: string, speedClass: number) {
    this.key = `office-kart:splits:${trackId}:${speedClass}`;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? "null") as number[] | null;
      if (Array.isArray(saved) && saved.length === SPLITS) this.best = saved;
    } catch {
      this.best = null;
    }
  }

  /** `frac` is progress round the lap, 0..1; `now` in milliseconds. */
  update(frac: number, now: number): void {
    if (this.last < 0) {
      this.last = frac;
      this.lapStart = now;
      this.clean = frac < 0.03 || frac > 0.97;
      return;
    }
    const wrapped = this.last > 0.8 && frac < 0.2;
    if (wrapped) {
      // Across the line: a complete lap that beats the best becomes the new yardstick.
      const lap = now - this.lapStart;
      if (this.clean && this.current.length === SPLITS - 1) {
        const full = [...this.current, lap];
        if (!this.best || lap < this.best[SPLITS - 1]) {
          this.best = full;
          try {
            localStorage.setItem(this.key, JSON.stringify(full.map((v) => Math.round(v))));
          } catch {
            // Storage is full or blocked: the delta still works for this session.
          }
        }
        if (this.best) this.value = (lap - this.best[SPLITS - 1]) / 1000;
      }
      this.current = [];
      this.lapStart = now;
      this.clean = true;
    } else if (frac > this.last) {
      const passed = Math.floor(frac * SPLITS);
      while (this.current.length < passed && this.current.length < SPLITS - 1) {
        this.current.push(now - this.lapStart);
        const i = this.current.length - 1;
        if (this.best && this.clean) this.value = (this.current[i] - this.best[i]) / 1000;
      }
    }
    this.last = frac;
  }
}
