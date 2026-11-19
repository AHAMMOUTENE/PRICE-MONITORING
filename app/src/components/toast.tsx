import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useT } from '../lib/i18n'

interface ToastItem {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface ToastApi {
  show: (message: string, action?: { label: string; run: () => void }) => void
}

const ToastContext = createContext<ToastApi>({ show: () => undefined })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback<ToastApi['show']>((message, action) => {
    const id = Date.now() + Math.random()
    setItems((list) => [...list, { id, message, actionLabel: action?.label, onAction: action?.run }])
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 6000)
  }, [])

  // Valeur stable : les consommateurs ne se re-rendent pas à chaque toast.
  const api = useMemo(() => ({ show }), [show])
  const { t: tr } = useT()
  // Une promesse rejetée que personne n'a attrapée ne reste plus silencieuse.
  useEffect(() => {
    const onRejection = () => show(tr('common.error'))
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [show, tr])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.message}</span>
            {t.onAction && (
              <button
                onClick={() => {
                  t.onAction?.()
                  setItems((list) => list.filter((x) => x.id !== t.id))
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  return useContext(ToastContext)
}
