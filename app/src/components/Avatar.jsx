import styles from './Avatar.module.css'
import Image from './Image'

export default function Avatar({
  src,
  alt,
  name,
  size = 'md', // 'xs', 'sm', 'md', 'lg'
  className = ''
}) {
  const initial = name ? name.charAt(0).toUpperCase() : '?'

  return (
    <div className={`${styles.avatar} ${styles[size]} ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={alt || name || 'Avatar'}
          className={styles.avatarImage}
        />
      ) : (
        <div className={styles.avatarPlaceholder}>
          {initial}
        </div>
      )}
    </div>
  )
}

