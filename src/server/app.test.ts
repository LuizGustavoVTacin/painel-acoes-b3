import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarApp, nomeDoHost } from './app.js';

describe('GET /api/saude', () => {
  it('responde 200 com status ok e o horário atual em ISO', async () => {
    const antes = Date.now();
    const resposta = await request(criarApp()).get('/api/saude');

    expect(resposta.status).toBe(200);
    expect(resposta.body.status).toBe('ok');
    const horario = Date.parse(resposta.body.horario);
    expect(horario).toBeGreaterThanOrEqual(antes - 1000);
    expect(horario).toBeLessThanOrEqual(Date.now());
  });
});

describe('rotas inexistentes', () => {
  it('responde 404 em JSON para rotas /api desconhecidas', async () => {
    const resposta = await request(criarApp()).get('/api/nao-existe');

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Rota não encontrada' });
  });

  it('não serve frontend quando a pasta do cliente não foi informada', async () => {
    const resposta = await request(criarApp()).get('/');

    expect(resposta.status).toBe(404);
  });
});

describe('erros de requisição', () => {
  it('responde 400 em JSON quando o corpo JSON é malformado', async () => {
    const resposta = await request(criarApp())
      .post('/api/saude')
      .set('Content-Type', 'application/json')
      .send('{malformado');

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'Requisição inválida' });
  });

  it('responde 413 com mensagem própria quando o corpo é grande demais', async () => {
    const resposta = await request(criarApp())
      .post('/api/saude')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ texto: 'x'.repeat(200 * 1024) }));

    expect(resposta.status).toBe(413);
    expect(resposta.body).toEqual({ erro: 'Requisição muito grande' });
  });
});

describe('acesso somente local', () => {
  it.each(['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST'])(
    'aceita o Host %s',
    async (host) => {
      const resposta = await request(criarApp()).get('/api/saude').set('Host', host);

      expect(resposta.status).toBe(200);
    },
  );

  it.each(['site-malicioso.example', 'localhost.example.com:3000', '192.168.0.10:3000'])(
    'recusa com 403 o Host %s',
    async (host) => {
      const resposta = await request(criarApp()).get('/api/saude').set('Host', host);

      expect(resposta.status).toBe(403);
      expect(resposta.body).toEqual({ erro: 'Acesso permitido apenas pelo próprio computador' });
    },
  );
});

describe('nomeDoHost', () => {
  it.each([
    ['localhost:3000', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ['[::1]:3000', '[::1]'],
    ['Exemplo.COM:80', 'exemplo.com'],
    ['', ''],
  ])('%j vira %j', (cabecalho, esperado) => {
    expect(nomeDoHost(cabecalho)).toBe(esperado);
  });
});

describe('frontend compilado', () => {
  let pasta: string;

  beforeEach(() => {
    pasta = mkdtempSync(path.join(tmpdir(), 'dashboard-cliente-'));
    writeFileSync(path.join(pasta, 'index.html'), '<h1>Dashboard B3</h1>');
  });

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  it('serve o index.html na raiz e em rotas do frontend', async () => {
    const app = criarApp({ pastaCliente: pasta });

    for (const rota of ['/', '/qualquer/rota']) {
      const resposta = await request(app).get(rota);
      expect(resposta.status).toBe(200);
      expect(resposta.text).toContain('Dashboard B3');
    }
  });

  it('responde 404 para arquivos inexistentes em vez de devolver o index.html', async () => {
    const app = criarApp({ pastaCliente: pasta });

    for (const rota of ['/assets/antigo-abc123.js', '/favicon.ico']) {
      const resposta = await request(app).get(rota);
      expect(resposta.status).toBe(404);
    }
  });

  it('continua respondendo 404 em JSON para /api desconhecida', async () => {
    const resposta = await request(criarApp({ pastaCliente: pasta })).get('/api/nao-existe');

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Rota não encontrada' });
  });

  it('ignora a pasta se ela não contém index.html', async () => {
    rmSync(path.join(pasta, 'index.html'));
    const resposta = await request(criarApp({ pastaCliente: pasta })).get('/');

    expect(resposta.status).toBe(404);
  });
});
