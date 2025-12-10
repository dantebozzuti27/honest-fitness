import { useState, useRef, useEffect } from 'react'
import styles from './DatePicker.module.css'

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  className = '',
  disabled = false,
  ...props
}) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  const handleChange = (e) => {
    onChange?.(e.target.value)
  }

  return (
    <div className={`${styles.datePickerContainer} ${className}`}>
      <div className={styles.dateIcon}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        min={min}
        max={max}
        disabled={disabled}
        placeholder={placeholder}
        className={`${styles.dateInput} ${focused ? styles.focused : ''}`}
        {...props}
      />
    </div>
  )
}

