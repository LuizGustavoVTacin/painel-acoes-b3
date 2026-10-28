import { describe, expect, it } from 'vitest';
import { criarFetchFalso, json } from '../testes/fetchFalso.js';
import { itemSpark, PREGAO_27_10, spark } from '../testes/yahooFalso.js';
import type { ErroFonte } from './erroFonte.js';
import { validarUrlExterna } from './http.js';
import { buscarLoteYahoo, dividirEmLotes, interpretarSpark, urlDoLote } from './yahoo.js';

const AGORA = new Date('2026-10-27T15:00:00Z');
const URL_YAHOO = 'https://query1.finance.yahoo.com/';

async function falha(promessa: Promise<unknown>): Promise<ErroFonte> {
  try {
    await promessa;
  } catch (erro) {
    return erro as ErroFonte;
  }
  throw new Error('Era esperada uma falha');
}

describe('lotes', () => {
  it('divide em lotes de no máximo 20 ações', () => {
    const tickers = Array.from({ length: 45 }, (_, i) => `ABC${i}3`);

    expect(dividirEmLotes(tickers).map((lote) => lote.length)).toEqual([20, 20, 5]);
    expect(dividirEmLotes([])).toEqual([]);
  });

  it('monta a URL do spark, sem chave, aceita pela lista de endereços permitidos', () => {
    const url = urlDoLote(['BBAS3', 'B3SA3']);

    expect(url).toBe(
      'https://query1.finance.yahoo.com/v7/finance/spark?symbols=BBAS3.SA,B3SA3.SA&range=1d&interval=1d',
    );
    expect(() => validarUrlExterna(url)).not.toThrow();
  });

  it.each([0, 21])('recusa lote com %s ações', (tamanho) => {
    const tickers = Array.from({ length: tamanho }, (_, i) => `ABC${i}3`);
    expect(() => urlDoLote(tickers)).toThrow(RangeError);
  });

  it('não aceita parâmetros extras no Yahoo, como crumb', () => {
    expect(() =>
      validarUrlExterna('https://query1.finance.yahoo.com/v7/finance/quote?symbols=X&crumb=abc'),
    ).toThrow();
  });
});

describe('interpretarSpark', () => {
  it('converte preço para centavos e guarda horário da negociação e do pregão', () => {
    expect(interpretarSpark({ spark: { result: [itemSpark('BBAS3')] } }, ['BBAS3'])).toEqual([
      {
        ticker: 'BBAS3',
        precoCentavos: 1738,
        negociadoEm: '2026-10-27T14:55:00.000Z',
        pregao: PREGAO_27_10,
      },
    ]);
  });

  it('aceita cotação sem horário do pregão', () => {
    const [cotacao] = interpretarSpark(
      { spark: { result: [itemSpark('BBAS3', 17.38, { currentTradingPeriod: null })] } },
      ['BBAS3'],
    );
    expect(cotacao.pregao).toBeNull();
  });

  it.each([
    ['ação não pedida', itemSpark('PETR4')],
    ['sem o sufixo .SA', { ...itemSpark('BBAS3'), symbol: 'BBAS3' }],
    ['moeda diferente de real', itemSpark('BBAS3', 17.38, { currency: 'USD' })],
    ['preço zero', itemSpark('BBAS3', 0)],
    ['preço abaixo de meio centavo', itemSpark('BBAS3', 0.004)],
    ['preço em texto', itemSpark('BBAS3', '17,38' as unknown as number)],
    ['sem horário de negociação', itemSpark('BBAS3', 17.38, { regularMarketTime: null })],
    ['horário fracionado', itemSpark('BBAS3', 17.38, { regularMarketTime: 1.5 })],
    ['sem resposta', { symbol: 'BBAS3.SA' }],
  ])('ignora item com %s', (_caso, item) => {
    expect(
      interpretarSpark({ spark: { result: [item, itemSpark('ITUB4')] } }, ['BBAS3', 'ITUB4']).map(
        (c) => c.ticker,
      ),
    ).toEqual(['ITUB4']);
  });

  it.each([
    ['preço zero (suspensa)', 0],
    ['preço ausente', undefined],
  ])('lote só com ação de %s não é mudança de formato', (_caso, preco) => {
    const item = itemSpark('SUSP3', 1, { regularMarketPrice: preco });
    expect(interpretarSpark({ spark: { result: [item] } }, ['SUSP3'])).toEqual([]);
  });

  it('lote só com uma ação em formato de erro não é mudança de formato', () => {
    const item = { symbol: 'XXXX3.SA', response: [{ error: { code: 'Not Found' } }] };
    expect(interpretarSpark({ spark: { result: [item] } }, ['XXXX3'])).toEqual([]);
  });

  it('várias ações desconhecidas no mesmo lote (com erro) não são mudança de formato', () => {
    const erro = (t: string) => ({
      symbol: `${t}.SA`,
      response: [{ error: { code: 'Not Found' } }],
    });
    expect(
      interpretarSpark({ spark: { result: [erro('ELET3'), erro('XXXX3')] } }, ['ELET3', 'XXXX3']),
    ).toEqual([]);
  });

  it('uma só ação sem dados e sem erro já indica mudança de formato', () => {
    const item = { symbol: 'BBAS3.SA', response: [{ dados: {} }] };
    expect(() => interpretarSpark({ spark: { result: [item] } }, ['BBAS3'])).toThrow(/formato/);
  });

  it('várias ações sem nenhum dado de cotação indicam mudança de formato', () => {
    const semDados = (t: string) => ({ symbol: `${t}.SA`, response: [{ dados: {} }] });
    expect(() =>
      interpretarSpark({ spark: { result: [semDados('BBAS3'), semDados('PETR4')] } }, [
        'BBAS3',
        'PETR4',
      ]),
    ).toThrow(/formato/);
  });

  it('ações que o Yahoo não conhece simplesmente não vêm (sem erro)', () => {
    expect(interpretarSpark({ spark: { result: [] } }, ['ELET3'])).toEqual([]);
  });

  it.each([
    ['sem a lista', { spark: {} }],
    ['resposta nula', null],
    ['lista que não é array', { spark: { result: 'x' } }],
    ['itens que não são reconhecidos', { spark: { result: [{ foo: 1 }] } }],
  ])('acusa formato alterado: %s', (_caso, corpo) => {
    expect(() => interpretarSpark(corpo, ['BBAS3'])).toThrow(/formato/);
  });
});

describe('buscarLoteYahoo', () => {
  it('envia só o User-Agent exigido pelo Yahoo, sem chave, cookie ou crumb', async () => {
    const { buscar, requisicoes } = criarFetchFalso({ [URL_YAHOO]: spark(itemSpark('BBAS3')) });

    const cotacoes = await buscarLoteYahoo(buscar, ['BBAS3'], AGORA);

    expect(cotacoes).toHaveLength(1);
    expect(requisicoes).toHaveLength(1);
    const { url, cabecalhos } = requisicoes[0];
    expect(url).not.toMatch(/crumb|token|key/i);
    expect(cabecalhos.get('user-agent')).toBe('Mozilla/5.0');
    expect(cabecalhos.has('cookie')).toBe(false);
    expect(cabecalhos.has('authorization')).toBe(false);
  });

  it('lote só com ações que o Yahoo não conhece (404 "Not Found") não é falha da API', async () => {
    // Resposta real do spark para symbols=XXXX3.SA (conferida em 28/10/2026).
    const corpo = {
      spark: {
        result: null,
        error: { code: 'Not Found', description: 'No data found for spark symbols' },
      },
    };
    const { buscar } = criarFetchFalso({ [URL_YAHOO]: json(corpo, { status: 404 }) });

    await expect(buscarLoteYahoo(buscar, ['ELET3', 'XXXX3'], AGORA)).resolves.toEqual([]);
  });

  it.each([
    ['página HTML', new Response('<html>Not Found</html>', { status: 404 })],
    ['JSON de outro erro', json({ finance: { error: { code: 'Not Found' } } }, { status: 404 })],
  ])('outro 404 (%s) continua sendo formato alterado', async (_caso, resposta) => {
    const { buscar } = criarFetchFalso({ [URL_YAHOO]: resposta });

    expect((await falha(buscarLoteYahoo(buscar, ['BBAS3'], AGORA))).situacao).toBe(
      'formato_alterado',
    );
  });

  it('404 "Not Found" falando de assinatura é bloqueio, não "nenhuma ação"', async () => {
    const corpo = {
      spark: {
        result: null,
        error: { code: 'Not Found', description: 'Subscription required: upgrade your plan' },
      },
    };
    const { buscar } = criarFetchFalso({ [URL_YAHOO]: json(corpo, { status: 404 }) });

    expect((await falha(buscarLoteYahoo(buscar, ['BBAS3'], AGORA))).situacao).toBe('bloqueada');
  });

  it('404 pedindo pagamento continua sendo bloqueio', async () => {
    const { buscar } = criarFetchFalso({
      [URL_YAHOO]: new Response('Subscription required: upgrade your plan', { status: 404 }),
    });

    expect((await falha(buscarLoteYahoo(buscar, ['BBAS3'], AGORA))).situacao).toBe('bloqueada');
  });

  it('lote grande demais (400 do Yahoo) é formato alterado', async () => {
    const corpo = {
      spark: {
        result: null,
        error: {
          code: 'Bad Request',
          description: 'Number of symbols needs to be less than or equal to 20',
        },
      },
    };
    const { buscar } = criarFetchFalso({ [URL_YAHOO]: json(corpo, { status: 400 }) });

    expect((await falha(buscarLoteYahoo(buscar, ['BBAS3'], AGORA))).situacao).toBe(
      'formato_alterado',
    );
  });

  it('"Invalid Crumb" (401) é instabilidade, não pedido de pagamento', async () => {
    const { buscar } = criarFetchFalso({
      [URL_YAHOO]: json(
        { finance: { error: { code: 'Unauthorized', description: 'Invalid Crumb' } } },
        { status: 401 },
      ),
    });

    expect((await falha(buscarLoteYahoo(buscar, ['BBAS3'], AGORA))).situacao).toBe('instavel');
  });

  it('limite de requisições (429) é instabilidade', async () => {
    const { buscar } = criarFetchFalso({
      [URL_YAHOO]: new Response('Too Many Requests', { status: 429 }),
    });

    expect((await falha(buscarLoteYahoo(buscar, ['BBAS3'], AGORA))).situacao).toBe('instavel');
  });

  it('resposta que não é JSON é formato alterado', async () => {
    const { buscar } = criarFetchFalso({ [URL_YAHOO]: new Response('<html>oops</html>') });

    expect((await falha(buscarLoteYahoo(buscar, ['BBAS3'], AGORA))).situacao).toBe(
      'formato_alterado',
    );
  });
});
