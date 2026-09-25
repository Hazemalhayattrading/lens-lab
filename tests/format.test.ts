import { describe, expect, it } from 'vitest';
import { fmtDistance, fmtDofCm, fmtF, fmtRange, fmtRatio } from '../src/ui/format';

describe('UI formatters', () => {
  it('formats distances across scales', () => {
    expect(fmtDistance(786)).toBe('78.6 cm');
    expect(fmtDistance(2000)).toBe('2.00 m');
    expect(fmtDistance(30000)).toBe('30.0 m');
    expect(fmtDistance(200000)).toBe('200 m');
    expect(fmtDistance(Infinity)).toBe('∞');
  });

  it('shares the unit in a range when both ends use it', () => {
    expect(fmtRange(786, 814)).toBe('78.6–81.4 cm');
    expect(fmtRange(29700, 30300)).toBe('29.7–30.3 m');
    expect(fmtRange(900, 1100)).toBe('90.0 cm – 1.10 m');
    expect(fmtRange(20000, Infinity)).toBe('20.0 m – ∞');
    expect(fmtRange(299.8, 300.2)).toBe('30.0 cm ± 0.20 mm');
  });

  it('keeps published two-decimal f-numbers', () => {
    expect(fmtF(0.95)).toBe('f/0.95');
    expect(fmtF(1.78)).toBe('f/1.78');
    expect(fmtF(2.8)).toBe('f/2.8');
    expect(fmtF(16)).toBe('f/16');
  });

  it('formats depth of field and reproduction ratios', () => {
    expect(fmtDofCm(0.36)).toBe('0.36 mm');
    expect(fmtDofCm(28)).toBe('2.8 cm');
    expect(fmtDofCm(600)).toBe('60 cm');
    expect(fmtRatio(1)).toBe('1:1');
  });
});
