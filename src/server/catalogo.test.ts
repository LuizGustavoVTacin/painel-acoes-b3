import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from './app.js';
import { abrirBanco, type Banco } from './banco/conexao.js';
import { criarRepositorioUsoApi } from './banco/usoApi.js';
import { criarServicoCatalogo } from './catalogo.js';
import { URL_LISTA_BRAPI } from './externo/brapi.js';
import { ErroFonte } from './externo/erroFonte.js';
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

describe('robustez (pontos da revisão)', () => {
  it('Retry-After absurdo não quebra a rota e mantém a pausa entre chamadas', async () => {
    const { buscar, requisicoes } = criarFetchFalso({
      [URL_LISTA_BRAPI]: json({}, { status: 429, headers: { 'Retry-After': '9999999999999' } }),
    });
    const app = criarApp({ banco, buscar, agora: () => agora });

    const primeira = await request(app).get('/api/catalogo');
    const segunda = await request(app).get('/api/catalogo');

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(requisicoes).toHaveLength(1);
  });

  it('item recusado pelo banco não impede o restante do catálogo', async () => {
    const { catalogo } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });
    // Simula uma regra do banco que recusa um item específico.
    banco.exec(`CREATE TEMP TRIGGER recusa_itub BEFORE INSERT ON catalogo
      WHEN NEW.ticker = 'ITUB4' BEGIN SELECT RAISE(ABORT, 'recusado'); END`);

    await catalogo.garantirAtualizado();

    expect(catalogo.listar().map((a) => a.ticker)).toEqual(['BBAS3']);
  });

  it('aviso de cobrança junto com dados: guarda os dados e avisa, sem pausar a API', async () => {
    const lista = listaBrapi();
    const { catalogo, estado } = montar({
      [URL_LISTA_BRAPI]: new Response(await lista.text(), {
        headers: { 'content-type': 'application/json', 'X-Brapi-Billing-Warning': 'near limit' },
      }),
    });

    await catalogo.garantirAtualizado();

    expect(catalogo.listar()).toHaveLength(2);
    expect(estado.consultar('brapi')).toMatchObject({
      situacao: 'ok',
      mensagem:
        'A API passou a exigir chave, plano ou pagamento (aviso recebido junto com os dados)',
      proximaTentativa: null,
    });
  });

  it('avisa quando a lista encolhe para menos da metade', async () => {
    const acao = (stock: string) => ({ stock, name: stock, close: 17, logo: null });
    const completa = json({ stocks: [acao('BBAS3'), acao('ITUB4'), acao('PETR4')] });
    const pequena = json({ stocks: [acao('BBAS3')] });
    const { catalogo, estado } = montar({ [URL_LISTA_BRAPI]: [completa, pequena] });
    await catalogo.garantirAtualizado();
    avancar(15 * MINUTO);

    await catalogo.garantirAtualizado();

    expect(estado.consultar('brapi')).toMatchObject({
      situacao: 'ok',
      mensagem: 'A brapi devolveu menos ações que o normal (1 de 3)',
    });
    expect(catalogo.listar()).toHaveLength(3);
  });

  it('relógio atrasado não trava as chamadas', async () => {
    const { catalogo, requisicoes } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });
    await catalogo.garantirAtualizado();

    avancar(-3 * HORA);
    await catalogo.garantirAtualizado();

    expect(requisicoes).toHaveLength(2);
  });

  it('logos que exigem pagamento: avisa e não baixa mais nada por 24 horas', async () => {
    const { catalogo, estado, uso, requisicoes } = montar({
      [URL_LISTA_BRAPI]: json({
        stocks: [
          { stock: 'BBAS3', name: 'BB', close: 17, logo: URL_LOGO },
          {
            stock: 'PETR4',
            name: 'PETRO',
            close: 38,
            logo: 'https://icons.brapi.dev/icons/PETR4.svg',
          },
        ],
      }),
      'https://icons.brapi.dev/': json({ message: 'pagamento necessário' }, { status: 402 }),
    });
    await catalogo.garantirAtualizado();

    expect(await catalogo.logo('BBAS3')).toBeNull();
    expect(await catalogo.logo('PETR4')).toBeNull();
    avancar(23 * HORA);
    await catalogo.logo('PETR4');

    expect(estado.consultar('brapi_icones')?.situacao).toBe('bloqueada');
    expect(estado.consultar('brapi')?.situacao).toBe('ok');
    expect(requisicoes.filter((r) => r.url.includes('icons'))).toHaveLength(1);
    expect(uso.consultar('brapi', '2026-10')).toBe(1);
    expect(uso.consultar('brapi_icones', '2026-10')).toBe(1);
  });

  it('primeira tentativa de logo sem internet: tenta de novo em 15 minutos, não em 24 horas', async () => {
    const { catalogo, requisicoes } = montar({
      [URL_LISTA_BRAPI]: listaBrapi(),
      [URL_LOGO]: [new TypeError('fetch failed'), svg()],
    });
    await catalogo.garantirAtualizado();

    expect(await catalogo.logo('BBAS3')).toBeNull();
    avancar(10 * MINUTO);
    expect(await catalogo.logo('BBAS3')).toBeNull();
    avancar(5 * MINUTO);
    expect(await catalogo.logo('BBAS3')).not.toBeNull();

    expect(requisicoes.filter((r) => r.url === URL_LOGO)).toHaveLength(2);
  });

  it('baixa no máximo 4 logos ao mesmo tempo', async () => {
    let simultaneos = 0;
    let pico = 0;
    const stocks = Array.from({ length: 10 }, (_, i) => ({
      stock: `ABC${String.fromCharCode(65 + i)}3`,
      name: `Empresa ${i}`,
      close: 10,
      logo: `https://icons.brapi.dev/icons/ABC${String.fromCharCode(65 + i)}3.svg`,
    }));
    const { catalogo } = montar({
      [URL_LISTA_BRAPI]: json({ stocks }),
      'https://icons.brapi.dev/': async () => {
        pico = Math.max(pico, ++simultaneos);
        await new Promise((resolver) => setTimeout(resolver, 5));
        simultaneos--;
        return svg();
      },
    });
    await catalogo.garantirAtualizado();

    const logos = await Promise.all(stocks.map((s) => catalogo.logo(s.stock)));

    expect(logos.every((logo) => logo !== null)).toBe(true);
    expect(pico).toBe(4);
  });
});

describe('robustez (segunda revisão)', () => {
  const logoDe = (ticker: string) => `https://icons.brapi.dev/icons/${ticker}.svg`;
  const listaCom = (tickers: string[]) =>
    json({ stocks: tickers.map((t) => ({ stock: t, name: t, close: 10, logo: logoDe(t) })) });
  const atrasado = (resposta: () => Response, ms: number) => async () => {
    await new Promise((resolver) => setTimeout(resolver, ms));
    return resposta();
  };

  it('avisa quantas ações foram recusadas pelo banco', async () => {
    const { catalogo, estado } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });
    banco.exec(`CREATE TEMP TRIGGER recusa_itub BEFORE INSERT ON catalogo
      WHEN NEW.ticker = 'ITUB4' BEGIN SELECT RAISE(ABORT, 'recusado'); END`);

    await catalogo.garantirAtualizado();

    expect(estado.consultar('brapi')?.mensagem).toBe(
      '1 ações da brapi foram ignoradas por dados inválidos',
    );
  });

  it('erro do banco que não é regra desfaz o catálogo inteiro, sem culpar a API', async () => {
    const { catalogo, estado } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });
    // abs() do menor inteiro estoura: erro comum do SQLite, não violação de regra.
    banco.exec(`CREATE TEMP TRIGGER estoura BEFORE INSERT ON catalogo
      WHEN NEW.ticker = 'ITUB4' BEGIN SELECT abs(-9223372036854775807 - 1); END`);

    await catalogo.garantirAtualizado();

    expect(catalogo.listar()).toEqual([]);
    expect(estado.consultar('brapi')).toMatchObject({
      situacao: 'ok',
      mensagem: 'A brapi respondeu, mas o banco local não salvou os dados',
    });
  });

  it('se o banco não grava o estado, a pausa de 15 minutos continua valendo', async () => {
    const { catalogo, estado, requisicoes } = montar({
      [URL_LISTA_BRAPI]: json({}, { status: 503 }),
    });
    vi.spyOn(estado, 'registrarFalha').mockImplementation(() => {
      throw new Error('database is locked');
    });

    await catalogo.garantirAtualizado();
    avancar(MINUTO);
    await catalogo.garantirAtualizado();

    expect(requisicoes).toHaveLength(1);
  });

  it('falha ao consultar o estado das APIs não derruba a rota do catálogo', async () => {
    const { catalogo, estado, requisicoes } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });
    vi.spyOn(estado, 'podeChamar').mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(catalogo.garantirAtualizado()).resolves.toBeUndefined();
    await expect(catalogo.logo('BBAS3')).resolves.toBeNull();
    expect(requisicoes).toHaveLength(0);
  });

  it('falha ao contar o uso não derruba a rota do catálogo', async () => {
    const { buscar } = criarFetchFalso({ [URL_LISTA_BRAPI]: listaBrapi() });
    const uso = criarRepositorioUsoApi(banco);
    vi.spyOn(uso, 'registrar').mockImplementation(() => {
      throw new Error('disk full');
    });
    const estado = criarEstadoFontes(banco);
    const catalogo = criarServicoCatalogo({ banco, buscar, agora: () => agora, estado, uso });

    await expect(catalogo.garantirAtualizado()).resolves.toBeUndefined();
    expect(catalogo.listar()).toHaveLength(2);
  });

  it('logo grande demais afeta só aquela ação, não pausa os demais', async () => {
    const { catalogo, estado } = montar({
      [URL_LISTA_BRAPI]: listaCom(['ABCD3', 'EFGH3']),
      [logoDe('ABCD3')]: () =>
        new Response('x', {
          headers: { 'content-length': '300000', 'content-type': 'image/svg+xml' },
        }),
      [logoDe('EFGH3')]: svg(),
    });
    await catalogo.garantirAtualizado();

    expect(await catalogo.logo('ABCD3')).toBeNull();
    expect(await catalogo.logo('EFGH3')).not.toBeNull();
    expect(estado.podeChamar('brapi_icones', agora)).toBe(true);
  });

  it('sucesso em paralelo não apaga a pausa pedida por outro download', async () => {
    const { catalogo, estado } = montar({
      [URL_LISTA_BRAPI]: listaCom(['ABCD3', 'EFGH3', 'IJKL3']),
      [logoDe('ABCD3')]: () => json({}, { status: 429, headers: { 'Retry-After': '600' } }),
      [logoDe('EFGH3')]: atrasado(() => svg(), 10),
      [logoDe('IJKL3')]: atrasado(() => svg(), 10),
    });
    await catalogo.garantirAtualizado();

    await Promise.all(['ABCD3', 'EFGH3', 'IJKL3'].map((t) => catalogo.logo(t)));

    expect(estado.consultar('brapi_icones')).toMatchObject({
      situacao: 'instavel',
      proximaTentativa: '2026-10-27T15:10:00.000Z',
    });
    expect(estado.podeChamar('brapi_icones', agora)).toBe(false);
  });

  it('pedidos de logo na fila respeitam o bloqueio feito pelos primeiros', async () => {
    const tickers = ['ABCD3', 'EFGH3', 'IJKL3', 'MNOP3', 'QRST3', 'UVWX3'];
    const { catalogo, requisicoes } = montar({
      [URL_LISTA_BRAPI]: listaCom(tickers),
      'https://icons.brapi.dev/': atrasado(() => json({}, { status: 402 }), 5),
    });
    await catalogo.garantirAtualizado();

    await Promise.all(tickers.map((t) => catalogo.logo(t)));

    expect(requisicoes.filter((r) => r.url.includes('icons'))).toHaveLength(4);
  });

  it('download de logo que falha libera a vaga para os próximos', async () => {
    const tickers = Array.from({ length: 10 }, (_, i) => `ABC${String.fromCharCode(65 + i)}3`);
    const ruins = new Set(tickers.slice(0, 4));
    const respostas: Parameters<typeof criarFetchFalso>[0] = {
      [URL_LISTA_BRAPI]: listaCom(tickers),
    };
    for (const t of tickers) {
      respostas[logoDe(t)] = ruins.has(t)
        ? () => new Response('x', { headers: { 'content-length': '300000' } })
        : svg();
    }
    const { catalogo } = montar(respostas);
    await catalogo.garantirAtualizado();

    const logos = await Promise.all(tickers.map((t) => catalogo.logo(t)));

    expect(logos.filter((l) => l !== null)).toHaveLength(6);
  });
});

describe('estado das fontes: datas e relógio', () => {
  it('ignora uma data de espera inválida', () => {
    const estado = criarEstadoFontes(banco);
    const erro = new ErroFonte('instavel', 'x', 429, new Date(NaN));

    estado.registrarFalha('brapi', erro, agora);

    expect(estado.consultar('brapi')?.proximaTentativa).toBeNull();
    expect(estado.podeChamar('brapi', agora)).toBe(true);
  });

  it('bloqueio de 24 h resiste a um pequeno atraso do relógio', () => {
    const estado = criarEstadoFontes(banco);
    estado.registrarFalha('brapi', new ErroFonte('bloqueada', 'pagar', 402), agora);

    expect(estado.podeChamar('brapi', new Date(agora.getTime() - 2000))).toBe(false);
    expect(estado.podeChamar('brapi', new Date(agora.getTime() + 24 * HORA - 1))).toBe(false);
    expect(estado.podeChamar('brapi', new Date(agora.getTime() + 24 * HORA))).toBe(true);
  });

  it('espera absurda deixada por um relógio adiantado é ignorada', () => {
    const estado = criarEstadoFontes(banco);
    estado.registrarFalha('brapi', new ErroFonte('bloqueada', 'pagar', 402), agora);

    expect(estado.podeChamar('brapi', new Date(agora.getTime() - 3 * HORA))).toBe(true);
  });
});

describe('robustez (terceira revisão)', () => {
  const logoDe = (ticker: string) => `https://icons.brapi.dev/icons/${ticker}.svg`;
  const listaCom = (tickers: string[]) =>
    json({ stocks: tickers.map((t) => ({ stock: t, name: t, close: 10, logo: logoDe(t) })) });

  it.each(['brapi', 'brapi_icones'] as const)(
    '%s bloqueada volta a ok quando a API se recupera depois de 24 h',
    async (provedor) => {
      const { catalogo, estado } = montar({
        [URL_LISTA_BRAPI]:
          provedor === 'brapi' ? [json({}, { status: 402 }), listaBrapi()] : listaBrapi(),
        [URL_LOGO]: [json({}, { status: 402 }), svg()],
      });
      if (provedor === 'brapi') {
        await catalogo.garantirAtualizado();
      } else {
        await catalogo.garantirAtualizado();
        await catalogo.logo('BBAS3');
      }
      expect(estado.consultar(provedor)?.situacao).toBe('bloqueada');

      avancar(24 * HORA);
      await catalogo.garantirAtualizado();
      await catalogo.logo('BBAS3');

      expect(estado.consultar(provedor)).toMatchObject({ situacao: 'ok', proximaTentativa: null });
    },
  );

  it('relógio atrasado com o banco sem gravar: a pausa em memória ainda vale', async () => {
    const { catalogo, estado, requisicoes } = montar({ [URL_LISTA_BRAPI]: listaBrapi() });
    await catalogo.garantirAtualizado(); // grava ultimaTentativa às 15:00 no banco
    vi.spyOn(estado, 'registrarSucesso').mockImplementation(() => {
      throw new Error('database is locked');
    });
    avancar(-45 * MINUTO); // relógio volta: 14:15
    await catalogo.garantirAtualizado(); // chama (banco no futuro) e guarda 14:15 em memória

    avancar(5 * MINUTO);
    await catalogo.garantirAtualizado();

    expect(requisicoes).toHaveLength(2);
  });

  it('vários logos seguidos com formato estranho avisam e pausam o servidor de logos', async () => {
    const tickers = ['ABCD3', 'EFGH3', 'IJKL3', 'MNOP3', 'QRST3', 'UVWX3'];
    const { catalogo, estado, requisicoes } = montar({
      [URL_LISTA_BRAPI]: listaCom(tickers),
      'https://icons.brapi.dev/': () => json({}, { status: 410 }),
    });
    await catalogo.garantirAtualizado();

    for (const t of tickers) await catalogo.logo(t);

    expect(estado.consultar('brapi_icones')?.situacao).toBe('formato_alterado');
    expect(requisicoes.filter((r) => r.url.includes('icons'))).toHaveLength(5);
  });

  it('se o banco não grava o logo, não baixa de novo a cada pedido', async () => {
    const { catalogo, requisicoes } = montar({
      [URL_LISTA_BRAPI]: listaBrapi(),
      [URL_LOGO]: svg(),
    });
    await catalogo.garantirAtualizado();
    banco.exec(`CREATE TEMP TRIGGER sem_logo BEFORE INSERT ON logos
      BEGIN SELECT RAISE(ABORT, 'disco cheio'); END`);

    await catalogo.logo('BBAS3');
    await catalogo.logo('BBAS3');

    expect(requisicoes.filter((r) => r.url === URL_LOGO)).toHaveLength(1);
  });

  it('tolerância de 1 h no relógio: -59 min mantém o bloqueio, -61 min libera', () => {
    const estado = criarEstadoFontes(banco);
    estado.registrarFalha('brapi', new ErroFonte('bloqueada', 'pagar', 402), agora);

    expect(estado.podeChamar('brapi', new Date(agora.getTime() - 59 * MINUTO))).toBe(false);
    expect(estado.podeChamar('brapi', new Date(agora.getTime() - 61 * MINUTO))).toBe(true);
  });
});
