import { describe, expect, it } from 'vitest';
import { alternarAcao, montarListaEscolha } from './escolha';

describe('alternarAcao', () => {
  it('marca no fim, preservando a ordem de escolha', () => {
    expect(alternarAcao(['PETR4', 'BBAS3'], 'VALE3')).toEqual(['PETR4', 'BBAS3', 'VALE3']);
  });

  it('desmarca sem mexer na ordem das outras', () => {
    expect(alternarAcao(['PETR4', 'BBAS3', 'VALE3'], 'BBAS3')).toEqual(['PETR4', 'VALE3']);
  });

  it('com o limite atingido não marca outra, mas ainda desmarca', () => {
    expect(alternarAcao(['PETR4', 'BBAS3'], 'VALE3', 2)).toEqual(['PETR4', 'BBAS3']);
    expect(alternarAcao(['PETR4', 'BBAS3'], 'PETR4', 2)).toEqual(['BBAS3']);
  });

  it('não altera a lista recebida', () => {
    const marcadas = ['PETR4'];
    alternarAcao(marcadas, 'BBAS3');
    alternarAcao(marcadas, 'PETR4');
    expect(marcadas).toEqual(['PETR4']);
  });

  it('usa o limite de 50 por padrão', () => {
    const cheias = Array.from({ length: 50 }, (_, i) => `ABCD${i + 1}`);
    expect(alternarAcao(cheias, 'VALE3')).toHaveLength(50);
    expect(alternarAcao(cheias.slice(1), 'VALE3')).toHaveLength(50);
  });
});

describe('montarListaEscolha', () => {
  const catalogo = [
    { ticker: 'BBAS3', nome: 'Banco do Brasil' },
    { ticker: 'ITUB4', nome: 'Itaú Unibanco' },
    { ticker: 'PETR4', nome: 'Petrobras' },
    { ticker: 'VALE3', nome: 'Vale' },
  ];

  it('salvas primeiro, na ordem da grade; depois o resto do catálogo', () => {
    expect(montarListaEscolha(catalogo, ['VALE3', 'BBAS3'], '').map((i) => i.ticker)).toEqual([
      'VALE3',
      'BBAS3',
      'ITUB4',
      'PETR4',
    ]);
  });

  it('ação salva fora do catálogo aparece marcada como tal, sem nome', () => {
    const [antiga, ...resto] = montarListaEscolha(catalogo, ['ELET3'], '');
    expect(antiga).toEqual({ ticker: 'ELET3', nome: '', foraDoCatalogo: true });
    expect(resto.every((item) => !item.foraDoCatalogo)).toBe(true);
    expect(resto).toHaveLength(4);
  });

  it('a busca filtra os dois grupos, por código ou nome', () => {
    expect(montarListaEscolha(catalogo, ['ELET3', 'ITUB4'], 'itau')).toEqual([
      { ticker: 'ITUB4', nome: 'Itaú Unibanco', foraDoCatalogo: false },
    ]);
    expect(montarListaEscolha(catalogo, ['ELET3'], 'elet').map((i) => i.ticker)).toEqual(['ELET3']);
  });

  it('catálogo vazio (brapi fora do ar) ainda mostra as salvas', () => {
    expect(montarListaEscolha([], ['BBAS3'], '')).toEqual([
      { ticker: 'BBAS3', nome: '', foraDoCatalogo: true },
    ]);
  });
});
