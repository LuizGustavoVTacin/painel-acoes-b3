import { hojeEmBrasilia } from '../shared/datas.js';
import type { Centavos } from '../shared/dinheiro.js';
import { filtrarAcoes, type AcaoListada } from '../shared/selecao.js';
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
/**
 * Saídas da bolsa são poucas por dia: uma lista com menos de 90% do tamanho da última lista
 * completa indica corte ou mudança na API. Ela é guardada (com aviso), mas não esconde nada.
 */
const FRACAO_MINIMA_DA_LISTA = 0.9;
/**
 * Listas menores seguidas, de tamanho estável (até 2% de diferença), viram o novo normal:
 * a brapi mudou de vez. Cortes progressivos (400 → 220 → 120) nunca são aceitos.
 */
const LISTAS_PARA_NOVO_TAMANHO = 3;
const VARIACAO_DE_TAMANHO_ESTAVEL = 0.02;
/**
 * Ações vistas numa das duas últimas listas completas (ou todas, antes de haver duas): uma ação
 * que falte numa única lista não some do menu.
 */
const SOMENTE_LISTADAS = `geracao >= coalesce((SELECT completa_anterior FROM catalogo_geracao), 0)`;

/** Régua de tamanho que decide se uma lista nova é completa. */
export interface ReguaDaLista {
  /** Tamanho da última lista completa; null antes da primeira. */
  tamanhoNormal: number | null;
  encolhidasSeguidas: number;
  tamanhoEncolhida: number | null;
}

export const REGUA_INICIAL: ReguaDaLista = {
  tamanhoNormal: null,
  encolhidasSeguidas: 0,
  tamanhoEncolhida: null,
};

/**
 * Diz se uma lista com `tamanho` ações vale como lista completa da B3 e devolve a régua nova.
 * `encolheu` indica uma lista menor que o normal que não foi aceita (merece aviso).
 */
export function avaliarTamanhoDaLista(
  regua: ReguaDaLista,
  tamanho: number,
): { completa: boolean; encolheu: boolean; regua: ReguaDaLista } {
  const { tamanhoNormal, tamanhoEncolhida, encolhidasSeguidas } = regua;
  const completaNova = {
    completa: true,
    encolheu: false,
    regua: { tamanhoNormal: tamanho, encolhidasSeguidas: 0, tamanhoEncolhida: null },
  };
  if (tamanhoNormal === null || tamanho >= tamanhoNormal * FRACAO_MINIMA_DA_LISTA) {
    return completaNova;
  }
  const estavel =
    tamanhoEncolhida !== null &&
    Math.abs(tamanho - tamanhoEncolhida) <= tamanhoEncolhida * VARIACAO_DE_TAMANHO_ESTAVEL;
  const seguidas = estavel ? encolhidasSeguidas + 1 : 1;
  if (seguidas >= LISTAS_PARA_NOVO_TAMANHO) return completaNova;
  return {
    completa: false,
    encolheu: true,
    regua: { tamanhoNormal, encolhidasSeguidas: seguidas, tamanhoEncolhida: tamanho },
  };
}

interface LinhaGeracao {
  geracao: number;
  completa: number;
  completa_anterior: number;
  completa_em: string | null;
  tamanho_normal: number | null;
  encolhidas_seguidas: number;
  tamanho_encolhida: number | null;
  ultima_em: string | null;
}

interface ResultadoDaLista {
  gravados: number;
  /** Lista menor que o normal, não aceita: o tamanho de referência, para o aviso. */
  encolheuDe: number | null;
}
const FALHAS_DE_FORMATO_PARA_ALERTA = 5;
const AVISO_FALHA_LOCAL = 'A brapi respondeu, mas o banco local não salvou os dados';
const AVISO_DE_COBRANCA = `${MENSAGEM_COBRANCA} (aviso recebido junto com os dados)`;

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
 * Ações que saem da listagem continuam no banco (com o último preço e logo conhecidos), mas
 * deixam de ser listadas depois de uma lista de tamanho normal sem elas. Uma lista que encolheu
 * demais (falha da brapi) não esconde nada.
 */
export function criarServicoCatalogo({ banco, buscar, agora, estado, uso }: DependenciasCatalogo) {
  const gravarItem = banco.prepare(
    `INSERT INTO catalogo
       (ticker, nome, logo_url, preco_centavos, setor, variacao_centesimos, geracao, atualizado_em)
     VALUES (:ticker, :nome, :logoUrl, :precoCentavos, :setor, :variacaoDoDia, :geracao, :agora)
     ON CONFLICT (ticker) DO UPDATE SET nome = excluded.nome, logo_url = excluded.logo_url,
       preco_centavos = excluded.preco_centavos, setor = excluded.setor,
       variacao_centesimos = excluded.variacao_centesimos, geracao = excluded.geracao,
       atualizado_em = excluded.atualizado_em`,
  );
  // Veio na lista mas o banco recusou os dados novos: continua listada, sem a variação antiga.
  const marcarVista = banco.prepare(
    'UPDATE catalogo SET geracao = ?, variacao_centesimos = NULL WHERE ticker = ?',
  );
  // A variação do dia vale só para quem veio na lista mais recente.
  const limparVariacoesAntigas = banco.prepare(
    'UPDATE catalogo SET variacao_centesimos = NULL WHERE geracao < ? AND variacao_centesimos IS NOT NULL',
  );
  const lerGeracao = banco.prepare('SELECT * FROM catalogo_geracao WHERE id = 1');
  const gravarGeracao = banco.prepare(
    `INSERT INTO catalogo_geracao (id, geracao, completa, completa_anterior, completa_em,
       tamanho_normal, encolhidas_seguidas, tamanho_encolhida, ultima_em)
     VALUES (1, :geracao, :completa, :completaAnterior, :completaEm,
       :tamanhoNormal, :encolhidasSeguidas, :tamanhoEncolhida, :ultimaEm)
     ON CONFLICT (id) DO UPDATE SET geracao = excluded.geracao, completa = excluded.completa,
       completa_anterior = excluded.completa_anterior, completa_em = excluded.completa_em,
       tamanho_normal = excluded.tamanho_normal,
       encolhidas_seguidas = excluded.encolhidas_seguidas,
       tamanho_encolhida = excluded.tamanho_encolhida, ultima_em = excluded.ultima_em`,
  );
  const buscarInicioDoPregao = banco.prepare('SELECT inicio FROM pregao WHERE id = 1');
  const contarItens = banco.prepare('SELECT count(*) AS total FROM catalogo');
  const listarItens = banco.prepare(
    `SELECT ticker, nome, setor, variacao_centesimos AS variacaoDoDia FROM catalogo
     WHERE ${SOMENTE_LISTADAS} ORDER BY ticker`,
  );

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
   * Cada lista recebe um número novo; uma de tamanho normal passa a valer como a lista atual da
   * B3, e as ações que faltaram nela e na completa anterior deixam de ser listadas.
   */
  function salvarItens(itens: { ticker: Ticker }[], momento: Date): ResultadoDaLista {
    let gravados = 0;
    let encolheuDe: number | null = null;
    emTransacao(banco, () => {
      const anterior = lerGeracao.get() as LinhaGeracao | undefined;
      const geracao = (anterior?.geracao ?? 0) + 1;
      for (const item of itens) {
        try {
          gravarItem.run({ ...item, geracao, agora: momento.toISOString() });
          gravados++;
        } catch (erro) {
          if (!ehViolacaoDeRegra(erro)) throw erro;
          console.warn(`Ação ${item.ticker} ignorada no catálogo:`, (erro as Error).message);
          marcarVista.run(geracao, item.ticker);
        }
      }
      limparVariacoesAntigas.run(geracao);

      // Conta o que a brapi mandou (inclusive o que o banco recusou): a régua mede a API.
      const regua = anterior
        ? {
            tamanhoNormal: anterior.tamanho_normal,
            encolhidasSeguidas: anterior.encolhidas_seguidas,
            tamanhoEncolhida: anterior.tamanho_encolhida,
          }
        : REGUA_INICIAL;
      const avaliacao = avaliarTamanhoDaLista(regua, itens.length);
      if (avaliacao.encolheu) encolheuDe = regua.tamanhoNormal;
      const iso = momento.toISOString();
      gravarGeracao.run({
        geracao,
        completa: avaliacao.completa ? geracao : (anterior?.completa ?? 0),
        completaAnterior: avaliacao.completa
          ? (anterior?.completa ?? 0)
          : (anterior?.completa_anterior ?? 0),
        completaEm: avaliacao.completa ? iso : (anterior?.completa_em ?? null),
        ...avaliacao.regua,
        ultimaEm: iso,
      });
    });
    return { gravados, encolheuDe };
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
      const { itens, avisoDeCobranca } = await buscarListaBrapi(buscar, momento);
      let resultado: ResultadoDaLista;
      try {
        resultado = salvarItens(itens, momento);
      } catch (erro) {
        // Problema do banco local, não da API: a brapi respondeu bem.
        console.error('Não foi possível salvar o catálogo no banco:', erro);
        semFalhar('registrar o sucesso da brapi', () =>
          estado.registrarSucesso('brapi', momento, AVISO_FALHA_LOCAL),
        );
        return;
      }

      const { gravados, encolheuDe } = resultado;
      const aviso = avisoDeCobranca
        ? AVISO_DE_COBRANCA
        : encolheuDe !== null
          ? `A brapi devolveu menos ações que o normal (${itens.length} de ${encolheuDe})`
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

  /** Atualiza o catálogo se estiver velho; falhas ficam registradas e nunca são lançadas. */
  function garantirAtualizado(): Promise<void> {
    atualizacaoEmAndamento ??= atualizarCatalogo().finally(() => {
      atualizacaoEmAndamento = null;
    });
    return atualizacaoEmAndamento;
  }

  return {
    garantirAtualizado,

    /** Ações da lista atual da B3 (sem as que saíram da bolsa), filtradas pela busca. */
    listar(busca = ''): AcaoListada[] {
      return filtrarAcoes(listarItens.all() as unknown as AcaoListada[], busca);
    },

    /**
     * Horário da lista mais recente (a da variação do dia) e o dia do pregão a que a variação
     * se refere: o último pregão informado pelo Yahoo, se já tinha começado quando a lista
     * chegou. Sem essa informação, `pregao` é null (a tela não diz "hoje").
     */
    listaAtual(): { atualizadoEm: string | null; pregao: string | null } {
      const atualizadoEm = (lerGeracao.get() as LinhaGeracao | undefined)?.ultima_em ?? null;
      const inicio = (buscarInicioDoPregao.get() as { inicio: string } | undefined)?.inicio;
      const pregao =
        atualizadoEm && inicio && inicio <= atualizadoEm ? hojeEmBrasilia(new Date(inicio)) : null;
      return { atualizadoEm, pregao };
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
      // Com o Yahoo funcionando, ninguém mais carrega o catálogo: o logo precisa dele.
      // Só quando está vazio: uma ação fora da lista não faz chamá-la a cada 15 minutos.
      if ((contarItens.get() as { total: number }).total === 0) await garantirAtualizado();

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
