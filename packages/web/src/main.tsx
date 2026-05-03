import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import App from './App';
import { getLogger, initLogger } from './logger-init';
import { ToastContainer } from './utils/toast';

initLogger()
  .then(() => {
    const logger = getLogger();
    logger.info('[app] starting markdawn web');
    logger.debug(`[env] NODE_ENV: ${import.meta.env.MODE}`);
    logger.debug(`[env] VITE_API_URL: ${import.meta.env.VITE_API_URL ?? 'not set'}`);
    logger.debug(`[env] VITE_COLLAB_URL: ${import.meta.env.VITE_COLLAB_URL ?? 'not set'}`);
  })
  .catch((err) => {
    console.error('[app] failed to initialize logger:', err);
  });

const queryClient = new QueryClient();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ToastContainer />
    </QueryClientProvider>
  </React.StrictMode>,
);
