export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly limit = 120, private readonly windowMs = 60_000) {}

  consume(key: string, now = Date.now()): boolean {
    const start = now - this.windowMs;
    const recent = (this.windows.get(key) ?? []).filter((timestamp) => timestamp > start);
    if (recent.length >= this.limit) return false;
    recent.push(now);
    this.windows.set(key, recent);
    return true;
  }
}
