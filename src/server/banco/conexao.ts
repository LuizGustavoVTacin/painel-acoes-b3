import { DatabaseSync } from 'node:sqlite';
import { aplicarMigracoes } from './migracoes.js';

export type Banco = DatabaseSync;

/** Abre (ou cria) o banco SQLite e aplica as migrações pendentes. Use ':memory:' nos testes. */
export function abrirBanco(arquivo: string): Banco {
  const banco = new DatabaseSync(arquivo);
  try {
    banco.exec('PRAGMA journal_mode = WAL');
    banco.exec('PRAGMA foreign_keys = ON');
    banco.exec('PRAGMA busy_timeout = 5000');
    aplicarMigracoes(banco);
    return banco;
  } catch (erro) {
    // Sem fechar, o arquivo continuaria travado no Windows.
    banco.close();
    throw erro;
  }
}

/**
 * Fecha o banco gravando no arquivo principal tudo o que estava no WAL, para que
 * dados.db fique completo mesmo que só ele seja copiado.
 */
export function fecharBanco(banco: Banco): void {
  if (!banco.isOpen) return;
  try {
    banco.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    // Mesmo que o checkpoint falhe, o banco precisa ser fechado (os dados já estão no WAL).
    banco.close();
  }
}
