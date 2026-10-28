import { describe, expect, it } from 'vitest';
import { criarFetchFalso, json } from '../testes/fetchFalso.js';
import { ErroFonte } from './erroFonte.js';
import { lerRetryAfter, requisitarExterno, validarUrlExterna, type Buscar } from './http.js';

const AGORA = new Date('2026-10-27T15:00:00Z');
const URL_OK = 'https://brapi.dev/api/quote/list';
const opcoes = { limiteBytes: 1024 };

async function falha(promessa: Promise<unknown>): Promise<ErroFonte> {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(ErroFonte);
  return erro as ErroFonte;
}

describe('validarUrlExterna (custo zero)', () => {
  it.each([URL_OK, 'https://icons.brapi.dev/icons/BBAS3.svg'])('permite %s', (url) => {
    expect(() => validarUrlExterna(url)).not.toThrow();
  });

  it.each([
    ['host fora da lista', 'https://api.exemplo.com/cotacao'],
    ['subdomínio parecido', 'https://brapi.dev.golpe.com/api'],
    ['http sem criptografia', 'http://brapi.dev/api/quote/list'],
    ['chave no parâmetro token', 'https://brapi.dev/api/quote/BBAS3?token=abc'],
    ['chave no parâmetro apikey', 'https://brapi.dev/api/quote/BBAS3?apikey=abc'],
    ['chave com maiúsculas', 'https://brapi.dev/api/quote/list?Token=abc'],
    ['access_token', 'https://brapi.dev/api/quote/list?access_token=abc'],
    ['qualquer parâmetro fora da lista', 'https://brapi.dev/api/quote/list?search=x'],
    ['parâmetro em host de logos', 'https://icons.brapi.dev/icons/BBAS3.svg?v=1'],
  ])('recusa %s', (_caso, url) => {
    expect(() => validarUrlExterna(url)).toThrow();
  });
});

describe('requisitarExterno', () => {
  it('devolve o corpo de uma resposta bem-sucedida', async () => {
    const { buscar } = criarFetchFalso({ [URL_OK]: json({ ok: true }) });

    const resposta = await requisitarExterno(buscar, URL_OK, AGORA, opcoes);

    expect(resposta.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(resposta.corpo))).toEqual({ ok: true });
  });

  it('nunca envia cabeçalhos de autenticação', async () => {
    const { buscar, requisicoes } = criarFetchFalso({ [URL_OK]: json({}) });

    await requisitarExterno(buscar, URL_OK, AGORA, opcoes);

    expect(requisicoes).toHaveLength(1);
    expect(requisicoes[0].cabecalhos.has('authorization')).toBe(false);
  });

  it('pede sem seguir redirecionamentos e com tempo limite', async () => {
    let opcoesRecebidas: RequestInit | undefined;
    const buscar: Buscar = async (_url, init) => {
      opcoesRecebidas = init;
      return json({});
    };

    await requisitarExterno(buscar, URL_OK, AGORA, opcoes);

    expect(opcoesRecebidas?.redirect).toBe('error');
    expect(opcoesRecebidas?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['Authorization', 'Cookie', 'X-Api-Key'])(
    'recusa o cabeçalho %s, sem chegar à rede',
    async (nome) => {
      const { buscar, requisicoes } = criarFetchFalso({ [URL_OK]: json({}) });

      await expect(
        requisitarExterno(buscar, URL_OK, AGORA, { ...opcoes, cabecalhos: { [nome]: 'x' } }),
      ).rejects.toThrow(/proibidos/);
      expect(requisicoes).toHaveLength(0);
    },
  );

  it.each([
    [401, 'instavel'],
    [402, 'bloqueada'],
    [403, 'instavel'],
    [429, 'instavel'],
    [500, 'instavel'],
    [503, 'instavel'],
    [404, 'formato_alterado'],
    [400, 'formato_alterado'],
  ])('classifica HTTP %s como %s', async (status, situacao) => {
    const { buscar } = criarFetchFalso({ [URL_OK]: json({}, { status }) });

    const erro = await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes));

    expect(erro.situacao).toBe(situacao);
    expect(erro.status).toBe(status);
  });

  it('reconhece pedido de chave no corpo de um erro 400', async () => {
    const corpo = {
      error: true,
      message: 'Token de autenticação não fornecido',
      code: 'MISSING_TOKEN',
    };
    const { buscar } = criarFetchFalso({ [URL_OK]: json(corpo, { status: 400 }) });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'bloqueada',
    );
  });

  it.each([401, 403])('trata %s com pedido de chave no corpo como bloqueio', async (status) => {
    const { buscar } = criarFetchFalso({
      [URL_OK]: json({ code: 'MISSING_TOKEN' }, { status }),
    });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'bloqueada',
    );
  });

  it('401/403 sem sinal de cobrança (ex.: anti-robô) espera 1 hora, sem alarme de pagamento', async () => {
    const { buscar } = criarFetchFalso({
      [URL_OK]: new Response('Invalid Crumb', { status: 401 }),
    });

    const erro = await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes));

    expect(erro.situacao).toBe('instavel');
    expect(erro.esperarAte?.toISOString()).toBe('2026-10-27T16:00:00.000Z');
  });

  it('erro 500 que menciona "token" continua sendo instabilidade', async () => {
    const { buscar } = criarFetchFalso({
      [URL_OK]: new Response('CSRF token inválido', { status: 500 }),
    });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'instavel',
    );
  });

  it.each([429, 503])('aviso de cobrança num %s continua sendo instabilidade', async (status) => {
    const resposta = json({}, { status, headers: { 'X-Brapi-Billing-Warning': 'near limit' } });
    const { buscar } = criarFetchFalso({ [URL_OK]: resposta });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'instavel',
    );
  });

  it('cabeçalho de cobrança num erro marca bloqueio', async () => {
    const resposta = json({}, { status: 400, headers: { 'X-Brapi-Upgrade-Url': 'https://x' } });
    const { buscar } = criarFetchFalso({ [URL_OK]: resposta });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'bloqueada',
    );
  });

  it('cabeçalho de cobrança numa resposta 200 é aviso: os dados são entregues', async () => {
    const resposta = json({ ok: 1 }, { headers: { 'X-Brapi-Billing-Warning': 'near limit' } });
    const { buscar } = criarFetchFalso({ [URL_OK]: resposta });

    const resultado = await requisitarExterno(buscar, URL_OK, AGORA, opcoes);

    expect(resultado.avisoDeCobranca).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(resultado.corpo))).toEqual({ ok: 1 });
  });

  it('não confunde a lista de cabeçalhos expostos com cobrança real', async () => {
    const resposta = json(
      {},
      {
        headers: { 'Access-Control-Expose-Headers': 'X-Brapi-Billing-Action,X-Brapi-Upgrade-Url' },
      },
    );
    const { buscar } = criarFetchFalso({ [URL_OK]: resposta });

    await expect(requisitarExterno(buscar, URL_OK, AGORA, opcoes)).resolves.toBeDefined();
  });

  it('usa o Retry-After do 429 para saber quando tentar de novo', async () => {
    const resposta = json({}, { status: 429, headers: { 'Retry-After': '60' } });
    const { buscar } = criarFetchFalso({ [URL_OK]: resposta });

    const erro = await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes));

    expect(erro.esperarAte?.toISOString()).toBe('2026-10-27T15:01:00.000Z');
  });

  describe('lerRetryAfter', () => {
    const cabecalhos = (valores: Record<string, string>) => new Headers(valores);

    it('limita esperas enormes a 24 horas', () => {
      expect(lerRetryAfter(cabecalhos({ 'retry-after': '999999999' }), AGORA)?.toISOString()).toBe(
        '2026-10-28T15:00:00.000Z',
      );
    });

    it.each([
      ['número absurdo (viraria data inválida)', '9999999999999'],
      ['data epoch em ratelimit-reset', '1793000000'],
      ['texto', 'amanhã'],
      ['negativo', '-5'],
    ])('ignora %s', (_caso, valor) => {
      expect(lerRetryAfter(cabecalhos({ 'retry-after': valor }), AGORA)).toBeUndefined();
    });

    it('usa ratelimit-reset quando não há Retry-After', () => {
      expect(lerRetryAfter(cabecalhos({ 'ratelimit-reset': '30' }), AGORA)?.toISOString()).toBe(
        '2026-10-27T15:00:30.000Z',
      );
    });
  });

  it('classifica falha de conexão e tempo esgotado como instável', async () => {
    const semRede = criarFetchFalso({ [URL_OK]: new TypeError('fetch failed') });
    const lenta = criarFetchFalso({
      [URL_OK]: new DOMException('The operation timed out', 'TimeoutError'),
    });

    const erroRede = await falha(requisitarExterno(semRede.buscar, URL_OK, AGORA, opcoes));
    const erroTempo = await falha(requisitarExterno(lenta.buscar, URL_OK, AGORA, opcoes));

    expect(erroRede).toMatchObject({
      situacao: 'instavel',
      message: 'Não foi possível conectar à API',
    });
    expect(erroTempo).toMatchObject({
      situacao: 'instavel',
      message: 'A API demorou demais para responder',
    });
  });

  it('classifica tempo esgotado durante a leitura do corpo como instável', async () => {
    const corpoQueExpira = new ReadableStream({
      pull(controle) {
        controle.error(new DOMException('The operation timed out', 'TimeoutError'));
      },
    });
    const buscar: Buscar = async () => new Response(corpoQueExpira);

    expect(await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).toMatchObject({
      situacao: 'instavel',
      message: 'A API demorou demais para responder',
    });
  });

  it('recusa respostas maiores que o limite, lidas aos poucos', async () => {
    const { buscar } = criarFetchFalso({ [URL_OK]: () => new Response('x'.repeat(2000)) });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'formato_alterado',
    );
  });

  it('recusa de cara respostas que declaram tamanho acima do limite', async () => {
    let leuCorpo = false;
    // highWaterMark 0: o stream só lê quando alguém consome o corpo.
    const corpo = new ReadableStream(
      {
        pull(controle) {
          leuCorpo = true;
          controle.enqueue(new Uint8Array(10));
          controle.close();
        },
      },
      { highWaterMark: 0 },
    );
    const buscar: Buscar = async () =>
      new Response(corpo, { headers: { 'content-length': '999999' } });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'formato_alterado',
    );
    expect(leuCorpo).toBe(false);
  });

  it('aceita status extras quando o chamador pede (ex.: 304)', async () => {
    const { buscar } = criarFetchFalso({ [URL_OK]: new Response(null, { status: 304 }) });

    const resposta = await requisitarExterno(buscar, URL_OK, AGORA, {
      ...opcoes,
      statusAceitos: [304],
    });

    expect(resposta.status).toBe(304);
  });
});
