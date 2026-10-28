import type { DataISO } from '../../shared/datas.js';
import type { Centavos } from '../../shared/dinheiro.js';
import type { Compra } from '../../shared/posicao.js';
import type { Ticker } from '../../shared/ticker.js';
import type { Banco } from './conexao.js';

/** Dados que o usuário informa ao registrar ou editar uma compra. */
export interface DadosTransacao {
  ticker: Ticker;
  data: DataISO;
  quantidade: number;
  precoUnitario: Centavos;
  taxas: Centavos;
  plataforma: string;
}

export interface Transacao extends DadosTransacao {
  id: number;
  criadoEm: string;
  atualizadoEm: string;
}

interface LinhaTransacao {
  id: number;
  ticker: string;
  data: string;
  quantidade: number;
  preco_unitario_centavos: number;
  taxas_centavos: number;
  plataforma: string;
  criado_em: string;
  atualizado_em: string;
}

const COLUNAS = `id, ticker, data, quantidade, preco_unitario_centavos, taxas_centavos,
  plataforma, criado_em, atualizado_em`;

function paraTransacao(linha: LinhaTransacao): Transacao {
  return {
    id: linha.id,
    ticker: linha.ticker,
    data: linha.data,
    quantidade: linha.quantidade,
    precoUnitario: linha.preco_unitario_centavos,
    taxas: linha.taxas_centavos,
    plataforma: linha.plataforma,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

function parametros(dados: DadosTransacao) {
  return {
    ticker: dados.ticker,
    data: dados.data,
    quantidade: dados.quantidade,
    preco: dados.precoUnitario,
    taxas: dados.taxas,
    plataforma: dados.plataforma,
  };
}

export type RepositorioTransacoes = ReturnType<typeof criarRepositorioTransacoes>;

export function criarRepositorioTransacoes(banco: Banco) {
  const ordem = 'ORDER BY data DESC, id DESC';
  const listarTodas = banco.prepare(`SELECT ${COLUNAS} FROM transacoes ${ordem}`);
  const listarDoTicker = banco.prepare(
    `SELECT ${COLUNAS} FROM transacoes WHERE ticker = ? ${ordem}`,
  );
  const buscarPorId = banco.prepare(`SELECT ${COLUNAS} FROM transacoes WHERE id = ?`);
  const inserir = banco.prepare(
    `INSERT INTO transacoes (ticker, data, quantidade, preco_unitario_centavos, taxas_centavos, plataforma)
     VALUES (:ticker, :data, :quantidade, :preco, :taxas, :plataforma)
     RETURNING ${COLUNAS}`,
  );
  const alterar = banco.prepare(
    `UPDATE transacoes SET ticker = :ticker, data = :data, quantidade = :quantidade,
       preco_unitario_centavos = :preco, taxas_centavos = :taxas, plataforma = :plataforma,
       atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = :id
     RETURNING ${COLUNAS}`,
  );
  const apagar = banco.prepare('DELETE FROM transacoes WHERE id = ?');
  const listarCompras = banco.prepare(
    'SELECT ticker, quantidade, preco_unitario_centavos, taxas_centavos FROM transacoes ORDER BY ticker',
  );

  return {
    listar(ticker?: Ticker): Transacao[] {
      const linhas = ticker === undefined ? listarTodas.all() : listarDoTicker.all(ticker);
      return (linhas as unknown as LinhaTransacao[]).map(paraTransacao);
    },

    buscar(id: number): Transacao | null {
      const linha = buscarPorId.get(id) as LinhaTransacao | undefined;
      return linha ? paraTransacao(linha) : null;
    },

    criar(dados: DadosTransacao): Transacao {
      return paraTransacao(inserir.get(parametros(dados)) as unknown as LinhaTransacao);
    },

    /** Substitui os dados da transação; null se o id não existir. */
    atualizar(id: number, dados: DadosTransacao): Transacao | null {
      const linha = alterar.get({ ...parametros(dados), id }) as LinhaTransacao | undefined;
      return linha ? paraTransacao(linha) : null;
    },

    /** Apaga a transação; false se o id não existir. */
    excluir(id: number): boolean {
      return apagar.run(id).changes > 0;
    },

    /** Compras agrupadas por ticker, prontas para calcularPosicao. */
    comprasPorTicker(): Map<Ticker, Compra[]> {
      const compras = new Map<Ticker, Compra[]>();
      const linhas = listarCompras.all() as unknown as Pick<
        LinhaTransacao,
        'ticker' | 'quantidade' | 'preco_unitario_centavos' | 'taxas_centavos'
      >[];
      for (const linha of linhas) {
        const lista = compras.get(linha.ticker) ?? [];
        lista.push({
          quantidade: linha.quantidade,
          precoUnitario: linha.preco_unitario_centavos,
          taxas: linha.taxas_centavos,
        });
        compras.set(linha.ticker, lista);
      }
      return compras;
    },
  };
}
