import { useEffect, useState } from 'react';

export type Carga<T> =
  { situacao: 'carregando' } | { situacao: 'ok'; dados: T } | { situacao: 'erro' };

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
 * Carrega dados do servidor local uma vez, com tempo limite. Devolve a carga e uma função
 * que tenta de novo — só se a última tentativa falhou; o que já carregou não é buscado outra vez.
 */
export function useCarga<T>(
  buscar: (signal: AbortSignal) => Promise<T>,
  tempoLimiteMs: number,
): [Carga<T>, () => void] {
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

  function tentarDeNovo(): void {
    if (carga.situacao !== 'erro') return;
    setCarga({ situacao: 'carregando' });
    setTentativa((n) => n + 1);
  }

  return [carga, tentarDeNovo];
}
