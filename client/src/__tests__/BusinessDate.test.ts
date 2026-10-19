import { describe, it, expect } from 'vitest';
import { addBusinessDays, businessDateKey, businessInstant } from '../utils/businessDate';

describe('business date helpers', () => {
  it('reads the IST calendar day, not the UTC day, around IST midnight', () => {
    expect(businessDateKey(new Date('2026-10-18T18:29:59.000Z'))).toBe('2026-10-18');
    expect(businessDateKey(new Date('2026-10-18T18:30:00.000Z'))).toBe('2026-10-19');
  });

  it('steps business days across a month boundary', () => {
    expect(addBusinessDays('2026-10-01', -7)).toBe('2026-09-24');
    expect(addBusinessDays('2026-10-19', 0)).toBe('2026-10-19');
  });

  it('turns IST wall-clock times into the matching instant', () => {
    expect(businessInstant('2026-10-19')).toBe('2026-10-18T18:30:00.000Z');
    expect(businessInstant('2026-10-19', '21:00')).toBe('2026-10-19T15:30:00.000Z');
  });
});
