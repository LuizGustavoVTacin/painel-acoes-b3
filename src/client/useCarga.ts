import { useEffect, useRef, useState } from 'react';

export type Carga<T> =
  | { situacao: 'carregando' }
  /** `desatualizada`: a última recarga falhou; os dados são os da carga anterior. */
  | { situacao: 'ok'; dados: T; desatualizada?: boolean }
  | { situacao: 'erro' };

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
 * Se foi o tempo limite que cancelou, lança ErroTempoEsgotado; qualquer outro erro da tarefa
 * (mesmo um que chegue depois do prazo) passa adiante como está.
 */
export async function comTempoLimite<T>(
  tarefa: (signal: AbortSignal) => Promise<T>,
  tempoLimiteMs: number,
  controle = new AbortController(),
): Promise<T> {
  const esgotado = new ErroTempoEsgotado();
  const limite = setTimeout(() => controle.abort(esgotado), tempoLimiteMs);
  try {
    return await tarefa(controle.signal);
  } catch (erro) {
    const foiOPrazo =
      controle.signal.reason === esgotado &&
      (erro === esgotado || (erro instanceof DOMException && erro.name === 'AbortError'));
    throw foiOPrazo ? esgotado : erro;
  } finally {
    clearTimeout(limite);
  }
}

/**
 * Carrega dados do servidor local, com tempo limite. Devolve a carga, uma função que tenta de
 * novo depois de uma falha, e outra que busca de novo mantendo na tela os dados atuais até a
 * resposta chegar; se essa recarga falhar, os dados ficam, marcados como desatualizados.
 * Uma busca nova cancela a anterior: vale sempre a resposta da mais recente.
 */
export function useCarga<T>(
  buscar: (signal: AbortSignal) => Promise<T>,
  tempoLimiteMs: number,
): [Carga<T>, () => void, () => void] {
  const [carga, setCarga] = useState<Carga<T>>({ situacao: 'carregando' });
  const [pedido, setPedido] = useState(0);
  /** Número do pedido mais recente, contado já no clique (antes de o efeito rodar de novo). */
  const ultimoPedido = useRef(0);

  useEffect(() => {
    const meu = ultimoPedido.current;
    let ativo = true;
    const vale = () => ativo && meu === ultimoPedido.current;
    const controle = new AbortController();
    comTempoLimite(buscar, tempoLimiteMs, controle).then(
      (dados) => {
        if (vale()) setCarga({ situacao: 'ok', dados });
      },
      () => {
        if (!vale()) return;
        setCarga((atual) =>
          atual.situacao === 'ok' ? { ...atual, desatualizada: true } : { situacao: 'erro' },
        );
      },
    );
    return () => {
      ativo = false;
      controle.abort();
    };
  }, [buscar, pedido, tempoLimiteMs]);

  function recarregar(): void {
    ultimoPedido.current += 1;
    // Depois de uma falha não há dados para manter: a tela volta a mostrar "carregando".
    setCarga((atual) => (atual.situacao === 'erro' ? { situacao: 'carregando' } : atual));
    setPedido((n) => n + 1);
  }

  function tentarDeNovo(): void {
    if (carga.situacao === 'erro' || (carga.situacao === 'ok' && carga.desatualizada)) {
      recarregar();
    }
  }

  return [carga, tentarDeNovo, recarregar];
}
