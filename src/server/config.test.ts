import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lerPorta, PORTA_PADRAO, pastaClienteCompilado } from './config.js';

describe('lerPorta', () => {
  it.each([
    ['4000', 4000],
    [' 8080 ', 8080],
    ['1', 1],
    ['65535', 65535],
  ])('aceita %j', (valor, esperado) => {
    expect(lerPorta(valor)).toBe(esperado);
  });

  it.each([undefined, '', '   ', 'abc', '0', '65536', '-1', '30.5', '3000abc'])(
    'usa a porta padrão para %j',
    (valor) => {
      expect(lerPorta(valor)).toBe(PORTA_PADRAO);
    },
  );
});

describe('pastaClienteCompilado', () => {
  const projeto = path.resolve('projeto-ficticio');
  const urlDe = (...partes: string[]) => pathToFileURL(path.join(projeto, ...partes)).href;

  it('aponta para dist/client quando roda a partir de dist/server', () => {
    expect(pastaClienteCompilado(urlDe('dist', 'server', 'index.js'))).toBe(
      path.join(projeto, 'dist', 'client'),
    );
  });

  it('não serve frontend quando roda a partir de src/server (desenvolvimento)', () => {
    expect(pastaClienteCompilado(urlDe('src', 'server', 'index.ts'))).toBeUndefined();
  });

  it('ignora pastas "dist" acima do projeto', () => {
    const url = pathToFileURL(path.resolve('dist', 'projeto', 'src', 'server', 'index.ts')).href;

    expect(pastaClienteCompilado(url)).toBeUndefined();
  });
});
