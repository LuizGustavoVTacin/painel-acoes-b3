import 'dotenv/config';
import { criarApp } from './app.js';
import { abrirBanco } from './banco/conexao.js';
import { caminhoBanco, lerPorta, pastaClienteCompilado } from './config.js';

const porta = lerPorta(process.env.PORT);
const pastaCliente = pastaClienteCompilado(import.meta.url);
const banco = abrirBanco(caminhoBanco(process.env.DB_ARQUIVO, import.meta.url));

const servidor = criarApp({ banco, pastaCliente })
  .listen(porta, '127.0.0.1', () => {
    console.log(`Dashboard B3 rodando em http://localhost:${porta}`);
  })
  .on('error', (erro: NodeJS.ErrnoException) => {
    if (erro.code === 'EADDRINUSE') {
      console.error(`A porta ${porta} já está em uso. O dashboard já está aberto?`);
    } else {
      console.error(erro);
    }
    banco.close();
    process.exit(1);
  });

// Fecha o banco ao encerrar (Ctrl+C), garantindo que tudo foi gravado no arquivo.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    servidor.close();
    banco.close();
    process.exit(0);
  });
}
