import { describe, expect, it } from 'vitest';
import { normalizarTicker } from './ticker.js';

describe('normalizarTicker', () => {
  it.each([
    ['BBAS3', 'BBAS3'],
    ['taee11', 'TAEE11'],
    ['  petr4 ', 'PETR4'],
    ['Bpac11', 'BPAC11'],
  ])('"%s" → %s', (texto, ticker) => {
    expect(normalizarTicker(texto)).toBe(ticker);
  });

  it.each(['', 'BBAS', 'BBA3', 'BBAS123', 'BBAS3F', '1BAS3', 'BB AS3', 'BBAS3.SA', 'ÇBAS3'])(
    'recusa "%s"',
    (texto) => {
      expect(normalizarTicker(texto)).toBeNull();
    },
  );
});
