import { describe, expect, it } from 'vitest';
import { depthMap } from '../src/scene/layout';
import { fmtDistance, fmtDofCm, fmtF, fmtRange, fmtRatio, splitDistance } from '../src/ui/format';

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

  it('splits the big Focus readout with the same units, km at the far end of the ladder (review F38)', () => {
    expect(splitDistance(786)).toEqual({ value: '78.6', unit: 'cm' });
    expect(splitDistance(2000)).toEqual({ value: '2.00', unit: 'm' });
    expect(splitDistance(30000)).toEqual({ value: '30.0', unit: 'm' });
    expect(splitDistance(200000)).toEqual({ value: '200', unit: 'm' });
    expect(splitDistance(9.21e7)).toEqual({ value: '92.1', unit: 'km' }); // was "92100.0 m"
    expect(splitDistance(9.283e8)).toEqual({ value: '928', unit: 'km' }); // was "928317.8 m"
    expect(splitDistance(Infinity)).toEqual({ value: '∞', unit: '' });
    expect(fmtDistance(9.21e7)).toBe('92.1 km');
    expect(fmtDistance(9.283e8)).toBe('928 km');
    // beyond 99 999 km a power of ten keeps the number short
    expect(splitDistance(5.24e10)).toEqual({ value: '52400', unit: 'km' });
    expect(splitDistance(1.984e11)).toEqual({ value: '2·10⁵', unit: 'km' });
    expect(fmtDistance(1.995e12)).toBe('2·10⁶ km');
    expect(fmtDistance(9.6e12)).toBe('1·10⁷ km');
    expect(fmtDistance(3e21)).toBe('3·10¹⁵ km');
    // the same number in the big readout and the slider output, and at most five digits at every
    // slider step (the 27 px readout cell holds five digits + "km" down to a 1024 px window)
    for (let i = 0; i <= 999; i++) {
      const d = depthMap.fromU(i / 1000);
      const s = splitDistance(d);
      expect(fmtDistance(d)).toBe(`${s.value} ${s.unit}`);
      expect([...s.value.replace('.', '')].length).toBeLessThanOrEqual(5);
    }
  });

  it('formats depth of field and reproduction ratios', () => {
    expect(fmtDofCm(0.36)).toBe('0.36 mm');
    expect(fmtDofCm(28)).toBe('2.8 cm');
    expect(fmtDofCm(600)).toBe('60 cm');
    expect(fmtRatio(1)).toBe('1:1');
  });
});
