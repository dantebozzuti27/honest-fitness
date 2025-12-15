import { useState } from 'react'
import styles from './InputField.module.css'

export default function InputField({
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  success,
  required = false,
  disabled = false,
  id,
  name,
  containerClassName = '',
  className = '',
  ...props
}) {
  const [focused, setFocused] = useState(false)
  const inputId = id || name || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className={`${styles.inputField} ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      <input
        id={inputId}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={`${styles.input} ${error ? styles.error : ''} ${success ? styles.success : ''} ${focused ? styles.focused : ''} ${className}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...props}
      />
      {error && (
        <div id={`${inputId}-error`} className={styles.errorMessage} role="alert">
          {error}
        </div>
      )}
      {success && !error && (
        <div className={styles.successMessage}>
          {success}
        </div>
      )}
    </div>
  )
}

