/**
 * Geometria da grade: a posição de um quadrado é o índice na lista, e a linha muda a cada
 * `colunas` quadrados. Sem "dar a volta": o fim de uma linha não é vizinho do começo da próxima.
 */

/** Índices dos vizinhos de cima, de baixo, da esquerda e da direita (só os que existem). */
export function vizinhos(indice: number, total: number, colunas: number | null): number[] {
  if (colunas === null || colunas < 1 || indice < 0 || indice >= total) return [];
  const resultado: number[] = [];
  const coluna = indice % colunas;
  if (indice - colunas >= 0) resultado.push(indice - colunas);
  if (indice + colunas < total) resultado.push(indice + colunas);
  if (coluna > 0) resultado.push(indice - 1);
  if (coluna < colunas - 1 && indice + 1 < total) resultado.push(indice + 1);
  return resultado;
}

/**
 * Para onde o foco vai com uma tecla; null se a tecla não move o destaque.
 * Na borda, fica onde está. Sem saber as colunas, só esquerda e direita andam, em fila.
 */
export function moverComSeta(
  indice: number,
  tecla: string,
  total: number,
  colunas: number | null,
): number | null {
  if (total === 0) return null;
  const linhaUnica = colunas === null || colunas < 1;
  const coluna = linhaUnica ? indice : indice % colunas;
  switch (tecla) {
    case 'ArrowLeft':
      return coluna > 0 ? indice - 1 : indice;
    case 'ArrowRight':
      return (linhaUnica || coluna < colunas - 1) && indice + 1 < total ? indice + 1 : indice;
    case 'ArrowUp':
      return !linhaUnica && indice - colunas >= 0 ? indice - colunas : indice;
    case 'ArrowDown':
      return !linhaUnica && indice + colunas < total ? indice + colunas : indice;
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}

/**
 * Conta as colunas a partir do valor calculado de grid-template-columns
 * ("150px 150px 150px"); null se o valor não for uma lista de trilhas já resolvida.
 */
export function contarColunas(gridTemplateColumns: string): number | null {
  const semNomes = gridTemplateColumns.replace(/\[[^\]]*\]/g, ' ').trim();
  if (!semNomes || semNomes === 'none' || semNomes.includes('(')) return null;
  return semNomes.split(/\s+/).length;
}
