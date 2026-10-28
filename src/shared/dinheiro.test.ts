import { describe, expect, it } from 'vitest';
import {
  agruparMilhares,
  formatarBRL,
  garantirCentavos,
  reaisParaCentavos,
  textoParaCentavos,
} from './dinheiro.js';

describe('garantirCentavos', () => {
  it('aceita inteiros seguros, inclusive zero e negativos', () => {
    expect(garantirCentavos(0)).toBe(0);
    expect(garantirCentavos(123456)).toBe(123456);
    expect(garantirCentavos(-5)).toBe(-5);
  });

  it.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('recusa %s', (valor) => {
    expect(() => garantirCentavos(valor, 'preco')).toThrow(RangeError);
    expect(() => garantirCentavos(valor, 'preco')).toThrow(/preco/);
  });
});

describe('reaisParaCentavos', () => {
  it.each([
    [0, 0],
    [12.34, 1234],
    [27.9, 2790],
    [0.01, 1],
    [1234567.89, 123456789],
    // Casos em que a multiplicação em ponto flutuante erra sem tratamento:
    [1.005, 101],
    [0.285, 29],
    [8.675, 868],
    [19.99, 1999],
    [0.1 + 0.2, 30],
    // Mais de duas casas: arredonda ao centavo mais próximo.
    [12.344, 1234],
    [12.345, 1235],
    [-1.005, -101],
  ])('%s reais → %s centavos', (reais, centavos) => {
    expect(reaisParaCentavos(reais)).toBe(centavos);
  });

  it('não devolve -0 para valores negativos minúsculos', () => {
    expect(Object.is(reaisParaCentavos(-0.001), 0)).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, 1e20])('recusa %s', (reais) => {
    expect(() => reaisParaCentavos(reais)).toThrow(RangeError);
  });
});

describe('textoParaCentavos', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234,5', 123450],
    ['0,01', 1],
    ['0,5', 50],
    ['10', 1000],
    ['1.234', 123400],
    ['1.234.567,89', 123456789],
    ['R$ 1.234,56', 123456],
    ['R$1,00', 100],
    ['r$ 2,50', 250],
    ['R$ 3,00', 300],
    ['  42,00  ', 4200],
    ['0', 0],
  ])('"%s" → %s', (texto, centavos) => {
    expect(textoParaCentavos(texto)).toBe(centavos);
  });

  it.each([
    '',
    '   ',
    'abc',
    '1,234',
    '12,345',
    '1.23,45',
    '1234.56',
    '1.2345,00',
    '-10,00',
    '10,',
    ',50',
    '1 234,56',
    '10R$',
    'R$',
    '99999999999999999,99',
  ])('recusa "%s"', (texto) => {
    expect(() => textoParaCentavos(texto)).toThrow(RangeError);
  });
});

describe('agruparMilhares', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1.000'],
    ['1234567', '1.234.567'],
  ])('"%s" → "%s"', (digitos, esperado) => {
    expect(agruparMilhares(digitos)).toBe(esperado);
  });
});

describe('formatarBRL', () => {
  it.each([
    [0, 'R$ 0,00'],
    [1, 'R$ 0,01'],
    [50, 'R$ 0,50'],
    [100, 'R$ 1,00'],
    [123456, 'R$ 1.234,56'],
    [100000, 'R$ 1.000,00'],
    [123456789, 'R$ 1.234.567,89'],
    [-5, '-R$ 0,05'],
    [-123456, '-R$ 1.234,56'],
    [Number.MAX_SAFE_INTEGER, 'R$ 90.071.992.547.409,91'],
  ])('%s → "%s"', (centavos, texto) => {
    expect(formatarBRL(centavos)).toBe(texto);
  });

  it('é o inverso de textoParaCentavos', () => {
    for (const centavos of [0, 7, 99, 100, 123456, 987654321]) {
      expect(textoParaCentavos(formatarBRL(centavos))).toBe(centavos);
    }
  });

  it('recusa valores que não são centavos inteiros', () => {
    expect(() => formatarBRL(12.5)).toThrow(RangeError);
  });
});
