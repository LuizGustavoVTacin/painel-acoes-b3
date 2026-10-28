import type { DataISO } from '../shared/datas.js';
import { LIMITE_ACOES_SELECIONADAS } from '../shared/selecao.js';
import { normalizarTicker, type Ticker } from '../shared/ticker.js';
import { conferirDadosTransacao, type DadosTransacao } from '../shared/transacao.js';
import { ErroValidacao } from './erros.js';

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Valida o corpo de criação/edição de uma transação. Lança ErroValidacao com os campos errados. */
export function validarDadosTransacao(corpo: unknown, hoje: DataISO): DadosTransacao {
  if (!ehObjeto(corpo)) {
    throw new ErroValidacao('Envie os dados da transação em formato JSON');
  }
  const resultado = conferirDadosTransacao(corpo, hoje);
  if (!resultado.valida) {
    throw new ErroValidacao('Verifique os campos destacados', resultado.campos);
  }
  return resultado.dados;
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
