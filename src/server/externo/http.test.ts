import { describe, expect, it } from 'vitest';
import { criarFetchFalso, json } from '../testes/fetchFalso.js';
import { ErroFonte } from './erroFonte.js';
import { requisitarExterno, validarUrlExterna } from './http.js';

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

  it('recusa pedidos com cabeçalho de autenticação, sem chegar à rede', async () => {
    const { buscar, requisicoes } = criarFetchFalso({ [URL_OK]: json({}) });

    await expect(
      requisitarExterno(buscar, URL_OK, AGORA, {
        ...opcoes,
        cabecalhos: { Authorization: 'Bearer x' },
      }),
    ).rejects.toThrow(/proibidos/);
    expect(requisicoes).toHaveLength(0);
  });

  it.each([
    [401, 'bloqueada'],
    [402, 'bloqueada'],
    [403, 'bloqueada'],
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

  it('trata cabeçalhos de cobrança como bloqueio, mesmo com status 200', async () => {
    const resposta = json({ stocks: [] }, { headers: { 'X-Brapi-Billing-Status': 'over_quota' } });
    const { buscar } = criarFetchFalso({ [URL_OK]: resposta });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'bloqueada',
    );
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

  it('recusa respostas maiores que o limite', async () => {
    const { buscar } = criarFetchFalso({ [URL_OK]: () => new Response('x'.repeat(2000)) });

    expect((await falha(requisitarExterno(buscar, URL_OK, AGORA, opcoes))).situacao).toBe(
      'formato_alterado',
    );
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
