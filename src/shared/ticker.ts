/** Código de negociação da B3: 4 letras + 1 ou 2 dígitos (BBAS3, TAEE11). */
export type Ticker = string;

// Validado antes de converter para maiúsculas: toUpperCase transformaria "ﬀ" em "FF".
const PADRAO_TICKER = /^[A-Za-z]{4}\d{1,2}$/;

/** Normaliza (maiúsculas, sem espaços nas pontas) e valida um ticker; null se inválido. */
export function normalizarTicker(texto: string): Ticker | null {
  const ticker = texto.trim();
  return PADRAO_TICKER.test(ticker) ? ticker.toUpperCase() : null;
}
