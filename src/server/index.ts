import 'dotenv/config';
import { criarApp } from './app.js';
import { lerPorta, pastaClienteCompilado } from './config.js';

const porta = lerPorta(process.env.PORT);
const pastaCliente = pastaClienteCompilado(import.meta.url);

criarApp({ pastaCliente })
  .listen(porta, '127.0.0.1', () => {
    console.log(`Dashboard B3 rodando em http://localhost:${porta}`);
  })
  .on('error', (erro: NodeJS.ErrnoException) => {
    if (erro.code === 'EADDRINUSE') {
      console.error(`A porta ${porta} já está em uso. O dashboard já está aberto?`);
    } else {
      console.error(erro);
    }
    process.exit(1);
  });
