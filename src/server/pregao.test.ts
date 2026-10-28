import { describe, expect, it } from 'vitest';
import { intervaloDeAtualizacao, marcosDoPregao, situacaoDoPregao, type Pregao } from './pregao.js';

// Terça, 27/10/2026: pregão das 10h às 17h em Brasília (13h às 20h UTC).
const PREGAO: Pregao = { inicio: '2026-10-27T13:00:00.000Z', fim: '2026-10-27T20:00:00.000Z' };
const em = (iso: string) => new Date(iso);
const MINUTO = 60_000;

describe('situacaoDoPregao', () => {
  it.each([
    ['antes da abertura', '2026-10-27T12:59:59Z', 'fechado'],
    ['na abertura', '2026-10-27T13:00:00Z', 'aberto'],
    ['no meio do pregão', '2026-10-27T17:00:00Z', 'aberto'],
    ['no fim do pregão (leilão de fechamento)', '2026-10-27T20:00:00Z', 'leilao'],
    ['29 min após o fim', '2026-10-27T20:29:59Z', 'leilao'],
    ['30 min após o fim', '2026-10-27T20:30:00Z', 'fechado'],
    ['de madrugada', '2026-10-28T05:00:00Z', 'fechado'],
    ['dia seguinte, mais de 1 h antes de abrir', '2026-10-28T11:59:00Z', 'fechado'],
    ['dia seguinte, 1 h antes de abrir (folga)', '2026-10-28T12:00:00Z', 'desconhecido'],
    ['dia seguinte, sem pregão confirmado', '2026-10-28T13:00:00Z', 'desconhecido'],
    ['dia seguinte, no leilão projetado', '2026-10-28T20:10:00Z', 'desconhecido'],
    ['dia seguinte, à noite', '2026-10-28T21:00:00Z', 'fechado'],
    ['feriado de quinta, com o pregão de terça guardado', '2026-10-29T15:00:00Z', 'desconhecido'],
    ['sábado no horário de pregão', '2026-10-31T15:00:00Z', 'fechado'],
    ['domingo no horário de pregão', '2026-11-01T15:00:00Z', 'fechado'],
    ['segunda após o fim de semana', '2026-11-02T15:00:00Z', 'desconhecido'],
  ])('%s: %s', (_caso, instante, esperado) => {
    expect(situacaoDoPregao(PREGAO, em(instante))).toBe(esperado);
  });

  it('pregão anunciado para amanhã: fechado até abrir, aberto depois', () => {
    const amanha: Pregao = {
      inicio: '2026-10-28T13:00:00.000Z',
      fim: '2026-10-28T20:00:00.000Z',
    };
    expect(situacaoDoPregao(amanha, em('2026-10-27T23:00:00Z'))).toBe('fechado');
    expect(situacaoDoPregao(amanha, em('2026-10-28T13:00:00Z'))).toBe('aberto');
  });

  it.each([
    ['dia útil às 12h (pode ser feriado)', '2026-10-27T15:00:00Z', 'desconhecido'],
    ['dia útil às 17h10', '2026-10-27T20:10:00Z', 'desconhecido'],
    ['dia útil às 9h', '2026-10-27T12:00:00Z', 'fechado'],
    ['dia útil à noite', '2026-10-27T23:00:00Z', 'fechado'],
    ['sábado às 12h', '2026-10-31T15:00:00Z', 'fechado'],
  ])(
    'sem pregão do Yahoo, o horário habitual da B3 fica sem confirmação: %s',
    (_caso, instante, esperado) => {
      expect(situacaoDoPregao(undefined, em(instante))).toBe(esperado);
    },
  );
});

describe('intervaloDeAtualizacao', () => {
  it.each([
    ['pregão aberto', '2026-10-27T17:00:00Z', 5],
    ['leilão', '2026-10-27T20:10:00Z', 5],
    ['fechado', '2026-10-27T23:00:00Z', 60],
    ['dia seguinte, 30 min antes da abertura projetada', '2026-10-28T12:30:00Z', 15],
    ['dia seguinte, primeiros 30 min após a abertura projetada', '2026-10-28T13:10:00Z', 5],
    ['dia seguinte, sem confirmação depois disso (feriado)', '2026-10-28T13:30:00Z', 15],
  ])('%s: %s min', (_caso, instante, minutos) => {
    expect(intervaloDeAtualizacao(PREGAO, em(instante))).toBe(minutos * MINUTO);
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
