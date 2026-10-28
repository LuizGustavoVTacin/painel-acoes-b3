import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface OpcoesApp {
  /** Pasta com o frontend compilado. Só é servida se contiver um index.html. */
  pastaCliente?: string;
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

const tratarErro: ErrorRequestHandler = (erro, _req, res, _next) => {
  const status: number = erro?.status;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ erro: 'Requisição inválida' });
    return;
  }
  console.error(erro);
  res.status(500).json({ erro: 'Erro interno do servidor' });
};

export function criarApp({ pastaCliente }: OpcoesApp = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(somenteHostLocal);
  app.use(express.json());

  app.get('/api/saude', (_req, res) => {
    res.json({ status: 'ok', horario: new Date().toISOString() });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  if (pastaCliente && existsSync(path.join(pastaCliente, 'index.html'))) {
    app.use(express.static(pastaCliente));
    // Rotas do frontend recebem o index.html; arquivos inexistentes (com extensão) dão 404.
    app.get('*', (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(pastaCliente, 'index.html'));
    });
  }

  app.use(tratarErro);

  return app;
}
