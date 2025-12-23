import styles from './SafeAreaScaffold.module.css'

/**
 * SafeAreaScaffold
 *
 * A minimal, low-risk layout primitive:
 * - Protects content from iOS safe areas (top/bottom)
 * - Adds a bottom spacer so content doesn't sit behind BottomNav
 *
 * It intentionally does NOT impose padding/margins on your content.
 * Wrap your existing page container inside it.
 */
export default function SafeAreaScaffold({ children, className = '' }) {
  return (
    <div className={`${styles.scaffold} ${className}`}>
      {children}
      <div className={styles.bottomSpacer} aria-hidden="true" />
    </div>
  )
}


