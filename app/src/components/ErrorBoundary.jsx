import React from 'react'
import { logError } from '../utils/logger'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    logError('ErrorBoundary caught an error', { error, errorInfo })
    this.setState({
      error,
      errorInfo
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          background: 'var(--bg-primary, #000000)',
          color: 'var(--text-primary, #ffffff)',
          textAlign: 'center',
          fontFamily: 'var(--font-sans, -apple-system, sans-serif)'
        }}>
          <h1 style={{ 
            fontSize: '24px', 
            marginBottom: '16px', 
            color: 'var(--danger, #ff453a)',
            fontFamily: 'var(--font-display, -apple-system, sans-serif)'
          }}>Error</h1>
          <p style={{ 
            marginBottom: '24px', 
            color: 'var(--text-secondary, #a1a1a6)',
            fontSize: '16px'
          }}>
            Something went wrong. Please try refreshing the page.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, errorInfo: null })
              window.location.reload()
            }}
            style={{
              padding: '16px 32px',
              background: 'var(--accent, #ffffff)',
              color: 'var(--bg-primary, #000000)',
              border: 'none',
              borderRadius: 'var(--radius-md, 8px)',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              minWidth: '200px',
              minHeight: '48px',
              fontFamily: 'var(--font-display, -apple-system, sans-serif)'
            }}
          >
            Refresh Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary

