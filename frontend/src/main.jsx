import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

// Wake up the Render backend immediately on page load so it is warm by the
// time the user logs in. Fire-and-forget — errors are intentionally swallowed.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
fetch(`${API_URL}/health`).catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
