import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'

const el = document.getElementById('root')
if (!el) {
  document.body.innerHTML =
    '<p style="font-family:sans-serif;padding:24px">Нет элемента #root в index.html</p>'
} else {
  createRoot(el).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  )
}
