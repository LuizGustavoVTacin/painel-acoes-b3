import { useEffect, useState } from 'react';

export type Carga<T> =
  { situacao: 'carregando' } | { situacao: 'ok'; dados: T } | { situacao: 'erro' };

/**
 * Tempo máximo de espera nos painéis do menu. O catálogo pode esperar a brapi (que tem tempo
 * limite próprio no servidor); passado isto, algo travou e o painel oferece tentar de novo.
 */
export const TEMPO_LIMITE_PAINEL_MS = 20 * 1000;

/**
 * O servidor não respondeu a tempo. Numa gravação, ela pode ter acontecido mesmo assim:
 * quem recebe este erro deve conferir os dados antes de deixar o usuário tentar de novo.
 */
export class ErroTempoEsgotado extends Error {
  constructor() {
    super('O servidor do dashboard demorou demais para responder');
    this.name = 'ErroTempoEsgotado';
  }
}

/**
 * Roda `tarefa` com um sinal que é cancelado por `controle` ou ao passar o tempo limite.
 * Se foi o tempo limite que cancelou, lança ErroTempoEsgotado.
 */
export async function comTempoLimite<T>(
  tarefa: (signal: AbortSignal) => Promise<T>,
  tempoLimiteMs: number,
  controle = new AbortController(),
): Promise<T> {
  let expirou = false;
  const limite = setTimeout(() => {
    expirou = true;
    controle.abort();
  }, tempoLimiteMs);
  try {
    return await tarefa(controle.signal);
  } catch (erro) {
    throw expirou ? new ErroTempoEsgotado() : erro;
  } finally {
    clearTimeout(limite);
  }
}

/**
 * Carrega dados do servidor local, com tempo limite. Devolve a carga, uma função que tenta de
 * novo (só se a última tentativa falhou) e outra que busca de novo mantendo na tela os dados
 * atuais até a resposta chegar. Uma busca nova cancela a anterior: vale sempre a mais recente.
 */
export function useCarga<T>(
  buscar: (signal: AbortSignal) => Promise<T>,
  tempoLimiteMs: number,
): [Carga<T>, () => void, () => void] {
  const [carga, setCarga] = useState<Carga<T>>({ situacao: 'carregando' });
  const [pedido, setPedido] = useState(0);

  useEffect(() => {
    let ativo = true;
    const controle = new AbortController();
    comTempoLimite(buscar, tempoLimiteMs, controle).then(
      (dados) => {
        if (ativo) setCarga({ situacao: 'ok', dados });
      },
      () => {
        if (ativo) setCarga({ situacao: 'erro' });
      },
    );
    return () => {
      ativo = false;
      controle.abort();
    };
  }, [buscar, pedido, tempoLimiteMs]);

  function recarregar(): void {
    setPedido((n) => n + 1);
  }

  function tentarDeNovo(): void {
    if (carga.situacao !== 'erro') return;
    setCarga({ situacao: 'carregando' });
    recarregar();
  }

  return [carga, tentarDeNovo, recarregar];
}
