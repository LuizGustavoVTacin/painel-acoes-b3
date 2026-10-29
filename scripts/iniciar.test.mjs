import { describe, expect, it } from 'vitest';
import {
  classificarPorta,
  comandoNavegador,
  entraNoBuild,
  precisaCompilar,
  precisaInstalar,
  versaoNodeServe,
} from './iniciar.mjs';

describe('versaoNodeServe', () => {
  it.each([
    ['v24.0.0', true],
    ['v24.11.1', true],
    ['v26.1.0', true],
    ['v22.12.0', false],
    ['v8.0.0', false],
    ['', false],
    ['lixo', false],
  ])('%s → %s', (versao, serve) => {
    expect(versaoNodeServe(versao)).toBe(serve);
  });
});

describe('precisaInstalar', () => {
  it('sem node_modules instala', () => {
    expect(precisaInstalar({ instaladoEm: null, lockEm: 100 })).toBe(true);
  });

  it('package-lock.json mais novo que a instalação instala de novo', () => {
    expect(precisaInstalar({ instaladoEm: 100, lockEm: 200 })).toBe(true);
  });

  it('instalação em dia não instala', () => {
    expect(precisaInstalar({ instaladoEm: 200, lockEm: 100 })).toBe(false);
    expect(precisaInstalar({ instaladoEm: 200, lockEm: 200 })).toBe(false);
  });
});

describe('entraNoBuild', () => {
  it.each([
    ['src/client/App.tsx', true],
    ['src\\server\\app.ts', true],
    ['src/client/estilo.css', true],
    ['src/client/App.test.tsx', false],
    ['src/server/app.test.ts', false],
    ['src/server/testes/fetchFalso.ts', false],
    ['src\\server\\testes\\yahooFalso.ts', false],
    ['src/ponta-a-ponta/fluxo.test.tsx', false],
  ])('%s → %s', (caminho, entra) => {
    expect(entraNoBuild(caminho)).toBe(entra);
  });
});

describe('precisaCompilar', () => {
  it('sem compilação compila', () => {
    expect(precisaCompilar({ compiladoEm: null, fontesEm: [1, 2] })).toBe(true);
  });

  it('uma fonte mais nova que a compilação compila', () => {
    expect(precisaCompilar({ compiladoEm: 100, fontesEm: [50, 150] })).toBe(true);
  });

  it('tudo mais velho que a compilação: abre direto', () => {
    expect(precisaCompilar({ compiladoEm: 100, fontesEm: [50, 100] })).toBe(false);
  });
});

describe('classificarPorta', () => {
  it('conexão recusada: porta livre', () => {
    expect(classificarPorta({ erro: 'ECONNREFUSED' })).toBe('livre');
  });

  it('o próprio dashboard responde', () => {
    expect(
      classificarPorta({ status: 200, corpo: { status: 'ok', horario: '2026-10-28T12:00:00Z' } }),
    ).toBe('dashboard');
  });

  it.each([
    ['tempo esgotado', { erro: 'TimeoutError' }],
    ['outro erro de rede', { erro: 'ECONNRESET' }],
    ['página que não é o dashboard', { status: 404, corpo: null }],
    ['JSON de outro programa', { status: 200, corpo: { nome: 'outro' } }],
    ['texto em vez de JSON', { status: 200, corpo: null }],
  ])('%s: outro programa', (_caso, resultado) => {
    expect(classificarPorta(resultado)).toBe('outro');
  });
});

describe('comandoNavegador', () => {
  it('no Windows usa o start do cmd, com título vazio antes do endereço', () => {
    expect(comandoNavegador('http://localhost:3000', 'win32')).toEqual({
      programa: 'cmd.exe',
      argumentos: ['/c', 'start', '""', 'http://localhost:3000'],
      literal: true,
    });
  });

  it('no macOS usa open e no Linux xdg-open', () => {
    expect(comandoNavegador('http://localhost:3000', 'darwin').programa).toBe('open');
    expect(comandoNavegador('http://localhost:3000', 'linux').programa).toBe('xdg-open');
  });
});
