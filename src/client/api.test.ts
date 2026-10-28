import { describe, expect, it, vi } from 'vitest';
import { buscarCotacoes, ErroApi, lerRespostaCotacoes } from './api';
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
    ['fonte em uso desconhecida', { ...resposta(), fontesEmUso: ['google'] }],
    ['ticker inválido sem cotação no Yahoo', { ...resposta(), semCotacaoNoYahoo: ['ibov'] }],
    ['sem fontes', { ...resposta(), fontes: null }],
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
    ['provedor desconhecido', { ...resposta(), fontes: [{ ...fonte('yahoo'), provedor: 'x' }] }],
    ['situação desconhecida', { ...resposta(), fontes: [{ ...fonte('yahoo'), situacao: 'paga' }] }],
  ])('recusa: %s', (_caso, corpo) => {
    expect(() => lerRespostaCotacoes(corpo)).toThrow(ErroApi);
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
