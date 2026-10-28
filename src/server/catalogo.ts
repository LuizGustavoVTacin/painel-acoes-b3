import type { Centavos } from '../shared/dinheiro.js';
import type { Ticker } from '../shared/ticker.js';
import type { Banco } from './banco/conexao.js';
import { emTransacao } from './banco/emTransacao.js';
import type { RepositorioUsoApi } from './banco/usoApi.js';
import { buscarListaBrapi } from './externo/brapi.js';
import { ErroFonte } from './externo/erroFonte.js';
import { contarUso, passou, podeChamar, registrarFalha, semFalhar } from './externo/apoio.js';
import type { EstadoFontes } from './externo/estadoFontes.js';
import { MENSAGEM_COBRANCA, requisitarExterno, type Buscar } from './externo/http.js';

/** A brapi guarda a listagem em cache por 15 minutos; chamar antes disso é desperdício. */
export const INTERVALO_MINIMO_CATALOGO_MS = 15 * 60 * 1000;
/** Cada logo é conferido no máximo uma vez por dia. */
export const VALIDADE_LOGO_MS = 24 * 60 * 60 * 1000;
/** Depois de uma falha temporária ao baixar logos, espera antes de tentar de novo. */
export const ESPERA_APOS_FALHA_DE_LOGO_MS = 15 * 60 * 1000;
/** Downloads de logo simultâneos (na primeira abertura podem ser 50 de uma vez). */
const DOWNLOADS_SIMULTANEOS = 4;
const LIMITE_LOGO_BYTES = 200 * 1024;
const TIPOS_DE_LOGO = new Set(['image/svg+xml', 'image/png']);
/** Uma lista com menos da metade das ações já conhecidas indica corte ou mudança na API. */
const FRACAO_MINIMA_DA_LISTA = 0.5;
const FALHAS_DE_FORMATO_PARA_ALERTA = 5;
const AVISO_FALHA_LOCAL = 'A brapi respondeu, mas o banco local não salvou os dados';
const AVISO_DE_COBRANCA = `${MENSAGEM_COBRANCA} (aviso recebido junto com os dados)`;

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

/** Erro de regra do banco (CHECK, UNIQUE...): recusa só a linha e não desfaz a transação. */
function ehViolacaoDeRegra(erro: unknown): boolean {
  const SQLITE_CONSTRAINT = 19;
  const codigo = (erro as { errcode?: unknown } | null)?.errcode;
  return typeof codigo === 'number' && (codigo & 0xff) === SQLITE_CONSTRAINT;
}

/** Limita quantas promessas rodam ao mesmo tempo. */
function criarLimitador(maximo: number) {
  let ativas = 0;
  const fila: (() => void)[] = [];
  return async function <T>(tarefa: () => Promise<T>): Promise<T> {
    if (ativas >= maximo) await new Promise<void>((liberar) => fila.push(liberar));
    ativas++;
    try {
      return await tarefa();
    } finally {
      ativas--;
      fila.shift()?.();
    }
  };
}

export type ServicoCatalogo = ReturnType<typeof criarServicoCatalogo>;

/**
 * Catálogo de ações, preços de reserva e logos vindos da brapi, guardados no banco.
 * Ações que saem da listagem continuam no catálogo (com o último preço e logo conhecidos):
 * apagar dependeria de a brapi nunca devolver uma lista incompleta.
 */
export function criarServicoCatalogo({ banco, buscar, agora, estado, uso }: DependenciasCatalogo) {
  const gravarItem = banco.prepare(
    `INSERT INTO catalogo (ticker, nome, logo_url, preco_centavos, atualizado_em)
     VALUES (:ticker, :nome, :logoUrl, :precoCentavos, :agora)
     ON CONFLICT (ticker) DO UPDATE SET nome = excluded.nome, logo_url = excluded.logo_url,
       preco_centavos = excluded.preco_centavos, atualizado_em = excluded.atualizado_em`,
  );
  const contarItens = banco.prepare('SELECT count(*) AS total FROM catalogo');
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
  let ultimaChamadaCatalogo: string | undefined;
  /** Conferências de logo também em memória, para não repetir downloads se o banco falhar. */
  const logosConferidosEm = new Map<Ticker, string>();
  /** Logos seguidos com formato inesperado; vários indicam mudança no servidor de logos. */
  let falhasDeFormatoSeguidas = 0;
  const logosEmAndamento = new Map<Ticker, Promise<void>>();
  const limitarDownloads = criarLimitador(DOWNLOADS_SIMULTANEOS);

  /**
   * Grava os itens um a um: um item recusado por uma regra do banco não impede os demais.
   * Outros erros (disco cheio, banco travado) desfazem a transação e são lançados.
   */
  function salvarItens(itens: { ticker: Ticker }[], momento: Date): number {
    let gravados = 0;
    emTransacao(banco, () => {
      for (const item of itens) {
        try {
          gravarItem.run({ ...item, agora: momento.toISOString() });
          gravados++;
        } catch (erro) {
          if (!ehViolacaoDeRegra(erro)) throw erro;
          console.warn(`Ação ${item.ticker} ignorada no catálogo:`, (erro as Error).message);
        }
      }
    });
    return gravados;
  }

  async function atualizarCatalogo(): Promise<void> {
    const momento = agora();
    // A última chamada fica também em memória: se o banco não gravar o estado, a pausa vale.
    const anteriores = [estado.consultar('brapi')?.ultimaTentativa, ultimaChamadaCatalogo];
    if (!anteriores.every((t) => passou(INTERVALO_MINIMO_CATALOGO_MS, t, momento))) return;
    if (!podeChamar(estado, 'brapi', momento)) return;

    ultimaChamadaCatalogo = momento.toISOString();
    contarUso(uso, 'brapi', momento);
    try {
      const conhecidas = (contarItens.get() as { total: number }).total;
      const { itens, avisoDeCobranca } = await buscarListaBrapi(buscar, momento);
      let gravados: number;
      try {
        gravados = salvarItens(itens, momento);
      } catch (erro) {
        // Problema do banco local, não da API: a brapi respondeu bem.
        console.error('Não foi possível salvar o catálogo no banco:', erro);
        semFalhar('registrar o sucesso da brapi', () =>
          estado.registrarSucesso('brapi', momento, AVISO_FALHA_LOCAL),
        );
        return;
      }

      const aviso = avisoDeCobranca
        ? AVISO_DE_COBRANCA
        : gravados < conhecidas * FRACAO_MINIMA_DA_LISTA
          ? `A brapi devolveu menos ações que o normal (${gravados} de ${conhecidas})`
          : gravados < itens.length
            ? `${itens.length - gravados} ações da brapi foram ignoradas por dados inválidos`
            : null;
      semFalhar('registrar o sucesso da brapi', () =>
        estado.registrarSucesso('brapi', momento, aviso),
      );
    } catch (erro) {
      registrarFalha(estado, 'brapi', erro, momento);
    }
  }

  async function conferirLogo(ticker: Ticker, url: string, salvo: LinhaLogo | undefined) {
    const momento = agora();
    // Pedidos que esperaram na fila conferem de novo: outro download pode ter pausado a fonte.
    if (!podeChamar(estado, 'brapi_icones', momento)) return;
    const manter = {
      ticker,
      conteudo: salvo?.conteudo ?? null,
      tipo: salvo?.tipo ?? null,
      etag: salvo?.etag ?? null,
      verificadoEm: momento.toISOString(),
    };
    const gravar = (linha: typeof manter) => {
      logosConferidosEm.set(ticker, linha.verificadoEm);
      semFalhar(`salvar o logo de ${ticker}`, () => gravarLogo.run(linha));
    };

    contarUso(uso, 'brapi_icones', momento);
    try {
      const resposta = await requisitarExterno(buscar, url, momento, {
        limiteBytes: LIMITE_LOGO_BYTES,
        cabecalhos: salvo?.etag && salvo.conteudo ? { 'if-none-match': salvo.etag } : {},
        statusAceitos: [304, 404],
      });
      falhasDeFormatoSeguidas = 0;
      semFalhar('registrar o sucesso dos logos', () =>
        estado.registrarSucesso(
          'brapi_icones',
          momento,
          resposta.avisoDeCobranca ? AVISO_DE_COBRANCA : null,
        ),
      );
      const tipo = resposta.cabecalhos.get('content-type')?.split(';')[0].trim() ?? '';
      if (resposta.status === 200 && TIPOS_DE_LOGO.has(tipo) && resposta.corpo.byteLength > 0) {
        gravar({
          ...manter,
          conteudo: resposta.corpo,
          tipo,
          etag: resposta.cabecalhos.get('etag'),
        });
        return;
      }
      // 304 (não mudou), 404 (sem logo) ou tipo inesperado: mantém o que havia até amanhã.
      gravar(manter);
    } catch (erro) {
      if (erro instanceof ErroFonte && erro.situacao === 'formato_alterado') {
        // Problema deste logo (grande demais, status estranho): só ele espera até amanhã.
        console.warn(`Logo de ${ticker} ignorado: ${erro.message}`);
        gravar(manter);
        // Vários logos seguidos assim indicam mudança no servidor: aí sim, avisa e pausa.
        if (++falhasDeFormatoSeguidas >= FALHAS_DE_FORMATO_PARA_ALERTA) {
          falhasDeFormatoSeguidas = 0;
          registrarFalha(estado, 'brapi_icones', erro, momento);
        }
        return;
      }
      const temporaria = erro instanceof ErroFonte && erro.situacao === 'instavel';
      // Falha temporária: pausa os downloads de logo por alguns minutos, não por um dia.
      const falha = temporaria
        ? new ErroFonte(
            'instavel',
            erro.message,
            erro.status,
            erro.esperarAte ?? new Date(momento.getTime() + ESPERA_APOS_FALHA_DE_LOGO_MS),
          )
        : erro;
      registrarFalha(estado, 'brapi_icones', falha, momento);
      // Sem logo salvo e falha temporária: nada a gravar, para tentar de novo em breve.
      if (!(temporaria && !salvo)) gravar(manter);
    }
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
      const momento = agora();
      const salvo = buscarLogo.get(ticker) as LinhaLogo | undefined;
      const vencido = [salvo?.verificado_em, logosConferidosEm.get(ticker)].every((t) =>
        passou(VALIDADE_LOGO_MS, t, momento),
      );
      const url = (buscarLogoUrl.get(ticker) as { logo_url: string | null } | undefined)?.logo_url;

      if (vencido && url && podeChamar(estado, 'brapi_icones', momento)) {
        let conferencia = logosEmAndamento.get(ticker);
        if (!conferencia) {
          conferencia = limitarDownloads(() => conferirLogo(ticker, url, salvo)).finally(() =>
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
