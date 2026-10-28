import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { comTempoLimite, ErroTempoEsgotado, useCarga } from './useCarga';

/** Tarefa que só termina (com erro) quando o sinal é cancelado. */
const esperarCancelamento = (signal: AbortSignal) =>
  new Promise<never>((_, falhar) =>
    signal.addEventListener('abort', () => falhar(new DOMException('Abortado', 'AbortError'))),
  );

describe('comTempoLimite', () => {
  it('devolve o resultado da tarefa que termina a tempo', async () => {
    await expect(comTempoLimite(async () => 42, 1000)).resolves.toBe(42);
  });

  it('passado o tempo, cancela a tarefa e lança ErroTempoEsgotado', async () => {
    await expect(comTempoLimite(esperarCancelamento, 10)).rejects.toBeInstanceOf(ErroTempoEsgotado);
  });

  it('cancelamento por quem chamou não vira tempo esgotado', async () => {
    const controle = new AbortController();
    const tarefa = comTempoLimite(esperarCancelamento, 1000, controle);
    controle.abort();
    const erro = await tarefa.catch((e: unknown) => e);
    expect(erro).not.toBeInstanceOf(ErroTempoEsgotado);
    expect((erro as DOMException).name).toBe('AbortError');
  });

  it('um erro da própria tarefa passa adiante como está', async () => {
    const falha = new Error('recusado');
    await expect(
      comTempoLimite(async () => {
        throw falha;
      }, 1000),
    ).rejects.toBe(falha);
  });

  it('um erro de verdade que chega depois do prazo não é trocado por tempo esgotado', async () => {
    const falha = new Error('A grade já tem 50 ações');
    const tarefa = () => new Promise<never>((_, falhar) => setTimeout(() => falhar(falha), 30));
    await expect(comTempoLimite(tarefa, 5)).rejects.toBe(falha);
  });
});

/** Busca controlada pelo teste: cada chamada fica pendente até `responder` ou `falhar`. */
function buscaControlada() {
  const pedidos: { resolver: (valor: string) => void; rejeitar: (erro: Error) => void }[] = [];
  const buscar = (signal: AbortSignal) =>
    new Promise<string>((resolver, rejeitar) => {
      pedidos.push({ resolver, rejeitar });
      signal.addEventListener('abort', () => rejeitar(new DOMException('Abortado', 'AbortError')));
    });
  return { buscar, pedidos };
}

describe('useCarga', () => {
  it('carrega, e a recarga mantém os dados na tela até a resposta nova', async () => {
    const { buscar, pedidos } = buscaControlada();
    const { result } = renderHook(() => useCarga(buscar, 1000));
    expect(result.current[0]).toEqual({ situacao: 'carregando' });

    await act(async () => pedidos[0].resolver('v1'));
    expect(result.current[0]).toEqual({ situacao: 'ok', dados: 'v1' });

    act(() => result.current[2]());
    await waitFor(() => expect(pedidos).toHaveLength(2));
    expect(result.current[0]).toEqual({ situacao: 'ok', dados: 'v1' });

    await act(async () => pedidos[1].resolver('v2'));
    expect(result.current[0]).toEqual({ situacao: 'ok', dados: 'v2' });
  });

  it('vale a resposta da recarga mais recente; a anterior é ignorada', async () => {
    const { buscar, pedidos } = buscaControlada();
    const { result } = renderHook(() => useCarga(buscar, 1000));
    await act(async () => pedidos[0].resolver('v1'));

    act(() => result.current[2]());
    await waitFor(() => expect(pedidos).toHaveLength(2));
    act(() => result.current[2]());
    await waitFor(() => expect(pedidos).toHaveLength(3));

    // A segunda resposta chega atrasada (já cancelada): não pode aparecer.
    await act(async () => pedidos[1].resolver('antiga'));
    await act(async () => pedidos[2].resolver('nova'));
    expect(result.current[0]).toEqual({ situacao: 'ok', dados: 'nova' });
  });

  it('recarga que falha mantém os dados, marcados como desatualizados', async () => {
    const { buscar, pedidos } = buscaControlada();
    const { result } = renderHook(() => useCarga(buscar, 1000));
    await act(async () => pedidos[0].resolver('v1'));

    act(() => result.current[2]());
    await waitFor(() => expect(pedidos).toHaveLength(2));
    await act(async () => pedidos[1].rejeitar(new Error('fora do ar')));

    expect(result.current[0]).toEqual({ situacao: 'ok', dados: 'v1', desatualizada: true });

    // "Tentar de novo" volta a buscar, e a resposta boa tira a marca.
    act(() => result.current[1]());
    await waitFor(() => expect(pedidos).toHaveLength(3));
    await act(async () => pedidos[2].resolver('v2'));
    expect(result.current[0]).toEqual({ situacao: 'ok', dados: 'v2' });
  });

  it('primeira carga que falha vira erro; tentar de novo mostra "carregando"', async () => {
    const { buscar, pedidos } = buscaControlada();
    const { result } = renderHook(() => useCarga(buscar, 1000));
    await act(async () => pedidos[0].rejeitar(new Error('fora do ar')));
    expect(result.current[0]).toEqual({ situacao: 'erro' });

    act(() => result.current[1]());
    expect(result.current[0]).toEqual({ situacao: 'carregando' });
    await waitFor(() => expect(pedidos).toHaveLength(2));
  });

  it('tentar de novo não faz nada quando a carga está boa', async () => {
    const { buscar, pedidos } = buscaControlada();
    const { result } = renderHook(() => useCarga(buscar, 1000));
    await act(async () => pedidos[0].resolver('v1'));

    act(() => result.current[1]());
    await new Promise((r) => setTimeout(r, 10));
    expect(pedidos).toHaveLength(1);
  });

  it('busca que estoura o tempo vira erro', async () => {
    const { buscar } = buscaControlada();
    const { result } = renderHook(() => useCarga(buscar, 10));
    await waitFor(() => expect(result.current[0]).toEqual({ situacao: 'erro' }));
  });
});
