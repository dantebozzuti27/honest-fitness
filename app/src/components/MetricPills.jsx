import styles from './MetricPills.module.css'
import { formatSleep, formatSteps, formatWeightLbs } from '../utils/metricFormatters'

export default function MetricPills({
  steps,
  sleep,
  weight,
  max = 3
}) {
  const items = []

  const stepsText = formatSteps(steps)
  if (stepsText) items.push({ id: 'steps', label: 'Steps', value: stepsText })

  const sleepText = formatSleep(sleep)
  if (sleepText) items.push({ id: 'sleep', label: 'Sleep', value: sleepText })

  const weightText = formatWeightLbs(weight)
  if (weightText) items.push({ id: 'weight', label: 'Weight', value: weightText })

  const shown = items.slice(0, Math.max(0, Number(max) || 0))
  if (shown.length === 0) return null

  return (
    <div className={styles.row} aria-label="Health metrics">
      {shown.map((it) => (
        <span key={it.id} className={styles.pill} aria-label={`${it.label}: ${it.value}`}>
          <span className={styles.pillLabel}>{it.label}</span>
          <span className={styles.pillValue}>{it.value}</span>
        </span>
      ))}
    </div>
  )
}


