import styles from './Skeleton.module.css'

export default function Skeleton({ className = '', style }) {
  return <div className={`${styles.skeleton} ${className}`} style={style} aria-hidden="true" />
}



