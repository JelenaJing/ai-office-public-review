import React from 'react'
import ReactDOM from 'react-dom/client'
import WebApp from './web/WebApp'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>,
)
