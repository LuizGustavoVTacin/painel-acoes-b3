import type {
  Cotacao,
  EstadoFonte,
  FonteCotacao,
  Provedor,
  RespostaCotacoes,
  SituacaoFonte,
} from '../shared/painel';
import { normalizarTicker, type Ticker } from '../shared/ticker';

/** Falha ao obter dados do servidor local, com uma mensagem pronta para a tela. */
export class ErroApi extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

const FONTES = new Set<FonteCotacao>(['yahoo', 'brapi']);
const PROVEDORES = new Set<Provedor>(['yahoo', 'brapi', 'brapi_icones']);
const SITUACOES = new Set<SituacaoFonte>(['ok', 'instavel', 'bloqueada', 'formato_alterado']);

type Objeto = Record<string, unknown>;

const ehObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);
const ehTicker = (valor: unknown): valor is Ticker =>
  typeof valor === 'string' && normalizarTicker(valor) === valor;
const ehInstante = (valor: unknown): valor is string =>
  typeof valor === 'string' && !Number.isNaN(Date.parse(valor));
const ehInstanteOuNulo = (valor: unknown): valor is string | null =>
  valor === null || ehInstante(valor);
const ehPreco = (valor: unknown): valor is number | null =>
  valor === null || (Number.isSafeInteger(valor) && (valor as number) > 0);

function formatoInvalido(): ErroApi {
  return new ErroApi('O servidor enviou uma resposta em formato inesperado');
}

function lerCotacao(valor: unknown): Cotacao {
  if (
    !ehObjeto(valor) ||
    !ehTicker(valor.ticker) ||
    !ehPreco(valor.precoCentavos) ||
    !(valor.fonte === null || FONTES.has(valor.fonte as FonteCotacao)) ||
    !ehInstanteOuNulo(valor.negociadoEm) ||
    !ehInstanteOuNulo(valor.atualizadoEm) ||
    typeof valor.desatualizada !== 'boolean'
  ) {
    throw formatoInvalido();
  }
  return {
    ticker: valor.ticker,
    precoCentavos: valor.precoCentavos,
    fonte: valor.fonte as FonteCotacao | null,
    negociadoEm: valor.negociadoEm,
    atualizadoEm: valor.atualizadoEm,
    desatualizada: valor.desatualizada,
  };
}

function lerFonte(valor: unknown): EstadoFonte {
  if (
    !ehObjeto(valor) ||
    !PROVEDORES.has(valor.provedor as Provedor) ||
    !SITUACOES.has(valor.situacao as SituacaoFonte) ||
    !(valor.mensagem === null || typeof valor.mensagem === 'string') ||
    !ehInstante(valor.desde) ||
    !ehInstante(valor.ultimaTentativa) ||
    !ehInstanteOuNulo(valor.ultimoSucesso) ||
    !ehInstanteOuNulo(valor.proximaTentativa)
  ) {
    throw formatoInvalido();
  }
  return {
    provedor: valor.provedor as Provedor,
    situacao: valor.situacao as SituacaoFonte,
    mensagem: valor.mensagem,
    desde: valor.desde,
    ultimaTentativa: valor.ultimaTentativa,
    ultimoSucesso: valor.ultimoSucesso,
    proximaTentativa: valor.proximaTentativa,
  };
}

/** Confere o corpo de GET /api/cotacoes; qualquer desvio vira ErroApi, nunca uma tela quebrada. */
export function lerRespostaCotacoes(corpo: unknown): RespostaCotacoes {
  if (
    !ehObjeto(corpo) ||
    !Array.isArray(corpo.cotacoes) ||
    !(corpo.mercadoAberto === null || typeof corpo.mercadoAberto === 'boolean') ||
    !Array.isArray(corpo.fontesEmUso) ||
    !corpo.fontesEmUso.every((fonte) => FONTES.has(fonte as FonteCotacao)) ||
    !Array.isArray(corpo.semCotacaoNoYahoo) ||
    !corpo.semCotacaoNoYahoo.every(ehTicker) ||
    !Array.isArray(corpo.fontes)
  ) {
    throw formatoInvalido();
  }
  return {
    cotacoes: corpo.cotacoes.map(lerCotacao),
    mercadoAberto: corpo.mercadoAberto,
    fontesEmUso: corpo.fontesEmUso as FonteCotacao[],
    semCotacaoNoYahoo: corpo.semCotacaoNoYahoo as Ticker[],
    fontes: corpo.fontes.map(lerFonte),
  };
}

/**
 * Busca as cotações das ações selecionadas no servidor local.
 * Falhas de rede, de status e de formato viram ErroApi; o cancelamento (signal) é repassado.
 */
export async function buscarCotacoes(signal: AbortSignal): Promise<RespostaCotacoes> {
  let resposta: Response;
  try {
    resposta = await fetch('/api/cotacoes', { signal, headers: { accept: 'application/json' } });
  } catch (erro) {
    if (signal.aborted) throw erro;
    throw new ErroApi('Não foi possível falar com o servidor do dashboard');
  }
  if (!resposta.ok) {
    throw new ErroApi(`O servidor do dashboard respondeu com erro (${resposta.status})`);
  }
  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch (erro) {
    if (signal.aborted) throw erro;
    throw formatoInvalido();
  }
  return lerRespostaCotacoes(corpo);
}
