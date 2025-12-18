import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SideMenu from '../components/SideMenu'
import BackButton from '../components/BackButton'
import SearchField from '../components/SearchField'
import Skeleton from '../components/Skeleton'
import Button from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { getRecentWorkoutsFromSupabase } from '../lib/db/workoutsDb'
import { startWorkout } from '../utils/navIntents'
import styles from './PRs.module.css'

const REP_TARGETS = [1, 3, 5, 8, 10, 12]

export default function PRs() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const selected = (params.get('exercise') || '').toString()

  const [loading, setLoading] = useState(true)
  const [recentWorkouts, setRecentWorkouts] = useState([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!user?.id) return
    let mounted = true
    setLoading(true)
    ;(async () => {
      try {
        const rows = await getRecentWorkoutsFromSupabase(user.id, 200)
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

  const prByExercise = useMemo(() => {
    const map = new Map()
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

          const prev = map.get(name) || {
            name,
            bestE1rm: null,
            bestSet: null,
            repPR: Object.fromEntries(REP_TARGETS.map(r => [r, null]))
          }

          if (!prev.bestE1rm || e1rm > prev.bestE1rm.value) {
            prev.bestE1rm = { value: e1rm, weight, reps, date }
          }
          if (!prev.bestSet || weight > prev.bestSet.weight) {
            prev.bestSet = { weight, reps, date }
          }

          for (const r of REP_TARGETS) {
            if (reps < r) continue
            const cur = prev.repPR[r]
            if (!cur || weight > cur.weight) {
              prev.repPR[r] = { weight, reps, date }
            }
          }

          map.set(name, prev)
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const av = a.bestE1rm?.value || 0
      const bv = b.bestE1rm?.value || 0
      return bv - av
    })
  }, [recentWorkouts])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return prByExercise
    const tokens = q.split(/\s+/).filter(Boolean)
    return prByExercise.filter((p) => tokens.every(t => p.name.toLowerCase().includes(t)))
  }, [prByExercise, query])

  const selectedPR = useMemo(() => {
    if (!selected) return null
    return prByExercise.find(p => p.name === selected) || null
  }, [prByExercise, selected])

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <SideMenu />
        <h1 className={styles.title}>PRs</h1>
        <BackButton />
      </header>

      <div className={styles.searchRow}>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises…"
          onClear={() => setQuery('')}
        />
        <Button variant="secondary" className={styles.closeDetailBtn} onClick={() => { setParams({}); }}>
          Clear
        </Button>
      </div>

      {loading ? (
        <div className={styles.card}>
          <Skeleton style={{ width: '60%', height: 14 }} />
          <div style={{ height: 10 }} />
          <Skeleton style={{ width: '90%', height: 14 }} />
          <div style={{ height: 10 }} />
          <Skeleton style={{ width: '75%', height: 14 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.muted}>No PRs found yet. Log some strength sets.</div>
      ) : (
        <div className={styles.grid}>
          <div className={styles.list}>
            {filtered.slice(0, 80).map((p) => (
              <button
                key={p.name}
                type="button"
                className={`${styles.row} ${selected === p.name ? styles.rowActive : ''}`}
                onClick={() => setParams({ exercise: p.name })}
              >
                <div className={styles.rowLeft}>
                  <div className={styles.rowTitle}>{p.name}</div>
                  <div className={styles.rowSub}>
                    {p.bestE1rm ? `Best e1RM: ${Math.round(p.bestE1rm.value)} · ${p.bestE1rm.reps}×${Math.round(p.bestE1rm.weight)} · ${p.bestE1rm.date}` : '—'}
                  </div>
                </div>
                <div className={styles.rowRight}>
                  <div className={styles.rowValue}>{p.bestE1rm ? Math.round(p.bestE1rm.value) : '—'}</div>
                  <div className={styles.rowUnit}>e1RM</div>
                </div>
              </button>
            ))}
          </div>

          <div className={styles.detail}>
            {!selectedPR ? (
              <div className={styles.detailEmpty}>
                Select an exercise to see rep PRs.
              </div>
            ) : (
              <div className={styles.detailCard}>
                <div className={styles.detailHeader}>
                  <div className={styles.detailTitle}>{selectedPR.name}</div>
                  <Button variant="secondary" onClick={() => startWorkout(navigate, { mode: 'picker', sessionType: 'workout' })}>
                    Train →
                  </Button>
                </div>
                <div className={styles.detailGrid}>
                  {REP_TARGETS.map((r) => {
                    const pr = selectedPR.repPR[r]
                    return (
                      <div key={r} className={styles.prTile}>
                        <div className={styles.prLabel}>{r}RM*</div>
                        <div className={styles.prValue}>{pr ? Math.round(pr.weight) : '—'}</div>
                        <div className={styles.prSub}>{pr ? `${pr.reps} reps · ${pr.date}` : '—'}</div>
                      </div>
                    )
                  })}
                </div>
                <div className={styles.footnote}>
                  *Uses the best weight you’ve lifted for at least that many reps (from recent history).
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


