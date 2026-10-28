import { describe, expect, it } from 'vitest';
import { comTempoLimite, ErroTempoEsgotado } from './useCarga';

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
});
