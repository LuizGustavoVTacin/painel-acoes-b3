import { describe, expect, it } from 'vitest';
import { contarColunas, moverComSeta, vizinhos } from './vizinhos';

// Grade de 10 quadrados em 4 colunas:
//  0  1  2  3
//  4  5  6  7
//  8  9
const ordenar = (lista: number[]) => [...lista].sort((a, b) => a - b);

describe('vizinhos', () => {
  it.each([
    ['meio', 5, [1, 4, 6, 9]],
    ['canto superior esquerdo', 0, [1, 4]],
    ['canto superior direito', 3, [2, 7]],
    ['fim de linha não é vizinho do começo da próxima', 7, [3, 6]],
    ['começo de linha não é vizinho do fim da anterior', 4, [0, 5, 8]],
    ['acima de um buraco da última linha', 6, [2, 5, 7]],
    ['último da linha incompleta', 9, [5, 8]],
  ])('%s', (_caso, indice, esperado) => {
    expect(ordenar(vizinhos(indice, 10, 4))).toEqual(esperado);
  });

  it('uma coluna: só acima e abaixo', () => {
    expect(ordenar(vizinhos(1, 3, 1))).toEqual([0, 2]);
  });

  it('um quadrado só: sem vizinhos', () => {
    expect(vizinhos(0, 1, 4)).toEqual([]);
  });

  it.each([
    ['colunas desconhecidas', 5, 10, null],
    ['colunas inválidas', 5, 10, 0],
    ['índice fora da grade', 10, 10, 4],
    ['índice negativo', -1, 10, 4],
    ['grade vazia', 0, 0, 4],
  ])('%s: sem vizinhos', (_caso, indice, total, colunas) => {
    expect(vizinhos(indice, total, colunas)).toEqual([]);
  });
});

describe('moverComSeta', () => {
  it.each([
    ['ArrowRight', 5, 6],
    ['ArrowLeft', 5, 4],
    ['ArrowUp', 5, 1],
    ['ArrowDown', 5, 9],
    ['ArrowRight', 3, 3], // fim da linha: fica
    ['ArrowLeft', 4, 4], // começo da linha: fica
    ['ArrowUp', 2, 2], // primeira linha: fica
    ['ArrowDown', 6, 6], // abaixo não há quadrado: fica
    ['ArrowRight', 9, 9], // último quadrado: fica
    ['Home', 6, 0],
    ['End', 2, 9],
  ])('%s a partir de %s vai para %s', (tecla, indice, esperado) => {
    expect(moverComSeta(indice, tecla, 10, 4)).toBe(esperado);
  });

  it('tecla que não move devolve null', () => {
    expect(moverComSeta(5, 'Enter', 10, 4)).toBeNull();
    expect(moverComSeta(5, 'a', 10, 4)).toBeNull();
  });

  it('sem saber as colunas, esquerda e direita andam em fila; cima e baixo não', () => {
    expect(moverComSeta(3, 'ArrowRight', 10, null)).toBe(4);
    expect(moverComSeta(4, 'ArrowLeft', 10, null)).toBe(3);
    expect(moverComSeta(4, 'ArrowDown', 10, null)).toBe(4);
    expect(moverComSeta(4, 'ArrowUp', 10, null)).toBe(4);
  });

  it('grade vazia: nada a fazer', () => {
    expect(moverComSeta(0, 'ArrowRight', 0, 4)).toBeNull();
  });
});

describe('contarColunas', () => {
  it.each([
    ['150px 150px 150px', 3],
    ['187.5px', 1],
    ['[inicio] 150px [meio] 150px [fim]', 2],
    ['  150px   150px ', 2],
  ])('"%s" → %s', (valor, esperado) => {
    expect(contarColunas(valor)).toBe(esperado);
  });

  it.each(['', 'none', 'repeat(auto-fill, minmax(150px, 1fr))'])(
    '"%s" não é uma lista resolvida',
    (valor) => {
      expect(contarColunas(valor)).toBeNull();
    },
  );
});
