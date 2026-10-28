import { useEffect, useState } from 'react';

export type Carga<T> =
  { situacao: 'carregando' } | { situacao: 'ok'; dados: T } | { situacao: 'erro' };

/**
 * Tempo máximo de espera nos painéis do menu. O catálogo pode esperar a brapi (que tem tempo
 * limite próprio no servidor); passado isto, algo travou e o painel oferece tentar de novo.
 */
export const TEMPO_LIMITE_PAINEL_MS = 20 * 1000;

/** Roda `tarefa` com um sinal que é cancelado por `controle` ou ao passar o tempo limite. */
export async function comTempoLimite<T>(
  tarefa: (signal: AbortSignal) => Promise<T>,
  controle: AbortController,
  tempoLimiteMs: number,
): Promise<T> {
  const limite = setTimeout(() => controle.abort(), tempoLimiteMs);
  try {
    return await tarefa(controle.signal);
  } finally {
    clearTimeout(limite);
  }
}

/**
 * Carrega dados do servidor local uma vez, com tempo limite. Devolve a carga, uma função que
 * tenta de novo só se a última tentativa falhou, e outra que recarrega mesmo o que já carregou.
 */
export function useCarga<T>(
  buscar: (signal: AbortSignal) => Promise<T>,
  tempoLimiteMs: number,
): [Carga<T>, () => void, () => void] {
  const [carga, setCarga] = useState<Carga<T>>({ situacao: 'carregando' });
  const [tentativa, setTentativa] = useState(0);
  const carregou = carga.situacao === 'ok';

  useEffect(() => {
    if (carregou) return;
    let ativo = true;
    const controle = new AbortController();
    comTempoLimite(buscar, controle, tempoLimiteMs).then(
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
  }, [buscar, tentativa, carregou, tempoLimiteMs]);

  function recarregar(): void {
    setCarga({ situacao: 'carregando' });
    setTentativa((n) => n + 1);
  }

  function tentarDeNovo(): void {
    if (carga.situacao === 'erro') recarregar();
  }

  return [carga, tentarDeNovo, recarregar];
}
