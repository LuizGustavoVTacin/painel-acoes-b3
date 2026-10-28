import type { Centavos } from '../shared/dinheiro.js';
import type { Ticker } from '../shared/ticker.js';
import type { Banco } from './banco/conexao.js';
import { emTransacao } from './banco/emTransacao.js';
import type { RepositorioUsoApi } from './banco/usoApi.js';
import type { ServicoCatalogo } from './catalogo.js';
import { contarUso, passou, registrarFalha, semFalhar } from './externo/apoio.js';
import type { EstadoFontes } from './externo/estadoFontes.js';
import type { Buscar } from './externo/http.js';
import { buscarLoteYahoo, dividirEmLotes, type CotacaoYahoo } from './externo/yahoo.js';

/** Durante o pregão, cada ação é atualizada no máximo a cada 5 minutos. */
export const INTERVALO_PREGAO_ABERTO_MS = 5 * 60 * 1000;
/** Fora do pregão (noite, fim de semana, feriado), no máximo 1 vez por hora. */
export const INTERVALO_PREGAO_FECHADO_MS = 60 * 60 * 1000;
/** Uma cotação fica desatualizada quando perde duas atualizações seguidas. */
const ATUALIZACOES_PERDIDAS_PARA_ALERTA = 2;

export type FonteCotacao = 'yahoo' | 'brapi';

export interface Cotacao {
  ticker: Ticker;
  precoCentavos: Centavos | null;
  fonte: FonteCotacao | null;
  /** Horário da última negociação (só o Yahoo informa). */
  negociadoEm: string | null;
  /** Quando o preço foi obtido da API. */
  atualizadoEm: string | null;
  desatualizada: boolean;
}

export interface PainelCotacoes {
  cotacoes: Cotacao[];
  mercadoAberto: boolean;
  /** Fontes das cotações atuais (não desatualizadas), Yahoo primeiro. */
  fontesEmUso: FonteCotacao[];
}

interface LinhaCotacao {
  ticker: Ticker;
  preco_centavos: number;
  fonte: FonteCotacao;
  negociado_em: string | null;
  atualizado_em: string;
}

export interface DependenciasCotacoes {
  banco: Banco;
  buscar: Buscar;
  agora: () => Date;
  estado: EstadoFontes;
  uso: RepositorioUsoApi;
  catalogo: ServicoCatalogo;
}

export type ServicoCotacoes = ReturnType<typeof criarServicoCotacoes>;

/**
 * Cotações das ações selecionadas: Yahoo como fonte principal, listagem da brapi como reserva
 * e o último preço salvo no banco quando nenhuma das duas responde.
 */
export function criarServicoCotacoes({
  banco,
  buscar,
  agora,
  estado,
  uso,
  catalogo,
}: DependenciasCotacoes) {
  const buscarCotacao = banco.prepare('SELECT * FROM cotacoes WHERE ticker = ?');
  const gravarCotacao = banco.prepare(
    `INSERT INTO cotacoes (ticker, preco_centavos, fonte, negociado_em, atualizado_em)
     VALUES (:ticker, :precoCentavos, :fonte, :negociadoEm, :atualizadoEm)
     ON CONFLICT (ticker) DO UPDATE SET preco_centavos = excluded.preco_centavos,
       fonte = excluded.fonte, negociado_em = excluded.negociado_em,
       atualizado_em = excluded.atualizado_em`,
  );
  const buscarPregao = banco.prepare('SELECT inicio, fim FROM pregao WHERE id = 1');
  const gravarPregao = banco.prepare(
    `INSERT INTO pregao (id, inicio, fim) VALUES (1, :inicio, :fim)
     ON CONFLICT (id) DO UPDATE SET inicio = excluded.inicio, fim = excluded.fim`,
  );

  /** Última tentativa no Yahoo por ação, também em memória (vale mesmo se o banco falhar). */
  const tentativasYahoo = new Map<Ticker, string>();
  const atualizacoesEmAndamento = new Map<string, Promise<void>>();

  const lerCotacao = (ticker: Ticker) => buscarCotacao.get(ticker) as LinhaCotacao | undefined;

  /** Sem pregão conhecido, considera aberto: o intervalo curto descobre o horário logo. */
  function mercadoAberto(momento: Date): boolean {
    const pregao = buscarPregao.get() as { inicio: string; fim: string } | undefined;
    if (!pregao) return true;
    const instante = momento.toISOString();
    return pregao.inicio <= instante && instante < pregao.fim;
  }

  const intervalo = (momento: Date) =>
    mercadoAberto(momento) ? INTERVALO_PREGAO_ABERTO_MS : INTERVALO_PREGAO_FECHADO_MS;

  const desatualizada = (atualizadoEm: string, momento: Date) =>
    passou(ATUALIZACOES_PERDIDAS_PARA_ALERTA * intervalo(momento), atualizadoEm, momento);

  function salvarDoYahoo(cotacoes: readonly CotacaoYahoo[], momento: Date): void {
    const pregoes = cotacoes.flatMap((c) => (c.pregao ? [c.pregao] : []));
    const maisRecente = pregoes.sort((a, b) => a.fim.localeCompare(b.fim)).at(-1);
    emTransacao(banco, () => {
      for (const { ticker, precoCentavos, negociadoEm } of cotacoes) {
        gravarCotacao.run({
          ticker,
          precoCentavos,
          fonte: 'yahoo',
          negociadoEm,
          atualizadoEm: momento.toISOString(),
        });
      }
      if (maisRecente) gravarPregao.run({ ...maisRecente });
    });
  }

  async function atualizarPeloYahoo(tickers: readonly Ticker[], momento: Date): Promise<void> {
    const intervaloAtual = intervalo(momento);
    const vencidas = tickers.filter((ticker) => {
      const salva = lerCotacao(ticker);
      const ultimaDoYahoo = salva?.fonte === 'yahoo' ? salva.atualizado_em : undefined;
      return [tentativasYahoo.get(ticker), ultimaDoYahoo].every((instante) =>
        passou(intervaloAtual, instante, momento),
      );
    });
    if (vencidas.length === 0 || !estado.podeChamar('yahoo', momento)) return;
    for (const ticker of vencidas) tentativasYahoo.set(ticker, momento.toISOString());

    const recebidas = new Set<Ticker>();
    for (const lote of dividirEmLotes(vencidas)) {
      // Outro pedido em paralelo pode ter pausado o Yahoo enquanto este lote esperava.
      if (!estado.podeChamar('yahoo', momento)) return;
      contarUso(uso, 'yahoo', momento);
      let cotacoes: CotacaoYahoo[];
      try {
        cotacoes = await buscarLoteYahoo(buscar, lote, momento);
      } catch (erro) {
        registrarFalha(estado, 'yahoo', erro, momento);
        return;
      }
      // Erro ao salvar é do banco local, não do Yahoo: não muda o estado da API.
      semFalhar('salvar as cotações do Yahoo', () => salvarDoYahoo(cotacoes, momento));
      for (const { ticker } of cotacoes) recebidas.add(ticker);
    }

    const ausentes = vencidas.filter((ticker) => !recebidas.has(ticker));
    const aviso = ausentes.length > 0 ? `Sem cotação no Yahoo: ${ausentes.join(', ')}` : null;
    semFalhar('registrar o sucesso do Yahoo', () =>
      estado.registrarSucesso('yahoo', momento, aviso),
    );
  }

  /** Usa o preço da listagem da brapi para as ações que o Yahoo não atualizou. */
  async function completarPelaBrapi(tickers: readonly Ticker[], momento: Date): Promise<void> {
    const semYahooAtual = tickers.filter((ticker) => {
      const salva = lerCotacao(ticker);
      return !salva || salva.fonte !== 'yahoo' || desatualizada(salva.atualizado_em, momento);
    });
    if (semYahooAtual.length === 0) return;

    await catalogo.garantirAtualizado();
    const precos = catalogo.precos(semYahooAtual);
    for (const ticker of semYahooAtual) {
      const reserva = precos.get(ticker);
      const salva = lerCotacao(ticker);
      if (!reserva || (salva && reserva.atualizadoEm <= salva.atualizado_em)) continue;
      semFalhar(`salvar a cotação de ${ticker}`, () =>
        gravarCotacao.run({
          ticker,
          precoCentavos: reserva.precoCentavos,
          fonte: 'brapi',
          negociadoEm: null,
          atualizadoEm: reserva.atualizadoEm,
        }),
      );
    }
  }

  async function atualizarAgora(tickers: readonly Ticker[]): Promise<void> {
    const momento = agora();
    try {
      await atualizarPeloYahoo(tickers, momento);
      await completarPelaBrapi(tickers, momento);
    } catch (erro) {
      // Erro do banco local: as cotações já salvas continuam valendo.
      console.error('Erro ao atualizar as cotações:', erro);
    }
  }

  return {
    /** Atualiza as cotações vencidas; falhas ficam registradas e nunca são lançadas. */
    atualizar(tickers: readonly Ticker[]): Promise<void> {
      const chave = tickers.join(',');
      let atualizacao = atualizacoesEmAndamento.get(chave);
      if (!atualizacao) {
        atualizacao = atualizarAgora(tickers).finally(() => atualizacoesEmAndamento.delete(chave));
        atualizacoesEmAndamento.set(chave, atualizacao);
      }
      return atualizacao;
    },

    /** Últimas cotações salvas das ações pedidas, na mesma ordem. */
    listar(tickers: readonly Ticker[]): PainelCotacoes {
      const momento = agora();
      const cotacoes = tickers.map((ticker): Cotacao => {
        const salva = lerCotacao(ticker);
        if (!salva) {
          return {
            ticker,
            precoCentavos: null,
            fonte: null,
            negociadoEm: null,
            atualizadoEm: null,
            desatualizada: true,
          };
        }
        return {
          ticker,
          precoCentavos: salva.preco_centavos,
          fonte: salva.fonte,
          negociadoEm: salva.negociado_em,
          atualizadoEm: salva.atualizado_em,
          desatualizada: desatualizada(salva.atualizado_em, momento),
        };
      });
      const emUso = new Set(cotacoes.filter((c) => !c.desatualizada).map((c) => c.fonte));
      const fontesEmUso = (['yahoo', 'brapi'] as const).filter((fonte) => emUso.has(fonte));
      return { cotacoes, mercadoAberto: mercadoAberto(momento), fontesEmUso };
    },
  };
}
