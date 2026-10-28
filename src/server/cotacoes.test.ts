import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from './app.js';
import { abrirBanco, type Banco } from './banco/conexao.js';
import { criarRepositorioUsoApi } from './banco/usoApi.js';
import { criarServicoCatalogo } from './catalogo.js';
import { criarServicoCotacoes } from './cotacoes.js';
import { URL_LISTA_BRAPI } from './externo/brapi.js';
import { criarEstadoFontes } from './externo/estadoFontes.js';
import { criarFetchFalso, json } from './testes/fetchFalso.js';
import { itemSpark, segundos, spark } from './testes/yahooFalso.js';

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const URL_YAHOO = 'https://query1.finance.yahoo.com/';

// Reserva: listagem da brapi com preços diferentes dos do Yahoo, para saber de onde veio.
const listaBrapi = () =>
  json({
    stocks: ['BBAS3', 'PETR4', 'ELET3'].map((stock) => ({
      stock,
      name: stock,
      close: 50,
      logo: null,
    })),
  });

let banco: Banco;
let agora: Date;
const avancar = (ms: number) => {
  agora = new Date(agora.getTime() + ms);
};

function montar(respostas: Parameters<typeof criarFetchFalso>[0]) {
  const { buscar, requisicoes } = criarFetchFalso(respostas);
  const estado = criarEstadoFontes(banco);
  const uso = criarRepositorioUsoApi(banco);
  const relogio = () => agora;
  const catalogo = criarServicoCatalogo({ banco, buscar, agora: relogio, estado, uso });
  // A pausa entre rodadas avança o relógio falso em vez de esperar de verdade.
  const esperas: number[] = [];
  const esperar = async (ms: number) => {
    esperas.push(ms);
    avancar(ms);
  };
  const cotacoes = criarServicoCotacoes({
    banco,
    buscar,
    agora: relogio,
    estado,
    uso,
    catalogo,
    esperar,
  });
  const doYahoo = () => requisicoes.filter((r) => r.url.startsWith(URL_YAHOO));
  const daBrapi = () => requisicoes.filter((r) => r.url === URL_LISTA_BRAPI);
  return { cotacoes, estado, uso, doYahoo, daBrapi, esperas };
}

async function atualizarEListar(servico: ReturnType<typeof montar>['cotacoes'], tickers: string[]) {
  await servico.atualizar(tickers);
  return servico.listar(tickers);
}

beforeEach(() => {
  banco = abrirBanco(':memory:');
  agora = new Date('2026-10-27T15:00:00Z'); // 12h em Brasília: pregão aberto
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  banco.close();
});

describe('cotações pelo Yahoo', () => {
  it('busca no Yahoo, salva e informa a fonte', async () => {
    const { cotacoes, estado, uso, daBrapi } = montar({
      [URL_YAHOO]: spark(itemSpark('BBAS3', 17.38), itemSpark('PETR4', 38.5)),
    });

    const painel = await atualizarEListar(cotacoes, ['BBAS3', 'PETR4']);

    expect(painel).toEqual({
      cotacoes: [
        {
          ticker: 'BBAS3',
          precoCentavos: 1738,
          fonte: 'yahoo',
          negociadoEm: '2026-10-27T14:55:00.000Z',
          atualizadoEm: agora.toISOString(),
          desatualizada: false,
        },
        expect.objectContaining({ ticker: 'PETR4', precoCentavos: 3850, fonte: 'yahoo' }),
      ],
      mercadoAberto: true,
      fontesEmUso: ['yahoo'],
      semCotacaoNoYahoo: [],
    });
    expect(estado.consultar('yahoo')).toMatchObject({ situacao: 'ok', mensagem: null });
    expect(uso.consultar('yahoo', '2026-10')).toBe(1);
    expect(daBrapi()).toHaveLength(0);
  });

  it('50 ações viram 3 chamadas (lotes de 20, 20 e 10)', async () => {
    const tickers = Array.from({ length: 50 }, (_, i) => `AB${String(i).padStart(2, '0')}3`);
    const { cotacoes, uso, doYahoo } = montar({
      [URL_YAHOO]: [
        spark(...tickers.slice(0, 20).map((t) => itemSpark(t))),
        spark(...tickers.slice(20, 40).map((t) => itemSpark(t))),
        spark(...tickers.slice(40).map((t) => itemSpark(t))),
      ],
    });

    const painel = await atualizarEListar(cotacoes, tickers);

    expect(
      doYahoo().map((r) => new URL(r.url).searchParams.get('symbols')!.split(',').length),
    ).toEqual([20, 20, 10]);
    expect(painel.cotacoes.every((c) => c.fonte === 'yahoo')).toBe(true);
    expect(uso.consultar('yahoo', '2026-10')).toBe(3);
  });

  it('com o pregão aberto, atualiza no máximo a cada 5 minutos', async () => {
    const { cotacoes, doYahoo } = montar({ [URL_YAHOO]: spark(itemSpark('BBAS3')) });
    await cotacoes.atualizar(['BBAS3']);

    avancar(4 * MINUTO);
    await cotacoes.atualizar(['BBAS3']);
    expect(doYahoo()).toHaveLength(1);

    avancar(1 * MINUTO);
    await cotacoes.atualizar(['BBAS3']);
    expect(doYahoo()).toHaveLength(2);
  });

  it('com o pregão fechado, atualiza no máximo 1 vez por hora e mostra o fechamento', async () => {
    agora = new Date('2026-10-27T22:00:00Z'); // 19h em Brasília
    const { cotacoes, doYahoo } = montar({ [URL_YAHOO]: spark(itemSpark('BBAS3')) });
    await cotacoes.atualizar(['BBAS3']);

    avancar(59 * MINUTO);
    const painel = await atualizarEListar(cotacoes, ['BBAS3']);
    expect(doYahoo()).toHaveLength(1);
    expect(painel.mercadoAberto).toBe(false);
    expect(painel.cotacoes[0]).toMatchObject({ precoCentavos: 1738, desatualizada: false });

    avancar(1 * MINUTO);
    await cotacoes.atualizar(['BBAS3']);
    expect(doYahoo()).toHaveLength(2);
  });

  it('ação recém-selecionada é buscada na hora, sem repetir as que estão em dia', async () => {
    const { cotacoes, doYahoo } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), spark(itemSpark('PETR4'))],
    });
    await cotacoes.atualizar(['BBAS3']);

    avancar(1 * MINUTO);
    const painel = await atualizarEListar(cotacoes, ['BBAS3', 'PETR4']);

    expect(doYahoo().map((r) => new URL(r.url).searchParams.get('symbols'))).toEqual([
      'BBAS3.SA',
      'PETR4.SA',
    ]);
    expect(painel.cotacoes.map((c) => c.fonte)).toEqual(['yahoo', 'yahoo']);
  });
});

describe('reserva pela brapi e falhas', () => {
  it('ação que o Yahoo não tem usa o preço da brapi, com aviso', async () => {
    const { cotacoes, estado } = montar({
      [URL_YAHOO]: spark(itemSpark('BBAS3')),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const painel = await atualizarEListar(cotacoes, ['BBAS3', 'ELET3']);

    expect(painel.cotacoes.map((c) => [c.ticker, c.fonte, c.precoCentavos])).toEqual([
      ['BBAS3', 'yahoo', 1738],
      ['ELET3', 'brapi', 5000],
    ]);
    expect(painel.fontesEmUso).toEqual(['yahoo', 'brapi']);
    expect(painel.semCotacaoNoYahoo).toEqual(['ELET3']);
    expect(estado.consultar('yahoo')?.situacao).toBe('ok');
  });

  it('Yahoo pedindo pagamento: usa só a brapi e não chama o Yahoo por 24 h', async () => {
    const { cotacoes, estado, doYahoo } = montar({
      [URL_YAHOO]: json({ message: 'subscription required' }, { status: 402 }),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const painel = await atualizarEListar(cotacoes, ['BBAS3', 'PETR4']);
    avancar(23 * HORA);
    await cotacoes.atualizar(['BBAS3', 'PETR4']);

    expect(estado.consultar('yahoo')?.situacao).toBe('bloqueada');
    expect(painel.fontesEmUso).toEqual(['brapi']);
    expect(painel.cotacoes.every((c) => c.fonte === 'brapi')).toBe(true);
    expect(doYahoo()).toHaveLength(1);
  });

  it('falha no segundo lote: guarda o primeiro e não insiste no terceiro', async () => {
    const tickers = Array.from({ length: 45 }, (_, i) => `AB${String(i).padStart(2, '0')}3`);
    const { cotacoes, estado, doYahoo } = montar({
      [URL_YAHOO]: [
        spark(...tickers.slice(0, 20).map((t) => itemSpark(t))),
        json({}, { status: 500 }),
      ],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const painel = await atualizarEListar(cotacoes, tickers);

    expect(doYahoo()).toHaveLength(2);
    expect(painel.cotacoes.filter((c) => c.fonte === 'yahoo')).toHaveLength(20);
    expect(estado.consultar('yahoo')?.situacao).toBe('instavel');
  });

  it('sem nenhuma fonte, mantém o último preço e marca como desatualizado', async () => {
    const { cotacoes } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), new TypeError('fetch failed')],
      [URL_LISTA_BRAPI]: new TypeError('fetch failed'),
    });
    await cotacoes.atualizar(['BBAS3']);

    avancar(5 * MINUTO);
    const logo = await atualizarEListar(cotacoes, ['BBAS3']);
    avancar(6 * MINUTO);
    const depois = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(logo.cotacoes[0]).toMatchObject({ precoCentavos: 1738, desatualizada: false });
    expect(depois.cotacoes[0]).toMatchObject({ precoCentavos: 1738, desatualizada: true });
    expect(depois.fontesEmUso).toEqual([]);
  });

  it('ação sem nenhuma cotação aparece sem preço', async () => {
    const { cotacoes } = montar({
      [URL_YAHOO]: spark(),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const painel = await atualizarEListar(cotacoes, ['WEGE3']);

    expect(painel.cotacoes[0]).toEqual({
      ticker: 'WEGE3',
      precoCentavos: null,
      fonte: null,
      negociadoEm: null,
      atualizadoEm: null,
      desatualizada: true,
    });
  });

  it('erro do banco ao salvar não é culpa do Yahoo', async () => {
    const { cotacoes, estado } = montar({
      [URL_YAHOO]: spark(itemSpark('BBAS3')),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    banco.exec(`CREATE TEMP TRIGGER sem_cotacao BEFORE INSERT ON cotacoes
      BEGIN SELECT RAISE(ABORT, 'disco cheio'); END`);

    await expect(cotacoes.atualizar(['BBAS3'])).resolves.toBeUndefined();

    expect(estado.consultar('yahoo')?.situacao).toBe('ok');
  });

  it('o banco recusa preço zero e fonte desconhecida', () => {
    const inserir = banco.prepare(
      `INSERT INTO cotacoes (ticker, preco_centavos, fonte, atualizado_em) VALUES (?, ?, ?, 'x')`,
    );
    expect(() => inserir.run('BBAS3', 0, 'yahoo')).toThrow(/CHECK/);
    expect(() => inserir.run('BBAS3', 100, 'google')).toThrow(/CHECK/);
  });
});

describe('GET /api/cotacoes', () => {
  it('devolve as cotações das ações selecionadas e o estado das fontes', async () => {
    const { buscar } = criarFetchFalso({ [URL_YAHOO]: spark(itemSpark('BBAS3')) });
    const app = criarApp({ banco, buscar, agora: () => agora });
    await request(app)
      .put('/api/selecao')
      .send({ tickers: ['BBAS3'] });

    const resposta = await request(app).get('/api/cotacoes');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      cotacoes: [{ ticker: 'BBAS3', precoCentavos: 1738, fonte: 'yahoo' }],
      mercadoAberto: true,
      fontesEmUso: ['yahoo'],
      fontes: [expect.objectContaining({ provedor: 'yahoo', situacao: 'ok' })],
    });
  });

  it('sem internet, responde 200 com as ações sem preço', async () => {
    const { buscar } = criarFetchFalso({});
    const app = criarApp({ banco, buscar, agora: () => agora });
    await request(app)
      .put('/api/selecao')
      .send({ tickers: ['BBAS3'] });

    const resposta = await request(app).get('/api/cotacoes');

    expect(resposta.status).toBe(200);
    expect(resposta.body.cotacoes).toEqual([expect.objectContaining({ precoCentavos: null })]);
    expect(resposta.body.fontesEmUso).toEqual([]);
  });
});

describe('ritmo pelo horário do pregão', () => {
  it('feriado: sem pregão confirmado no dia útil, atualiza a cada 15 minutos', async () => {
    agora = new Date('2026-10-28T15:00:00Z'); // quarta, 12h; o Yahoo só tem o pregão de terça
    const { cotacoes, doYahoo } = montar({ [URL_YAHOO]: spark(itemSpark('BBAS3')) });

    const painel = await atualizarEListar(cotacoes, ['BBAS3']);
    avancar(14 * MINUTO);
    await cotacoes.atualizar(['BBAS3']);
    expect(doYahoo()).toHaveLength(1);
    avancar(1 * MINUTO);
    await cotacoes.atualizar(['BBAS3']);

    expect(painel.mercadoAberto).toBeNull();
    expect(doYahoo()).toHaveLength(2);
  });

  it('pega o preço do leilão de fechamento logo depois das 17h', async () => {
    agora = new Date('2026-10-27T19:58:00Z');
    const { cotacoes, doYahoo } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3', 17.38)), spark(itemSpark('BBAS3', 17.5))],
    });
    await cotacoes.atualizar(['BBAS3']);

    agora = new Date('2026-10-27T20:15:00Z');
    const painel = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(doYahoo()).toHaveLength(2);
    expect(painel.cotacoes[0].precoCentavos).toBe(1750);
    expect(painel.mercadoAberto).toBe(false);
  });

  it('busca de novo ao fim do leilão, mesmo dentro do intervalo', async () => {
    agora = new Date('2026-10-27T20:27:00Z');
    const { cotacoes, doYahoo } = montar({ [URL_YAHOO]: spark(itemSpark('BBAS3')) });
    await cotacoes.atualizar(['BBAS3']);

    agora = new Date('2026-10-27T20:30:00Z'); // 3 min depois, mas o leilão acabou
    await cotacoes.atualizar(['BBAS3']);
    agora = new Date('2026-10-27T20:45:00Z');
    await cotacoes.atualizar(['BBAS3']);

    expect(doYahoo()).toHaveLength(2);
  });

  it('descobre o pregão novo logo na abertura do dia seguinte', async () => {
    const pregao28 = {
      currentTradingPeriod: {
        regular: {
          start: segundos('2026-10-28T13:00:00Z'),
          end: segundos('2026-10-28T20:00:00Z'),
        },
      },
    };
    agora = new Date('2026-10-28T12:58:00Z'); // 9h58 de quarta: Yahoo ainda informa terça
    const { cotacoes, doYahoo } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), spark(itemSpark('BBAS3', 18, pregao28))],
    });
    await cotacoes.atualizar(['BBAS3']);

    agora = new Date('2026-10-28T13:00:00Z');
    const painel = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(doYahoo()).toHaveLength(2);
    expect(painel.mercadoAberto).toBe(true);
  });
});

describe('robustez das cotações (revisão)', () => {
  it('pedidos simultâneos compartilham a mesma atualização', () => {
    const { cotacoes } = montar({ [URL_YAHOO]: spark(itemSpark('BBAS3')) });

    expect(cotacoes.atualizar(['BBAS3'])).toBe(cotacoes.atualizar(['BBAS3']));
  });

  it('ação suspensa (preço 0) fica sem cotação, sem pausar o Yahoo', async () => {
    const { cotacoes, estado } = montar({
      [URL_YAHOO]: spark(itemSpark('SUSP3', 0)),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const painel = await atualizarEListar(cotacoes, ['SUSP3']);

    expect(painel.semCotacaoNoYahoo).toEqual(['SUSP3']);
    expect(estado.consultar('yahoo')?.situacao).toBe('ok');
    expect(estado.podeChamar('yahoo', agora)).toBe(true);
  });

  it('o aviso de ação ausente fica enquanto ela estiver selecionada, e sai ao desmarcar', async () => {
    const { cotacoes } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), spark(itemSpark('PETR4'))],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    await cotacoes.atualizar(['BBAS3', 'ELET3']);

    avancar(1 * MINUTO);
    const comOutra = await atualizarEListar(cotacoes, ['BBAS3', 'ELET3', 'PETR4']);

    expect(comOutra.semCotacaoNoYahoo).toEqual(['ELET3']);
    expect(cotacoes.listar(['BBAS3', 'PETR4']).semCotacaoNoYahoo).toEqual([]);
  });

  it('ação marcada logo após uma rodada espera a pausa de 5 s e é buscada no Yahoo', async () => {
    const { cotacoes, doYahoo, esperas, daBrapi } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), spark(itemSpark('PETR4'))],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    await cotacoes.atualizar(['BBAS3']);

    avancar(3000);
    const painel = await atualizarEListar(cotacoes, ['BBAS3', 'PETR4']);

    expect(esperas).toEqual([2000]);
    expect(doYahoo().map((r) => new URL(r.url).searchParams.get('symbols'))).toEqual([
      'BBAS3.SA',
      'PETR4.SA',
    ]);
    expect(painel.cotacoes.map((c) => c.fonte)).toEqual(['yahoo', 'yahoo']);
    expect(daBrapi()).toHaveLength(0);
  });

  it('rodadas de chamadas ao Yahoo nunca se sobrepõem', async () => {
    let simultaneas = 0;
    let pico = 0;
    const lento = async () => {
      pico = Math.max(pico, ++simultaneas);
      await new Promise((resolver) => setTimeout(resolver, 10));
      simultaneas--;
      return spark(itemSpark('BBAS3'), itemSpark('PETR4'), itemSpark('VALE3'));
    };
    const { cotacoes, doYahoo } = montar({ [URL_YAHOO]: lento, [URL_LISTA_BRAPI]: listaBrapi() });

    await Promise.all([
      cotacoes.atualizar(['BBAS3']),
      cotacoes.atualizar(['BBAS3', 'PETR4']),
      cotacoes.atualizar(['VALE3']),
    ]);

    // Os três pedidos entram na mesma rodada: uma só chamada com as três ações.
    expect(pico).toBe(1);
    expect(doYahoo()).toHaveLength(1);
    expect(new URL(doYahoo()[0].url).searchParams.get('symbols')).toBe(
      'BBAS3.SA,PETR4.SA,VALE3.SA',
    );
  });

  it('bloqueio durante a rodada interrompe os lotes seguintes', async () => {
    const muitas = Array.from({ length: 25 }, (_, i) => `AB${String(i).padStart(2, '0')}3`);
    const { cotacoes, estado, doYahoo } = montar({
      [URL_YAHOO]: spark(...muitas.slice(0, 20).map((t) => itemSpark(t))),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    // Liberado no início e após a pausa da rodada e no 1º lote; bloqueado antes do 2º.
    vi.spyOn(estado, 'podeChamar')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await cotacoes.atualizar(muitas);

    expect(doYahoo()).toHaveLength(1);
  });

  it('Yahoo instável: usa a brapi e volta ao Yahoo quando ele se recupera', async () => {
    const { cotacoes, estado } = montar({
      [URL_YAHOO]: [json({}, { status: 503 }), spark(itemSpark('BBAS3'))],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const antes = await atualizarEListar(cotacoes, ['BBAS3']);
    avancar(15 * MINUTO); // sem pregão conhecido, o ritmo é de 15 minutos
    const depois = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(antes.cotacoes[0]).toMatchObject({ fonte: 'brapi', precoCentavos: 5000 });
    expect(depois.cotacoes[0]).toMatchObject({ fonte: 'yahoo', precoCentavos: 1738 });
    expect(estado.consultar('yahoo')?.situacao).toBe('ok');
  });

  it('falha curta do Yahoo não troca o preço dele pelo da brapi (sem alternar fontes)', async () => {
    const { cotacoes, daBrapi } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), json({}, { status: 503 })],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    await cotacoes.atualizar(['BBAS3']);

    avancar(11 * MINUTO); // desatualizada, mas há menos de 30 min
    const painel = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(painel.cotacoes[0]).toMatchObject({ fonte: 'yahoo', desatualizada: true });
    expect(daBrapi()).toHaveLength(0);
  });

  it('falha longa do Yahoo passa a usar a brapi', async () => {
    const { cotacoes } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), json({}, { status: 503 })],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    await cotacoes.atualizar(['BBAS3']);

    avancar(31 * MINUTO);
    const painel = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(painel.cotacoes[0]).toMatchObject({ fonte: 'brapi', precoCentavos: 5000 });
  });

  it('preço reserva antigo da brapi não substitui um preço mais novo do Yahoo', async () => {
    const { cotacoes } = montar({
      [URL_YAHOO]: [
        json({}, { status: 503 }),
        spark(itemSpark('BBAS3')),
        json({}, { status: 503 }),
      ],
      [URL_LISTA_BRAPI]: [listaBrapi(), new TypeError('fetch failed')],
    });
    await cotacoes.atualizar(['BBAS3']); // brapi às 15:00
    avancar(15 * MINUTO);
    await cotacoes.atualizar(['BBAS3']); // Yahoo às 15:15

    avancar(31 * MINUTO); // Yahoo falha e a brapi não responde: só há o preço antigo da brapi
    const painel = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(painel.cotacoes[0]).toMatchObject({ fonte: 'yahoo', precoCentavos: 1738 });
  });

  it('com APIs lentas, a resposta sai no tempo limite com os dados salvos', async () => {
    const { cotacoes } = montar({ [URL_YAHOO]: () => new Promise<Response>(() => {}) });

    const inicio = Date.now();
    await cotacoes.atualizarComLimite(['BBAS3'], 30);

    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(cotacoes.listar(['BBAS3']).cotacoes[0].precoCentavos).toBeNull();
  });
});

describe('concorrência e pregão salvo', () => {
  it('a reserva espera a busca no Yahoo que outro pedido já iniciou', async () => {
    const lento = async () => {
      await new Promise((resolver) => setTimeout(resolver, 20));
      return spark(itemSpark('BBAS3'));
    };
    const { cotacoes } = montar({ [URL_YAHOO]: lento, [URL_LISTA_BRAPI]: listaBrapi() });

    const primeira = cotacoes.atualizar(['BBAS3']);
    await cotacoes.atualizar(['BBAS3', 'PETR4']);
    const painel = cotacoes.listar(['BBAS3', 'PETR4']);
    await primeira;

    expect(painel.cotacoes.map((c) => c.fonte)).toEqual(['yahoo', 'brapi']);
  });

  it('um pregão mais antigo nunca substitui um mais novo', async () => {
    const pregao28 = {
      currentTradingPeriod: {
        regular: { start: segundos('2026-10-28T13:00:00Z'), end: segundos('2026-10-28T20:00:00Z') },
      },
    };
    const { cotacoes } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3', 18, pregao28)), spark(itemSpark('BBAS3'))],
    });
    await cotacoes.atualizar(['BBAS3']);
    avancar(HORA);
    await cotacoes.atualizar(['BBAS3']);

    expect(banco.prepare('SELECT fim FROM pregao').get()).toEqual({
      fim: '2026-10-28T20:00:00.000Z',
    });
  });
});

describe('segunda revisão da etapa 4b', () => {
  it('lote que falha não descarta o pregão lido nos lotes anteriores', async () => {
    const tickers = Array.from({ length: 25 }, (_, i) => `AB${String(i).padStart(2, '0')}3`);
    const { cotacoes, estado } = montar({
      [URL_YAHOO]: [
        spark(...tickers.slice(0, 20).map((t) => itemSpark(t))),
        json({}, { status: 503 }),
      ],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const painel = await atualizarEListar(cotacoes, tickers);

    expect(banco.prepare('SELECT fim FROM pregao').get()).toEqual({
      fim: '2026-10-27T20:00:00.000Z',
    });
    expect(painel.mercadoAberto).toBe(true);
    expect(estado.consultar('yahoo')?.situacao).toBe('instavel');
  });

  it('erro ao consultar o estado do Yahoo não derruba a reserva', async () => {
    const { cotacoes, estado } = montar({
      [URL_YAHOO]: spark(itemSpark('BBAS3')),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    const original = estado.podeChamar.bind(estado);
    vi.spyOn(estado, 'podeChamar').mockImplementation((provedor, momento) => {
      if (provedor === 'yahoo') throw new Error('database is locked');
      return original(provedor, momento);
    });

    const painel = await atualizarEListar(cotacoes, ['BBAS3']);

    expect(painel.cotacoes[0]).toMatchObject({ fonte: 'brapi', precoCentavos: 5000 });
  });

  it('atualização que passou do tempo limite termina sozinha e vale para o próximo pedido', async () => {
    const lento = async () => {
      await new Promise((resolver) => setTimeout(resolver, 50));
      return spark(itemSpark('BBAS3'));
    };
    const { cotacoes, doYahoo } = montar({ [URL_YAHOO]: lento });

    await cotacoes.atualizarComLimite(['BBAS3'], 5);
    expect(cotacoes.listar(['BBAS3']).cotacoes[0].precoCentavos).toBeNull();

    await cotacoes.atualizarComLimite(['BBAS3'], 1000);
    expect(cotacoes.listar(['BBAS3']).cotacoes[0]).toMatchObject({
      fonte: 'yahoo',
      precoCentavos: 1738,
    });
    expect(doYahoo()).toHaveLength(1);
  });
});

describe('terceira revisão da etapa 4b', () => {
  it('pedidos que chegam durante uma rodada lenta são atendidos juntos na próxima', async () => {
    const lento = (itens: string[]) => async () => {
      await new Promise((resolver) => setTimeout(resolver, 10));
      return spark(...itens.map((t) => itemSpark(t)));
    };
    const { cotacoes, doYahoo } = montar({
      [URL_YAHOO]: [lento(['BBAS3']), lento(['PETR4', 'VALE3', 'ITUB4'])],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });

    const primeira = cotacoes.atualizar(['BBAS3']);
    await new Promise((resolver) => setTimeout(resolver, 2)); // a 1ª rodada já começou
    await Promise.all([
      primeira,
      cotacoes.atualizar(['BBAS3', 'PETR4']),
      cotacoes.atualizar(['BBAS3', 'PETR4', 'VALE3']),
      cotacoes.atualizar(['ITUB4']),
    ]);

    expect(doYahoo().map((r) => new URL(r.url).searchParams.get('symbols'))).toEqual([
      'BBAS3.SA',
      'PETR4.SA,VALE3.SA,ITUB4.SA',
    ]);
  });

  it('Yahoo em espera: a reserva entra sem esperar a pausa', async () => {
    const { cotacoes, esperas } = montar({
      [URL_YAHOO]: json({}, { status: 402 }),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    await cotacoes.atualizar(['BBAS3']);

    avancar(1000);
    const painel = await atualizarEListar(cotacoes, ['BBAS3', 'PETR4']);

    expect(esperas).toEqual([]);
    expect(painel.cotacoes.map((c) => c.fonte)).toEqual(['brapi', 'brapi']);
  });

  it('relógio atrasado: espera a pausa inteira', async () => {
    const { cotacoes, esperas } = montar({
      [URL_YAHOO]: [spark(itemSpark('BBAS3')), spark(itemSpark('PETR4'))],
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    await cotacoes.atualizar(['BBAS3']);

    avancar(-60 * 1000);
    await cotacoes.atualizar(['BBAS3', 'PETR4']);

    expect(esperas).toEqual([5000]);
  });

  it('rodada que não chegou a chamar o Yahoo não impõe pausa à seguinte', async () => {
    const { cotacoes, estado, esperas } = montar({
      [URL_YAHOO]: spark(itemSpark('BBAS3'), itemSpark('PETR4')),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    const original = estado.podeChamar.bind(estado);
    const espiao = vi.spyOn(estado, 'podeChamar');
    // 1ª rodada: liberada no início e após a pausa, mas bloqueada antes do 1º lote.
    espiao.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);
    await cotacoes.atualizar(['BBAS3']);
    espiao.mockImplementation(original);

    avancar(1000);
    await cotacoes.atualizar(['BBAS3', 'PETR4']);

    expect(esperas).toEqual([]);
  });

  it('rodada que falha por erro inesperado não trava as seguintes', async () => {
    const { cotacoes, doYahoo } = montar({
      [URL_YAHOO]: spark(itemSpark('BBAS3')),
      [URL_LISTA_BRAPI]: listaBrapi(),
    });
    // Sem a tabela, ler as cotações salvas falha e a 1ª rodada termina com erro.
    banco.exec('ALTER TABLE cotacoes RENAME TO cotacoes_fora');
    await expect(cotacoes.atualizar(['BBAS3'])).resolves.toBeUndefined();
    banco.exec('ALTER TABLE cotacoes_fora RENAME TO cotacoes');

    avancar(1000);
    await cotacoes.atualizar(['BBAS3']);

    expect(doYahoo()).toHaveLength(1);
    expect(cotacoes.listar(['BBAS3']).cotacoes[0].fonte).toBe('yahoo');
  });
});
