import { describe, expect, it, vi } from 'vitest';
import {
  atualizarTransacao,
  buscarCatalogo,
  criarTransacao,
  excluirTransacao,
  lerListaTransacoes,
  listarTransacoes,
  buscarCotacoes,
  buscarSelecao,
  ErroApi,
  lerCatalogo,
  lerRespostaCotacoes,
  lerSelecao,
  salvarSelecao,
} from './api';
import { cotacao, fonte, resposta } from './testes/respostas';

describe('lerRespostaCotacoes', () => {
  it('aceita a resposta do servidor', () => {
    const corpo = resposta({
      cotacoes: [cotacao('BBAS3', 1738), cotacao('ELET3', null)],
      mercadoAberto: null,
      semCotacaoNoYahoo: ['ELET3'],
    });
    expect(lerRespostaCotacoes(corpo)).toEqual(corpo);
  });

  it('descarta campos desconhecidos', () => {
    const corpo = { ...resposta(), extra: 1, cotacoes: [{ ...cotacao('BBAS3', 1738), x: 2 }] };
    expect(lerRespostaCotacoes(corpo)).toEqual(resposta({ cotacoes: [cotacao('BBAS3', 1738)] }));
  });

  it.each([
    ['nulo', null],
    ['lista', []],
    ['sem cotações', { ...resposta(), cotacoes: undefined }],
    ['mercado em texto', { ...resposta(), mercadoAberto: 'sim' }],
    ['sem fontes em uso', { ...resposta(), fontesEmUso: 'yahoo' }],
    ['sem a lista de ações fora do Yahoo', { ...resposta(), semCotacaoNoYahoo: null }],
    ['sem fontes', { ...resposta(), fontes: null }],
  ])('recusa estrutura errada: %s', (_caso, corpo) => {
    expect(() => lerRespostaCotacoes(corpo)).toThrow(ErroApi);
  });

  it.each([
    ['preço fracionado', resposta({ cotacoes: [cotacao('BBAS3', 17.38)] })],
    ['preço zero', resposta({ cotacoes: [cotacao('BBAS3', 0)] })],
    [
      'preço em texto',
      { ...resposta(), cotacoes: [{ ...cotacao('BBAS3', 1), precoCentavos: '1' }] },
    ],
    ['ticker em minúsculas', resposta({ cotacoes: [cotacao('bbas3', 1738)] })],
    [
      'horário inválido',
      resposta({ cotacoes: [cotacao('BBAS3', 1738, { atualizadoEm: 'ontem' })] }),
    ],
    [
      'desatualizada ausente',
      { ...resposta(), cotacoes: [{ ...cotacao('BBAS3', 1738), desatualizada: undefined }] },
    ],
    [
      'horário sem fuso',
      resposta({ cotacoes: [cotacao('BBAS3', 1738, { atualizadoEm: '2026-10-27T17:00:00' })] }),
    ],
    [
      'data sem horário',
      resposta({ cotacoes: [cotacao('BBAS3', 1738, { negociadoEm: '2026-10-27' })] }),
    ],
  ])('descarta só a cotação inválida: %s', (_caso, corpo) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const comValida = { ...corpo, cotacoes: [...corpo.cotacoes, cotacao('PETR4', 5279)] };

    expect(lerRespostaCotacoes(comValida).cotacoes).toEqual([cotacao('PETR4', 5279)]);
    expect(console.warn).toHaveBeenCalled();
  });

  it.each([
    ['provedor desconhecido', { ...fonte('yahoo'), provedor: 'x' }],
    ['situação desconhecida', { ...fonte('yahoo'), situacao: 'paga' }],
    ['horário inválido', { ...fonte('yahoo'), desde: 'ontem' }],
  ])('descarta só a fonte inválida: %s', (_caso, invalida) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const corpo = { ...resposta(), fontes: [invalida, fonte('brapi')] };

    expect(lerRespostaCotacoes(corpo).fontes).toEqual([fonte('brapi')]);
  });

  it('ignora fontes em uso e códigos desconhecidos, mantendo os válidos', () => {
    const corpo = {
      ...resposta(),
      fontesEmUso: ['google', 'brapi'],
      semCotacaoNoYahoo: ['ibov', 'ELET3'],
    };

    const lida = lerRespostaCotacoes(corpo);
    expect(lida.fontesEmUso).toEqual(['brapi']);
    expect(lida.semCotacaoNoYahoo).toEqual(['ELET3']);
  });
});

describe('buscarCotacoes', () => {
  const sinal = () => new AbortController().signal;

  it('consulta /api/cotacoes e devolve os dados conferidos', async () => {
    const fetchFalso = vi.fn(async () => Response.json(resposta()));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(buscarCotacoes(sinal())).resolves.toEqual(resposta());
    expect(fetchFalso).toHaveBeenCalledWith('/api/cotacoes', expect.anything());
  });

  it.each([
    [
      'servidor fora do ar',
      async () => {
        throw new TypeError('Failed to fetch');
      },
      'Não foi possível falar com o servidor do dashboard',
    ],
    [
      'erro do servidor',
      async () => new Response('falhou', { status: 500 }),
      'O servidor do dashboard respondeu com erro (500)',
    ],
    [
      'resposta que não é JSON',
      async () => new Response('<html>'),
      'O servidor enviou uma resposta em formato inesperado',
    ],
  ])('%s vira ErroApi com mensagem para a tela', async (_caso, implementacao, mensagem) => {
    vi.stubGlobal('fetch', vi.fn(implementacao));

    const erro = await buscarCotacoes(sinal()).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect((erro as ErroApi).message).toBe(mensagem);
  });

  it('cancelamento é repassado, não vira erro de servidor', async () => {
    const controle = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controle.abort();
        throw new DOMException('Abortado', 'AbortError');
      }),
    );

    const erro = await buscarCotacoes(controle.signal).catch((e: unknown) => e);
    expect(erro).not.toBeInstanceOf(ErroApi);
    expect((erro as DOMException).name).toBe('AbortError');
  });
});

describe('lerCatalogo', () => {
  it('aceita as ações e ignora o endereço do logo', () => {
    const corpo = {
      acoes: [{ ticker: 'BBAS3', nome: 'Banco do Brasil', logo: '/api/logos/BBAS3' }],
    };
    expect(lerCatalogo(corpo)).toEqual([{ ticker: 'BBAS3', nome: 'Banco do Brasil' }]);
  });

  it.each([
    ['nulo', null],
    ['sem ações', {}],
    ['ações fora de lista', { acoes: 'BBAS3' }],
  ])('recusa estrutura errada: %s', (_caso, corpo) => {
    expect(() => lerCatalogo(corpo)).toThrow(ErroApi);
  });

  it('descarta só a ação inválida', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const corpo = {
      acoes: [
        { ticker: 'bbas3', nome: 'Banco do Brasil' },
        { ticker: 'VALE3', nome: null },
        { ticker: 'PETR4', nome: 'Petrobras' },
      ],
    };
    expect(lerCatalogo(corpo)).toEqual([{ ticker: 'PETR4', nome: 'Petrobras' }]);
  });
});

describe('lerSelecao', () => {
  it('aceita a seleção na ordem do servidor', () => {
    expect(lerSelecao({ tickers: ['PETR4', 'BBAS3'], limite: 50 })).toEqual(['PETR4', 'BBAS3']);
  });

  it.each([
    ['nulo', null],
    ['sem tickers', { limite: 50 }],
    ['um código inválido', { tickers: ['BBAS3', 'xyz'] }],
  ])('recusa a seleção inteira: %s', (_caso, corpo) => {
    expect(() => lerSelecao(corpo)).toThrow(ErroApi);
  });
});

describe('catálogo e seleção no servidor', () => {
  const sinal = () => new AbortController().signal;

  it('buscarCatalogo consulta /api/catalogo', async () => {
    const fetchFalso = vi.fn(async () =>
      Response.json({ acoes: [{ ticker: 'BBAS3', nome: 'Banco do Brasil' }] }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    await expect(buscarCatalogo(sinal())).resolves.toEqual([
      { ticker: 'BBAS3', nome: 'Banco do Brasil' },
    ]);
    expect(fetchFalso).toHaveBeenCalledWith('/api/catalogo', expect.anything());
  });

  it('buscarSelecao consulta /api/selecao', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ tickers: ['BBAS3'], limite: 50 })),
    );
    await expect(buscarSelecao(sinal())).resolves.toEqual(['BBAS3']);
  });

  it('salvarSelecao envia a lista com PUT e devolve a que ficou salva', async () => {
    const fetchFalso = vi.fn(async () =>
      Response.json({ tickers: ['PETR4', 'BBAS3'], limite: 50 }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    await expect(salvarSelecao(['PETR4', 'BBAS3'])).resolves.toEqual(['PETR4', 'BBAS3']);
    const [endereco, opcoes] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(endereco).toBe('/api/selecao');
    expect(opcoes.method).toBe('PUT');
    expect(opcoes.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(opcoes.body as string)).toEqual({ tickers: ['PETR4', 'BBAS3'] });
  });

  it('pedido recusado mostra o motivo dado pelo servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ erro: 'Selecione no máximo 50 ações' }, { status: 400 })),
    );

    await expect(salvarSelecao(['BBAS3'])).rejects.toThrow(
      new ErroApi('Selecione no máximo 50 ações'),
    );
  });

  it('recusa sem motivo legível usa a mensagem genérica', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('?', { status: 403 })),
    );

    await expect(salvarSelecao(['BBAS3'])).rejects.toThrow(
      'O servidor do dashboard respondeu com erro (403)',
    );
  });
});

const transacao = (extra: Record<string, unknown> = {}) => ({
  id: 7,
  ticker: 'BBAS3',
  data: '2026-10-20',
  quantidade: 100,
  precoUnitario: 1738,
  taxas: 490,
  plataforma: 'Itaú Íon',
  criadoEm: '2026-10-20T13:00:00.000Z',
  atualizadoEm: '2026-10-20T13:00:00.000Z',
  ...extra,
});

describe('lerListaTransacoes', () => {
  it('aceita as compras do servidor', () => {
    expect(lerListaTransacoes({ transacoes: [transacao()] })).toEqual([transacao()]);
  });

  it('recusa estrutura errada', () => {
    expect(() => lerListaTransacoes({ compras: [] })).toThrow(ErroApi);
  });

  it.each([
    ['id zero', { id: 0 }],
    ['preço fracionado', { precoUnitario: 17.38 }],
    ['ticker inválido', { ticker: 'bb' }],
    ['data em formato brasileiro', { data: '20/10/2026' }],
    ['sem plataforma', { plataforma: '' }],
    ['criação sem horário', { criadoEm: 'ontem' }],
  ])('descarta só a compra inválida: %s', (_caso, defeito) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const corpo = { transacoes: [transacao(defeito), transacao({ id: 8 })] };
    expect(lerListaTransacoes(corpo)).toEqual([transacao({ id: 8 })]);
  });

  it('aceita compra com data futura para o relógio daqui (o servidor já validou)', () => {
    const corpo = { transacoes: [transacao({ data: '2999-01-01' })] };
    expect(lerListaTransacoes(corpo)).toHaveLength(1);
  });
});

describe('compras no servidor', () => {
  const dados = {
    ticker: 'BBAS3',
    data: '2026-10-20',
    quantidade: 100,
    precoUnitario: 1738,
    taxas: 490,
    plataforma: 'Itaú Íon',
  };

  it('listarTransacoes consulta /api/transacoes', async () => {
    const fetchFalso = vi.fn(async () => Response.json({ transacoes: [transacao()] }));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(listarTransacoes(new AbortController().signal)).resolves.toEqual([transacao()]);
    expect(fetchFalso).toHaveBeenCalledWith('/api/transacoes', expect.anything());
  });

  it('criarTransacao envia POST com JSON e devolve a compra salva', async () => {
    const fetchFalso = vi.fn(async () =>
      Response.json({ transacao: transacao() }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    await expect(criarTransacao(dados)).resolves.toEqual(transacao());
    const [endereco, opcoes] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(endereco).toBe('/api/transacoes');
    expect(opcoes.method).toBe('POST');
    expect(JSON.parse(opcoes.body as string)).toEqual(dados);
  });

  it('atualizarTransacao envia PUT para o id', async () => {
    const fetchFalso = vi.fn(async () => Response.json({ transacao: transacao() }));
    vi.stubGlobal('fetch', fetchFalso);

    await atualizarTransacao(7, dados);
    const [endereco, opcoes] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(endereco).toBe('/api/transacoes/7');
    expect(opcoes.method).toBe('PUT');
  });

  it('excluirTransacao aceita a resposta 204 sem corpo', async () => {
    const fetchFalso = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(excluirTransacao(7)).resolves.toBeUndefined();
    const [endereco, opcoes] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(endereco).toBe('/api/transacoes/7');
    expect(opcoes.method).toBe('DELETE');
  });

  it('compra que sumiu (404) vira ErroApi com o motivo do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ erro: 'Transação não encontrada' }, { status: 404 })),
    );
    await expect(excluirTransacao(7)).rejects.toThrow(new ErroApi('Transação não encontrada'));
  });

  it('recusa com erros por campo traz cada mensagem, ignorando campos desconhecidos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            erro: 'Verifique os campos destacados',
            campos: { data: 'A data da compra não pode ser no futuro', senha: 'x', taxas: 3 },
          },
          { status: 400 },
        ),
      ),
    );

    const erro = (await criarTransacao(dados).catch((e: unknown) => e)) as ErroApi;
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro.message).toBe('Verifique os campos destacados');
    expect(erro.campos).toEqual({ data: 'A data da compra não pode ser no futuro' });
  });
});
