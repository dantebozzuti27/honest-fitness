import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import Button from '../components/Button'
import Skeleton from '../components/Skeleton'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import { logError } from '../utils/logger'
import { getProgramsByIds, listMyProgramPurchases } from '../lib/db/marketplaceDb'
import styles from './Marketplace.module.css'

export default function Library() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast, hideToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [purchases, setPurchases] = useState([])
  const [programs, setPrograms] = useState([])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    ;(async () => {
      if (!user?.id) return
      try {
        const p = await listMyProgramPurchases(user.id)
        const ids = p.map(x => x.program_id).filter(Boolean)
        const progs = await getProgramsByIds(ids)
        if (!mounted) return
        setPurchases(p)
        setPrograms(progs)
      } catch (e) {
        logError('Library load failed', e)
        showToast('Failed to load your library.', 'error')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [user?.id, showToast])

  const programsById = useMemo(() => {
    const m = {}
    for (const p of Array.isArray(programs) ? programs : []) {
      if (p?.id) m[p.id] = p
    }
    return m
  }, [programs])

  return (
    <div className={styles.container}>
      {toast ? <Toast message={toast.message} type={toast.type} onClose={hideToast} /> : null}

      <div className={styles.header}>
        <BackButton fallbackPath="/profile" />
        <h1>Your Library</h1>
        <div style={{ width: 32 }} />
      </div>

      {loading ? (
        <>
          <Skeleton style={{ width: '100%', height: 120, marginBottom: 12 }} />
          <Skeleton style={{ width: '100%', height: 120, marginBottom: 12 }} />
        </>
      ) : purchases.length === 0 ? (
        <div className={styles.card}>
          <div className={styles.meta}>No programs in your library yet.</div>
          <div style={{ height: 10 }} />
          <Button onClick={() => navigate('/market')}>Browse marketplace</Button>
        </div>
      ) : (
        <div className={styles.grid}>
          {purchases.map((purchase) => {
            const program = programsById[purchase.program_id]
            let enrollment = null
            try {
              if (user?.id && purchase?.program_id) {
                const raw = localStorage.getItem(`program_enroll_${user.id}_${purchase.program_id}`)
                if (raw) enrollment = JSON.parse(raw)
              }
            } catch {
              enrollment = null
            }
            return (
              <div key={purchase.id} className={styles.card}>
                <div className={styles.title}>{program?.title || 'Program'}</div>
                <div className={styles.meta}>
                  {purchase.status?.toUpperCase?.() || 'PAID'} · Added {purchase.created_at ? new Date(purchase.created_at).toLocaleDateString() : ''}
                </div>
                {enrollment?.startDate ? (
                  <div className={styles.meta} style={{ marginTop: 6 }}>
                    Enrolled · Start: {String(enrollment.startDate)} · Scheduled: {Number(enrollment.scheduledCount || 0)}
                  </div>
                ) : null}
                <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                  <Button variant="secondary" onClick={() => navigate(`/market/${purchase.program_id}`)}>
                    View
                  </Button>
                  <Button onClick={() => navigate(`/market/${purchase.program_id}`, { state: { openEnroll: true } })}>
                    Enroll / Schedule
                  </Button>
                  {enrollment ? (
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`/market/${purchase.program_id}`, { state: { openReschedule: true } })}
                    >
                      Reschedule
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


