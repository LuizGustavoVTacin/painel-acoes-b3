import { ehDataISO, type DataISO } from './datas.js';
import type { Centavos } from './dinheiro.js';
import { normalizarTicker, type Ticker } from './ticker.js';

/** Regras de uma compra, usadas pelo servidor (API) e pela tela (formulário). */

export const QUANTIDADE_MAXIMA = 1_000_000_000;
/** R$ 1.000.000,00 por ação. */
export const PRECO_MAXIMO = 100_000_000;
/** R$ 1.000.000,00 de taxas numa compra. */
export const TAXAS_MAXIMAS = 100_000_000;
/** R$ 100 bilhões numa compra: mantém as somas bem dentro dos inteiros seguros. */
export const TOTAL_MAXIMO = 10_000_000_000_000;
export const TAMANHO_MAXIMO_PLATAFORMA = 40;

/** Dados que o usuário informa ao registrar ou editar uma compra. */
export interface DadosTransacao {
  ticker: Ticker;
  data: DataISO;
  quantidade: number;
  precoUnitario: Centavos;
  taxas: Centavos;
  plataforma: string;
}

export interface Transacao extends DadosTransacao {
  id: number;
  criadoEm: string;
  atualizadoEm: string;
}

export type CampoTransacao = keyof DadosTransacao;

/** Mensagem de erro por campo do formulário. */
export type ErrosDeCampo = Partial<Record<CampoTransacao, string>>;

export type ResultadoConferencia =
  { valida: true; dados: DadosTransacao } | { valida: false; campos: ErrosDeCampo };

function ehInteiroEntre(valor: unknown, minimo: number, maximo: number): valor is number {
  return Number.isSafeInteger(valor) && (valor as number) >= minimo && (valor as number) <= maximo;
}

/** Valor total pago numa compra: quantidade × preço unitário + taxas. */
export function totalDaCompra({
  quantidade,
  precoUnitario,
  taxas,
}: Pick<DadosTransacao, 'quantidade' | 'precoUnitario' | 'taxas'>): Centavos {
  return quantidade * precoUnitario + taxas;
}

/**
 * Confere os campos de uma compra (vindos em JSON ou já convertidos do formulário).
 * Devolve os dados normalizados ou a mensagem de cada campo errado.
 */
export function conferirDadosTransacao(
  corpo: Record<string, unknown>,
  hoje: DataISO,
): ResultadoConferencia {
  const campos: ErrosDeCampo = {};
  const { quantidade, precoUnitario, taxas } = corpo;

  const ticker = typeof corpo.ticker === 'string' ? normalizarTicker(corpo.ticker) : null;
  if (!ticker) campos.ticker = 'Informe um código da B3 válido, como BBAS3';

  const data = corpo.data;
  if (typeof data !== 'string' || !ehDataISO(data)) {
    campos.data = 'Informe uma data válida';
  } else if (data > hoje) {
    campos.data = 'A data da compra não pode ser no futuro';
  }

  if (!ehInteiroEntre(quantidade, 1, QUANTIDADE_MAXIMA)) {
    campos.quantidade = 'A quantidade deve ser um número inteiro maior que zero';
  }
  if (!ehInteiroEntre(precoUnitario, 1, PRECO_MAXIMO)) {
    campos.precoUnitario = 'O preço unitário deve ser maior que zero e até R$ 1.000.000,00';
  }
  if (!ehInteiroEntre(taxas, 0, TAXAS_MAXIMAS)) {
    campos.taxas = 'As taxas devem ser zero ou mais, até R$ 1.000.000,00';
  }
  if (
    !campos.quantidade &&
    !campos.precoUnitario &&
    !campos.taxas &&
    totalDaCompra({
      quantidade: quantidade as number,
      precoUnitario: precoUnitario as number,
      taxas: taxas as number,
    }) > TOTAL_MAXIMO
  ) {
    campos.quantidade = 'O valor total da compra é grande demais';
  }

  const plataforma =
    typeof corpo.plataforma === 'string' ? corpo.plataforma.normalize('NFC').trim() : '';
  const tamanhoPlataforma = [...plataforma].length;
  if (tamanhoPlataforma === 0 || tamanhoPlataforma > TAMANHO_MAXIMO_PLATAFORMA) {
    campos.plataforma = `Informe a plataforma (até ${TAMANHO_MAXIMO_PLATAFORMA} caracteres)`;
  } else if (!plataforma.isWellFormed() || /[\p{Cc}\p{Cf}]/u.test(plataforma)) {
    // Caracteres de controle (ex.: NUL) fazem o SQLite contar o tamanho de outro jeito;
    // caracteres invisíveis de formatação (ex.: U+202E) bagunçariam a exibição.
    campos.plataforma = 'A plataforma contém caracteres inválidos';
  }

  if (Object.keys(campos).length > 0) return { valida: false, campos };
  return {
    valida: true,
    dados: {
      ticker: ticker!,
      data: data as DataISO,
      quantidade: quantidade as number,
      precoUnitario: precoUnitario as number,
      taxas: taxas as number,
      plataforma,
    },
  };
}
