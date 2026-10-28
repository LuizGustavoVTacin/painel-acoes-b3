import type { Cotacao } from '../shared/painel';
import type { Ticker } from '../shared/ticker';

/** Ritmo normal de atualização da tela. */
export const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000;
/** Ação recém-marcada ainda sem preço: o servidor busca em segundo plano; pergunta de novo logo. */
export const ESPERA_ACAO_SEM_DADOS_MS = 10 * 1000;
/** Quantas vezes perguntar logo por uma ação sem preço antes de voltar ao ritmo normal. */
export const TENTATIVAS_ACAO_SEM_DADOS = 3;
/** Servidor local fora do ar (ex.: reiniciando): tenta de novo em 1 minuto. */
export const ESPERA_APOS_FALHA_MS = 60 * 1000;

export interface PlanoBusca {
  esperaMs: number;
  /** Quantas buscas rápidas cada ação ainda sem preço já recebeu. */
  tentativas: ReadonlyMap<Ticker, number>;
}

/**
 * Decide quando buscar de novo. Ações sem nenhum preço salvo ganham até 3 buscas rápidas cada;
 * uma ação que nenhuma fonte conhece não faz a tela perguntar a cada 10 s para sempre.
 */
export function planejarProximaBusca(
  cotacoes: readonly Cotacao[],
  anteriores: ReadonlyMap<Ticker, number>,
): PlanoBusca {
  const tentativas = new Map<Ticker, number>();
  let buscaRapida = false;
  for (const { ticker, atualizadoEm } of cotacoes) {
    if (atualizadoEm !== null) continue;
    const feitas = anteriores.get(ticker) ?? 0;
    if (feitas < TENTATIVAS_ACAO_SEM_DADOS) {
      buscaRapida = true;
      tentativas.set(ticker, feitas + 1);
    } else {
      tentativas.set(ticker, feitas);
    }
  }
  return {
    esperaMs: buscaRapida ? ESPERA_ACAO_SEM_DADOS_MS : INTERVALO_ATUALIZACAO_MS,
    tentativas,
  };
}
