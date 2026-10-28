import type { Ticker } from './ticker.js';

/** Máximo de ações exibidas no dashboard ao mesmo tempo. */
export const LIMITE_ACOES_SELECIONADAS = 50;

/** Uma ação que pode ser escolhida no menu (GET /api/catalogo). */
export interface AcaoCatalogo {
  ticker: Ticker;
  nome: string;
}

/** Remove acentos e caixa para comparar buscas: "Itaú" encontra "ITAU". */
export function simplificar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Ações cujo código ou nome contém o termo buscado (sem diferença de acento e caixa). */
export function filtrarAcoes<T extends AcaoCatalogo>(acoes: readonly T[], busca: string): T[] {
  const termo = simplificar(busca.trim());
  if (!termo) return [...acoes];
  return acoes.filter(
    ({ ticker, nome }) => simplificar(ticker).includes(termo) || simplificar(nome).includes(termo),
  );
}
