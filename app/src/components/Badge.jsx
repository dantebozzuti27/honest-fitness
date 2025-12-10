import styles from './Badge.module.css'

export default function Badge({ 
  children, 
  variant = 'default', // 'default', 'primary', 'success', 'warning', 'danger'
  size = 'md', // 'xs', 'sm', 'md', 'lg'
  className = '' 
}) {
  return (
    <span className={`${styles.badge} ${styles[variant]} ${styles[size]} ${className}`}>
      {children}
    </span>
  )
}

