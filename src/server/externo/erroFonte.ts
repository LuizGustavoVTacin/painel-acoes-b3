/**
 * Situação de uma API externa:
 * - ok: respondendo normalmente;
 * - instavel: falha temporária (rede, tempo esgotado, erro 5xx, limite de requisições);
 * - bloqueada: passou a exigir chave, plano ou pagamento — nunca pagamos, então paramos de chamar;
 * - formato_alterado: respondeu, mas num formato que não reconhecemos.
 */
export type SituacaoFonte = 'ok' | 'instavel' | 'bloqueada' | 'formato_alterado';

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
