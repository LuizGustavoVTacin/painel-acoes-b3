/** Valor monetário em centavos de real. Sempre um inteiro seguro, nunca fração. */
export type Centavos = number;

/** Garante que o valor é um inteiro seguro em centavos; lança RangeError se não for. */
export function garantirCentavos(valor: number, nome = 'valor'): Centavos {
  if (!Number.isSafeInteger(valor)) {
    throw new RangeError(`${nome} deve ser um número inteiro de centavos (recebido: ${valor})`);
  }
  return valor;
}

/** Arredonda para o inteiro mais próximo; empates (x,5) se afastam do zero. */
function arredondarMeioParaFora(valor: number): number {
  // "+ 0" troca -0 por 0.
  return Math.sign(valor) * Math.round(Math.abs(valor)) + 0;
}

/**
 * Converte reais (ex.: preço vindo de uma API) em centavos.
 * toPrecision(15) remove o ruído binário antes de arredondar: 1.005 * 100 vale
 * 100.49999999999999 em ponto flutuante, mas deve virar 101 centavos.
 */
export function reaisParaCentavos(reais: number): Centavos {
  if (!Number.isFinite(reais)) {
    throw new RangeError(`Valor em reais inválido: ${reais}`);
  }
  const centavos = Number((reais * 100).toPrecision(15));
  return garantirCentavos(arredondarMeioParaFora(centavos));
}

// Parte inteira com separador de milhar (1.234.567) ou sem (1234567); até 2 casas após a vírgula.
const PADRAO_VALOR_BR = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Lê um valor digitado no formato brasileiro ("1.234,56", "R$ 10", "0,5") e devolve
 * centavos, sem passar por ponto flutuante. Valores negativos não são aceitos.
 */
export function textoParaCentavos(texto: string): Centavos {
  const limpo = texto.trim().replace(/^R\$\s*/i, '');
  const partes = PADRAO_VALOR_BR.exec(limpo);
  if (!partes) {
    throw new RangeError(`Valor inválido: "${texto}". Use o formato 1.234,56`);
  }
  const reais = partes[1].replaceAll('.', '');
  const fracao = (partes[2] ?? '').padEnd(2, '0');
  return garantirCentavos(Number(reais + fracao));
}

/** Insere pontos de milhar numa sequência de dígitos: "1234567" → "1.234.567". */
export function agruparMilhares(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Formata centavos em reais: 123456 → "R$ 1.234,56"; -5 → "-R$ 0,05". */
export function formatarBRL(centavos: Centavos): string {
  garantirCentavos(centavos);
  const digitos = String(Math.abs(centavos)).padStart(3, '0');
  const reais = agruparMilhares(digitos.slice(0, -2));
  const sinal = centavos < 0 ? '-' : '';
  return `${sinal}R$ ${reais},${digitos.slice(-2)}`;
}
