import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { QuoteProvider } from './lib/quoteStore';
import { SiteConfigProvider } from './lib/siteConfigStore';
// Saira (SIL Open Font Licence), self-hosted: closest open match to the lettering in the logo.
import '@fontsource/saira/latin-500.css';
import '@fontsource/saira/latin-800.css';
import './styles.css';
import './catalog.css';
import './wide.css';

// After a new version is deployed, an open tab may ask for a code chunk that no longer exists.
// Reload once (guarded against loops) so the visitor gets the new version instead of an error.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('wu-chunk-reload') ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('wu-chunk-reload', String(Date.now()));
  } catch {
    /* storage blocked: still try one reload */
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SiteConfigProvider>
          <QuoteProvider>
            <App />
          </QuoteProvider>
        </SiteConfigProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
