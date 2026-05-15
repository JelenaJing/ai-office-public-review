import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { registerBuiltins } from './skills/registerBuiltins'

// Register all built-in legacy Skills before the React tree mounts.
// This is a synchronous, idempotent, in-memory operation — safe to call unconditionally.
registerBuiltins()

// Restore display scale from user preference before first paint.
const _storedScale = localStorage.getItem('aioffice.displayScale')
if (_storedScale) {
  document.documentElement.style.zoom = _storedScale
}
import AppErrorBoundary from './components/AppErrorBoundary'
import { DocumentProvider } from './contexts/DocumentContext'
import { DepartmentProvider } from './contexts/DepartmentContext'
import { KnowledgeProvider } from './contexts/KnowledgeContext'
import { PersonalLibraryProvider } from './contexts/PersonalLibraryContext'
import { WorkspaceProvider } from './contexts/WorkspaceContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { EditorSessionProvider } from './contexts/EditorSessionContext'
import { InternalAccountProvider } from './contexts/InternalAccountContext'
import { MatrixChatProvider } from './contexts/MatrixChatContext'
import { DocumentWorkspaceKnowledgeProvider } from './contexts/DocumentWorkspaceContext'
import './index.css'
import 'katex/dist/katex.min.css'

// Catch global errors and rejections so they are logged but don't silently kill
// the React tree. vosk-browser / Emscripten can emit uncaught errors during WASM
// compilation that would otherwise appear as white-screen crashes.
window.addEventListener('error', (event) => {
  console.error('[GlobalError]', event.error ?? event.message)
  // Prevent the default "uncaught error" handling which can unmount React 18 root
  event.preventDefault()
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[UnhandledRejection]', event.reason)
  event.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
  // Suppress React 18's default behavior of re-throwing recoverable errors
  // (e.g. hydration mismatches or worker errors) which can cause white-screen
  onRecoverableError(error, errorInfo) {
    console.error('[ReactRecoverableError]', error, errorInfo)
  },
}).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <LanguageProvider>
        <InternalAccountProvider>
          <MatrixChatProvider>
            <WorkspaceProvider>
            <DocumentProvider>
              <EditorSessionProvider>
                <DepartmentProvider>
                  <KnowledgeProvider>
                    <PersonalLibraryProvider>
                      <DocumentWorkspaceKnowledgeProvider>
                        <App />
                      </DocumentWorkspaceKnowledgeProvider>
                    </PersonalLibraryProvider>
                  </KnowledgeProvider>
                </DepartmentProvider>
              </EditorSessionProvider>
            </DocumentProvider>
          </WorkspaceProvider>
          </MatrixChatProvider>
        </InternalAccountProvider>
      </LanguageProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)