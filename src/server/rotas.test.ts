import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from './app.js';
import { abrirBanco, type Banco } from './banco/conexao.js';

// 27/10/2026 às 22:30 em Brasília (já dia 28 em UTC).
const AGORA = new Date('2026-10-28T01:30:00Z');

const compraValida = {
  ticker: 'bbas3',
  data: '2026-10-20',
  quantidade: 100,
  precoUnitario: 2750,
  taxas: 490,
  plataforma: '  Itaú Íon ',
};

let banco: Banco;
let app: ReturnType<typeof criarApp>;

beforeEach(() => {
  banco = abrirBanco(':memory:');
  app = criarApp({ banco, agora: () => AGORA });
});

afterEach(() => {
  banco.close();
});

const criarCompra = async (dados: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/transacoes')
    .send({ ...compraValida, ...dados });

describe('POST /api/transacoes', () => {
  it('cria a transação normalizando ticker e plataforma', async () => {
    const resposta = await criarCompra();

    expect(resposta.status).toBe(201);
    expect(resposta.body.transacao).toMatchObject({
      id: 1,
      ticker: 'BBAS3',
      data: '2026-10-20',
      quantidade: 100,
      precoUnitario: 2750,
      taxas: 490,
      plataforma: 'Itaú Íon',
    });
  });

  it('aceita compra feita hoje no calendário de Brasília', async () => {
    const resposta = await criarCompra({ data: '2026-10-27' });

    expect(resposta.status).toBe(201);
  });

  it('recusa compra com data futura (amanhã em Brasília)', async () => {
    const resposta = await criarCompra({ data: '2026-10-28' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos).toEqual({ data: 'A data da compra não pode ser no futuro' });
  });

  it('informa todos os campos inválidos de uma vez', async () => {
    const resposta = await request(app).post('/api/transacoes').send({
      ticker: 'XYZ',
      data: '31/10/2026',
      quantidade: 1.5,
      precoUnitario: 0,
      taxas: -1,
      plataforma: '   ',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe('Verifique os campos destacados');
    expect(Object.keys(resposta.body.campos).sort()).toEqual([
      'data',
      'plataforma',
      'precoUnitario',
      'quantidade',
      'taxas',
      'ticker',
    ]);
  });

  it.each([
    ['quantidade como texto', { quantidade: '100' }, 'quantidade'],
    ['preço em reais (fracionado)', { precoUnitario: 27.5 }, 'precoUnitario'],
    ['preço acima do máximo', { precoUnitario: 100_000_001 }, 'precoUnitario'],
    ['quantidade acima do máximo', { quantidade: 1_000_000_001 }, 'quantidade'],
    ['total grande demais', { quantidade: 1_000_000_000, precoUnitario: 100_000 }, 'quantidade'],
    ['taxas ausentes', { taxas: undefined }, 'taxas'],
    ['plataforma longa', { plataforma: 'x'.repeat(41) }, 'plataforma'],
    ['data inexistente', { data: '2026-02-30' }, 'data'],
    ['ticker fracionário', { ticker: 'BBAS3F' }, 'ticker'],
  ])('recusa %s', async (_caso, dados, campo) => {
    const resposta = await criarCompra(dados);

    expect(resposta.status).toBe(400);
    expect(Object.keys(resposta.body.campos)).toEqual([campo]);
  });

  it('aceita plataforma com 40 caracteres acentuados', async () => {
    const resposta = await criarCompra({ plataforma: 'í'.repeat(40) });

    expect(resposta.status).toBe(201);
  });

  it.each([
    ['sem corpo', undefined],
    ['com uma lista', [compraValida]],
  ])('recusa requisição %s', async (_caso, corpo) => {
    const resposta = await request(app).post('/api/transacoes').send(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe('Envie os dados da transação em formato JSON');
  });
});

describe('GET /api/transacoes', () => {
  it('lista as transações, com filtro por ticker', async () => {
    await criarCompra();
    await criarCompra({ ticker: 'PETR4' });

    const todas = await request(app).get('/api/transacoes');
    const filtradas = await request(app).get('/api/transacoes?ticker=petr4');

    expect(todas.body.transacoes).toHaveLength(2);
    expect(filtradas.body.transacoes.map((t: { ticker: string }) => t.ticker)).toEqual(['PETR4']);
  });

  it('recusa filtro de ticker inválido', async () => {
    const resposta = await request(app).get('/api/transacoes?ticker=xx');

    expect(resposta.status).toBe(400);
  });

  it('recusa o filtro repetido', async () => {
    const resposta = await request(app).get('/api/transacoes?ticker=BBAS3&ticker=PETR4');

    expect(resposta.status).toBe(400);
  });
});

describe('PUT /api/transacoes/:id', () => {
  it('substitui os dados da transação', async () => {
    const { body } = await criarCompra();

    const resposta = await request(app)
      .put(`/api/transacoes/${body.transacao.id}`)
      .send({ ...compraValida, quantidade: 30, plataforma: 'BTG' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.transacao).toMatchObject({ id: 1, quantidade: 30, plataforma: 'BTG' });
  });

  it('valida os dados como na criação', async () => {
    await criarCompra();

    const resposta = await request(app)
      .put('/api/transacoes/1')
      .send({ ...compraValida, quantidade: 0 });

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos).toHaveProperty('quantidade');
  });

  it.each(['999', 'abc', '0', '-1', '1.5', '99999999999999999999'])(
    'responde 404 para o id %s',
    async (id) => {
      const resposta = await request(app).put(`/api/transacoes/${id}`).send(compraValida);

      expect(resposta.status).toBe(404);
      expect(resposta.body).toEqual({ erro: 'Transação não encontrada' });
    },
  );
});

describe('DELETE /api/transacoes/:id', () => {
  it('exclui e depois responde 404', async () => {
    await criarCompra();

    const primeira = await request(app).delete('/api/transacoes/1');
    const segunda = await request(app).delete('/api/transacoes/1');

    expect(primeira.status).toBe(204);
    expect(segunda.status).toBe(404);
    expect((await request(app).get('/api/transacoes')).body.transacoes).toEqual([]);
  });
});

describe('/api/selecao', () => {
  it('começa vazia e informa o limite', async () => {
    const resposta = await request(app).get('/api/selecao');

    expect(resposta.body).toEqual({ tickers: [], limite: 50 });
  });

  it('substitui a seleção normalizando os tickers', async () => {
    const resposta = await request(app)
      .put('/api/selecao')
      .send({ tickers: ['bbas3', 'PETR4', ' vale3 '] });

    expect(resposta.status).toBe(200);
    expect(resposta.body.tickers).toEqual(['BBAS3', 'PETR4', 'VALE3']);
    expect((await request(app).get('/api/selecao')).body.tickers).toEqual([
      'BBAS3',
      'PETR4',
      'VALE3',
    ]);
  });

  it.each([
    [
      'mais de 50 ações',
      { tickers: Array.from({ length: 51 }, (_, i) => `AAAA${i}`) },
      /no máximo 50/,
    ],
    ['ticker inválido', { tickers: ['BBAS3', 'XX'] }, /inválido: "XX"/],
    ['ticker que não é texto', { tickers: [3] }, /inválido: 3/],
    ['ticker repetido', { tickers: ['BBAS3', 'bbas3'] }, /repetida.*BBAS3/],
    ['formato errado', ['BBAS3'], /\{ "tickers"/],
  ])('recusa %s sem alterar a seleção', async (_caso, corpo, mensagem) => {
    await request(app)
      .put('/api/selecao')
      .send({ tickers: ['ITUB4'] });

    const resposta = await request(app).put('/api/selecao').send(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toMatch(mensagem);
    expect((await request(app).get('/api/selecao')).body.tickers).toEqual(['ITUB4']);
  });
});

describe('GET /api/posicoes', () => {
  it('consolida as compras por ticker', async () => {
    await criarCompra({ quantidade: 100, precoUnitario: 1000, taxas: 100 });
    await criarCompra({ quantidade: 50, precoUnitario: 1300, taxas: 50 });
    await criarCompra({ ticker: 'PETR4', quantidade: 10, precoUnitario: 3800, taxas: 0 });

    const resposta = await request(app).get('/api/posicoes');

    expect(resposta.body).toEqual({
      posicoes: {
        BBAS3: { quantidadeTotal: 150, custoTotal: 165150, precoMedio: 1101 },
        PETR4: { quantidadeTotal: 10, custoTotal: 38000, precoMedio: 3800 },
      },
      erros: {},
    });
  });

  it('não inclui ações sem compras', async () => {
    expect((await request(app).get('/api/posicoes')).body).toEqual({ posicoes: {}, erros: {} });
  });

  it('uma ação com total impossível de calcular não derruba as outras', async () => {
    await criarCompra({ ticker: 'BBAS3', quantidade: 10, precoUnitario: 1000, taxas: 0 });
    // Cada compra é válida, mas a soma passa do limite de inteiros seguros.
    const inserir = banco.prepare(
      `INSERT INTO transacoes (ticker, data, quantidade, preco_unitario_centavos, taxas_centavos, plataforma)
       VALUES ('PETR4', '2026-10-20', 100000, 100000000, 0, 'BTG')`,
    );
    for (let i = 0; i < 901; i++) inserir.run();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resposta = await request(app).get('/api/posicoes');

    expect(resposta.status).toBe(200);
    expect(resposta.body.posicoes).toEqual({
      BBAS3: { quantidadeTotal: 10, custoTotal: 10000, precoMedio: 1000 },
    });
    expect(resposta.body.erros).toEqual({
      PETR4: 'Não foi possível calcular a posição desta ação',
    });
  });
});

describe('dados aceitos pela validação são aceitos pelo banco', () => {
  it.each([
    ['plataforma com acentos e emoji', { plataforma: 'Itaú Íon 🚀' }],
    ['plataforma com 40 emojis', { plataforma: '🚀'.repeat(40) }],
    [
      'valores nos limites',
      { quantidade: 1_000_000_000, precoUnitario: 9_000, taxas: 100_000_000 },
    ],
    ['preço mínimo e taxa zero', { precoUnitario: 1, taxas: 0 }],
    ['ticker com 2 dígitos', { ticker: 'taee11' }],
    ['data mais antiga possível', { data: '1900-01-01' }],
  ])('%s', async (_caso, dados) => {
    const resposta = await criarCompra(dados);

    expect(resposta.status).toBe(201);
  });

  it.each([
    ['caractere NUL no início', '\u0000abc'],
    ['caractere NUL no meio', 'ab\u0000c'],
    ['quebra de linha', 'BTG\nXP'],
    ['surrogate isolado', 'BTG \ud800'],
    ['espaço de largura zero', 'BTG​'],
    ['inversão de direção do texto', '‮BTG'],
  ])('recusa plataforma com %s (400, não 500)', async (_caso, plataforma) => {
    const resposta = await criarCompra({ plataforma });

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos).toEqual({
      plataforma: 'A plataforma contém caracteres inválidos',
    });
  });
});
