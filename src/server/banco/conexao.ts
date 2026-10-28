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
