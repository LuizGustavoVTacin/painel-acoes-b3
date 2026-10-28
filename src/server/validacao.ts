import { ehDataISO, type DataISO } from '../shared/datas.js';
import { normalizarTicker, type Ticker } from '../shared/ticker.js';
import type { DadosTransacao } from './banco/transacoes.js';
import { LIMITE_ACOES_SELECIONADAS } from './banco/migracoes.js';
import { ErroValidacao } from './erros.js';

export const QUANTIDADE_MAXIMA = 1_000_000_000;
/** R$ 1.000.000,00 por ação. */
export const PRECO_MAXIMO = 100_000_000;
/** R$ 1.000.000,00 de taxas numa compra. */
export const TAXAS_MAXIMAS = 100_000_000;
/** R$ 100 bilhões numa compra: mantém as somas bem dentro dos inteiros seguros. */
export const TOTAL_MAXIMO = 10_000_000_000_000;
export const TAMANHO_MAXIMO_PLATAFORMA = 40;

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function ehInteiroEntre(valor: unknown, minimo: number, maximo: number): valor is number {
  return Number.isSafeInteger(valor) && (valor as number) >= minimo && (valor as number) <= maximo;
}

/** Valida o corpo de criação/edição de uma transação. Lança ErroValidacao com os campos errados. */
export function validarDadosTransacao(corpo: unknown, hoje: DataISO): DadosTransacao {
  if (!ehObjeto(corpo)) {
    throw new ErroValidacao('Envie os dados da transação em formato JSON');
  }
  const campos: Record<string, string> = {};
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
    (quantidade as number) * (precoUnitario as number) + (taxas as number) > TOTAL_MAXIMO
  ) {
    campos.quantidade = 'O valor total da compra é grande demais';
  }

  const plataforma =
    typeof corpo.plataforma === 'string' ? corpo.plataforma.normalize('NFC').trim() : '';
  const tamanhoPlataforma = [...plataforma].length;
  if (tamanhoPlataforma === 0 || tamanhoPlataforma > TAMANHO_MAXIMO_PLATAFORMA) {
    campos.plataforma = `Informe a plataforma (até ${TAMANHO_MAXIMO_PLATAFORMA} caracteres)`;
  } else if (!plataforma.isWellFormed() || /\p{Cc}/u.test(plataforma)) {
    // Caracteres de controle (ex.: NUL) fazem o SQLite contar o tamanho de outro jeito.
    campos.plataforma = 'A plataforma contém caracteres inválidos';
  }

  if (Object.keys(campos).length > 0) {
    throw new ErroValidacao('Verifique os campos destacados', campos);
  }
  return {
    ticker: ticker!,
    data: data as DataISO,
    quantidade: quantidade as number,
    precoUnitario: precoUnitario as number,
    taxas: taxas as number,
    plataforma,
  };
}

/** Valida a nova lista de ações exibidas: tickers válidos, sem repetição, até o limite. */
export function validarSelecao(corpo: unknown): Ticker[] {
  if (!ehObjeto(corpo) || !Array.isArray(corpo.tickers)) {
    throw new ErroValidacao('Envie a seleção como { "tickers": [...] }');
  }
  if (corpo.tickers.length > LIMITE_ACOES_SELECIONADAS) {
    throw new ErroValidacao(`Selecione no máximo ${LIMITE_ACOES_SELECIONADAS} ações`);
  }
  const tickers = new Set<Ticker>();
  for (const item of corpo.tickers) {
    const ticker = typeof item === 'string' ? normalizarTicker(item) : null;
    if (!ticker) throw new ErroValidacao(`Código de ação inválido: ${JSON.stringify(item)}`);
    if (tickers.has(ticker)) throw new ErroValidacao(`Ação repetida na seleção: ${ticker}`);
    tickers.add(ticker);
  }
  return [...tickers];
}

/** Converte o :id da rota em número; null se o texto não for um id possível. */
export function lerId(texto: string): number | null {
  const id = /^[1-9]\d{0,15}$/.test(texto) ? Number(texto) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}
