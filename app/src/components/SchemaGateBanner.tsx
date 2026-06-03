import { useEffect, useState } from 'react'
import {
  evaluateSchemaGate,
  getSchemaCapabilities,
  runSchemaCapabilityCheck,
  type SchemaGateResult,
} from '../lib/schemaCapability'

export default function SchemaGateBanner() {
  const [gate, setGate] = useState<SchemaGateResult | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const caps = getSchemaCapabilities() ?? (await runSchemaCapabilityCheck().catch(() => null))
      if (cancelled) return
      setGate(evaluateSchemaGate(caps))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (!gate?.message) return null

  const isWarning = gate.ok && gate.missing.length > 0

  return (
    <div
      role="status"
      style={{
        margin: '8px 12px 0',
        padding: '10px 12px',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.45,
        background: isWarning ? 'rgba(230, 168, 0, 0.12)' : 'rgba(239, 68, 68, 0.12)',
        border: `1px solid ${isWarning ? 'rgba(230, 168, 0, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
        color: 'var(--text-secondary)',
      }}
    >
      {gate.message}
    </div>
  )
}
