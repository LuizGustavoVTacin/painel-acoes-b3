/** Código de negociação da B3: 4 letras + 1 ou 2 dígitos (BBAS3, TAEE11). */
export type Ticker = string;

const PADRAO_TICKER = /^[A-Z]{4}\d{1,2}$/;

/** Normaliza (maiúsculas, sem espaços nas pontas) e valida um ticker; null se inválido. */
export function normalizarTicker(texto: string): Ticker | null {
  const ticker = texto.trim().toUpperCase();
  return PADRAO_TICKER.test(ticker) ? ticker : null;
}
