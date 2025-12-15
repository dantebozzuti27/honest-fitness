import styles from './Progress.module.css'

export default function Progress({ 
  value, // 0-100
  max = 100,
  size = 'md', // 'sm', 'md', 'lg'
  showLabel = false,
  className = '',
  variant = 'default' // 'default', 'success', 'warning', 'danger'
}) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))
  
  return (
    <div className={`${styles.progress} ${styles[size]} ${className}`}>
      <div className={styles.progressBar}>
        <div 
          className={`${styles.progressFill} ${styles[variant]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className={styles.progressLabel}>{Math.round(percentage)}%</span>
      )}
    </div>
  )
}

