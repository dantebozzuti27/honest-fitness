import type { CSSProperties } from 'react'
import styles from './Skeleton.module.css'

export default function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`${styles.skeleton} ${className}`} style={style} aria-hidden="true" />
}



