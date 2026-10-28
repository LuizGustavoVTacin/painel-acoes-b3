import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Banco } from './banco/conexao.js';
import { criarRepositorioSelecao } from './banco/selecao.js';
import { criarRepositorioTransacoes } from './banco/transacoes.js';
import { ErroHttp } from './erros.js';
import { criarRotasPosicoes, criarRotasSelecao, criarRotasTransacoes } from './rotas.js';

export interface OpcoesApp {
  banco: Banco;
  /** Pasta com o frontend compilado. Só é servida se contiver um index.html. */
  pastaCliente?: string;
  /** Relógio usado nas validações de data (substituível nos testes). */
  agora?: () => Date;
}

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Extrai o nome do host de um cabeçalho Host, sem a porta. */
export function nomeDoHost(cabecalhoHost: string): string {
  const semPorta = cabecalhoHost.startsWith('[')
    ? cabecalhoHost.slice(0, cabecalhoHost.indexOf(']') + 1)
    : cabecalhoHost.split(':')[0];
  return semPorta.toLowerCase();
}

/** Bloqueia requisições com Host externo (proteção contra DNS rebinding). */
const somenteHostLocal: RequestHandler = (req, res, next) => {
  if (HOSTS_LOCAIS.has(nomeDoHost(req.headers.host ?? ''))) return next();
  res.status(403).json({ erro: 'Acesso permitido apenas pelo próprio computador' });
};

const tratarErro: ErrorRequestHandler = (erro, _req, res, next) => {
  // Resposta já começou a ser enviada: só o Express consegue encerrar a conexão.
  if (res.headersSent) return next(erro);

  if (erro instanceof ErroHttp) {
    res
      .status(erro.status)
      .json({ erro: erro.message, ...(erro.campos && { campos: erro.campos }) });
    return;
  }

  const status: number = erro?.status;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const mensagem = status === 413 ? 'Requisição muito grande' : 'Requisição inválida';
    res.status(status).json({ erro: mensagem });
    return;
  }
  console.error(erro);
  res.status(500).json({ erro: 'Erro interno do servidor' });
};

export function criarApp({ banco, pastaCliente, agora = () => new Date() }: OpcoesApp): Express {
  const dependencias = {
    transacoes: criarRepositorioTransacoes(banco),
    selecao: criarRepositorioSelecao(banco),
    agora,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(somenteHostLocal);
  app.use(express.json());

  app.get('/api/saude', (_req, res) => {
    res.json({ status: 'ok', horario: new Date().toISOString() });
  });

  app.use('/api/transacoes', criarRotasTransacoes(dependencias));
  app.use('/api/selecao', criarRotasSelecao(dependencias));
  app.use('/api/posicoes', criarRotasPosicoes(dependencias));

  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  if (pastaCliente && existsSync(path.join(pastaCliente, 'index.html'))) {
    app.use(express.static(pastaCliente));
    // Rotas do frontend recebem o index.html; arquivos inexistentes (com extensão) dão 404.
    app.get('/{*caminho}', (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(pastaCliente, 'index.html'));
    });
  }

  app.use(tratarErro);

  return app;
}
