import { json } from './fetchFalso.js';

/** Instante em segundos desde 1970, como o Yahoo envia. */
export const segundos = (iso: string) => Date.parse(iso) / 1000;

/** Pregão regular de 27/10/2026: 10h às 17h em Brasília. */
export const PREGAO_27_10 = {
  inicio: '2026-10-27T13:00:00.000Z',
  fim: '2026-10-27T20:00:00.000Z',
};

/** Item do spark no formato real do Yahoo (recorte de 27/10/2026, só os campos usados). */
export function itemSpark(
  ticker: string,
  preco = 17.38,
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    symbol: `${ticker}.SA`,
    response: [
      {
        meta: {
          currency: 'BRL',
          symbol: `${ticker}.SA`,
          regularMarketPrice: preco,
          regularMarketTime: segundos('2026-10-27T14:55:00Z'),
          chartPreviousClose: preco - 1,
          currentTradingPeriod: {
            regular: {
              start: segundos(PREGAO_27_10.inicio),
              end: segundos(PREGAO_27_10.fim),
              timezone: 'BRT',
            },
          },
          ...meta,
        },
      },
    ],
  };
}

export const spark = (...itens: unknown[]) => json({ spark: { result: itens, error: null } });
