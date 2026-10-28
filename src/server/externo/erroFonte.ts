import type { SituacaoFonte } from '../../shared/painel.js';

export type { SituacaoFonte };

export type SituacaoFalha = Exclude<SituacaoFonte, 'ok'>;

/** Falha ao acessar uma API externa, já classificada. */
export class ErroFonte extends Error {
  constructor(
    readonly situacao: SituacaoFalha,
    mensagem: string,
    /** Status HTTP da resposta, quando houve resposta. */
    readonly status?: number,
    /** Quando a API pediu para esperar (ex.: Retry-After de um 429). */
    readonly esperarAte?: Date,
  ) {
    super(mensagem);
    this.name = 'ErroFonte';
  }
}
