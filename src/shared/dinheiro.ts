/** Valor monetário em centavos de real. Sempre um inteiro seguro, nunca fração. */
export type Centavos = number;

/** Garante que o valor é um inteiro seguro; lança RangeError se não for. */
export function garantirInteiroSeguro(valor: number, nome: string, unidade = 'número'): number {
  if (!Number.isSafeInteger(valor)) {
    throw new RangeError(`${nome} deve ser um ${unidade} inteiro (recebido: ${valor})`);
  }
  return valor;
}

/** Garante que o valor é um inteiro seguro em centavos; lança RangeError se não for. */
export function garantirCentavos(valor: number, nome = 'valor'): Centavos {
  return garantirInteiroSeguro(valor, nome, 'número de centavos');
}

/**
 * Maior valor aceito por reaisParaCentavos. Acima de 15 algarismos significativos o
 * ponto flutuante já não representa os centavos com segurança.
 */
export const LIMITE_REAIS = 1e13;

/** Arredonda para o inteiro mais próximo; empates (x,5) se afastam do zero. */
function arredondarMeioParaFora(valor: number): number {
  // "+ 0" troca -0 por 0.
  return Math.sign(valor) * Math.round(Math.abs(valor)) + 0;
}

/**
 * Converte um número com casas decimais (reais, percentual) no inteiro de centésimos mais
 * próximo. toPrecision(15) remove o ruído binário antes de arredondar: 1.005 * 100 vale
 * 100.49999999999999 em ponto flutuante, mas deve virar 101.
 */
export function paraCentesimos(valor: number): number {
  if (!Number.isFinite(valor) || Math.abs(valor) >= LIMITE_REAIS) {
    throw new RangeError(`Valor inválido: ${valor}`);
  }
  return arredondarMeioParaFora(Number((valor * 100).toPrecision(15)));
}

/** Converte reais (ex.: preço vindo de uma API) em centavos. */
export function reaisParaCentavos(reais: number): Centavos {
  if (!Number.isFinite(reais) || Math.abs(reais) >= LIMITE_REAIS) {
    throw new RangeError(`Valor em reais inválido: ${reais}`);
  }
  return garantirCentavos(paraCentesimos(reais));
}

// Parte inteira com separador de milhar (1.234.567), sem (1234567) ou só "0", sem zeros à
// esquerda; até 2 casas após a vírgula.
const PADRAO_VALOR_BR = /^([1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d*|0)(?:,(\d{1,2}))?$/;

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
function agruparMilhares(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Formata o módulo de um inteiro em centésimos com duas casas no padrão brasileiro,
 * sem sinal e sem ponto flutuante: 123456 → "1.234,56"; -5 → "0,05".
 */
export function formatarCentesimos(centesimos: number): string {
  garantirInteiroSeguro(centesimos, 'centesimos', 'número de centésimos');
  const digitos = String(Math.abs(centesimos)).padStart(3, '0');
  return `${agruparMilhares(digitos.slice(0, -2))},${digitos.slice(-2)}`;
}

/** Formata centavos em reais: 123456 → "R$ 1.234,56"; -5 → "-R$ 0,05". */
export function formatarBRL(centavos: Centavos): string {
  garantirCentavos(centavos);
  const sinal = centavos < 0 ? '-' : '';
  return `${sinal}R$ ${formatarCentesimos(centavos)}`;
}
