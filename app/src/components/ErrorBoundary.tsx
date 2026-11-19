import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { ErrorBlock } from './ui'

function Fallback() {
  const { t } = useT()
  return (
    <div className="page">
      <ErrorBlock message={t('common.error')} onRetry={() => window.location.reload()} />
    </div>
  )
}

/** Dernier filet : une erreur d'affichage montre un message avec « Réessayer » au lieu d'une page blanche. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children
  }
}
