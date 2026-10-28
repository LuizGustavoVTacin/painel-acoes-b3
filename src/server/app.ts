import express, { type ErrorRequestHandler, type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface OpcoesApp {
  /** Pasta com o frontend compilado. Só é servida se contiver um index.html. */
  pastaCliente?: string;
}

export function criarApp({ pastaCliente }: OpcoesApp = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/saude', (_req, res) => {
    res.json({ status: 'ok', horario: new Date().toISOString() });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  if (pastaCliente && existsSync(path.join(pastaCliente, 'index.html'))) {
    app.use(express.static(pastaCliente));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(pastaCliente, 'index.html'));
    });
  }

  const tratarErro: ErrorRequestHandler = (erro, _req, res, _next) => {
    console.error(erro);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  };
  app.use(tratarErro);

  return app;
}
