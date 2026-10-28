import type { DatabaseSync } from 'node:sqlite';

/** Executa a função dentro de uma transação; desfaz tudo se ela lançar erro. */
export function emTransacao<T>(banco: DatabaseSync, operacao: () => T): T {
  banco.exec('BEGIN IMMEDIATE');
  try {
    const resultado = operacao();
    banco.exec('COMMIT');
    return resultado;
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  }
}
