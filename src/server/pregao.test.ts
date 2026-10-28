import { describe, expect, it } from 'vitest';
import { intervaloDeAtualizacao, marcosDoPregao, situacaoDoPregao, type Pregao } from './pregao.js';

// Terça, 27/10/2026: pregão das 10h às 17h em Brasília (13h às 20h UTC).
const PREGAO: Pregao = { inicio: '2026-10-27T13:00:00.000Z', fim: '2026-10-27T20:00:00.000Z' };
const em = (iso: string) => new Date(iso);

describe('situacaoDoPregao', () => {
  it.each([
    ['antes da abertura', '2026-10-27T12:59:59Z', 'fechado'],
    ['na abertura', '2026-10-27T13:00:00Z', 'aberto'],
    ['no meio do pregão', '2026-10-27T17:00:00Z', 'aberto'],
    ['no fim do pregão (leilão de fechamento)', '2026-10-27T20:00:00Z', 'leilao'],
    ['29 min após o fim', '2026-10-27T20:29:59Z', 'leilao'],
    ['30 min após o fim', '2026-10-27T20:30:00Z', 'fechado'],
    ['de madrugada', '2026-10-28T05:00:00Z', 'fechado'],
    ['dia útil seguinte, antes de abrir', '2026-10-28T12:59:00Z', 'fechado'],
    ['dia útil seguinte, sem pregão confirmado', '2026-10-28T13:00:00Z', 'desconhecido'],
    ['dia útil seguinte, no leilão projetado', '2026-10-28T20:10:00Z', 'desconhecido'],
    ['dia útil seguinte, à noite', '2026-10-28T21:00:00Z', 'fechado'],
    ['sábado no horário de pregão', '2026-10-31T15:00:00Z', 'fechado'],
    ['domingo no horário de pregão', '2026-11-01T15:00:00Z', 'fechado'],
    ['segunda após o fim de semana', '2026-11-02T15:00:00Z', 'desconhecido'],
  ])('%s: %s', (_caso, instante, esperado) => {
    expect(situacaoDoPregao(PREGAO, em(instante))).toBe(esperado);
  });

  it('sem pregão conhecido, a situação é desconhecida', () => {
    expect(situacaoDoPregao(undefined, em('2026-10-27T15:00:00Z'))).toBe('desconhecido');
  });
});

describe('intervaloDeAtualizacao', () => {
  it('5 min no pregão e no leilão, 15 min sem confirmação e 1 h fechado', () => {
    expect(intervaloDeAtualizacao('aberto')).toBe(5 * 60_000);
    expect(intervaloDeAtualizacao('leilao')).toBe(5 * 60_000);
    expect(intervaloDeAtualizacao('desconhecido')).toBe(15 * 60_000);
    expect(intervaloDeAtualizacao('fechado')).toBe(60 * 60_000);
  });
});

describe('marcosDoPregao', () => {
  it('durante o pregão ainda não há marco', () => {
    expect(marcosDoPregao(PREGAO, em('2026-10-27T19:00:00Z'))).toEqual([]);
  });

  it('depois do leilão, o fim do leilão é um marco', () => {
    expect(marcosDoPregao(PREGAO, em('2026-10-27T20:30:00Z'))).toEqual([
      '2026-10-27T20:30:00.000Z',
    ]);
  });

  it('no dia seguinte, a abertura projetada também é um marco', () => {
    expect(marcosDoPregao(PREGAO, em('2026-10-28T13:00:00Z'))).toEqual([
      '2026-10-27T20:30:00.000Z',
      '2026-10-28T13:00:00.000Z',
    ]);
    expect(marcosDoPregao(PREGAO, em('2026-10-28T12:59:00Z'))).toEqual([
      '2026-10-27T20:30:00.000Z',
    ]);
  });

  it('sem pregão conhecido não há marcos', () => {
    expect(marcosDoPregao(undefined, em('2026-10-27T15:00:00Z'))).toEqual([]);
  });
});
