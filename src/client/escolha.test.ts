import { describe, expect, it } from 'vitest';
import {
  alternarAcao,
  contarSetores,
  montarListaEscolha,
  selecaoFinal,
  type FiltrosEscolha,
} from './escolha';
import { nomeDoSetor } from './setores';

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

const acao = (
  ticker: string,
  nome: string,
  setor: string | null,
  variacaoDoDia: number | null,
) => ({
  ticker,
  nome,
  setor,
  variacaoDoDia,
});

const fora = (ticker: string) => ({
  ticker,
  nome: '',
  setor: null,
  variacaoDoDia: null,
  foraDoCatalogo: true,
});

/** Filtros com tudo liberado, mudando só o que o teste informar. */
const filtros = (mudancas: Partial<FiltrosEscolha> = {}): FiltrosEscolha => ({
  busca: '',
  setor: null,
  modo: 'todas',
  ...mudancas,
});

describe('montarListaEscolha', () => {
  const catalogo = [
    acao('BBAS3', 'Banco do Brasil', 'Finance', 235),
    acao('ITUB4', 'Itaú Unibanco', 'Finance', -110),
    acao('PETR4', 'Petrobras', 'Energy Minerals', 512),
    acao('VALE3', 'Vale', null, null),
  ];
  const tickers = (itens: { ticker: string }[]) => itens.map((i) => i.ticker);

  it('salvas primeiro, na ordem da grade; depois o resto do catálogo', () => {
    expect(
      montarListaEscolha(catalogo, ['VALE3', 'BBAS3'], filtros()).map((i) => i.ticker),
    ).toEqual(['VALE3', 'BBAS3', 'ITUB4', 'PETR4']);
  });

  it('ação salva fora do catálogo aparece marcada como tal, sem nome', () => {
    const [antiga, ...resto] = montarListaEscolha(catalogo, ['ELET3'], filtros());
    expect(antiga).toEqual(fora('ELET3'));
    expect(resto.every((item) => !item.foraDoCatalogo)).toBe(true);
    expect(resto).toHaveLength(4);
  });

  it('a busca filtra os dois grupos, por código ou nome', () => {
    expect(montarListaEscolha(catalogo, ['ELET3', 'ITUB4'], filtros({ busca: 'itau' }))).toEqual([
      { ...catalogo[1], foraDoCatalogo: false },
    ]);
    expect(tickers(montarListaEscolha(catalogo, ['ELET3'], filtros({ busca: 'elet' })))).toEqual([
      'ELET3',
    ]);
  });

  it('catálogo vazio (brapi fora do ar) ainda mostra as salvas', () => {
    expect(montarListaEscolha([], ['BBAS3'], filtros())).toEqual([fora('BBAS3')]);
  });

  it('filtra por setor, mantendo as salvas no topo; sem setor só aparece em "todos"', () => {
    expect(tickers(montarListaEscolha(catalogo, ['ITUB4'], filtros({ setor: 'Finance' })))).toEqual(
      ['ITUB4', 'BBAS3'],
    );
    expect(tickers(montarListaEscolha(catalogo, ['ELET3'], filtros({ setor: 'Finance' })))).toEqual(
      ['BBAS3', 'ITUB4'],
    );
  });

  it('em alta: só as que subiram, da maior alta para a menor, sem fixar as salvas', () => {
    expect(tickers(montarListaEscolha(catalogo, ['BBAS3'], filtros({ modo: 'alta' })))).toEqual([
      'PETR4',
      'BBAS3',
    ]);
  });

  it('em baixa: só as que caíram, da maior queda para a menor', () => {
    const comQuedas = [
      ...catalogo,
      acao('WEGE3', 'WEG', null, -300),
      acao('ABEV3', 'Ambev', null, 0),
    ];
    expect(tickers(montarListaEscolha(comQuedas, [], filtros({ modo: 'baixa' })))).toEqual([
      'WEGE3',
      'ITUB4',
    ]);
  });

  it('variações iguais ficam em ordem de código', () => {
    const empatadas = [acao('VALE3', 'Vale', null, 100), acao('BBAS3', 'BB', null, 100)];
    expect(tickers(montarListaEscolha(empatadas, [], filtros({ modo: 'alta' })))).toEqual([
      'BBAS3',
      'VALE3',
    ]);
  });

  it('que comprei: só as compradas, incluindo as que saíram da bolsa', () => {
    const compradas = new Set(['PETR4', 'ITUB4', 'ELET3']);
    expect(
      montarListaEscolha(catalogo, ['ITUB4', 'VALE3'], filtros({ modo: 'compradas', compradas })),
    ).toEqual([
      { ...catalogo[1], foraDoCatalogo: false },
      { ...catalogo[2], foraDoCatalogo: false },
      fora('ELET3'),
    ]);
  });

  it('os filtros se combinam: setor, modo e busca', () => {
    const compradas = new Set(['BBAS3', 'ITUB4', 'PETR4']);
    const lista = (mudancas: Partial<FiltrosEscolha>) =>
      tickers(montarListaEscolha(catalogo, [], filtros({ compradas, ...mudancas })));
    expect(lista({ setor: 'Finance', modo: 'alta' })).toEqual(['BBAS3']);
    expect(lista({ setor: 'Finance', modo: 'compradas', busca: 'itau' })).toEqual(['ITUB4']);
    expect(lista({ setor: 'Energy Minerals', modo: 'baixa' })).toEqual([]);
  });
});

describe('contarSetores', () => {
  it('lista os setores em português, em ordem alfabética, com a quantidade de ações', () => {
    const catalogo = [
      acao('BBAS3', 'BB', 'Finance', null),
      acao('ITUB4', 'Itaú', 'Finance', null),
      acao('VIVT3', 'Vivo', 'Communications', null),
      acao('NOVA3', 'Nova', 'Space Mining', null),
      acao('VALE3', 'Vale', null, null),
    ];
    expect(contarSetores(catalogo)).toEqual([
      { setor: 'Finance', nome: 'Finanças', quantidade: 2 },
      { setor: 'Space Mining', nome: 'Space Mining', quantidade: 1 },
      { setor: 'Communications', nome: 'Telecomunicações', quantidade: 1 },
    ]);
  });
});

describe('nomeDoSetor', () => {
  it('traduz os setores da brapi e mantém os desconhecidos', () => {
    expect(nomeDoSetor('Utilities')).toBe('Energia elétrica e saneamento');
    expect(nomeDoSetor('Energy Minerals')).toBe('Petróleo, gás e carvão');
    expect(nomeDoSetor('Setor Novo')).toBe('Setor Novo');
    expect(nomeDoSetor('toString')).toBe('toString');
  });
});

describe('selecaoFinal', () => {
  it('as salvas mantêm a posição; as novas vão para o fim na ordem marcada', () => {
    expect(selecaoFinal(['PETR4', 'BBAS3', 'VALE3'], ['VALE3', 'ITUB4', 'PETR4', 'WEGE3'])).toEqual(
      ['PETR4', 'VALE3', 'ITUB4', 'WEGE3'],
    );
  });

  it('desmarcar e marcar de novo não muda a ordem', () => {
    expect(selecaoFinal(['PETR4', 'BBAS3'], ['BBAS3', 'PETR4'])).toEqual(['PETR4', 'BBAS3']);
  });

  it('desmarcar tudo dá lista vazia', () => {
    expect(selecaoFinal(['PETR4'], [])).toEqual([]);
  });
});
