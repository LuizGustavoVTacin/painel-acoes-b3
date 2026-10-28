import type { DatabaseSync } from 'node:sqlite';
import { emTransacao } from './emTransacao.js';

export const LIMITE_ACOES_SELECIONADAS = 50;

const TICKER_VALIDO = `(ticker GLOB '[A-Z][A-Z][A-Z][A-Z][0-9]' OR ticker GLOB '[A-Z][A-Z][A-Z][A-Z][0-9][0-9]')`;
const AGORA_ISO = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/**
 * Migrações em ordem. A posição no array é a versão (PRAGMA user_version).
 * Nunca altere uma migração já publicada: acrescente uma nova no fim.
 */
const MIGRACOES: readonly string[] = [
  `
  CREATE TABLE transacoes (
    id INTEGER PRIMARY KEY,
    ticker TEXT NOT NULL CHECK ${TICKER_VALIDO},
    data TEXT NOT NULL CHECK (date(data) IS data),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unitario_centavos INTEGER NOT NULL CHECK (preco_unitario_centavos > 0),
    taxas_centavos INTEGER NOT NULL CHECK (taxas_centavos >= 0),
    plataforma TEXT NOT NULL CHECK (length(plataforma) BETWEEN 1 AND 40),
    criado_em TEXT NOT NULL DEFAULT ${AGORA_ISO},
    atualizado_em TEXT NOT NULL DEFAULT ${AGORA_ISO}
  ) STRICT;

  CREATE INDEX idx_transacoes_ticker ON transacoes (ticker);

  CREATE TABLE acoes_selecionadas (
    ticker TEXT PRIMARY KEY CHECK ${TICKER_VALIDO},
    ordem INTEGER NOT NULL
  ) STRICT;

  CREATE TRIGGER limite_acoes_selecionadas
  BEFORE INSERT ON acoes_selecionadas
  WHEN (SELECT count(*) FROM acoes_selecionadas) >= ${LIMITE_ACOES_SELECIONADAS}
  BEGIN
    SELECT RAISE(ABORT, 'Limite de ${LIMITE_ACOES_SELECIONADAS} ações selecionadas');
  END;

  CREATE TABLE uso_api (
    provedor TEXT NOT NULL CHECK (length(provedor) > 0),
    mes TEXT NOT NULL CHECK (mes GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    requisicoes INTEGER NOT NULL CHECK (requisicoes >= 0),
    PRIMARY KEY (provedor, mes)
  ) STRICT;
  `,
];

export const VERSAO_ATUAL = MIGRACOES.length;

/** Aplica, em transação, as migrações que o banco ainda não tem. */
export function aplicarMigracoes(banco: DatabaseSync): void {
  const { user_version: versao } = banco.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (versao > VERSAO_ATUAL) {
    throw new Error(
      `O banco está na versão ${versao}, mais nova que este app (${VERSAO_ATUAL}). Atualize o app.`,
    );
  }

  for (let indice = versao; indice < VERSAO_ATUAL; indice++) {
    emTransacao(banco, () => {
      banco.exec(MIGRACOES[indice]);
      banco.exec(`PRAGMA user_version = ${indice + 1}`);
    });
  }
}
