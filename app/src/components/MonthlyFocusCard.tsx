import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getUserPreferences, saveUserPreferences } from '../lib/db/userPreferencesDb'
import {
  computeMonthlyFocusSplitGuard,
  currentMonthKey,
  displayMonthlyFocusState,
  muscleGroupDisplayLabel,
  type MonthlyFocusStateV1,
} from '../lib/monthlyFocus'
import { getLocalDate } from '../utils/dateUtils'
import { logError } from '../utils/logger'
import { useToast } from '../hooks/useToast'
import Button from './Button'

/**
 * Surfaces the user's monthly fitness + life focuses outside Profile.
 *
 * Why a dedicated component:
 *   - Home and TodayWorkout both want the same data; the engine reads it
 *     silently. Without a UI here the user has no way to see whether the
 *     focus is active, mark a habit completion, or know that today is a
 *     "split guard" day for the fitness focus.
 *
 * Variants (`variant` prop):
 *   - `full` (default) — used on Home. Shows both rows, a daily check-off
 *     toggle for the life habit, a month progress count, and a "Set in
 *     Profile" link. Renders an empty-state CTA when no focus is set so
 *     the user can discover the feature.
 *   - `compact` — used on TodayWorkout / WeekAhead. Single-line read-only
 *     banner: "This month's focus: Biceps · light layered today". Nothing
 *     renders if no fitness focus is set, since the compact placement is
 *     primarily there to explain why bicep accessories show up in plans.
 */
type Variant = 'full' | 'compact'

interface MonthlyFocusCardProps {
  variant?: Variant
  onChanged?: (next: MonthlyFocusStateV1) => void
}

const monthLength = (ym: string): number => {
  const [ys, ms] = ym.split('-')
  const y = Number(ys)
  const m = Number(ms)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 31
  return new Date(y, m, 0).getDate()
}

const completionsForMonth = (
  state: MonthlyFocusStateV1,
  ym: string,
): number => {
  let n = 0
  for (const [k, v] of Object.entries(state.life_completions)) {
    if (v && k.startsWith(`${ym}-`)) n += 1
  }
  return n
}

export default function MonthlyFocusCard({
  variant = 'full',
  onChanged,
}: MonthlyFocusCardProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [state, setState] = useState<MonthlyFocusStateV1 | null>(null)
  const [loading, setLoading] = useState(true)
  const [splitGuardActive, setSplitGuardActive] = useState(false)
  const [toggling, setToggling] = useState(false)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const prefs = await getUserPreferences(user.id)
      const ym = currentMonthKey()
      const next = displayMonthlyFocusState(prefs?.monthly_focus_state, ym)
      setState(next)
      const guard = computeMonthlyFocusSplitGuard(
        prefs?.weekly_split_schedule ?? null,
        Array.isArray(prefs?.rest_days) ? prefs.rest_days : null,
        getLocalDate(),
        next.fitness_muscle,
      )
      setSplitGuardActive(guard)
    } catch (err) {
      logError('MonthlyFocusCard load', err)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void load()
  }, [load])

  const ym = currentMonthKey()
  const today = getLocalDate()
  const todayDone = Boolean(state?.life_completions?.[today])
  const monthDone = state ? completionsForMonth(state, ym) : 0
  const monthTotal = monthLength(ym)

  const fitnessLabel = state?.fitness_muscle
    ? muscleGroupDisplayLabel(state.fitness_muscle)
    : ''
  const hasAnyFocus = Boolean(state && (state.fitness_muscle || state.life_label.trim()))

  const toggleToday = async () => {
    if (!user?.id || !state || !state.life_label.trim()) return
    setToggling(true)
    const prev = state
    const next: MonthlyFocusStateV1 = {
      ...state,
      month: ym,
      life_completions: { ...state.life_completions },
    }
    if (next.life_completions[today]) delete next.life_completions[today]
    else next.life_completions[today] = true
    for (const k of Object.keys(next.life_completions)) {
      if (!k.startsWith(`${ym}-`)) delete next.life_completions[k]
    }
    setState(next)
    try {
      await saveUserPreferences(user.id, { monthly_focus_state: next })
      onChanged?.(next)
    } catch (err) {
      logError('MonthlyFocusCard toggle', err)
      setState(prev)
      showToast('Failed to save check-in', 'error')
    } finally {
      setToggling(false)
    }
  }

  if (loading) return null

  if (variant === 'compact') {
    if (!state?.fitness_muscle) return null
    return (
      <button
        type="button"
        onClick={() => navigate('/profile')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 12px',
          margin: '0 0 8px',
          background: 'rgba(20, 184, 166, 0.10)',
          border: '1px solid rgba(20, 184, 166, 0.35)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
          fontSize: 13,
          textAlign: 'left',
          cursor: 'pointer',
        }}
        title="Edit in Profile"
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--accent, #14b8a6)',
          }}
        >
          Monthly focus
        </span>
        <span style={{ fontWeight: 600 }}>{fitnessLabel}</span>
        <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto', fontSize: 12 }}>
          {splitGuardActive ? 'Light layer today (split tomorrow)' : 'Layered into today'}
        </span>
      </button>
    )
  }

  if (!hasAnyFocus) {
    return (
      <div
        style={{
          padding: 16,
          margin: '0 0 12px',
          background: 'var(--bg-secondary)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              Set this month&apos;s focuses
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              One body part to layer into workouts and one daily life habit to track.
            </div>
          </div>
          <Button variant="secondary" onClick={() => navigate('/profile')}>
            Set up
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        padding: 16,
        margin: '0 0 12px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          This month&apos;s focuses
        </div>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent, #14b8a6)',
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Edit in Profile
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: 10,
        }}
      >
        <div
          style={{
            padding: '10px 12px',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              minWidth: 60,
            }}
          >
            Fitness
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {fitnessLabel ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {fitnessLabel}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {splitGuardActive
                    ? 'Light layered work today — split day tomorrow handles the heavy stimulus'
                    : 'Layered into today\u2019s workout when compatible with your split'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                No fitness focus set — pick one in Profile.
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '10px 12px',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              minWidth: 60,
            }}
          >
            Life
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {state?.life_label.trim() ? (
              <>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {state.life_label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {monthDone} / {monthTotal} days this month
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                No life habit set — add one in Profile.
              </div>
            )}
          </div>
          {state?.life_label.trim() && (
            <Button
              variant={todayDone ? 'secondary' : 'primary'}
              onClick={toggleToday}
              loading={toggling}
              style={{ padding: '6px 14px', fontSize: 13, flexShrink: 0 }}
            >
              {todayDone ? 'Done \u2713' : 'Mark today'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
