// app/src/components/ErrorBoundary.jsx
import { Component, cloneElement, isValidElement } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props
      // Allow fallback to be either a render function (called with {error})
      // or a React element (cloned with error prop injected). This lets
      // AppErrorFallback display error.name and error.stack without callers
      // having to drill state through props.
      if (typeof fallback === 'function') {
        return fallback({ error: this.state.error })
      }
      if (isValidElement(fallback)) {
        return cloneElement(fallback, { error: this.state.error })
      }
      return fallback ?? (
        <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace' }}>
          Component error — reload to retry
        </div>
      )
    }
    return this.props.children
  }
}
