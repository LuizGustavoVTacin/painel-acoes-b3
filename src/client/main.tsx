import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LimiteDeErro } from './LimiteDeErro';
import './estilo.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LimiteDeErro>
      <App />
    </LimiteDeErro>
  </StrictMode>,
);
