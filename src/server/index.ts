import 'dotenv/config';
import { criarApp } from './app.js';
import { abrirBanco, fecharBanco } from './banco/conexao.js';
import { caminhoBanco, lerPorta, pastaClienteCompilado } from './config.js';

const porta = lerPorta(process.env.PORT);
const pastaCliente = pastaClienteCompilado(import.meta.url);
const banco = abrirBanco(caminhoBanco(process.env.DB_ARQUIVO, import.meta.url));

const servidor = criarApp({ banco, buscar: fetch, pastaCliente })
  .listen(porta, '127.0.0.1', () => {
    console.log(`Dashboard B3 rodando em http://localhost:${porta}`);
  })
  .on('error', (erro: NodeJS.ErrnoException) => {
    if (erro.code === 'EADDRINUSE') {
      console.error(`A porta ${porta} já está em uso. O dashboard já está aberto?`);
    } else {
      console.error(erro);
    }
    fecharBanco(banco);
    process.exit(1);
  });

// Fecha o banco ao encerrar: Ctrl+C (SIGINT), kill (SIGTERM) ou fechar a janela no Windows (SIGHUP).
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sinal, () => {
    servidor.close();
    fecharBanco(banco);
    process.exit(0);
  });
}
