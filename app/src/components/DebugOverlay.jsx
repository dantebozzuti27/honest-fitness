import { useEffect, useMemo, useState } from 'react'

function formatError(err) {
  if (!err) return 'Unknown error'
  if (err instanceof Error) return `${err.name}: ${err.message}`
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export default function DebugOverlay({ enabled = false }) {
  const [errors, setErrors] = useState([])

  useEffect(() => {
    if (!enabled) return

    const onError = (event) => {
      const err = event?.error || new Error(event?.message || 'Unknown window error')
      setErrors((prev) => [
        { type: 'error', at: new Date().toISOString(), message: formatError(err), stack: err?.stack || '' },
        ...prev
      ].slice(0, 10))
    }

    const onUnhandledRejection = (event) => {
      const reason = event?.reason
      const err = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unhandled promise rejection')
      setErrors((prev) => [
        { type: 'unhandledrejection', at: new Date().toISOString(), message: formatError(err), stack: err?.stack || '' },
        ...prev
      ].slice(0, 10))
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [enabled])

  const content = useMemo(() => {
    if (!enabled) return null
    return errors
  }, [enabled, errors])

  if (!enabled) return null

  return (
    <div style={{
      position: 'fixed',
      top: 10,
      right: 10,
      zIndex: 999999,
      width: 420,
      maxWidth: 'calc(100vw - 20px)',
      maxHeight: 'calc(100vh - 20px)',
      overflow: 'auto',
      background: 'rgba(0,0,0,0.92)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: 12,
      padding: 12,
      color: '#fff',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Debug overlay</div>
        <button
          type="button"
          onClick={() => setErrors([])}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.25)',
            color: '#fff',
            borderRadius: 10,
            padding: '6px 10px',
            cursor: 'pointer'
          }}
        >
          Clear
        </button>
      </div>

      {content.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.7)' }}>No captured errors yet.</div>
      ) : (
        content.map((e, idx) => (
          <div key={`${e.at}-${idx}`} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ color: '#ff453a', fontWeight: 700, marginBottom: 4 }}>
              {e.type} @ {e.at}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{e.message}</div>
            {e.stack ? (
              <div style={{ whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.7)' }}>{e.stack}</div>
            ) : null}
          </div>
        ))
      )}
    </div>
  )
}



