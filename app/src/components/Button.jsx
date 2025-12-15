import { forwardRef } from 'react'
import styles from './Button.module.css'

const Button = forwardRef(function Button(
  {
    unstyled = false,
    variant = 'primary', // primary | secondary | tertiary | destructive
    size = 'md', // sm | md | lg
    loading = false,
    disabled = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    className = '',
    children,
    type = 'button',
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading
  const v = styles[variant] || styles.primary
  const s = styles[size] || styles.md

  if (unstyled) {
    return (
      <button
        ref={ref}
        type={type}
        className={className}
        disabled={isDisabled}
        aria-busy={loading ? 'true' : undefined}
        {...props}
      >
        {children}
      </button>
    )
  }

  return (
    <button
      ref={ref}
      type={type}
      className={[
        styles.button,
        v,
        s,
        fullWidth ? styles.fullWidth : '',
        className
      ].filter(Boolean).join(' ')}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      {...props}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {!loading && leftIcon ? <span className={styles.icon} aria-hidden="true">{leftIcon}</span> : null}
      <span className={styles.label}>{children}</span>
      {!loading && rightIcon ? <span className={styles.icon} aria-hidden="true">{rightIcon}</span> : null}
    </button>
  )
})

export default Button


