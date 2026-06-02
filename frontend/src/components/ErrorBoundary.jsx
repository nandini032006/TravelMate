import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, componentStack: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[TravelMate] Crash:', error.message)
    console.error('[TravelMate] Stack:', error.stack)
    console.error('[TravelMate] Component tree:', info.componentStack)
    this.setState({ componentStack: info.componentStack })
  }

  render() {
    if (this.state.error) {
      const msg   = this.state.error?.message   || 'Unknown error'
      const stack = this.state.error?.stack     || ''
      const comp  = this.state.componentStack   || ''

      return (
        <div role="alert" className="tm-error-boundary">
          <div className="tm-error-boundary__box">
            <span className="tm-error-boundary__icon" aria-hidden="true">⚠️</span>
            <h2 className="tm-error-boundary__title">TravelMate Beta encountered an unexpected issue.</h2>
            <p className="tm-error-boundary__msg">This is a beta release — please help us improve by reporting this issue.</p>

            {/* Diagnostic panel — visible on screen so mobile/APK users can report it */}
            <div style={{
              background: '#1e293b', color: '#f8fafc', borderRadius: 10,
              padding: '12px 14px', margin: '12px 0', textAlign: 'left',
              fontSize: 11, fontFamily: 'monospace', overflowX: 'auto',
              maxHeight: 260, overflowY: 'auto', userSelect: 'text',
            }}>
              <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 6 }}>
                {msg}
              </div>
              <div style={{ color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {stack.split('\n').slice(0, 6).join('\n')}
              </div>
              {comp && (
                <div style={{ color: '#64748b', marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {comp.split('\n').slice(0, 10).join('\n')}
                </div>
              )}
            </div>

            <button
              className="tm-error-boundary__btn"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
