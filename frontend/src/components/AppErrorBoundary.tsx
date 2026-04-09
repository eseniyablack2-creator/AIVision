import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null; info: ErrorInfo | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    console.error('AIVision render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#1a0a0a',
            color: '#fee2e2',
          }}
        >
          <h1 style={{ marginTop: 0 }}>Ошибка при запуске интерфейса</h1>
          <p style={{ maxWidth: 720, lineHeight: 1.6 }}>
            Сообщение ниже поможет найти причину «белого экрана». Обновите страницу; если ошибка
            повторяется — откройте консоль браузера (F12) и пришлите текст.
          </p>
          <pre
            style={{
              padding: 16,
              borderRadius: 12,
              background: '#0f172a',
              color: '#e2e8f0',
              overflow: 'auto',
              fontSize: 13,
            }}
          >
            {this.state.error.stack ?? this.state.error.message}
            {this.state.info?.componentStack ?? ''}
          </pre>
          <button
            type="button"
            style={{
              marginTop: 16,
              padding: '10px 18px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              background: '#f2d45c',
              color: '#111',
            }}
            onClick={() => window.location.reload()}
          >
            Обновить страницу
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
