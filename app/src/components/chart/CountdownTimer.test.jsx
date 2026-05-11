import { describe, it, expect, vi } from 'vitest';
import { computeRemainingSec } from './CountdownTimer';


describe('computeRemainingSec', () => {
  it('returns seconds until next bar boundary', () => {
    // At 9:30:30, with 5-min bars, next boundary is 9:35:00 → 270s remaining
    const barStart = 1715085000;  // 09:30:00 ET (assumed)
    const tfSeconds = 300;
    const now = 1715085030;  // 30s into bar
    expect(computeRemainingSec(barStart, tfSeconds, now)).toBe(270);
  });

  it('returns 0 when bar just closed', () => {
    expect(computeRemainingSec(1715085000, 300, 1715085300)).toBe(0);
  });

  it('handles 1-minute bars', () => {
    expect(computeRemainingSec(1715085000, 60, 1715085015)).toBe(45);
  });

  it('handles 1-hour bars', () => {
    expect(computeRemainingSec(1715085000, 3600, 1715085600)).toBe(3000);
  });

  it('returns null for non-intraday tf', () => {
    expect(computeRemainingSec(1715085000, null, 1715085030)).toBe(null);
  });

  it('clamps negative (overdue) to 0', () => {
    expect(computeRemainingSec(1715085000, 300, 1715085999)).toBe(0);
  });
});
