import type {
  Cotacao,
  EstadoFonte,
  FonteCotacao,
  Provedor,
  RespostaCotacoes,
  SituacaoFonte,
} from '../shared/painel';
import type { AcaoCatalogo } from '../shared/selecao';
import { ehInstanteISO } from '../shared/datas';
import { normalizarTicker, type Ticker } from '../shared/ticker';
import {
  conferirDadosTransacao,
  type CampoTransacao,
  type DadosTransacao,
  type ErrosDeCampo,
  type Transacao,
} from '../shared/transacao';

/** Falha ao obter dados do servidor local, com uma mensagem pronta para a tela. */
export class ErroApi extends Error {
  constructor(
    mensagem: string,
    /** Mensagem por campo do formulário, quando o servidor recusou dados digitados. */
    readonly campos: ErrosDeCampo = {},
    /** Status HTTP da recusa, quando o servidor respondeu (ex.: 404 = não existe mais). */
    readonly status?: number,
  ) {
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

/** Mensagem de erro que o próprio servidor local mandou ({ erro: "..." }), se houver. */
const CAMPOS_TRANSACAO = new Set<CampoTransacao>([
  'ticker',
  'data',
  'quantidade',
  'precoUnitario',
  'taxas',
  'plataforma',
]);

/** Motivo da recusa que o próprio servidor local mandou ({ erro, campos }), se houver. */
async function recusaDoServidor(resposta: Response): Promise<ErroApi | null> {
  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return null;
  }
  if (!ehObjeto(corpo) || typeof corpo.erro !== 'string') return null;
  const { status } = resposta;
  const campos: ErrosDeCampo = {};
  if (ehObjeto(corpo.campos)) {
    for (const [campo, mensagem] of Object.entries(corpo.campos)) {
      if (CAMPOS_TRANSACAO.has(campo as CampoTransacao) && typeof mensagem === 'string') {
        campos[campo as CampoTransacao] = mensagem;
      }
    }
  }
  return new ErroApi(corpo.erro, campos, status);
}

/**
 * Faz uma requisição ao servidor local. Falhas de rede e de status viram ErroApi; o
 * cancelamento (signal) é repassado. Um pedido recusado (4xx) traz o motivo dado pelo servidor.
 */
async function pedir(endereco: string, opcoes: RequestInit = {}): Promise<Response> {
  const { signal } = opcoes;
  let resposta: Response;
  try {
    resposta = await fetch(endereco, {
      ...opcoes,
      headers: { accept: 'application/json', ...opcoes.headers },
    });
  } catch (erro) {
    if (signal?.aborted) throw erro;
    throw new ErroApi('Não foi possível falar com o servidor do dashboard');
  }
  if (!resposta.ok) {
    const recusa = resposta.status < 500 ? await recusaDoServidor(resposta) : null;
    throw (
      recusa ??
      new ErroApi(
        `O servidor do dashboard respondeu com erro (${resposta.status})`,
        {},
        resposta.status,
      )
    );
  }
  return resposta;
}

/** Como `pedir`, devolvendo o corpo em JSON ainda não conferido (JSON inválido vira ErroApi). */
async function pedirJson(endereco: string, opcoes: RequestInit = {}): Promise<unknown> {
  const { signal } = opcoes;
  const resposta = await pedir(endereco, opcoes);
  try {
    return await resposta.json();
  } catch (erro) {
    if (signal?.aborted) throw erro;
    throw formatoInvalido();
  }
}

/** Busca as cotações das ações selecionadas no servidor local. */
export async function buscarCotacoes(signal: AbortSignal): Promise<RespostaCotacoes> {
  return lerRespostaCotacoes(await pedirJson('/api/cotacoes', { signal }));
}

function lerAcaoCatalogo(valor: unknown): AcaoCatalogo | null {
  if (!ehObjeto(valor) || !ehTicker(valor.ticker) || typeof valor.nome !== 'string') {
    return descartar('catálogo', valor);
  }
  return { ticker: valor.ticker, nome: valor.nome };
}

/** Confere o corpo de GET /api/catalogo; uma ação inválida é descartada sozinha. */
export function lerCatalogo(corpo: unknown): AcaoCatalogo[] {
  if (!ehObjeto(corpo) || !Array.isArray(corpo.acoes)) throw formatoInvalido();
  return corpo.acoes.map(lerAcaoCatalogo).filter(presente);
}

/**
 * Confere o corpo de GET/PUT /api/selecao. Aqui nada é descartado: a lista volta ao servidor
 * quando o usuário salva, e um código perdido no caminho sumiria da seleção sem ele pedir.
 */
export function lerSelecao(corpo: unknown): Ticker[] {
  if (!ehObjeto(corpo) || !Array.isArray(corpo.tickers) || !corpo.tickers.every(ehTicker)) {
    throw formatoInvalido();
  }
  return corpo.tickers;
}

/** Todas as ações que podem ser escolhidas, com o nome da empresa. */
export async function buscarCatalogo(signal: AbortSignal): Promise<AcaoCatalogo[]> {
  return lerCatalogo(await pedirJson('/api/catalogo', { signal }));
}

/** Ações exibidas hoje, na ordem em que foram escolhidas. */
export async function buscarSelecao(signal: AbortSignal): Promise<Ticker[]> {
  return lerSelecao(await pedirJson('/api/selecao', { signal }));
}

/** Troca a seleção inteira e devolve a que ficou salva no servidor. */
export async function salvarSelecao(
  tickers: readonly Ticker[],
  signal?: AbortSignal,
): Promise<Ticker[]> {
  const corpo = await pedirJson('/api/selecao', {
    signal,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tickers }),
  });
  return lerSelecao(corpo);
}

/** Datas de compras já salvas não são comparadas com "hoje": o relógio daqui pode diferir. */
const SEM_LIMITE_DE_DATA = '9999-12-31';

function lerTransacao(valor: unknown): Transacao | null {
  if (
    !ehObjeto(valor) ||
    !(Number.isSafeInteger(valor.id) && (valor.id as number) > 0) ||
    !ehInstante(valor.criadoEm) ||
    !ehInstante(valor.atualizadoEm)
  ) {
    return descartar('compra', valor);
  }
  const conferida = conferirDadosTransacao(valor, SEM_LIMITE_DE_DATA);
  if (!conferida.valida) return descartar('compra', valor);
  return {
    id: valor.id as number,
    ...conferida.dados,
    criadoEm: valor.criadoEm,
    atualizadoEm: valor.atualizadoEm,
  };
}

/** Confere o corpo de GET /api/transacoes; uma compra inválida é descartada sozinha. */
export function lerListaTransacoes(corpo: unknown): Transacao[] {
  if (!ehObjeto(corpo) || !Array.isArray(corpo.transacoes)) throw formatoInvalido();
  return corpo.transacoes.map(lerTransacao).filter(presente);
}

/** Confere o corpo de POST/PUT /api/transacoes: a compra que ficou salva. */
export function lerTransacaoSalva(corpo: unknown): Transacao {
  const transacao = ehObjeto(corpo) ? lerTransacao(corpo.transacao) : null;
  if (!transacao) throw formatoInvalido();
  return transacao;
}

/** Todas as compras registradas, mais recentes primeiro. */
export async function listarTransacoes(signal: AbortSignal): Promise<Transacao[]> {
  return lerListaTransacoes(await pedirJson('/api/transacoes', { signal }));
}

const comoJson = (dados: DadosTransacao) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(dados),
});

export async function criarTransacao(
  dados: DadosTransacao,
  signal?: AbortSignal,
): Promise<Transacao> {
  return lerTransacaoSalva(
    await pedirJson('/api/transacoes', { signal, method: 'POST', ...comoJson(dados) }),
  );
}

export async function atualizarTransacao(
  id: number,
  dados: DadosTransacao,
  signal?: AbortSignal,
): Promise<Transacao> {
  return lerTransacaoSalva(
    await pedirJson(`/api/transacoes/${id}`, { signal, method: 'PUT', ...comoJson(dados) }),
  );
}

export async function excluirTransacao(id: number, signal?: AbortSignal): Promise<void> {
  await pedir(`/api/transacoes/${id}`, { signal, method: 'DELETE' });
}
