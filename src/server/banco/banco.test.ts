import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirBanco, fecharBanco, type Banco } from './conexao.js';
import { emTransacao } from './emTransacao.js';
import { LIMITE_ACOES_SELECIONADAS } from '../../shared/selecao.js';
import { aplicarMigracoes, VERSAO_ATUAL } from './migracoes.js';
import { criarRepositorioSelecao } from './selecao.js';
import { criarRepositorioTransacoes, type DadosTransacao } from './transacoes.js';
import { criarRepositorioUsoApi } from './usoApi.js';

const compraBBAS3: DadosTransacao = {
  ticker: 'BBAS3',
  data: '2026-10-20',
  quantidade: 100,
  precoUnitario: 2750,
  taxas: 490,
  plataforma: 'Itaú Íon',
};

/** Gera n tickers válidos e distintos: AAAA1, AAAB1, … */
function tickers(quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => {
    const letra = (n: number) => String.fromCharCode(65 + n);
    return `AA${letra(Math.floor(i / 26) % 26)}${letra(i % 26)}3`;
  });
}

let banco: Banco;

beforeEach(() => {
  banco = abrirBanco(':memory:');
});

afterEach(() => {
  if (banco.isOpen) banco.close();
});

describe('migrações', () => {
  let pasta: string;

  beforeEach(() => {
    pasta = mkdtempSync(path.join(tmpdir(), 'dashboard-banco-'));
  });

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  it('cria as tabelas e registra a versão', () => {
    const { user_version } = banco.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    const tabelas = (
      banco.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((t) => t.name);

    expect(user_version).toBe(VERSAO_ATUAL);
    expect(tabelas).toEqual([
      'acoes_selecionadas',
      'catalogo',
      'cotacoes',
      'estado_api',
      'logos',
      'pregao',
      'transacoes',
      'uso_api',
    ]);
  });

  it('mantém os dados ao fechar e reabrir o arquivo, sem reaplicar migrações', () => {
    const arquivo = path.join(pasta, 'dados.db');
    const primeiro = abrirBanco(arquivo);
    criarRepositorioTransacoes(primeiro).criar(compraBBAS3);
    criarRepositorioSelecao(primeiro).substituir(['BBAS3', 'PETR4']);
    primeiro.close();

    const segundo = abrirBanco(arquivo);
    expect(criarRepositorioTransacoes(segundo).listar()).toHaveLength(1);
    expect(criarRepositorioSelecao(segundo).listar()).toEqual(['BBAS3', 'PETR4']);
    segundo.close();
  });

  it('faz backup do banco antes de aplicar migrações novas a dados existentes', () => {
    const arquivo = path.join(pasta, 'dados.db');
    const banco = new DatabaseSync(arquivo);
    aplicarMigracoes(banco, ['CREATE TABLE t (x INTEGER) STRICT']);
    banco.exec('INSERT INTO t VALUES (42)');

    aplicarMigracoes(banco, ['CREATE TABLE t (x INTEGER) STRICT', 'ALTER TABLE t ADD y INTEGER']);
    banco.close();

    const backups = readdirSync(pasta).filter((nome) => nome.startsWith('dados.db.bak-v1-'));
    expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(path.join(pasta, backups[0]));
    expect(backup.prepare('SELECT * FROM t').all()).toEqual([{ x: 42 }]);
    expect(backup.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    backup.close();
  });

  it('cria um backup novo a cada tentativa, sem reaproveitar um antigo', async () => {
    const arquivo = path.join(pasta, 'dados.db');
    const banco = new DatabaseSync(arquivo);
    aplicarMigracoes(banco, ['CREATE TABLE t (x INTEGER) STRICT']);
    const migracaoQueFalha = ['CREATE TABLE t (x INTEGER) STRICT', 'SINTAXE INVÁLIDA'];

    expect(() => aplicarMigracoes(banco, migracaoQueFalha)).toThrow();
    banco.exec('INSERT INTO t VALUES (7)'); // dado novo depois da primeira tentativa
    await new Promise((resolver) => setTimeout(resolver, 5));
    expect(() => aplicarMigracoes(banco, migracaoQueFalha)).toThrow();
    banco.close();

    const backups = readdirSync(pasta)
      .filter((nome) => nome.includes('.bak-v1-'))
      .sort();
    expect(backups).toHaveLength(2);
    const maisRecente = new DatabaseSync(path.join(pasta, backups[1]));
    expect(maisRecente.prepare('SELECT * FROM t').all()).toEqual([{ x: 7 }]);
    maisRecente.close();
  });

  it('não faz backup de um banco novo (versão 0)', () => {
    abrirBanco(path.join(pasta, 'novo.db')).close();

    expect(readdirSync(pasta).filter((nome) => nome.includes('.bak-'))).toEqual([]);
  });

  it('deixa o banco intacto se uma migração falhar', () => {
    const banco = new DatabaseSync(':memory:');
    aplicarMigracoes(banco, ['CREATE TABLE t (x INTEGER) STRICT']);

    expect(() =>
      aplicarMigracoes(banco, [
        'CREATE TABLE t (x INTEGER) STRICT',
        'CREATE TABLE nova (y INTEGER) STRICT',
        'SINTAXE INVÁLIDA',
      ]),
    ).toThrow();
    const tabelas = banco.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tabelas).toEqual([{ name: 't' }]);
    expect(banco.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    banco.close();
  });

  it('recusa abrir um banco criado por uma versão mais nova do app', () => {
    const arquivo = path.join(pasta, 'futuro.db');
    const banco = abrirBanco(arquivo);
    banco.exec(`PRAGMA user_version = ${VERSAO_ATUAL + 1}`);
    banco.close();

    expect(() => abrirBanco(arquivo)).toThrow(/mais nova que este app/);
  });
});

describe('regras do próprio banco', () => {
  const inserirBruto = (valores: Partial<Record<string, unknown>>) => {
    const linha = {
      ticker: 'BBAS3',
      data: '2026-10-20',
      quantidade: 1,
      preco: 100,
      taxas: 0,
      plataforma: 'BTG',
      ...valores,
    };
    banco
      .prepare(
        `INSERT INTO transacoes (ticker, data, quantidade, preco_unitario_centavos, taxas_centavos, plataforma)
         VALUES (:ticker, :data, :quantidade, :preco, :taxas, :plataforma)`,
      )
      .run(linha as Record<string, string | number>);
  };

  it.each(['BBAS3', 'TAEE11', 'B3SA3'])('aceita o ticker %s', (ticker) => {
    expect(() => inserirBruto({ ticker })).not.toThrow();
  });

  it.each([
    ['ticker inválido', { ticker: 'bbas3' }],
    ['ticker fracionário', { ticker: 'BBAS3F' }],
    ['ticker começando com dígito', { ticker: '3BSA3' }],
    ['data inexistente', { data: '2026-02-30' }],
    ['data em outro formato', { data: '20/10/2026' }],
    ['quantidade zero', { quantidade: 0 }],
    ['preço zero', { preco: 0 }],
    ['preço com centavos fracionados', { preco: 10.5 }],
    ['taxa negativa', { taxas: -1 }],
    ['plataforma vazia', { plataforma: '' }],
    ['plataforma longa', { plataforma: 'x'.repeat(41) }],
  ])('recusa %s', (_caso, valores) => {
    expect(() => inserirBruto(valores)).toThrow();
  });

  it(`impede mais de ${LIMITE_ACOES_SELECIONADAS} ações selecionadas`, () => {
    const inserir = banco.prepare('INSERT INTO acoes_selecionadas (ticker, ordem) VALUES (?, ?)');
    tickers(LIMITE_ACOES_SELECIONADAS).forEach((t, i) => inserir.run(t, i));

    expect(() => inserir.run('ZZZZ3', 99)).toThrow(/Limite de 50/);
  });
});

describe('emTransacao', () => {
  it('desfaz tudo se a operação falhar', () => {
    const selecao = criarRepositorioSelecao(banco);
    selecao.substituir(['BBAS3']);

    expect(() =>
      emTransacao(banco, () => {
        banco.exec('DELETE FROM acoes_selecionadas');
        throw new Error('falha no meio');
      }),
    ).toThrow('falha no meio');
    expect(selecao.listar()).toEqual(['BBAS3']);
    expect(banco.isTransaction).toBe(false);
  });

  it('preserva o erro original quando o SQLite já desfez a transação sozinho', () => {
    banco.exec('CREATE TEMP TABLE t (x INTEGER NOT NULL ON CONFLICT ROLLBACK)');

    expect(() => emTransacao(banco, () => banco.exec('INSERT INTO t VALUES (NULL)'))).toThrow(
      /NOT NULL constraint failed/,
    );
    expect(banco.isTransaction).toBe(false);
  });
});

describe('fecharBanco', () => {
  it('grava o WAL no arquivo principal e remove os arquivos auxiliares', () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'dashboard-fechar-'));
    try {
      const arquivo = path.join(pasta, 'dados.db');
      const aberto = abrirBanco(arquivo);
      criarRepositorioSelecao(aberto).substituir(['BBAS3']);

      fecharBanco(aberto);
      fecharBanco(aberto); // fechar de novo não deve falhar

      expect(aberto.isOpen).toBe(false);
      expect(existsSync(`${arquivo}-wal`)).toBe(false);
      const somenteArquivoPrincipal = new DatabaseSync(arquivo, { readOnly: true });
      expect(
        somenteArquivoPrincipal.prepare('SELECT ticker FROM acoes_selecionadas').all(),
      ).toEqual([{ ticker: 'BBAS3' }]);
      somenteArquivoPrincipal.close();
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});

describe('repositório de transações', () => {
  it('cria e devolve a transação com id e datas de controle', () => {
    const criada = criarRepositorioTransacoes(banco).criar(compraBBAS3);

    expect(criada).toMatchObject({ id: 1, ...compraBBAS3 });
    expect(criada.criadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(criada.atualizadoEm).toBe(criada.criadoEm);
  });

  it('lista da mais recente para a mais antiga, com filtro opcional por ticker', () => {
    const repositorio = criarRepositorioTransacoes(banco);
    const antiga = repositorio.criar({ ...compraBBAS3, data: '2026-01-10' });
    const nova = repositorio.criar({ ...compraBBAS3, data: '2026-05-10' });
    const petr = repositorio.criar({ ...compraBBAS3, ticker: 'PETR4', data: '2026-03-01' });
    const mesmoDia = repositorio.criar({ ...compraBBAS3, data: '2026-05-10' });

    expect(repositorio.listar().map((t) => t.id)).toEqual([
      mesmoDia.id,
      nova.id,
      petr.id,
      antiga.id,
    ]);
    expect(repositorio.listar('PETR4').map((t) => t.id)).toEqual([petr.id]);
    expect(repositorio.listar('VALE3')).toEqual([]);
  });

  it('busca por id', () => {
    const repositorio = criarRepositorioTransacoes(banco);
    const criada = repositorio.criar(compraBBAS3);

    expect(repositorio.buscar(criada.id)).toEqual(criada);
    expect(repositorio.buscar(999)).toBeNull();
  });

  it('atualiza todos os campos e a data de atualização', async () => {
    const repositorio = criarRepositorioTransacoes(banco);
    const criada = repositorio.criar(compraBBAS3);
    await new Promise((resolver) => setTimeout(resolver, 5));

    const novosDados = { ...compraBBAS3, quantidade: 50, plataforma: 'BTG', taxas: 0 };
    const atualizada = repositorio.atualizar(criada.id, novosDados);

    expect(atualizada).toMatchObject({ id: criada.id, ...novosDados, criadoEm: criada.criadoEm });
    expect(atualizada!.atualizadoEm > criada.atualizadoEm).toBe(true);
    expect(repositorio.atualizar(999, novosDados)).toBeNull();
  });

  it('exclui e informa se o id existia', () => {
    const repositorio = criarRepositorioTransacoes(banco);
    const criada = repositorio.criar(compraBBAS3);

    expect(repositorio.excluir(criada.id)).toBe(true);
    expect(repositorio.excluir(criada.id)).toBe(false);
    expect(repositorio.listar()).toEqual([]);
  });

  it('agrupa as compras por ticker', () => {
    const repositorio = criarRepositorioTransacoes(banco);
    repositorio.criar(compraBBAS3);
    repositorio.criar({ ...compraBBAS3, quantidade: 10, precoUnitario: 3000, taxas: 0 });
    repositorio.criar({ ...compraBBAS3, ticker: 'PETR4', quantidade: 5, precoUnitario: 3800 });

    expect(Object.fromEntries(repositorio.comprasPorTicker())).toEqual({
      BBAS3: [
        { quantidade: 100, precoUnitario: 2750, taxas: 490 },
        { quantidade: 10, precoUnitario: 3000, taxas: 0 },
      ],
      PETR4: [{ quantidade: 5, precoUnitario: 3800, taxas: 490 }],
    });
  });
});

describe('repositório da seleção', () => {
  it('começa vazio e guarda a ordem escolhida', () => {
    const selecao = criarRepositorioSelecao(banco);
    expect(selecao.listar()).toEqual([]);

    selecao.substituir(['VALE3', 'BBAS3', 'PETR4']);
    expect(selecao.listar()).toEqual(['VALE3', 'BBAS3', 'PETR4']);

    selecao.substituir(['PETR4']);
    expect(selecao.listar()).toEqual(['PETR4']);

    selecao.substituir([]);
    expect(selecao.listar()).toEqual([]);
  });

  it(`aceita exatamente ${LIMITE_ACOES_SELECIONADAS} ações`, () => {
    const selecao = criarRepositorioSelecao(banco);
    selecao.substituir(tickers(LIMITE_ACOES_SELECIONADAS));

    expect(selecao.listar()).toHaveLength(LIMITE_ACOES_SELECIONADAS);
  });

  it('mantém a seleção anterior se a nova passar do limite', () => {
    const selecao = criarRepositorioSelecao(banco);
    selecao.substituir(['BBAS3']);

    expect(() => selecao.substituir(tickers(LIMITE_ACOES_SELECIONADAS + 1))).toThrow();
    expect(selecao.listar()).toEqual(['BBAS3']);
  });
});

describe('repositório de uso de API', () => {
  it('soma as requisições por provedor e mês', () => {
    const uso = criarRepositorioUsoApi(banco);
    expect(uso.consultar('brapi', '2026-10')).toBe(0);

    uso.registrar('brapi', '2026-10');
    uso.registrar('brapi', '2026-10', 3);
    uso.registrar('brapi', '2026-11');
    uso.registrar('yahoo', '2026-10');

    expect(uso.consultar('brapi', '2026-10')).toBe(4);
    expect(uso.consultar('brapi', '2026-11')).toBe(1);
    expect(uso.consultar('yahoo', '2026-10')).toBe(1);
  });

  it.each([0, -1, 1.5])('recusa registrar %s requisições', (quantidade) => {
    expect(() => criarRepositorioUsoApi(banco).registrar('brapi', '2026-10', quantidade)).toThrow(
      RangeError,
    );
  });

  it('recusa mês fora do formato AAAA-MM', () => {
    expect(() => criarRepositorioUsoApi(banco).registrar('brapi', '10/2026')).toThrow();
  });
});
