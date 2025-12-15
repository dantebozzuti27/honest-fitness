import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BackButton from '../components/BackButton'
import SearchField from '../components/SearchField'
import Skeleton from '../components/Skeleton'
import Toast from '../components/Toast'
import { useToast } from '../hooks/useToast'
import { logError } from '../utils/logger'
import { getCoachProfiles, listPublishedPrograms } from '../lib/db/marketplaceDb'
import styles from './Marketplace.module.css'

function formatPrice({ priceCents, currency }) {
  const cents = Number(priceCents || 0)
  if (cents <= 0) return 'Free'
  const dollars = cents / 100
  const curr = String(currency || 'usd').toUpperCase()
  return `${curr} $${dollars.toFixed(2)}`
}

export default function Marketplace() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast, showToast, hideToast } = useToast()

  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [programs, setPrograms] = useState([])
  const [coachMap, setCoachMap] = useState({})
  const lastReqRef = useRef(0)

  const coachIds = useMemo(() => {
    const ids = new Set()
    for (const p of Array.isArray(programs) ? programs : []) {
      if (p?.coachId) ids.add(p.coachId)
    }
    return Array.from(ids)
  }, [programs])

  useEffect(() => {
    let mounted = true
    const reqId = Date.now()
    lastReqRef.current = reqId
    setLoading(true)

    const t = setTimeout(async () => {
      try {
        const list = await listPublishedPrograms({ query, limit: 60 })
        if (!mounted || lastReqRef.current !== reqId) return
        setPrograms(list)
      } catch (e) {
        logError('Marketplace load failed', e)
        if (!mounted) return
        showToast('Failed to load marketplace. Please try again.', 'error')
        setPrograms([])
      } finally {
        if (mounted) setLoading(false)
      }
    }, 250)

    return () => {
      mounted = false
      clearTimeout(t)
    }
  }, [query, showToast])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const map = await getCoachProfiles(coachIds)
        if (!mounted) return
        setCoachMap(map || {})
      } catch {
        // Non-blocking: cards still render without coach names.
      }
    })()
    return () => {
      mounted = false
    }
  }, [coachIds])

  return (
    <div className={styles.container}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={hideToast}
        />
      )}

      <div className={styles.headerRow}>
        <BackButton fallbackPath="/profile" />
        <h1 className={styles.title}>Marketplace</h1>
        {/* keep header balanced */}
        <div style={{ width: 32 }} />
      </div>

      <div className={styles.searchRow}>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search programs…"
          aria-label="Search marketplace"
          onClear={() => setQuery('')}
        />
      </div>

      {loading ? (
        <div className={styles.list}>
          <Skeleton style={{ width: '100%', height: 92 }} />
          <Skeleton style={{ width: '100%', height: 92 }} />
          <Skeleton style={{ width: '100%', height: 92 }} />
        </div>
      ) : programs.length === 0 ? (
        <div className={styles.empty}>
          No programs found.
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
            Coaches can publish from Coach Studio.
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          {programs.map((p) => {
            const coach = coachMap?.[p.coachId]
            const coachName = coach?.displayName || 'Coach'
            return (
              <button
                key={p.id}
                type="button"
                className={styles.card}
                onClick={() => navigate(`/market/${p.id}`)}
              >
                <div className={styles.cardTitle}>{p.title}</div>
                <div className={styles.cardMeta}>
                  {coachName} · {formatPrice({ priceCents: p.priceCents, currency: p.currency })}
                  {user?.id && p.coachId === user.id ? ' · Yours' : ''}
                </div>
                {p.description ? <div className={styles.cardDesc}>{p.description}</div> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}


