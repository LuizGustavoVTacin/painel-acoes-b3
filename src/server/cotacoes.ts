import type { Centavos } from '../shared/dinheiro.js';
import type { Ticker } from '../shared/ticker.js';
import type { Banco } from './banco/conexao.js';
import { emTransacao } from './banco/emTransacao.js';
import type { RepositorioUsoApi } from './banco/usoApi.js';
import type { ServicoCatalogo } from './catalogo.js';
import { contarUso, passou, podeChamar, registrarFalha, semFalhar } from './externo/apoio.js';
import type { EstadoFontes } from './externo/estadoFontes.js';
import type { Buscar } from './externo/http.js';
import { buscarLoteYahoo, dividirEmLotes, type CotacaoYahoo } from './externo/yahoo.js';
import { intervaloDeAtualizacao, marcosDoPregao, situacaoDoPregao, type Pregao } from './pregao.js';

/** Uma cotação fica desatualizada quando perde duas atualizações seguidas. */
const ATUALIZACOES_PERDIDAS_PARA_ALERTA = 2;
/** O preço da brapi só substitui um do Yahoo que esteja sem atualizar há mais que isso. */
const IDADE_MINIMA_PARA_RESERVA_MS = 30 * 60 * 1000;
/** Pausa mínima entre o fim de uma rodada de chamadas ao Yahoo e o início da próxima. */
export const PAUSA_ENTRE_RODADAS_YAHOO_MS = 10 * 1000;

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
  /** null quando o pregão do dia ainda não foi confirmado pelo Yahoo. */
  mercadoAberto: boolean | null;
  /** Fontes das cotações atuais (não desatualizadas), Yahoo primeiro. */
  fontesEmUso: FonteCotacao[];
  /** Ações pedidas que o Yahoo não devolveu na última tentativa (ex.: código antigo). */
  semCotacaoNoYahoo: Ticker[];
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
  /** Espera entre rodadas; os testes substituem por um avanço do relógio falso. */
  esperar?: (ms: number) => Promise<void>;
}

export type ServicoCotacoes = ReturnType<typeof criarServicoCotacoes>;

const esperarDeVerdade = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

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
  esperar = esperarDeVerdade,
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
  // Um pregão mais antigo (de uma rodada atrasada) nunca substitui um mais novo.
  const gravarPregao = banco.prepare(
    `INSERT INTO pregao (id, inicio, fim) VALUES (1, :inicio, :fim)
     ON CONFLICT (id) DO UPDATE SET inicio = excluded.inicio, fim = excluded.fim
     WHERE excluded.fim >= pregao.fim`,
  );

  /** Última tentativa no Yahoo por ação, também em memória (vale mesmo se o banco falhar). */
  const tentativasYahoo = new Map<Ticker, string>();
  /** Ações que o Yahoo não devolveu na última tentativa. */
  const ausentesNoYahoo = new Set<Ticker>();
  const atualizacoesEmAndamento = new Map<string, Promise<void>>();
  /**
   * Rodadas de chamadas ao Yahoo rodam uma de cada vez, com pausa entre elas: pedidos que
   * chegam durante uma rodada esperam e só buscam o que continuar vencido.
   */
  let filaYahoo: Promise<void> = Promise.resolve();
  let fimDaUltimaRodada: string | undefined;

  const lerCotacao = (ticker: Ticker) => buscarCotacao.get(ticker) as LinhaCotacao | undefined;
  const lerPregao = () => buscarPregao.get() as Pregao | undefined;
  const intervalo = (momento: Date) => intervaloDeAtualizacao(lerPregao(), momento);

  const desatualizada = (atualizadoEm: string, momento: Date) =>
    passou(ATUALIZACOES_PERDIDAS_PARA_ALERTA * intervalo(momento), atualizadoEm, momento);

  const podeChamarYahoo = (momento: Date) => podeChamar(estado, 'yahoo', momento);

  /** Vencida: passou o intervalo, ou passou um marco do pregão (fim do leilão, abertura). */
  function vencidaNoYahoo(ticker: Ticker, momento: Date): boolean {
    const salva = lerCotacao(ticker);
    const ultima = [
      tentativasYahoo.get(ticker),
      salva?.fonte === 'yahoo' ? salva.atualizado_em : undefined,
    ]
      .filter((instante) => instante !== undefined)
      .sort()
      .at(-1);
    if (ultima === undefined || passou(intervalo(momento), ultima, momento)) return true;
    return marcosDoPregao(lerPregao(), momento).some((marco) => ultima < marco);
  }

  function salvarDoYahoo(cotacoes: readonly CotacaoYahoo[], momento: Date): void {
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
    });
  }

  /** Busca as vencidas em lotes. Se um lote falhar, guarda o que os anteriores trouxeram. */
  async function buscarNoYahoo(vencidas: readonly Ticker[], momento: Date): Promise<void> {
    for (const ticker of vencidas) tentativasYahoo.set(ticker, momento.toISOString());
    const pregoes: Pregao[] = [];
    let completa = true;
    for (const lote of dividirEmLotes(vencidas)) {
      if (!podeChamarYahoo(momento)) {
        completa = false;
        break;
      }
      contarUso(uso, 'yahoo', momento);
      let cotacoes: CotacaoYahoo[];
      try {
        cotacoes = await buscarLoteYahoo(buscar, lote, momento);
      } catch (erro) {
        registrarFalha(estado, 'yahoo', erro, momento);
        completa = false;
        break;
      }
      // Erro ao salvar é do banco local, não do Yahoo: não muda o estado da API.
      semFalhar('salvar as cotações do Yahoo', () => salvarDoYahoo(cotacoes, momento));
      const recebidas = new Set(cotacoes.map((c) => c.ticker));
      for (const ticker of lote) {
        if (recebidas.has(ticker)) ausentesNoYahoo.delete(ticker);
        else ausentesNoYahoo.add(ticker);
      }
      for (const { pregao } of cotacoes) if (pregao) pregoes.push(pregao);
    }

    const maisRecente = pregoes.sort((a, b) => a.fim.localeCompare(b.fim)).at(-1);
    if (maisRecente) semFalhar('salvar o pregão', () => gravarPregao.run({ ...maisRecente }));
    if (completa) {
      semFalhar('registrar o sucesso do Yahoo', () => estado.registrarSucesso('yahoo', momento));
    }
  }

  /** Uma rodada: espera a pausa desde a rodada anterior e busca o que estiver vencido. */
  async function rodadaYahoo(tickers: readonly Ticker[]): Promise<void> {
    if (!tickers.some((ticker) => vencidaNoYahoo(ticker, agora()))) return;
    if (fimDaUltimaRodada !== undefined) {
      const decorrido = agora().getTime() - Date.parse(fimDaUltimaRodada);
      if (decorrido >= 0 && decorrido < PAUSA_ENTRE_RODADAS_YAHOO_MS) {
        await esperar(PAUSA_ENTRE_RODADAS_YAHOO_MS - decorrido);
      }
    }
    const momento = agora();
    const vencidas = tickers.filter((ticker) => vencidaNoYahoo(ticker, momento));
    if (vencidas.length === 0 || !podeChamarYahoo(momento)) return;
    try {
      await buscarNoYahoo(vencidas, momento);
    } finally {
      fimDaUltimaRodada = agora().toISOString();
    }
  }

  function atualizarPeloYahoo(tickers: readonly Ticker[]): Promise<void> {
    const rodada = filaYahoo.then(() => rodadaYahoo(tickers));
    filaYahoo = rodada.catch(() => {});
    return rodada;
  }

  /** Usa o preço da listagem da brapi para as ações sem cotação recente do Yahoo. */
  async function completarPelaBrapi(tickers: readonly Ticker[]): Promise<void> {
    const momento = agora();
    const precisamDeReserva = tickers.filter((ticker) => {
      const salva = lerCotacao(ticker);
      if (!salva || salva.fonte !== 'yahoo') return true;
      return (
        desatualizada(salva.atualizado_em, momento) &&
        passou(IDADE_MINIMA_PARA_RESERVA_MS, salva.atualizado_em, momento)
      );
    });
    if (precisamDeReserva.length === 0) return;

    await catalogo.garantirAtualizado();
    const precos = catalogo.precos(precisamDeReserva);
    for (const ticker of precisamDeReserva) {
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
    try {
      await atualizarPeloYahoo(tickers);
      await completarPelaBrapi(tickers);
    } catch (erro) {
      // Erro do banco local: as cotações já salvas continuam valendo.
      console.error('Erro ao atualizar as cotações:', erro);
    }
  }

  function atualizar(tickers: readonly Ticker[]): Promise<void> {
    const chave = tickers.join(',');
    let atualizacao = atualizacoesEmAndamento.get(chave);
    if (!atualizacao) {
      atualizacao = atualizarAgora(tickers).finally(() => atualizacoesEmAndamento.delete(chave));
      atualizacoesEmAndamento.set(chave, atualizacao);
    }
    return atualizacao;
  }

  return {
    /** Atualiza as cotações vencidas; falhas ficam registradas e nunca são lançadas. */
    atualizar,

    /**
     * Atualiza, mas espera no máximo `limiteMs`: depois disso a resposta segue com os dados
     * salvos e a atualização termina sozinha, valendo para o próximo pedido.
     */
    async atualizarComLimite(tickers: readonly Ticker[], limiteMs: number): Promise<void> {
      let temporizador: NodeJS.Timeout | undefined;
      const limite = new Promise<void>((resolver) => {
        temporizador = setTimeout(resolver, limiteMs);
      });
      try {
        await Promise.race([atualizar(tickers), limite]);
      } finally {
        clearTimeout(temporizador);
      }
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
      const situacao = situacaoDoPregao(lerPregao(), momento);
      return {
        cotacoes,
        mercadoAberto: situacao === 'desconhecido' ? null : situacao === 'aberto',
        fontesEmUso,
        semCotacaoNoYahoo: tickers.filter((ticker) => ausentesNoYahoo.has(ticker)),
      };
    },
  };
}
