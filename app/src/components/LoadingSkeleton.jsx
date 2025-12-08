import styles from './LoadingSkeleton.module.css'

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className={styles.tableSkeleton}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.tableRow}>
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className={styles.tableCell}></div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ count = 3 }) {
  return (
    <div className={styles.cardGrid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.card}>
          <div className={styles.cardHeader}></div>
          <div className={styles.cardBody}>
            <div className={styles.cardLine}></div>
            <div className={styles.cardLine}></div>
            <div className={styles.cardLineShort}></div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ items = 5 }) {
  return (
    <div className={styles.list}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className={styles.listItem}>
          <div className={styles.listIcon}></div>
          <div className={styles.listContent}>
            <div className={styles.listLine}></div>
            <div className={styles.listLineShort}></div>
          </div>
        </div>
      ))}
    </div>
  )
}

