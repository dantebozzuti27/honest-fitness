import styles from './SearchField.module.css'

export default function SearchField({
  value,
  onChange,
  onKeyDown,
  placeholder = 'Search…',
  autoFocus = false,
  inputRef,
  onClear,
  disabled = false,
  ariaLabel = 'Search'
}) {
  const canClear = Boolean(!disabled && onClear && value && String(value).length > 0)

  return (
    <div className={styles.wrap}>
      <span className={styles.leftIcon} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M21 21l-4.35-4.35"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={styles.input}
        aria-label={ariaLabel}
      />

      {canClear ? (
        <button
          type="button"
          className={styles.clearBtn}
          onClick={onClear}
          aria-label="Clear search"
          title="Clear"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M18 6 6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span className={styles.rightSpacer} aria-hidden="true" />
      )}
    </div>
  )
}


