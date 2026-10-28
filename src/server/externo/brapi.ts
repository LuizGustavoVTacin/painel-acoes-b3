import { reaisParaCentavos, type Centavos } from '../../shared/dinheiro.js';
import { normalizarTicker, type Ticker } from '../../shared/ticker.js';
import { ErroFonte } from './erroFonte.js';
import { requisitarExterno, validarUrlExterna, type Buscar } from './http.js';

/**
 * Listagem pública da brapi: todas as ações com nome, logo e último preço numa só chamada,
 * sem chave e sem consumir cota de plano.
 */
export const URL_LISTA_BRAPI = 'https://brapi.dev/api/quote/list?type=stock&limit=2000';
const HOST_LOGOS = 'icons.brapi.dev';
const LIMITE_LISTA_BYTES = 5 * 1024 * 1024;
const TAMANHO_MAXIMO_NOME = 200;

export interface ItemCatalogo {
  ticker: Ticker;
  nome: string;
  logoUrl: string | null;
  /** Último preço informado pela brapi; null se ausente ou inválido. */
  precoCentavos: Centavos | null;
}

const formatoAlterado = (detalhe: string) =>
  new ErroFonte('formato_alterado', `O formato dos dados da brapi mudou (${detalhe})`);

function lerLogo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  try {
    return validarUrlExterna(valor).hostname === HOST_LOGOS ? valor : null;
  } catch {
    return null;
  }
}

function lerPreco(valor: unknown): Centavos | null {
  if (typeof valor !== 'number' || !(valor > 0)) return null;
  try {
    return reaisParaCentavos(valor);
  } catch {
    return null;
  }
}

/**
 * Valida a resposta da listagem. Itens malformados e do mercado fracionário são descartados;
 * se nada for reconhecido, o formato da API mudou.
 */
export function interpretarListaBrapi(json: unknown): ItemCatalogo[] {
  const acoes = (json as { stocks?: unknown } | null)?.stocks;
  if (!Array.isArray(acoes)) throw formatoAlterado('lista de ações ausente');

  const itens = new Map<Ticker, ItemCatalogo>();
  for (const acao of acoes as Record<string, unknown>[]) {
    if (typeof acao !== 'object' || acao === null || typeof acao.stock !== 'string') continue;
    // Exige o código exatamente como a B3 publica (maiúsculas); BBAS3F fica de fora.
    const ticker = normalizarTicker(acao.stock);
    const nome = typeof acao.name === 'string' ? acao.name.trim() : '';
    if (ticker !== acao.stock || !nome || itens.has(ticker)) continue;

    itens.set(ticker, {
      ticker,
      nome: nome.slice(0, TAMANHO_MAXIMO_NOME),
      logoUrl: lerLogo(acao.logo),
      precoCentavos: lerPreco(acao.close),
    });
  }

  if (itens.size === 0) throw formatoAlterado('nenhuma ação reconhecida');
  return [...itens.values()];
}

export async function buscarListaBrapi(buscar: Buscar, agora: Date): Promise<ItemCatalogo[]> {
  const { corpo } = await requisitarExterno(buscar, URL_LISTA_BRAPI, agora, {
    limiteBytes: LIMITE_LISTA_BYTES,
  });
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(corpo));
  } catch {
    throw formatoAlterado('resposta não é JSON');
  }
  return interpretarListaBrapi(json);
}
