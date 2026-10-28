import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from './app.js';
import { abrirBanco, type Banco } from './banco/conexao.js';
import { criarRepositorioUsoApi } from './banco/usoApi.js';
import { criarServicoCatalogo } from './catalogo.js';
import { URL_LISTA_BRAPI } from './externo/brapi.js';
import { criarEstadoFontes } from './externo/estadoFontes.js';
import { criarFetchFalso, json, svg, type RequisicaoRegistrada } from './testes/fetchFalso.js';

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const URL_LOGO = 'https://icons.brapi.dev/icons/BBAS3.svg';

const listaBrapi = (close = 17.38) =>
  json({
    stocks: [
      { stock: 'BBAS3', name: 'BCO BRASIL S.A.', close, logo: URL_LOGO },
      { stock: 'ITUB4', name: 'ITAÚ UNIBANCO', close: 41.19, logo: null },
    ],
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
  const catalogo = criarServicoCatalogo({ banco, buscar, agora: () => agora, estado, uso });
  return { catalogo, estado, uso, requisicoes };
}

beforeEach(() => {
  banco = abrirBanco(':memory:');
  agora = new Date('2026-10-27T15:00:00Z');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  banco.close();
});

describe('catálogo', () => {
  it('busca a lista da brapi e guarda nomes e preços', async () => {
    const { catalogo, estado, uso } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });

    await catalogo.garantirAtualizado();

    expect(catalogo.listar()).toEqual([
      { ticker: 'BBAS3', nome: 'BCO BRASIL S.A.' },
      { ticker: 'ITUB4', nome: 'ITAÚ UNIBANCO' },
    ]);
    expect(catalogo.precos(['BBAS3', 'PETR4'])).toEqual(
      new Map([['BBAS3', { precoCentavos: 1738, atualizadoEm: agora.toISOString() }]]),
    );
    expect(estado.consultar('brapi')?.situacao).toBe('ok');
    expect(uso.consultar('brapi', '2026-10')).toBe(1);
  });

  it('busca ignorando acentos e maiúsculas, por ticker ou nome', async () => {
    const { catalogo } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });
    await catalogo.garantirAtualizado();

    expect(catalogo.listar('itau').map((a) => a.ticker)).toEqual(['ITUB4']);
    expect(catalogo.listar('bbas').map((a) => a.ticker)).toEqual(['BBAS3']);
    expect(catalogo.listar('  ')).toHaveLength(2);
    expect(catalogo.listar('inexistente')).toEqual([]);
  });

  it('chama a brapi no máximo uma vez a cada 15 minutos', async () => {
    const { catalogo, requisicoes } = montar({
      [URL_LISTA_BRAPI]: [listaBrapi(17), listaBrapi(18)],
    });

    await catalogo.garantirAtualizado();
    avancar(14 * MINUTO);
    await catalogo.garantirAtualizado();
    expect(requisicoes).toHaveLength(1);

    avancar(1 * MINUTO);
    await catalogo.garantirAtualizado();
    expect(requisicoes).toHaveLength(2);
    expect(catalogo.precos(['BBAS3']).get('BBAS3')?.precoCentavos).toBe(1800);
  });

  it('chamadas simultâneas compartilham uma única requisição', async () => {
    const { catalogo, requisicoes } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });

    await Promise.all([catalogo.garantirAtualizado(), catalogo.garantirAtualizado()]);

    expect(requisicoes).toHaveLength(1);
  });

  it('mantém o último catálogo quando a brapi cai, e tenta de novo depois', async () => {
    const { catalogo, estado, requisicoes } = montar({
      [URL_LISTA_BRAPI]: [listaBrapi(), json({}, { status: 503 }), listaBrapi(20)],
    });
    await catalogo.garantirAtualizado();

    avancar(15 * MINUTO);
    await expect(catalogo.garantirAtualizado()).resolves.toBeUndefined();
    expect(catalogo.listar()).toHaveLength(2);
    expect(catalogo.precos(['BBAS3']).get('BBAS3')?.precoCentavos).toBe(1738);
    expect(estado.consultar('brapi')).toMatchObject({ situacao: 'instavel' });

    avancar(15 * MINUTO);
    await catalogo.garantirAtualizado();
    expect(requisicoes).toHaveLength(3);
    expect(estado.consultar('brapi')?.situacao).toBe('ok');
  });

  it('para de chamar a brapi se ela exigir pagamento, e recheca só no dia seguinte', async () => {
    const { catalogo, estado, requisicoes } = montar({
      [URL_LISTA_BRAPI]: [
        json({ message: 'Faça upgrade do seu plano' }, { status: 402 }),
        listaBrapi(),
      ],
    });

    await catalogo.garantirAtualizado();
    expect(estado.consultar('brapi')).toMatchObject({
      situacao: 'bloqueada',
      mensagem: 'A API passou a exigir chave, plano ou pagamento',
    });

    for (const espera of [15 * MINUTO, 6 * HORA, 17 * HORA]) {
      avancar(espera);
      await catalogo.garantirAtualizado();
    }
    expect(requisicoes).toHaveLength(1);

    avancar(1 * HORA); // 24 h depois do bloqueio
    await catalogo.garantirAtualizado();
    expect(requisicoes).toHaveLength(2);
    expect(estado.consultar('brapi')?.situacao).toBe('ok');
  });

  it('respeita o Retry-After quando atinge o limite de requisições', async () => {
    const { catalogo, requisicoes } = montar({
      [URL_LISTA_BRAPI]: [
        json({}, { status: 429, headers: { 'Retry-After': '1800' } }),
        listaBrapi(),
      ],
    });

    await catalogo.garantirAtualizado();
    avancar(20 * MINUTO);
    await catalogo.garantirAtualizado();
    expect(requisicoes).toHaveLength(1);

    avancar(10 * MINUTO);
    await catalogo.garantirAtualizado();
    expect(requisicoes).toHaveLength(2);
  });

  it('acusa formato alterado sem apagar o catálogo salvo', async () => {
    const { catalogo, estado } = montar({
      [URL_LISTA_BRAPI]: [listaBrapi(), json({ dados: 'formato novo' })],
    });
    await catalogo.garantirAtualizado();
    avancar(15 * MINUTO);

    await catalogo.garantirAtualizado();

    expect(estado.consultar('brapi')?.situacao).toBe('formato_alterado');
    expect(catalogo.listar()).toHaveLength(2);
  });

  it('o horário "desde" só muda quando a situação muda', async () => {
    const { catalogo, estado } = montar({
      [URL_LISTA_BRAPI]: [json({}, { status: 500 }), json({}, { status: 500 })],
    });
    const inicio = agora.toISOString();

    await catalogo.garantirAtualizado();
    avancar(15 * MINUTO);
    await catalogo.garantirAtualizado();

    expect(estado.consultar('brapi')).toMatchObject({
      situacao: 'instavel',
      desde: inicio,
      ultimaTentativa: agora.toISOString(),
      ultimoSucesso: null,
    });
  });
});

describe('logos', () => {
  async function comCatalogo(
    respostasLogo: NonNullable<Parameters<typeof criarFetchFalso>[0]>[string],
  ) {
    const montado = montar({ [URL_LISTA_BRAPI]: listaBrapi(), [URL_LOGO]: respostasLogo });
    await montado.catalogo.garantirAtualizado();
    return montado;
  }

  const requisicoesDeLogo = (requisicoes: RequisicaoRegistrada[]) =>
    requisicoes.filter((r) => r.url === URL_LOGO);

  it('baixa o logo na primeira vez e guarda no banco', async () => {
    const { catalogo, requisicoes } = await comCatalogo(svg('<svg id="a"/>'));

    const logo = await catalogo.logo('BBAS3');

    expect(logo?.tipo).toBe('image/svg+xml');
    expect(new TextDecoder().decode(logo!.conteudo)).toBe('<svg id="a"/>');
    expect(requisicoesDeLogo(requisicoes)).toHaveLength(1);
  });

  it('não volta à internet pelo mesmo logo durante 24 horas', async () => {
    const { catalogo, requisicoes } = await comCatalogo(svg());

    await catalogo.logo('BBAS3');
    avancar(23 * HORA);
    await catalogo.logo('BBAS3');
    await catalogo.logo('BBAS3');

    expect(requisicoesDeLogo(requisicoes)).toHaveLength(1);
  });

  it('depois de 24 horas confere com ETag e mantém o salvo se não mudou (304)', async () => {
    const { catalogo, requisicoes } = await comCatalogo([
      svg('<svg id="a"/>', '"v1"'),
      new Response(null, { status: 304 }),
    ]);
    await catalogo.logo('BBAS3');
    avancar(24 * HORA);

    const logo = await catalogo.logo('BBAS3');

    const [, segunda] = requisicoesDeLogo(requisicoes);
    expect(segunda.cabecalhos.get('if-none-match')).toBe('"v1"');
    expect(new TextDecoder().decode(logo!.conteudo)).toBe('<svg id="a"/>');
  });

  it('atualiza quando o logo mudou', async () => {
    const { catalogo } = await comCatalogo([svg('<svg id="a"/>'), svg('<svg id="b"/>', '"v2"')]);
    await catalogo.logo('BBAS3');
    avancar(24 * HORA);

    const logo = await catalogo.logo('BBAS3');

    expect(new TextDecoder().decode(logo!.conteudo)).toBe('<svg id="b"/>');
  });

  it('mantém o logo salvo se a conferência falhar, e só tenta de novo no dia seguinte', async () => {
    const { catalogo, requisicoes } = await comCatalogo([
      svg('<svg id="a"/>'),
      new TypeError('fetch failed'),
      svg('<svg id="b"/>'),
    ]);
    await catalogo.logo('BBAS3');
    avancar(24 * HORA);

    expect(new TextDecoder().decode((await catalogo.logo('BBAS3'))!.conteudo)).toBe(
      '<svg id="a"/>',
    );
    avancar(1 * HORA);
    await catalogo.logo('BBAS3');
    expect(requisicoesDeLogo(requisicoes)).toHaveLength(2);
  });

  it('sem logo disponível devolve null e não insiste antes de 24 horas', async () => {
    const { catalogo, requisicoes } = await comCatalogo(new Response('', { status: 404 }));

    expect(await catalogo.logo('BBAS3')).toBeNull();
    avancar(5 * MINUTO);
    expect(await catalogo.logo('BBAS3')).toBeNull();

    expect(requisicoesDeLogo(requisicoes)).toHaveLength(1);
  });

  it.each([
    [
      'tipo que não é imagem',
      new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
    ],
    [
      'arquivo grande demais',
      new Response('x'.repeat(300 * 1024), { headers: { 'content-type': 'image/svg+xml' } }),
    ],
  ])('recusa %s', async (_caso, resposta) => {
    const { catalogo } = await comCatalogo(resposta);

    expect(await catalogo.logo('BBAS3')).toBeNull();
  });

  it('ação sem endereço de logo no catálogo não gera requisição', async () => {
    const { catalogo, requisicoes } = await comCatalogo(svg());

    expect(await catalogo.logo('ITUB4')).toBeNull();
    expect(await catalogo.logo('PETR4')).toBeNull();
    expect(requisicoes).toHaveLength(1); // só a lista
  });

  it('pedidos simultâneos do mesmo logo geram um único download', async () => {
    const { catalogo, requisicoes } = await comCatalogo(svg());

    await Promise.all([catalogo.logo('BBAS3'), catalogo.logo('BBAS3'), catalogo.logo('BBAS3')]);

    expect(requisicoesDeLogo(requisicoes)).toHaveLength(1);
  });
});

describe('custo zero', () => {
  it('nenhuma requisição do fluxo completo leva chave ou sai da lista de endereços', async () => {
    const { catalogo, requisicoes } = montar({
      [URL_LISTA_BRAPI]: [listaBrapi(), listaBrapi()],
      [URL_LOGO]: [svg(), new Response(null, { status: 304 })],
    });

    await catalogo.garantirAtualizado();
    await catalogo.logo('BBAS3');
    avancar(24 * HORA);
    await catalogo.garantirAtualizado();
    await catalogo.logo('BBAS3');

    expect(requisicoes.length).toBe(4);
    for (const { url, cabecalhos } of requisicoes) {
      expect(new URL(url).hostname).toMatch(/^(icons\.)?brapi\.dev$/);
      expect(url).not.toMatch(/token|apikey|key=/i);
      expect(cabecalhos.has('authorization')).toBe(false);
    }
  });
});

describe('rotas de catálogo, logos e fontes', () => {
  function criarAppComFetch(respostas: Parameters<typeof criarFetchFalso>[0]) {
    const { buscar, requisicoes } = criarFetchFalso(respostas);
    return { app: criarApp({ banco, buscar, agora: () => agora }), requisicoes };
  }

  it('GET /api/catalogo lista as ações com o endereço local do logo', async () => {
    const { app } = criarAppComFetch({ [URL_LISTA_BRAPI]: listaBrapi() });

    const resposta = await request(app).get('/api/catalogo?busca=brasil');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      acoes: [{ ticker: 'BBAS3', nome: 'BCO BRASIL S.A.', logo: '/api/logos/BBAS3' }],
    });
  });

  it('GET /api/catalogo responde mesmo com a brapi fora do ar', async () => {
    const { app } = criarAppComFetch({ [URL_LISTA_BRAPI]: new TypeError('fetch failed') });

    const resposta = await request(app).get('/api/catalogo');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ acoes: [] });
  });

  it('GET /api/catalogo recusa busca repetida', async () => {
    const { app } = criarAppComFetch({ [URL_LISTA_BRAPI]: listaBrapi() });

    expect((await request(app).get('/api/catalogo?busca=a&busca=b')).status).toBe(400);
  });

  it('GET /api/logos/:ticker entrega o SVG com cabeçalhos de segurança e cache de um dia', async () => {
    const { app } = criarAppComFetch({ [URL_LISTA_BRAPI]: listaBrapi(), [URL_LOGO]: svg() });
    await request(app).get('/api/catalogo');

    const resposta = await request(app).get('/api/logos/bbas3');

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(resposta.headers['content-security-policy']).toContain("default-src 'none'");
    expect(resposta.headers['content-security-policy']).toContain('sandbox');
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['cache-control']).toBe('public, max-age=86400');
    expect(resposta.body.toString()).toContain('<svg');
  });

  it.each(['XYZ', 'PETR4'])('GET /api/logos/%s responde 404 quando não há logo', async (ticker) => {
    const { app } = criarAppComFetch({ [URL_LISTA_BRAPI]: listaBrapi(), [URL_LOGO]: svg() });
    await request(app).get('/api/catalogo');

    const resposta = await request(app).get(`/api/logos/${ticker}`);

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Logo não encontrado' });
  });

  it('GET /api/fontes informa a situação de cada API', async () => {
    const { app } = criarAppComFetch({
      [URL_LISTA_BRAPI]: json({ code: 'MISSING_TOKEN' }, { status: 401 }),
    });
    expect((await request(app).get('/api/fontes')).body).toEqual({ fontes: [] });

    await request(app).get('/api/catalogo');
    const resposta = await request(app).get('/api/fontes');

    expect(resposta.body.fontes).toEqual([
      {
        provedor: 'brapi',
        situacao: 'bloqueada',
        mensagem: 'A API passou a exigir chave, plano ou pagamento',
        desde: agora.toISOString(),
        ultimaTentativa: agora.toISOString(),
        ultimoSucesso: null,
        proximaTentativa: new Date(agora.getTime() + 24 * HORA).toISOString(),
      },
    ]);
  });
});
