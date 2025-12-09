import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Auth.module.css'

export default function Auth() {
  const navigate = useNavigate()
  const { signIn, signUp } = useAuth()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [consentPrivacy, setConsentPrivacy] = useState(false)
  const [consentTerms, setConsentTerms] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    if (isSignUp && (!consentPrivacy || !consentTerms)) {
      setError('You must accept the Privacy Policy and Terms of Service to create an account')
      return
    }

    if (isSignUp && !username.trim()) {
      setError('Username is required')
      return
    }

    if (isSignUp && !phoneNumber.trim()) {
      setError('Phone number is required')
      return
    }

    // Validate username format (alphanumeric, underscore, hyphen, 3-20 chars)
    if (isSignUp && username.trim()) {
      const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/
      if (!usernameRegex.test(username.trim())) {
        setError('Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens')
        return
      }
    }

    // Validate phone number format (basic validation)
    if (isSignUp && phoneNumber.trim()) {
      const phoneRegex = /^[\d\s\-\+\(\)]{10,}$/
      const digitsOnly = phoneNumber.replace(/\D/g, '')
      if (digitsOnly.length < 10) {
        setError('Please enter a valid phone number')
        return
      }
    }

    setLoading(true)

    try {
      if (isSignUp) {
        await signUp(email, password, username.trim().toLowerCase(), phoneNumber.trim())
        setMessage('Check your email to confirm your account!')
      } else {
        await signIn(email, password)
        navigate('/')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>HonestFitness</h1>
        <p className={styles.subtitle}>{isSignUp ? 'Create your account' : 'Welcome back'}</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputGroup}>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className={styles.inputGroup}>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {isSignUp && (
            <>
              <div className={styles.inputGroup}>
                <label>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  required
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_-]+"
                />
                <small className={styles.helperText}>3-20 characters, letters, numbers, _, or -</small>
              </div>

              <div className={styles.inputGroup}>
                <label>Phone Number</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  required
                />
              </div>

              <div className={styles.inputGroup}>
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </>
          )}

          {isSignUp && (
            <div className={styles.consentSection}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={consentPrivacy}
                  onChange={(e) => setConsentPrivacy(e.target.checked)}
                  required
                />
                <span>
                  I agree to the{' '}
                  <Link to="/privacy" target="_blank" className={styles.link}>
                    Privacy Policy
                  </Link>
                </span>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={consentTerms}
                  onChange={(e) => setConsentTerms(e.target.checked)}
                  required
                />
                <span>
                  I agree to the{' '}
                  <Link to="/terms" target="_blank" className={styles.link}>
                    Terms of Service
                  </Link>
                </span>
              </label>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {message && <p className={styles.message}>{message}</p>}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <p className={styles.toggle}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button onClick={() => { 
            setIsSignUp(!isSignUp)
            setError('')
            setMessage('')
            setUsername('')
            setPhoneNumber('')
          }}>
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}

