import type { Centavos } from '../shared/dinheiro.js';
import { hojeEmBrasilia } from '../shared/datas.js';
import type { Ticker } from '../shared/ticker.js';
import type { Banco } from './banco/conexao.js';
import { emTransacao } from './banco/emTransacao.js';
import type { RepositorioUsoApi } from './banco/usoApi.js';
import { buscarListaBrapi } from './externo/brapi.js';
import { ErroFonte } from './externo/erroFonte.js';
import type { EstadoFontes } from './externo/estadoFontes.js';
import { requisitarExterno, type Buscar } from './externo/http.js';

/** A brapi guarda a listagem em cache por 15 minutos; chamar antes disso é desperdício. */
export const INTERVALO_MINIMO_CATALOGO_MS = 15 * 60 * 1000;
/** Cada logo é conferido no máximo uma vez por dia. */
export const VALIDADE_LOGO_MS = 24 * 60 * 60 * 1000;
const LIMITE_LOGO_BYTES = 200 * 1024;
const TIPOS_DE_LOGO = new Set(['image/svg+xml', 'image/png']);

export interface AcaoCatalogo {
  ticker: Ticker;
  nome: string;
}

export interface PrecoCatalogo {
  precoCentavos: Centavos;
  atualizadoEm: string;
}

export interface Logo {
  conteudo: Uint8Array;
  tipo: string;
}

interface LinhaLogo {
  conteudo: Uint8Array | null;
  tipo: string | null;
  etag: string | null;
  verificado_em: string;
}

export interface DependenciasCatalogo {
  banco: Banco;
  buscar: Buscar;
  agora: () => Date;
  estado: EstadoFontes;
  uso: RepositorioUsoApi;
}

/** Remove acentos e caixa para comparar buscas: "Itaú" encontra "ITAU". */
function simplificar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export type ServicoCatalogo = ReturnType<typeof criarServicoCatalogo>;

/** Catálogo de ações, preços de reserva e logos vindos da brapi, guardados no banco. */
export function criarServicoCatalogo({ banco, buscar, agora, estado, uso }: DependenciasCatalogo) {
  const gravarItem = banco.prepare(
    `INSERT INTO catalogo (ticker, nome, logo_url, preco_centavos, atualizado_em)
     VALUES (:ticker, :nome, :logoUrl, :precoCentavos, :agora)
     ON CONFLICT (ticker) DO UPDATE SET nome = excluded.nome, logo_url = excluded.logo_url,
       preco_centavos = excluded.preco_centavos, atualizado_em = excluded.atualizado_em`,
  );
  const listarItens = banco.prepare('SELECT ticker, nome FROM catalogo ORDER BY ticker');
  const buscarPreco = banco.prepare(
    'SELECT preco_centavos, atualizado_em FROM catalogo WHERE ticker = ? AND preco_centavos IS NOT NULL',
  );
  const buscarLogoUrl = banco.prepare('SELECT logo_url FROM catalogo WHERE ticker = ?');
  const buscarLogo = banco.prepare(
    'SELECT conteudo, tipo, etag, verificado_em FROM logos WHERE ticker = ?',
  );
  const gravarLogo = banco.prepare(
    `INSERT INTO logos (ticker, conteudo, tipo, etag, verificado_em)
     VALUES (:ticker, :conteudo, :tipo, :etag, :verificadoEm)
     ON CONFLICT (ticker) DO UPDATE SET conteudo = excluded.conteudo, tipo = excluded.tipo,
       etag = excluded.etag, verificado_em = excluded.verificado_em`,
  );

  let atualizacaoEmAndamento: Promise<void> | null = null;
  const logosEmAndamento = new Map<Ticker, Promise<void>>();

  const mesAtual = (momento: Date) => hojeEmBrasilia(momento).slice(0, 7);

  async function atualizarCatalogo(): Promise<void> {
    const momento = agora();
    const ultimaTentativa = estado.consultar('brapi')?.ultimaTentativa;
    const recente =
      ultimaTentativa !== undefined &&
      momento.getTime() - Date.parse(ultimaTentativa) < INTERVALO_MINIMO_CATALOGO_MS;
    if (recente || !estado.podeChamar('brapi', momento)) return;

    uso.registrar('brapi', mesAtual(momento));
    try {
      const itens = await buscarListaBrapi(buscar, momento);
      emTransacao(banco, () => {
        for (const item of itens) gravarItem.run({ ...item, agora: momento.toISOString() });
      });
      estado.registrarSucesso('brapi', momento);
    } catch (erro) {
      const falha =
        erro instanceof ErroFonte
          ? erro
          : new ErroFonte('instavel', 'Erro inesperado ao processar os dados da brapi');
      if (!(erro instanceof ErroFonte)) console.error('Erro inesperado no catálogo:', erro);
      estado.registrarFalha('brapi', falha, momento);
    }
  }

  async function conferirLogo(ticker: Ticker, url: string, salvo: LinhaLogo | undefined) {
    const momento = agora();
    const manter = {
      ticker,
      conteudo: salvo?.conteudo ?? null,
      tipo: salvo?.tipo ?? null,
      etag: salvo?.etag ?? null,
      verificadoEm: momento.toISOString(),
    };

    uso.registrar('brapi', mesAtual(momento));
    try {
      const resposta = await requisitarExterno(buscar, url, momento, {
        limiteBytes: LIMITE_LOGO_BYTES,
        cabecalhos: salvo?.etag && salvo.conteudo ? { 'if-none-match': salvo.etag } : {},
        statusAceitos: [304, 404],
      });
      const tipo = resposta.cabecalhos.get('content-type')?.split(';')[0].trim() ?? '';
      if (resposta.status === 200 && TIPOS_DE_LOGO.has(tipo) && resposta.corpo.byteLength > 0) {
        gravarLogo.run({
          ...manter,
          conteudo: resposta.corpo,
          tipo,
          etag: resposta.cabecalhos.get('etag'),
        });
        return;
      }
    } catch (erro) {
      console.warn(`Não foi possível baixar o logo de ${ticker}:`, (erro as Error).message);
    }
    // 304, 404, tipo inesperado ou falha: mantém o que havia e só tenta de novo amanhã.
    gravarLogo.run(manter);
  }

  return {
    /** Atualiza o catálogo se estiver velho; falhas ficam registradas e nunca são lançadas. */
    garantirAtualizado(): Promise<void> {
      atualizacaoEmAndamento ??= atualizarCatalogo().finally(() => {
        atualizacaoEmAndamento = null;
      });
      return atualizacaoEmAndamento;
    },

    listar(busca = ''): AcaoCatalogo[] {
      const termo = simplificar(busca.trim());
      const acoes = listarItens.all() as unknown as AcaoCatalogo[];
      if (!termo) return acoes;
      return acoes.filter(
        ({ ticker, nome }) =>
          simplificar(ticker).includes(termo) || simplificar(nome).includes(termo),
      );
    },

    /** Último preço da brapi para cada ticker que tiver preço no catálogo. */
    precos(tickers: readonly Ticker[]): Map<Ticker, PrecoCatalogo> {
      const precos = new Map<Ticker, PrecoCatalogo>();
      for (const ticker of tickers) {
        const linha = buscarPreco.get(ticker) as
          { preco_centavos: number; atualizado_em: string } | undefined;
        if (linha) {
          precos.set(ticker, {
            precoCentavos: linha.preco_centavos,
            atualizadoEm: linha.atualizado_em,
          });
        }
      }
      return precos;
    },

    /** Logo salvo no banco; baixa na primeira vez e confere no máximo uma vez por dia. */
    async logo(ticker: Ticker): Promise<Logo | null> {
      const salvo = buscarLogo.get(ticker) as LinhaLogo | undefined;
      const vencido =
        !salvo || agora().getTime() - Date.parse(salvo.verificado_em) >= VALIDADE_LOGO_MS;
      const url = (buscarLogoUrl.get(ticker) as { logo_url: string | null } | undefined)?.logo_url;

      if (vencido && url) {
        let conferencia = logosEmAndamento.get(ticker);
        if (!conferencia) {
          conferencia = conferirLogo(ticker, url, salvo).finally(() =>
            logosEmAndamento.delete(ticker),
          );
          logosEmAndamento.set(ticker, conferencia);
        }
        await conferencia;
      }

      const atual = buscarLogo.get(ticker) as LinhaLogo | undefined;
      return atual?.conteudo && atual.tipo ? { conteudo: atual.conteudo, tipo: atual.tipo } : null;
    },
  };
}
