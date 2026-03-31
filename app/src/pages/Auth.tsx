import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { cognitoConfigOk } from '../lib/cognitoAuth'
import { resendConfirmation } from '../lib/cognitoAuth'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import InputField from '../components/InputField'
import { SUPPORT_EMAIL } from '../config/appStore'
import styles from './Auth.module.css'

export default function Auth() {
  const navigate = useNavigate()
  const { signIn, signUp, confirmSignUp, needsConfirmation, pendingEmail } = useAuth()
  const { toast, hideToast } = useToast()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [confirmCode, setConfirmCode] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  if (!cognitoConfigOk) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h1 className={styles.title}>ECHELON</h1>
            <p className={styles.subtitle}>Configuration required</p>
          </div>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Auth is not configured. Please set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.
          </div>
        </div>
      </div>
    )
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const target = pendingEmail || email
      await confirmSignUp(target, confirmCode.trim())
      setMessage('Account confirmed! Please sign in.')
      setIsSignUp(false)
      setConfirmCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setError('')
    try {
      await resendConfirmation(pendingEmail || email)
      setMessage('Confirmation code resent. Check your email.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (needsConfirmation) {
    return (
      <div className={styles.container}>
        {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h1 className={styles.title}>ECHELON</h1>
            <p className={styles.subtitle}>Check your email</p>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            We sent a confirmation code to <strong>{pendingEmail || email}</strong>.
          </p>
          <form onSubmit={handleConfirm} className={styles.form}>
            <InputField
              containerClassName={styles.inputGroup}
              label="Confirmation Code"
              type="text"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              placeholder="123456"
              required
              autoFocus
            />
            {error && <p className={styles.error}>{error}</p>}
            {message && <p className={styles.message}>{message}</p>}
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Confirming...' : 'Confirm Account'}
            </button>
          </form>
          <p className={styles.toggle}>
            Didn&apos;t get the code?{' '}
            <button onClick={handleResend}>Resend</button>
          </p>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (isSignUp && !username.trim()) {
      setError('Username is required')
      return
    }

    if (isSignUp && username.trim()) {
      const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/
      if (!usernameRegex.test(username.trim())) {
        setError('Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens')
        return
      }
    }

    setLoading(true)

    try {
      if (isSignUp) {
        await signUp(email, password, username.trim().toLowerCase(), null)
        setMessage('Check your email for a confirmation code!')
      } else {
        await signIn(email, password)
        navigate('/')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('User is not confirmed')) {
        setError('Please confirm your account first. Check your email for a confirmation code.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      {toast && <Toast message={toast.message} type={toast.type} duration={toast.duration} onClose={hideToast} />}
      <div className={styles.heroSection}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>Honest Fitness</h1>
          <p className={styles.heroTagline}>
            Track workouts, weight, and Fitbit stats — with real analytics.
          </p>
          <div className={styles.valueProps}>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Workout Tracking</div>
                <div className={styles.valueDesc}>Log every set, rep, and PR</div>
              </div>
            </div>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Advanced Analytics</div>
                <div className={styles.valueDesc}>Volume, frequency, and body part trends</div>
              </div>
            </div>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Fitbit Integration</div>
                <div className={styles.valueDesc}>Steps, heart rate, sleep, and HRV</div>
              </div>
            </div>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Templates</div>
                <div className={styles.valueDesc}>Build and reuse workout routines</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.title}>ECHELON</h1>
          <p className={styles.subtitle}>
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <InputField
            containerClassName={styles.inputGroup}
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <div className={styles.inputGroup}>
            <InputField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
            />
            {isSignUp && (
              <small className={styles.helperText}>
                Use a strong password with 8+ characters, including uppercase, lowercase, and numbers.
              </small>
            )}
          </div>

          {isSignUp && (
            <>
              <div className={styles.inputGroup}>
                <InputField
                  label="Username"
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

              <InputField
                containerClassName={styles.inputGroup}
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </>
          )}

          {isSignUp && (
            <div className={styles.consentHelp}>
              Need help? <a href={`mailto:${SUPPORT_EMAIL}`} className={styles.link}>Support</a>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {message && <p className={styles.message}>{message}</p>}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? 'Loading...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className={styles.trustSignals}>
          <div className={styles.trustBadge}><span>256-bit Encryption</span></div>
          <div className={styles.trustBadge}><span>GDPR Compliant</span></div>
          <div className={styles.trustBadge}><span>Privacy First</span></div>
        </div>

        <p className={styles.toggle}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button onClick={() => {
            setIsSignUp(!isSignUp)
            setError('')
            setMessage('')
            setUsername('')
          }}>
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}
