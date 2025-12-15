import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import PasswordStrengthIndicator from '../components/PasswordStrengthIndicator'
import EmailCapture from '../components/EmailCapture'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import InputField from '../components/InputField'
import { useHaptic } from '../hooks/useHaptic'
import styles from './Auth.module.css'

export default function Auth() {
  const navigate = useNavigate()
  const { signIn, signUp } = useAuth()
  const { toast, showToast, hideToast } = useToast()
  const haptic = useHaptic()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [consentPrivacy, setConsentPrivacy] = useState(false)
  const [consentTerms, setConsentTerms] = useState(false)
  const [showEmailCapture, setShowEmailCapture] = useState(false)
  const [socialLoading, setSocialLoading] = useState(null)

  // Social login handlers
  const handleSocialLogin = async (provider) => {
    setSocialLoading(provider)
    setError('')
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          }
        }
      })
      if (error) throw error
      // OAuth will redirect, so we don't need to navigate
    } catch (err) {
      setError(`Failed to sign in with ${provider}: ${err.message}`)
      setSocialLoading(null)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match')
      haptic?.error?.()
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      haptic?.error?.()
      return
    }

    if (isSignUp && (!consentPrivacy || !consentTerms)) {
      setError('You must accept the Privacy Policy and Terms of Service to create an account')
      haptic?.error?.()
      return
    }

    if (isSignUp && !username.trim()) {
      setError('Username is required')
      haptic?.error?.()
      return
    }

    if (isSignUp && !phoneNumber.trim()) {
      setError('Phone number is required')
      haptic?.error?.()
      return
    }

    // Validate username format (alphanumeric, underscore, hyphen, 3-20 chars)
    if (isSignUp && username.trim()) {
      const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/
      if (!usernameRegex.test(username.trim())) {
        setError('Username must be 3-20 characters and contain only letters, numbers, underscores, or hyphens')
        haptic?.error?.()
        return
      }
    }

    // Validate phone number format (basic validation)
    if (isSignUp && phoneNumber.trim()) {
      const phoneRegex = /^[\d\s\-\+\(\)]{10,}$/
      const digitsOnly = phoneNumber.replace(/\D/g, '')
      if (digitsOnly.length < 10) {
        setError('Please enter a valid phone number')
        haptic?.error?.()
        return
      }
    }

    setLoading(true)

    try {
      if (isSignUp) {
        // Store referral code if provided
        if (referralCode.trim()) {
          localStorage.setItem('signup_referral_code', referralCode.trim())
        }
        await signUp(email, password, username.trim().toLowerCase(), phoneNumber.trim())
        setMessage('Check your email to confirm your account!')
        haptic?.success?.()
      } else {
        await signIn(email, password)
        navigate('/')
        haptic?.success?.()
      }
    } catch (err) {
      setError(err.message)
      haptic?.error?.()
    } finally {
      setLoading(false)
    }
  }

  // Show email capture for non-users first (only once)
  if (showEmailCapture && !isSignUp) {
    return (
      <div className={styles.container}>
        <EmailCapture 
          onEmailCaptured={() => setShowEmailCapture(false)}
          onSkip={() => setShowEmailCapture(false)}
        />
        <button 
          className={styles.backToAuthBtn}
          onClick={() => setShowEmailCapture(false)}
        >
          Continue to Sign In
        </button>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={hideToast}
        />
      )}
      {/* Hero Section with Value Propositions */}
      <div className={styles.heroSection}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>Your Fitness Journey, Elevated</h1>
          <p className={styles.heroTagline}>
            Track workouts, analyze progress, and achieve your goals with precision.
          </p>
          
          {/* Key Value Propositions */}
          <div className={styles.valueProps}>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Advanced Analytics</div>
                <div className={styles.valueDesc}>Data-driven insights powered by ML</div>
              </div>
            </div>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Comprehensive Tracking</div>
                <div className={styles.valueDesc}>Workouts, nutrition, and health metrics</div>
              </div>
            </div>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Goal Achievement</div>
                <div className={styles.valueDesc}>Smart goals with predictive insights</div>
              </div>
            </div>
            <div className={styles.valueProp}>
              <div>
                <div className={styles.valueTitle}>Social Community</div>
                <div className={styles.valueDesc}>Connect with friends and share progress</div>
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

        {/* Social Login Options */}
        <div className={styles.socialLoginSection}>
          <button
            className={`${styles.socialBtn} ${styles.appleBtn}`}
            onClick={() => handleSocialLogin('apple')}
            disabled={socialLoading !== null}
          >
            {socialLoading === 'apple' ? (
              <span className={styles.loadingSpinner}>Loading...</span>
            ) : (
              <span className={styles.socialIcon}>Apple</span>
            )}
            <span>Continue with Apple</span>
          </button>
          <button
            className={`${styles.socialBtn} ${styles.googleBtn}`}
            onClick={() => handleSocialLogin('google')}
            disabled={socialLoading !== null}
          >
            {socialLoading === 'google' ? (
              <span className={styles.loadingSpinner}>Loading...</span>
            ) : (
              <span className={styles.socialIcon}>G</span>
            )}
            <span>Continue with Google</span>
          </button>
          <button
            className={`${styles.socialBtn} ${styles.facebookBtn}`}
            onClick={() => handleSocialLogin('facebook')}
            disabled={socialLoading !== null}
          >
            {socialLoading === 'facebook' ? (
              <span className={styles.loadingSpinner}>Loading...</span>
            ) : (
              <span className={styles.socialIcon}>f</span>
            )}
            <span>Continue with Facebook</span>
          </button>
        </div>

        <div className={styles.divider}>
          <span>or</span>
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
            {isSignUp && <PasswordStrengthIndicator password={password} />}
            {isSignUp && (
              <small className={styles.helperText}>
                Use a strong password with 8+ characters, including uppercase, lowercase, numbers, and special characters.
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

              <div className={styles.inputGroup}>
                <InputField
                  label="Phone Number"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  required
                />
                <small className={styles.helperText}>
                  Required for account recovery and two-factor authentication
                </small>
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

              {/* Referral Code Input */}
              <div className={styles.inputGroup}>
                <InputField
                  label="Referral Code (Optional)"
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  placeholder="Enter friend's code"
                />
                <small className={styles.helperText}>
                  Have a referral code? Enter it to unlock premium features for both you and your friend!
                </small>
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
            {loading ? 'Loading...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Trust Signals */}
        <div className={styles.trustSignals}>
          <div className={styles.trustBadge}>
            <span>256-bit Encryption</span>
          </div>
          <div className={styles.trustBadge}>
            <span>GDPR Compliant</span>
          </div>
          <div className={styles.trustBadge}>
            <span>Privacy First</span>
          </div>
        </div>

        {/* Onboarding Preview */}
        {isSignUp && (
          <div className={styles.onboardingPreview}>
            <h3 className={styles.previewTitle}>What you'll get:</h3>
            <div className={styles.previewFeatures}>
              <div className={styles.previewFeature}>
                <span>Track workouts with precision</span>
              </div>
              <div className={styles.previewFeature}>
                <span>Advanced analytics & insights</span>
              </div>
              <div className={styles.previewFeature}>
                <span>Set and achieve goals</span>
              </div>
              <div className={styles.previewFeature}>
                <span>Connect with friends</span>
              </div>
            </div>
            <button 
              className={styles.previewBtn}
              onClick={() => {
                // Could open a modal or navigate to a tour
                showToast('Take a tour coming soon!', 'info')
              }}
            >
              Take a Tour →
            </button>
          </div>
        )}

        <p className={styles.toggle}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button onClick={() => { 
            setIsSignUp(!isSignUp)
            setError('')
            setMessage('')
            setUsername('')
            setPhoneNumber('')
            setReferralCode('')
          }}>
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>

        {/* Email Capture for Non-Users */}
        {!isSignUp && (
          <div className={styles.emailCaptureSection}>
            <p className={styles.emailCaptureText}>
              Want updates? Get notified about new features.
            </p>
            <button 
              className={styles.emailCaptureBtn}
              onClick={() => setShowEmailCapture(true)}
            >
              Get Early Access
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

