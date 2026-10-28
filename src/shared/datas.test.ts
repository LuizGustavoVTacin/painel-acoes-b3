import { describe, expect, it } from 'vitest';
import { formatarData, formatarHorario, lerDataBR } from './datas.js';

describe('formatarData', () => {
  it.each([
    ['2026-10-27', '27/10/2026'],
    ['2026-01-05', '05/01/2026'],
    ['2024-02-29', '29/02/2024'],
    ['2000-02-29', '29/02/2000'],
  ])('%s → %s', (iso, br) => {
    expect(formatarData(iso)).toBe(br);
  });

  it.each([
    '',
    '27/10/2026',
    '2026-13-01',
    '2026-00-10',
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-10-00',
    '2026-1-5',
    '1899-12-31',
    '2026-10-27T10:00:00Z',
  ])('recusa "%s"', (iso) => {
    expect(() => formatarData(iso)).toThrow(RangeError);
  });
});

describe('lerDataBR', () => {
  it.each([
    ['27/10/2026', '2026-10-27'],
    ['1/2/2026', '2026-02-01'],
    [' 05/01/2026 ', '2026-01-05'],
    ['29/02/2024', '2024-02-29'],
    ['31/12/1999', '1999-12-31'],
  ])('"%s" → %s', (texto, iso) => {
    expect(lerDataBR(texto)).toBe(iso);
  });

  it.each([
    '',
    '2026-10-27',
    '31/02/2026',
    '29/02/2026',
    '31/04/2026',
    '00/10/2026',
    '10/13/2026',
    '27/10/26',
    '27-10-2026',
    '123/10/2026',
    'hoje',
  ])('recusa "%s"', (texto) => {
    expect(() => lerDataBR(texto)).toThrow(RangeError);
  });

  it('é o inverso de formatarData', () => {
    for (const iso of ['2026-10-27', '2024-02-29', '1999-01-01']) {
      expect(lerDataBR(formatarData(iso))).toBe(iso);
    }
  });
});

describe('formatarHorario', () => {
  it('mostra o horário de Brasília (UTC-3)', () => {
    expect(formatarHorario('2026-10-27T17:35:00Z')).toBe('27/10/2026 14:35');
  });

  it('vira o dia conforme o fuso de Brasília, não o UTC', () => {
    expect(formatarHorario('2026-10-28T02:10:00Z')).toBe('27/10/2026 23:10');
  });

  it('usa 00 para meia-noite (relógio de 24 horas)', () => {
    expect(formatarHorario('2026-10-28T03:00:00Z')).toBe('28/10/2026 00:00');
  });

  it('aceita Date e milissegundos', () => {
    const instante = Date.UTC(2026, 0, 5, 12, 7);
    expect(formatarHorario(instante)).toBe('05/01/2026 09:07');
    expect(formatarHorario(new Date(instante))).toBe('05/01/2026 09:07');
  });

  it.each(['', 'ontem', NaN])('recusa %j', (instante) => {
    expect(() => formatarHorario(instante)).toThrow(RangeError);
  });
});
