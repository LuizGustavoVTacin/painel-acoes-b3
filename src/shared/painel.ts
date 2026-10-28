import type { Centavos } from './dinheiro.js';
import type { Ticker } from './ticker.js';

/** Tipos da resposta de /api/cotacoes, usados pelo servidor e pela tela. */

export type FonteCotacao = 'yahoo' | 'brapi';

export interface Cotacao {
  ticker: Ticker;
  precoCentavos: Centavos | null;
  fonte: FonteCotacao | null;
  /** Horário da última negociação (só o Yahoo informa). */
  negociadoEm: string | null;
  /** Quando o preço foi obtido da API. */
  atualizadoEm: string | null;
  desatualizada: boolean;
}

export interface PainelCotacoes {
  cotacoes: Cotacao[];
  /** null quando o pregão do dia ainda não foi confirmado pelo Yahoo. */
  mercadoAberto: boolean | null;
  /** Fontes das cotações atuais (não desatualizadas), Yahoo primeiro. */
  fontesEmUso: FonteCotacao[];
  /** Ações pedidas que o Yahoo não devolveu na última tentativa (ex.: código antigo). */
  semCotacaoNoYahoo: Ticker[];
}

/** brapi: listagem (catálogo e preços); brapi_icones: imagens dos logos; yahoo: cotações. */
export type Provedor = 'brapi' | 'brapi_icones' | 'yahoo';

/**
 * Situação de uma API externa:
 * - ok: respondendo normalmente;
 * - instavel: falha temporária (rede, tempo esgotado, erro 5xx, limite de requisições);
 * - bloqueada: passou a exigir chave, plano ou pagamento — nunca pagamos, então paramos de chamar;
 * - formato_alterado: respondeu, mas num formato que não reconhecemos.
 */
export type SituacaoFonte = 'ok' | 'instavel' | 'bloqueada' | 'formato_alterado';

export interface EstadoFonte {
  provedor: Provedor;
  situacao: SituacaoFonte;
  /** Motivo da falha, ou um aviso quando a API funciona mas algo merece atenção. */
  mensagem: string | null;
  /** Desde quando a API está nesta situação. */
  desde: string;
  ultimaTentativa: string;
  ultimoSucesso: string | null;
  /** Antes deste horário a API não deve ser chamada. */
  proximaTentativa: string | null;
}

/** Corpo completo de GET /api/cotacoes. */
export interface RespostaCotacoes extends PainelCotacoes {
  fontes: EstadoFonte[];
}
