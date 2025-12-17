import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SideMenu from '../components/SideMenu'
import BackButton from '../components/BackButton'
import Skeleton from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { getRecentWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { getLocalDate, getTodayEST } from '../utils/dateUtils'
import styles from './Progress.module.css'

export default function Progress() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [recentWorkouts, setRecentWorkouts] = useState([])

  useEffect(() => {
    if (!user?.id) return
    let mounted = true
    setLoading(true)
    ;(async () => {
      try {
        const rows = await getRecentWorkoutsFromSupabase(user.id, 100)
        if (!mounted) return
        setRecentWorkouts(Array.isArray(rows) ? rows : [])
      } catch {
        if (!mounted) return
        setRecentWorkouts([])
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [user?.id])

  const prList = useMemo(() => {
    // Estimated 1RM via Epley: e1rm = weight * (1 + reps/30)
    const best = new Map()
    for (const w of Array.isArray(recentWorkouts) ? recentWorkouts : []) {
      const date = (w?.date || '').toString()
      for (const ex of Array.isArray(w?.workout_exercises) ? w.workout_exercises : []) {
        const name = (ex?.exercise_name || '').toString().trim()
        if (!name) continue
        const sets = Array.isArray(ex?.workout_sets) ? ex.workout_sets : []
        for (const s of sets) {
          const weight = Number(s?.weight)
          const reps = Number(s?.reps)
          if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) continue
          const e1rm = weight * (1 + reps / 30)
          const prev = best.get(name)
          if (!prev || e1rm > prev.e1rm) {
            best.set(name, { name, e1rm, weight, reps, date })
          }
        }
      }
    }
    return Array.from(best.values())
      .sort((a, b) => b.e1rm - a.e1rm)
      .slice(0, 12)
  }, [recentWorkouts])

  const weeklyMuscleSummary = useMemo(() => {
    const today = getTodayEST()
    const dt = new Date(`${today}T12:00:00`)
    dt.setDate(dt.getDate() - 6)
    const cutoff = getLocalDate(dt)

    const byPart = new Map()
    for (const w of Array.isArray(recentWorkouts) ? recentWorkouts : []) {
      const date = (w?.date || '').toString()
      if (!date || date < cutoff) continue
      for (const ex of Array.isArray(w?.workout_exercises) ? w.workout_exercises : []) {
        const part = (ex?.body_part || 'Other').toString() || 'Other'
        const sets = Array.isArray(ex?.workout_sets) ? ex.workout_sets : []
        const strengthSets = sets.filter(s => (s?.weight && s?.reps))
        const setCount = strengthSets.length
        const volume = strengthSets.reduce((sum, s) => sum + (Number(s.weight) * Number(s.reps)), 0)
        if (setCount === 0 && volume === 0) continue
        const prev = byPart.get(part) || { bodyPart: part, sets: 0, volume: 0 }
        prev.sets += setCount
        prev.volume += volume
        byPart.set(part, prev)
      }
    }
    return Array.from(byPart.values()).sort((a, b) => b.sets - a.sets).slice(0, 10)
  }, [recentWorkouts])

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>Progress</h1>
        <BackButton />
      </header>

      <div className={styles.grid}>
        <button className={styles.card} onClick={() => navigate('/analytics')}>
          <div className={styles.cardTitle}>Analytics</div>
          <div className={styles.cardSubtitle}>Trends, readiness, and insights</div>
        </button>

        <button className={styles.card} onClick={() => navigate('/calendar')}>
          <div className={styles.cardTitle}>Calendar</div>
          <div className={styles.cardSubtitle}>Schedule + review sessions</div>
        </button>

        <button className={styles.card} onClick={() => navigate('/planner')}>
          <div className={styles.cardTitle}>Plan</div>
          <div className={styles.cardSubtitle}>Weekly plan + today’s focus</div>
        </button>
      </div>

      <div style={{ height: 16 }} />

      <div className={styles.section}>
        <div className={styles.sectionHeaderRow}>
          <div className={styles.sectionTitle}>Top PRs (Estimated 1RM)</div>
          <button className={styles.sectionLink} onClick={() => navigate('/progress/prs')} type="button">
            See more →
          </button>
        </div>
        {loading ? (
          <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton style={{ width: '60%', height: 14 }} />
            <Skeleton style={{ width: '85%', height: 14 }} />
            <Skeleton style={{ width: '70%', height: 14 }} />
          </div>
        ) : prList.length === 0 ? (
          <div className={styles.muted}>Log some strength sets to see PRs here.</div>
        ) : (
          <div className={styles.list}>
            {prList.map((r) => (
              <div key={r.name} className={styles.row}>
                <div className={styles.rowLeft}>
                  <div className={styles.rowTitle}>{r.name}</div>
                  <div className={styles.rowSub}>
                    Best set: {r.reps}×{Math.round(r.weight)} · {r.date}
                  </div>
                </div>
                <div className={styles.rowRight}>
                  <div className={styles.rowValue}>{Math.round(r.e1rm)}</div>
                  <div className={styles.rowUnit}>e1RM</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 16 }} />

      <div className={styles.section}>
        <div className={styles.sectionHeaderRow}>
          <div className={styles.sectionTitle}>Weekly sets by muscle (last 7 days)</div>
        </div>
        {loading ? (
          <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton style={{ width: '45%', height: 14 }} />
            <Skeleton style={{ width: '80%', height: 14 }} />
            <Skeleton style={{ width: '70%', height: 14 }} />
          </div>
        ) : weeklyMuscleSummary.length === 0 ? (
          <div className={styles.muted}>No weekly volume yet.</div>
        ) : (
          <div className={styles.list}>
            {weeklyMuscleSummary.map((m) => (
              <div key={m.bodyPart} className={styles.row}>
                <div className={styles.rowLeft}>
                  <div className={styles.rowTitle}>{m.bodyPart}</div>
                  <div className={styles.rowSub}>
                    {m.sets} sets · {Math.round(m.volume).toLocaleString()} lbs volume
                  </div>
                </div>
                <div className={styles.rowRight}>
                  <div className={styles.rowValue}>{m.sets}</div>
                  <div className={styles.rowUnit}>sets</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


