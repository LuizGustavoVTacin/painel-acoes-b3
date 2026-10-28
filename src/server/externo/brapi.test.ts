import { describe, expect, it } from 'vitest';
import { criarFetchFalso, json } from '../testes/fetchFalso.js';
import { buscarListaBrapi, interpretarListaBrapi, URL_LISTA_BRAPI } from './brapi.js';
import { ErroFonte } from './erroFonte.js';

const AGORA = new Date('2026-10-27T15:00:00Z');

// Recorte real da resposta da brapi (27/10/2026), com os campos que usamos.
const acao = (stock: string, extras: Record<string, unknown> = {}) => ({
  stock,
  name: `Empresa ${stock}`,
  close: 17.38,
  logo: `https://icons.brapi.dev/icons/${stock}.svg`,
  type: 'stock',
  ...extras,
});

describe('interpretarListaBrapi', () => {
  it('converte as ações para o catálogo, com preço em centavos', () => {
    const itens = interpretarListaBrapi({
      stocks: [acao('BBAS3'), acao('TAEE11', { close: 40.57 }), acao('B3SA3')],
    });

    expect(itens).toEqual([
      {
        ticker: 'BBAS3',
        nome: 'Empresa BBAS3',
        logoUrl: 'https://icons.brapi.dev/icons/BBAS3.svg',
        precoCentavos: 1738,
      },
      {
        ticker: 'TAEE11',
        nome: 'Empresa TAEE11',
        logoUrl: 'https://icons.brapi.dev/icons/TAEE11.svg',
        precoCentavos: 4057,
      },
      {
        ticker: 'B3SA3',
        nome: 'Empresa B3SA3',
        logoUrl: 'https://icons.brapi.dev/icons/B3SA3.svg',
        precoCentavos: 1738,
      },
    ]);
  });

  it('descarta mercado fracionário, códigos fora do padrão, itens malformados e repetidos', () => {
    const itens = interpretarListaBrapi({
      stocks: [
        acao('BBAS3'),
        acao('BBAS3F'),
        acao('bbas3'),
        acao('IBOV'),
        acao('PETR4', { name: '' }),
        acao('VALE3', { name: 42 }),
        { name: 'sem ticker' },
        null,
        'texto',
        acao('BBAS3', { name: 'Duplicado' }),
      ],
    });

    expect(itens.map((i) => i.ticker)).toEqual(['BBAS3']);
    expect(itens[0].nome).toBe('Empresa BBAS3');
  });

  it.each([
    ['ausente', undefined],
    ['nulo', null],
    ['zero', 0],
    ['negativo', -1],
    ['texto', '17,38'],
    ['infinito', Infinity],
    ['abaixo de meio centavo (arredondaria para zero)', 0.004],
  ])('deixa o preço vazio quando ele vem %s', (_caso, close) => {
    expect(
      interpretarListaBrapi({ stocks: [acao('BBAS3', { close })] })[0].precoCentavos,
    ).toBeNull();
  });

  it.each([
    ['de outro site', 'https://outro.site/BBAS3.svg'],
    ['sem https', 'http://icons.brapi.dev/icons/BBAS3.svg'],
    ['ausente', undefined],
  ])('ignora logo %s', (_caso, logo) => {
    expect(interpretarListaBrapi({ stocks: [acao('BBAS3', { logo })] })[0].logoUrl).toBeNull();
  });

  it.each([
    ['sem a lista de ações', { indexes: [] }],
    ['lista que não é array', { stocks: 'x' }],
    ['nenhuma ação reconhecida', { stocks: [{ foo: 1 }] }],
    ['resposta nula', null],
  ])('acusa formato alterado: %s', (_caso, json) => {
    expect(() => interpretarListaBrapi(json)).toThrow(ErroFonte);
    try {
      interpretarListaBrapi(json);
    } catch (erro) {
      expect((erro as ErroFonte).situacao).toBe('formato_alterado');
    }
  });
});

describe('buscarListaBrapi', () => {
  it('busca a listagem pública, sem chave', async () => {
    const { buscar, requisicoes } = criarFetchFalso({
      [URL_LISTA_BRAPI]: json({ stocks: [acao('BBAS3')] }),
    });

    const { itens, avisoDeCobranca } = await buscarListaBrapi(buscar, AGORA);

    expect(itens).toHaveLength(1);
    expect(avisoDeCobranca).toBe(false);
    expect(requisicoes.map((r) => r.url)).toEqual([URL_LISTA_BRAPI]);
    expect(requisicoes[0].url).not.toMatch(/token|key/i);
    expect(requisicoes[0].cabecalhos.has('authorization')).toBe(false);
  });

  it('resposta 200 sem dados pedindo chave é bloqueio, não mudança de formato', async () => {
    const { buscar } = criarFetchFalso({
      [URL_LISTA_BRAPI]: json({ error: true, message: 'Token obrigatório para este recurso' }),
    });

    await expect(buscarListaBrapi(buscar, AGORA)).rejects.toMatchObject({ situacao: 'bloqueada' });
  });

  it('acusa formato alterado quando a resposta não é JSON', async () => {
    const { buscar } = criarFetchFalso({
      [URL_LISTA_BRAPI]: new Response('<html>manutenção</html>'),
    });

    await expect(buscarListaBrapi(buscar, AGORA)).rejects.toMatchObject({
      situacao: 'formato_alterado',
    });
  });
});
