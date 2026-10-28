import { reaisParaCentavos, type Centavos } from '../../shared/dinheiro.js';
import { normalizarTicker, type Ticker } from '../../shared/ticker.js';
import { ErroFonte } from './erroFonte.js';
import { requisitarExterno, type Buscar } from './http.js';

/**
 * Endpoint "spark" do Yahoo Finance: cotações de várias ações numa chamada, sem chave, conta,
 * cookie ou crumb (o endpoint /v7/finance/quote passou a exigir crumb e não é usado).
 */
const URL_SPARK_YAHOO = 'https://query1.finance.yahoo.com/v7/finance/spark';
/** O Yahoo recusa (HTTP 400) mais de 20 ações por chamada. */
export const LOTE_MAXIMO_YAHOO = 20;
const LIMITE_RESPOSTA_BYTES = 1024 * 1024;
/** Sem User-Agent o Yahoo responde 429. Não é chave nem conta: só o tipo de cliente. */
const CABECALHOS_YAHOO = { 'user-agent': 'Mozilla/5.0' };
const SUFIXO_B3 = '.SA';

export interface Pregao {
  inicio: string;
  fim: string;
}

export interface CotacaoYahoo {
  ticker: Ticker;
  precoCentavos: Centavos;
  /** Horário da última negociação. */
  negociadoEm: string;
  /** Horário do pregão regular do dia da cotação, se veio na resposta. */
  pregao: Pregao | null;
}

const formatoAlterado = (detalhe: string) =>
  new ErroFonte('formato_alterado', `O formato dos dados do Yahoo mudou (${detalhe})`);

/** Divide as ações em lotes aceitos pelo Yahoo. */
export function dividirEmLotes(tickers: readonly Ticker[]): Ticker[][] {
  const lotes: Ticker[][] = [];
  for (let i = 0; i < tickers.length; i += LOTE_MAXIMO_YAHOO) {
    lotes.push(tickers.slice(i, i + LOTE_MAXIMO_YAHOO));
  }
  return lotes;
}

export function urlDoLote(tickers: readonly Ticker[]): string {
  if (tickers.length === 0 || tickers.length > LOTE_MAXIMO_YAHOO) {
    throw new RangeError(`Lote do Yahoo deve ter de 1 a ${LOTE_MAXIMO_YAHOO} ações`);
  }
  const simbolos = tickers.map((ticker) => `${ticker}${SUFIXO_B3}`).join(',');
  return `${URL_SPARK_YAHOO}?symbols=${simbolos}&range=1d&interval=1d`;
}

/** Segundos desde 1970 (formato do Yahoo) para ISO; null se inválido. */
function lerInstante(valor: unknown): string | null {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0) return null;
  const data = new Date(valor * 1000);
  return Number.isFinite(data.getTime()) && data.getUTCFullYear() < 10000
    ? data.toISOString()
    : null;
}

function lerPregao(periodo: unknown): Pregao | null {
  const regular = (periodo as { regular?: { start?: unknown; end?: unknown } } | null)?.regular;
  const inicio = lerInstante(regular?.start);
  const fim = lerInstante(regular?.end);
  return inicio && fim && inicio < fim ? { inicio, fim } : null;
}

function lerCotacao(item: unknown, pedidos: ReadonlySet<Ticker>): CotacaoYahoo | null {
  const { symbol, response } = (item ?? {}) as { symbol?: unknown; response?: unknown };
  if (typeof symbol !== 'string' || !symbol.endsWith(SUFIXO_B3)) return null;
  const ticker = normalizarTicker(symbol.slice(0, -SUFIXO_B3.length));
  if (!ticker || !pedidos.has(ticker) || !Array.isArray(response)) return null;

  const meta = (response[0] as { meta?: Record<string, unknown> } | undefined)?.meta;
  if (!meta || meta.currency !== 'BRL') return null;
  const preco = meta.regularMarketPrice;
  if (typeof preco !== 'number' || !(preco > 0)) return null;
  let precoCentavos: Centavos;
  try {
    precoCentavos = reaisParaCentavos(preco);
  } catch {
    return null;
  }
  const negociadoEm = lerInstante(meta.regularMarketTime);
  if (precoCentavos <= 0 || !negociadoEm) return null;

  return { ticker, precoCentavos, negociadoEm, pregao: lerPregao(meta.currentTradingPeriod) };
}

/**
 * Valida a resposta do spark. Ações que o Yahoo não conhece simplesmente não vêm na lista;
 * se vierem itens mas nenhum for reconhecido, o formato da API mudou.
 */
export function interpretarSpark(json: unknown, pedidos: readonly Ticker[]): CotacaoYahoo[] {
  const resultado = (json as { spark?: { result?: unknown } } | null)?.spark?.result;
  if (!Array.isArray(resultado)) throw formatoAlterado('lista de cotações ausente');

  const conjunto = new Set(pedidos);
  const cotacoes = new Map<Ticker, CotacaoYahoo>();
  for (const item of resultado) {
    const cotacao = lerCotacao(item, conjunto);
    if (cotacao && !cotacoes.has(cotacao.ticker)) cotacoes.set(cotacao.ticker, cotacao);
  }
  if (resultado.length > 0 && cotacoes.size === 0) {
    throw formatoAlterado('nenhuma cotação reconhecida');
  }
  return [...cotacoes.values()];
}

/** Busca um lote (até 20 ações) no Yahoo. Falhas chegam como ErroFonte classificada. */
export async function buscarLoteYahoo(
  buscar: Buscar,
  tickers: readonly Ticker[],
  agora: Date,
): Promise<CotacaoYahoo[]> {
  const { corpo } = await requisitarExterno(buscar, urlDoLote(tickers), agora, {
    limiteBytes: LIMITE_RESPOSTA_BYTES,
    cabecalhos: CABECALHOS_YAHOO,
  });
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(corpo));
  } catch {
    throw formatoAlterado('resposta não é JSON');
  }
  return interpretarSpark(json, tickers);
}
