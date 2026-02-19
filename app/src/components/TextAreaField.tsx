import type { ChangeEvent, TextareaHTMLAttributes } from 'react'
import styles from './InputField.module.css'

export type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  label?: string
  value: string
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  error?: string | null
  success?: string | null
  required?: boolean
  disabled?: boolean
  id?: string
  name?: string
  rows?: number
  containerClassName?: string
  className?: string
}

export default function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  error,
  success,
  required = false,
  disabled = false,
  id,
  name,
  rows = 3,
  containerClassName = '',
  className = '',
  ...props
}: TextAreaFieldProps) {
  const inputId = id || name || `textarea-${label?.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className={`${styles.inputField} ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      <textarea
        id={inputId}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        rows={rows}
        className={`${styles.input} ${error ? styles.error : ''} ${success ? styles.success : ''} ${className}`}
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


