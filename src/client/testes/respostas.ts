import type { Cotacao, EstadoFonte, RespostaCotacoes } from '../../shared/painel';

/** Respostas falsas de /api/cotacoes no formato real do servidor, só para os testes da tela. */

export function cotacao(
  ticker: string,
  precoCentavos: number | null,
  extra: Partial<Cotacao> = {},
) {
  return {
    ticker,
    precoCentavos,
    fonte: precoCentavos === null ? null : 'yahoo',
    negociadoEm: precoCentavos === null ? null : '2026-10-27T20:10:16.000Z',
    atualizadoEm: precoCentavos === null ? null : '2026-10-27T20:44:12.000Z',
    desatualizada: false,
    ...extra,
  } satisfies Cotacao;
}

export function fonte(
  provedor: EstadoFonte['provedor'],
  situacao: EstadoFonte['situacao'] = 'ok',
  mensagem: string | null = null,
): EstadoFonte {
  return {
    provedor,
    situacao,
    mensagem,
    desde: '2026-10-27T10:00:00.000Z',
    ultimaTentativa: '2026-10-27T20:44:12.000Z',
    ultimoSucesso: situacao === 'ok' ? '2026-10-27T20:44:12.000Z' : null,
    proximaTentativa: null,
  };
}

export function resposta(extra: Partial<RespostaCotacoes> = {}): RespostaCotacoes {
  return {
    cotacoes: [cotacao('BBAS3', 1738), cotacao('PETR4', 5279)],
    mercadoAberto: false,
    fontesEmUso: ['yahoo'],
    semCotacaoNoYahoo: [],
    fontes: [fonte('yahoo'), fonte('brapi')],
    ...extra,
  };
}
