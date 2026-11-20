import { ErrorBoundary } from './components/ErrorBoundary'
import { LanguageGate } from './components/LanguageGate'
import { Shell } from './components/Shell'
import { ToastProvider } from './components/toast'
import { AppProvider } from './lib/app'
import { I18nProvider } from './lib/i18n'
import { useRoute } from './lib/router'
import { Account } from './pages/Account'
import { Accounts } from './pages/Accounts'
import { Dashboard } from './pages/Dashboard'
import { History } from './pages/History'
import { Identify } from './pages/Identify'
import { Notifications } from './pages/Notifications'
import { Product } from './pages/Product'
import { Scan } from './pages/Scan'
import { Products } from './pages/Products'
import { AccountsSettings } from './pages/settings/Accounts'
import { CalendarSettings } from './pages/settings/Calendar'
import { ProductsSettings } from './pages/settings/Products'

function Routes() {
  const { path } = useRoute()
  if (path === '/notifications') return <Notifications />
  if (path === '/identifier') return <Identify />
  if (path.startsWith('/comptes/')) return <Account />
  if (path === '/comptes') return <Accounts />
  if (path.startsWith('/produits/')) return <Product />
  if (path === '/produits') return <Products />
  if (path === '/historique') return <History />
  if (path === '/scanner') return <Scan />
  if (path === '/reglages/produits') return <ProductsSettings />
  if (path === '/reglages/calendrier') return <CalendarSettings />
  if (path.startsWith('/reglages')) return <AccountsSettings />
  return <Dashboard />
}

export function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <ToastProvider>
          <ErrorBoundary>
          <LanguageGate>
            <Shell>
              <Routes />
            </Shell>
          </LanguageGate>
          </ErrorBoundary>
        </ToastProvider>
      </AppProvider>
    </I18nProvider>
  )
}
