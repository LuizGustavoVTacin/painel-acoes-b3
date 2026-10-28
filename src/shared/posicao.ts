import {
  agruparMilhares,
  garantirCentavos,
  garantirInteiroSeguro,
  type Centavos,
} from './dinheiro.js';

/** Uma compra registrada, com valores em centavos. */
export interface Compra {
  quantidade: number;
  precoUnitario: Centavos;
  taxas: Centavos;
}

/** Situação consolidada das compras de uma ação. */
export interface Posicao {
  quantidadeTotal: number;
  /** Soma de quantidade × preço unitário + taxas de todas as compras. */
  custoTotal: Centavos;
  /** custoTotal / quantidadeTotal, arredondado ao centavo (apenas para exibição). */
  precoMedio: Centavos;
}

export type Direcao = 'alta' | 'baixa' | 'neutra';

export interface Variacao {
  direcao: Direcao;
  /** Percentual em centésimos de ponto: 1234 = 12,34%. */
  centesimosDePercentual: number;
}

/** a / b com arredondamento meio-para-fora, exato para qualquer inteiro (b > 0). */
function dividirArredondando(a: bigint, b: bigint): bigint {
  const negativo = a < 0n;
  const absoluto = negativo ? -a : a;
  const quociente = (2n * absoluto + b) / (2n * b);
  return negativo ? -quociente : quociente;
}

function validarCompra({ quantidade, precoUnitario, taxas }: Compra): void {
  if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
    throw new RangeError(`Quantidade deve ser um inteiro positivo (recebido: ${quantidade})`);
  }
  if (garantirCentavos(precoUnitario, 'precoUnitario') <= 0) {
    throw new RangeError(`Preço unitário deve ser maior que zero (recebido: ${precoUnitario})`);
  }
  if (garantirCentavos(taxas, 'taxas') < 0) {
    throw new RangeError(`Taxas não podem ser negativas (recebido: ${taxas})`);
  }
}

/**
 * Consolida as compras de uma ação. Preço médio = (valores pagos + taxas) / quantidade total.
 * Devolve null quando não há compras (a ação mostra só o preço, sem seta).
 */
export function calcularPosicao(compras: readonly Compra[]): Posicao | null {
  if (compras.length === 0) return null;

  let quantidadeTotal = 0n;
  let custoTotal = 0n;
  for (const compra of compras) {
    validarCompra(compra);
    quantidadeTotal += BigInt(compra.quantidade);
    custoTotal += BigInt(compra.quantidade) * BigInt(compra.precoUnitario) + BigInt(compra.taxas);
  }

  return {
    quantidadeTotal: garantirInteiroSeguro(Number(quantidadeTotal), 'quantidadeTotal'),
    custoTotal: garantirCentavos(Number(custoTotal), 'custoTotal'),
    precoMedio: Number(dividirArredondando(custoTotal, quantidadeTotal)),
  };
}

/**
 * Compara o preço atual com o preço médio. Usa os totais exatos (preço atual × quantidade
 * contra o custo total), para que o arredondamento do preço médio nunca inverta a seta.
 */
export function calcularVariacao(precoAtual: Centavos, posicao: Posicao): Variacao {
  if (garantirCentavos(precoAtual, 'precoAtual') < 0) {
    throw new RangeError(`Preço atual não pode ser negativo (recebido: ${precoAtual})`);
  }
  if (
    garantirInteiroSeguro(posicao.quantidadeTotal, 'quantidadeTotal') <= 0 ||
    garantirCentavos(posicao.custoTotal, 'custoTotal') <= 0
  ) {
    throw new RangeError('Posição inválida: quantidade e custo total devem ser maiores que zero');
  }
  const custoTotal = BigInt(posicao.custoTotal);
  const diferenca = BigInt(precoAtual) * BigInt(posicao.quantidadeTotal) - custoTotal;
  const direcao: Direcao = diferenca > 0n ? 'alta' : diferenca < 0n ? 'baixa' : 'neutra';
  const centesimos = Number(dividirArredondando(diferenca * 10_000n, custoTotal));

  return {
    direcao,
    centesimosDePercentual: garantirInteiroSeguro(centesimos, 'centesimosDePercentual'),
  };
}

/** Formata centésimos de ponto percentual: 1234 → "+12,34%", -567 → "-5,67%", 0 → "0,00%". */
export function formatarPercentual(centesimos: number): string {
  if (!Number.isSafeInteger(centesimos)) {
    throw new RangeError(`Percentual deve ser inteiro em centésimos (recebido: ${centesimos})`);
  }
  const digitos = String(Math.abs(centesimos)).padStart(3, '0');
  const sinal = centesimos > 0 ? '+' : centesimos < 0 ? '-' : '';
  return `${sinal}${agruparMilhares(digitos.slice(0, -2))},${digitos.slice(-2)}%`;
}
