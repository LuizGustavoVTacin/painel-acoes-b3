/**
 * Código de negociação da B3: 4 caracteres (letra seguida de letras ou dígitos) + 1 ou 2
 * dígitos. Ex.: BBAS3, TAEE11, B3SA3. O mercado fracionário (BBAS3F) não é aceito.
 */
export type Ticker = string;

// Validado antes de converter para maiúsculas: toUpperCase transformaria "ﬀ" em "FF".
const PADRAO_TICKER = /^[A-Za-z][A-Za-z0-9]{3}\d{1,2}$/;

/** Normaliza (maiúsculas, sem espaços nas pontas) e valida um ticker; null se inválido. */
export function normalizarTicker(texto: string): Ticker | null {
  const ticker = texto.trim();
  return PADRAO_TICKER.test(ticker) ? ticker.toUpperCase() : null;
}
