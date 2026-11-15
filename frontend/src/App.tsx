import { Dashboard } from './screens/Dashboard'
import { I18nProvider } from './i18n'

export default function App() {
  return <I18nProvider><Dashboard /></I18nProvider>
}
