// Injected time source. Nothing in domain/ calls Date.now() or new Date()
// directly — tests supply a FixedClock so "3 hours vs 3 weeks" scenarios are
// deterministic instead of racing the wall clock.

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private readonly current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    (this.current as unknown as { setTime(t: number): void }).setTime(this.current.getTime() + ms);
  }
}
