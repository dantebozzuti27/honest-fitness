import { useState } from 'react'
import styles from './Image.module.css'
import Spinner from './Spinner'

export default function Image({ 
  src, 
  alt, 
  className = '', 
  placeholder,
  fallback,
  ...props 
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const handleLoad = () => {
    setLoading(false)
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
  }

  if (error) {
    return (
      <div className={`${styles.imageError} ${className}`} {...props}>
        {fallback || (
          <div className={styles.errorIcon}>
            <span>📷</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`${styles.imageContainer} ${className}`} {...props}>
      {loading && (
        <div className={styles.imagePlaceholder}>
          {placeholder || <Spinner size="sm" color="secondary" />}
        </div>
      )}
      <img
        src={src}
        alt={alt}
        onLoad={handleLoad}
        onError={handleError}
        className={`${styles.image} ${loading ? styles.loading : ''}`}
        loading="lazy"
      />
    </div>
  )
}

