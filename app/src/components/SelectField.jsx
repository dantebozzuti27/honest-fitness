import styles from './InputField.module.css'

export default function SelectField({
  label,
  value,
  onChange,
  options = [], // [{ value, label }]
  error,
  success,
  required = false,
  disabled = false,
  id,
  name,
  placeholder,
  containerClassName = '',
  className = '',
  ...props
}) {
  const inputId = id || name || `select-${label?.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className={`${styles.inputField} ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      <select
        id={inputId}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        className={`${styles.input} ${error ? styles.error : ''} ${success ? styles.success : ''} ${className}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...props}
      >
        {placeholder ? <option value="" disabled>{placeholder}</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
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


