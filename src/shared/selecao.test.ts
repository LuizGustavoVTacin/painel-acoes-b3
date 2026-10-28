import { describe, expect, it } from 'vitest';
import { filtrarAcoes, simplificar } from './selecao.js';

describe('simplificar', () => {
  it('remove acentos e caixa', () => {
    expect(simplificar('Itaú Unibanco')).toBe('itau unibanco');
    expect(simplificar('AÇÃO')).toBe('acao');
  });
});

describe('filtrarAcoes', () => {
  const acoes = [
    { ticker: 'BBAS3', nome: 'Banco do Brasil' },
    { ticker: 'ITUB4', nome: 'Itaú Unibanco' },
    { ticker: 'PETR4', nome: 'Petrobras' },
  ];

  it('busca vazia ou só espaços devolve tudo, na mesma ordem', () => {
    expect(filtrarAcoes(acoes, '')).toEqual(acoes);
    expect(filtrarAcoes(acoes, '   ')).toEqual(acoes);
  });

  it('encontra por parte do código, sem diferença de caixa', () => {
    expect(filtrarAcoes(acoes, 'petr')).toEqual([acoes[2]]);
  });

  it('encontra por parte do nome, sem diferença de acento', () => {
    expect(filtrarAcoes(acoes, ' itau ')).toEqual([acoes[1]]);
    expect(filtrarAcoes(acoes, 'BRASIL')).toEqual([acoes[0]]);
  });

  it('sem resultado devolve lista vazia', () => {
    expect(filtrarAcoes(acoes, 'vale')).toEqual([]);
  });
});
