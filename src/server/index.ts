import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { criarApp } from './app.js';

const porta = Number(process.env.PORT ?? 3000);
// Resolve para <projeto>/dist/client tanto em src/server (dev) quanto em dist/server (produção).
const pastaCliente = fileURLToPath(new URL('../../dist/client', import.meta.url));

criarApp({ pastaCliente }).listen(porta, '127.0.0.1', () => {
  console.log(`Dashboard B3 rodando em http://localhost:${porta}`);
});
