import { describe, expect, it } from 'vitest';
import {
  calcularPosicao,
  calcularVariacao,
  formatarPercentual,
  type Compra,
  type Posicao,
} from './posicao.js';

const compra = (quantidade: number, precoUnitario: number, taxas = 0): Compra => ({
  quantidade,
  precoUnitario,
  taxas,
});

describe('calcularPosicao', () => {
  it('devolve null quando não há compras', () => {
    expect(calcularPosicao([])).toBeNull();
  });

  it('com uma compra sem taxas, o preço médio é o preço pago', () => {
    expect(calcularPosicao([compra(100, 2750)])).toEqual({
      quantidadeTotal: 100,
      custoTotal: 275000,
      precoMedio: 2750,
    });
  });

  it('inclui as taxas no custo e no preço médio', () => {
    // (10 × R$ 20,00 + R$ 5,00) / 10 = R$ 20,50
    expect(calcularPosicao([compra(10, 2000, 500)])).toEqual({
      quantidadeTotal: 10,
      custoTotal: 20500,
      precoMedio: 2050,
    });
  });

  it('pondera várias compras pela quantidade', () => {
    // (100 × 10,00 + 1,00) + (50 × 13,00 + 0,50) = 1.651,50 / 150 = 11,01
    const posicao = calcularPosicao([compra(100, 1000, 100), compra(50, 1300, 50)]);

    expect(posicao).toEqual({ quantidadeTotal: 150, custoTotal: 165150, precoMedio: 1101 });
  });

  it('arredonda o preço médio ao centavo mais próximo (meio para cima)', () => {
    // 1000 / 3 = 333,33… → 333
    expect(calcularPosicao([compra(3, 333, 1)])?.precoMedio).toBe(333);
    // 1001 / 2 = 500,5 → 501
    expect(calcularPosicao([compra(2, 500, 1)])?.precoMedio).toBe(501);
    // 2000 / 3 = 666,66… → 667
    expect(calcularPosicao([compra(3, 666, 2)])?.precoMedio).toBe(667);
  });

  it.each([
    ['quantidade zero', compra(0, 1000)],
    ['quantidade negativa', compra(-1, 1000)],
    ['quantidade fracionada', compra(1.5, 1000)],
    ['preço zero', compra(1, 0)],
    ['preço negativo', compra(1, -100)],
    ['preço fracionado', compra(1, 10.5)],
    ['taxa negativa', compra(1, 1000, -1)],
    ['taxa fracionada', compra(1, 1000, 0.5)],
  ])('recusa %s', (_caso, invalida) => {
    expect(() => calcularPosicao([compra(10, 1000), invalida])).toThrow(RangeError);
  });

  it('recusa totais que estouram o limite de inteiros seguros', () => {
    expect(() => calcularPosicao([compra(Number.MAX_SAFE_INTEGER, 100)])).toThrow(RangeError);
  });
});

describe('calcularVariacao', () => {
  const posicao = (custoTotal: number, quantidadeTotal: number): Posicao => ({
    custoTotal,
    quantidadeTotal,
    precoMedio: Math.round(custoTotal / quantidadeTotal),
  });

  it('indica alta com o percentual de ganho', () => {
    // Médio R$ 20,00 → atual R$ 22,47: +12,35%
    expect(calcularVariacao(2247, posicao(2000, 1))).toEqual({
      direcao: 'alta',
      centesimosDePercentual: 1235,
    });
  });

  it('indica baixa com o percentual de perda', () => {
    // Médio R$ 20,00 → atual R$ 18,00: -10,00%
    expect(calcularVariacao(1800, posicao(2000, 1))).toEqual({
      direcao: 'baixa',
      centesimosDePercentual: -1000,
    });
  });

  it('indica neutra quando o preço atual é igual ao médio', () => {
    expect(calcularVariacao(2050, posicao(20500, 10))).toEqual({
      direcao: 'neutra',
      centesimosDePercentual: 0,
    });
  });

  it('compara com o custo exato, não com o preço médio arredondado', () => {
    // Custo 1000 em 3 ações: médio exato 333,33…, exibido como 333.
    // Preço atual 333 está ABAIXO do médio exato, então é baixa, apesar de igual ao exibido.
    const resultado = calcularVariacao(333, posicao(1000, 3));

    expect(resultado.direcao).toBe('baixa');
    expect(resultado.centesimosDePercentual).toBe(-10); // 999/1000 - 1 = -0,10%
  });

  it('arredonda o percentual meio-para-fora, simetricamente', () => {
    // +0,005% → +0,01%; -0,005% → -0,01%
    expect(calcularVariacao(20001, posicao(20000, 1)).centesimosDePercentual).toBe(1);
    expect(calcularVariacao(19999, posicao(20000, 1)).centesimosDePercentual).toBe(-1);
  });

  it('mantém a direção mesmo quando o percentual arredondado é zero', () => {
    const resultado = calcularVariacao(1000001, posicao(1000000, 1));

    expect(resultado).toEqual({ direcao: 'alta', centesimosDePercentual: 0 });
  });

  it('preço atual zero significa perda total', () => {
    expect(calcularVariacao(0, posicao(2000, 1))).toEqual({
      direcao: 'baixa',
      centesimosDePercentual: -10000,
    });
  });

  it('funciona junto com calcularPosicao', () => {
    const consolidada = calcularPosicao([compra(100, 1000, 100), compra(50, 1300, 50)])!;

    // Custo 1.651,50; valor atual 150 × 12,00 = 1.800,00 → +8,99%
    expect(calcularVariacao(1200, consolidada)).toEqual({
      direcao: 'alta',
      centesimosDePercentual: 899,
    });
  });

  it.each([-1, 10.5, NaN])('recusa preço atual %s', (precoAtual) => {
    expect(() => calcularVariacao(precoAtual, posicao(2000, 1))).toThrow(RangeError);
  });
});

describe('formatarPercentual', () => {
  it.each([
    [1234, '+12,34%'],
    [-567, '-5,67%'],
    [0, '0,00%'],
    [1, '+0,01%'],
    [-10, '-0,10%'],
    [10000, '+100,00%'],
    [-10000, '-100,00%'],
    [123456, '+1.234,56%'],
  ])('%s → "%s"', (centesimos, texto) => {
    expect(formatarPercentual(centesimos)).toBe(texto);
  });

  it('recusa valores que não são inteiros', () => {
    expect(() => formatarPercentual(12.5)).toThrow(RangeError);
  });
});
