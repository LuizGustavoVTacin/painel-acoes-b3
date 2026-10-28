import type {
  Cotacao,
  EstadoFonte,
  FonteCotacao,
  Provedor,
  RespostaCotacoes,
  SituacaoFonte,
} from '../shared/painel';
import { ehInstanteISO } from '../shared/datas';
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
// O mesmo critério de formatarHorario: um horário que a tela não sabe mostrar é recusado aqui.
const ehInstante = (valor: unknown): valor is string =>
  typeof valor === 'string' && ehInstanteISO(valor);
const ehInstanteOuNulo = (valor: unknown): valor is string | null =>
  valor === null || ehInstante(valor);
const ehPreco = (valor: unknown): valor is number | null =>
  valor === null || (Number.isSafeInteger(valor) && (valor as number) > 0);

function formatoInvalido(): ErroApi {
  return new ErroApi('O servidor enviou uma resposta em formato inesperado');
}

/** Descarta um item inválido sem perder os demais; o aviso fica no console para diagnóstico. */
function descartar(tipo: string, valor: unknown): null {
  console.warn(`Item de ${tipo} ignorado: formato inesperado`, valor);
  return null;
}

function lerCotacao(valor: unknown): Cotacao | null {
  if (
    !ehObjeto(valor) ||
    !ehTicker(valor.ticker) ||
    !ehPreco(valor.precoCentavos) ||
    !(valor.fonte === null || FONTES.has(valor.fonte as FonteCotacao)) ||
    !ehInstanteOuNulo(valor.negociadoEm) ||
    !ehInstanteOuNulo(valor.atualizadoEm) ||
    typeof valor.desatualizada !== 'boolean'
  ) {
    return descartar('cotação', valor);
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

function lerFonte(valor: unknown): EstadoFonte | null {
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
    return descartar('fonte', valor);
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

const presente = <T>(item: T | null): item is T => item !== null;

/**
 * Confere o corpo de GET /api/cotacoes. Estrutura errada vira ErroApi; um item inválido é
 * descartado sozinho, para uma cotação estranha não esconder as outras 49.
 */
export function lerRespostaCotacoes(corpo: unknown): RespostaCotacoes {
  if (
    !ehObjeto(corpo) ||
    !Array.isArray(corpo.cotacoes) ||
    !(corpo.mercadoAberto === null || typeof corpo.mercadoAberto === 'boolean') ||
    !Array.isArray(corpo.fontesEmUso) ||
    !Array.isArray(corpo.semCotacaoNoYahoo) ||
    !Array.isArray(corpo.fontes)
  ) {
    throw formatoInvalido();
  }
  return {
    cotacoes: corpo.cotacoes.map(lerCotacao).filter(presente),
    mercadoAberto: corpo.mercadoAberto,
    fontesEmUso: corpo.fontesEmUso.filter((fonte): fonte is FonteCotacao =>
      FONTES.has(fonte as FonteCotacao),
    ),
    semCotacaoNoYahoo: corpo.semCotacaoNoYahoo.filter(ehTicker),
    fontes: corpo.fontes.map(lerFonte).filter(presente),
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
