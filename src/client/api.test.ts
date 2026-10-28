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
