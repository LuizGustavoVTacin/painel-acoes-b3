import type { DatabaseSync } from 'node:sqlite';
import { LIMITE_ACOES_SELECIONADAS } from '../../shared/selecao.js';
import { emTransacao } from './emTransacao.js';

const RAIZ_TICKER = '[A-Z][A-Z0-9][A-Z0-9][A-Z0-9]';
const TICKER_VALIDO = `(ticker GLOB '${RAIZ_TICKER}[0-9]' OR ticker GLOB '${RAIZ_TICKER}[0-9][0-9]')`;
const AGORA_ISO = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/**
 * Migrações em ordem. A posição no array é a versão (PRAGMA user_version).
 * Nunca altere uma migração já publicada: acrescente uma nova no fim.
 * Todas rodam dentro de uma transação, onde PRAGMA foreign_keys não tem efeito:
 * uma migração que reconstrua tabelas com chaves estrangeiras precisa tratar disso.
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
  `
  CREATE TABLE catalogo (
    ticker TEXT PRIMARY KEY CHECK ${TICKER_VALIDO},
    nome TEXT NOT NULL,
    logo_url TEXT,
    preco_centavos INTEGER CHECK (preco_centavos > 0),
    atualizado_em TEXT NOT NULL
  ) STRICT;

  CREATE TABLE logos (
    ticker TEXT PRIMARY KEY CHECK ${TICKER_VALIDO},
    conteudo BLOB,
    tipo TEXT,
    etag TEXT,
    verificado_em TEXT NOT NULL,
    CHECK ((conteudo IS NULL) = (tipo IS NULL))
  ) STRICT;

  CREATE TABLE estado_api (
    provedor TEXT PRIMARY KEY,
    situacao TEXT NOT NULL CHECK (situacao IN ('ok', 'instavel', 'bloqueada', 'formato_alterado')),
    mensagem TEXT,
    desde TEXT NOT NULL,
    ultima_tentativa TEXT NOT NULL,
    ultimo_sucesso TEXT,
    proxima_tentativa TEXT
  ) STRICT;
  `,
  `
  -- Último preço conhecido de cada ação, para nunca ficar sem dado se uma API falhar.
  CREATE TABLE cotacoes (
    ticker TEXT PRIMARY KEY CHECK ${TICKER_VALIDO},
    preco_centavos INTEGER NOT NULL CHECK (preco_centavos > 0),
    fonte TEXT NOT NULL CHECK (fonte IN ('yahoo', 'brapi')),
    negociado_em TEXT,
    atualizado_em TEXT NOT NULL
  ) STRICT;

  -- Horário do pregão regular mais recente informado pelo Yahoo (uma única linha).
  CREATE TABLE pregao (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    inicio TEXT NOT NULL,
    fim TEXT NOT NULL,
    CHECK (inicio < fim)
  ) STRICT;
  `,
  `
  ALTER TABLE catalogo ADD COLUMN setor TEXT;
  -- Variação do dia em centésimos de ponto percentual (-668 = -6,68%).
  ALTER TABLE catalogo ADD COLUMN variacao_centesimos INTEGER;

  -- Momento da última lista da brapi de tamanho normal (uma única linha). Ações que não vieram
  -- nela saíram da bolsa e deixam de ser oferecidas no menu.
  CREATE TABLE catalogo_lista (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    completa_em TEXT NOT NULL
  ) STRICT;
  `,
];

export const VERSAO_ATUAL = MIGRACOES.length;

function lerVersao(banco: DatabaseSync): number {
  return (banco.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function garantirVersaoSuportada(versao: number, versaoDoApp: number): void {
  if (versao > versaoDoApp) {
    throw new Error(
      `O banco está na versão ${versao}, mais nova que este app (${versaoDoApp}). Atualize o app.`,
    );
  }
}

/**
 * Copia o banco para "<arquivo>.bak-v<versão>-<data e hora>" antes de migrar dados que já
 * existem. O carimbo de tempo garante que cada tentativa guarda os dados daquele momento.
 */
function fazerBackup(banco: DatabaseSync, versao: number): void {
  const arquivo = banco.location();
  if (!arquivo) return; // banco em memória
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  banco.prepare('VACUUM INTO ?').run(`${arquivo}.bak-v${versao}-${carimbo}`);
}

/**
 * Aplica, numa única transação, as migrações que o banco ainda não tem.
 * Se qualquer uma falhar, o banco fica exatamente como estava.
 */
export function aplicarMigracoes(banco: DatabaseSync, migracoes: readonly string[] = MIGRACOES) {
  const versaoDoApp = migracoes.length;
  const versao = lerVersao(banco);
  garantirVersaoSuportada(versao, versaoDoApp);
  if (versao === versaoDoApp) return;
  if (versao > 0) fazerBackup(banco, versao);

  emTransacao(banco, () => {
    // Relida dentro da transação: outro processo pode ter migrado enquanto esperávamos o bloqueio.
    const versaoAtual = lerVersao(banco);
    garantirVersaoSuportada(versaoAtual, versaoDoApp);
    for (let indice = versaoAtual; indice < versaoDoApp; indice++) {
      banco.exec(migracoes[indice]);
    }
    banco.exec(`PRAGMA user_version = ${versaoDoApp}`);
  });
}
