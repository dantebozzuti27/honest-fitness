import { describe, expect, it } from 'vitest'
import { computeMonthlyFocusSplitGuard } from '../../src/lib/monthlyFocus'

describe('computeMonthlyFocusSplitGuard', () => {
  const schedule = {
    '1': {
      focus: 'Push',
      groups: ['mid_chest', 'triceps'],
    },
    '2': {
      focus: 'Pull',
      groups: ['back_lats', 'biceps'],
    },
  }

  it('is true when tomorrow split includes the focus muscle', () => {
    // Monday (1) plan date -> Tuesday (2) is pull w/ biceps
    expect(
      computeMonthlyFocusSplitGuard(schedule, [], '2026-05-11', 'biceps'),
    ).toBe(true)
  })

  it('is false on rest day tomorrow', () => {
    expect(
      computeMonthlyFocusSplitGuard(schedule, [2], '2026-05-11', 'biceps'),
    ).toBe(false)
  })

  it('is false when tomorrow does not train that muscle', () => {
    expect(
      computeMonthlyFocusSplitGuard(schedule, [], '2026-05-12', 'biceps'),
    ).toBe(false)
  })
})
