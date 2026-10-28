import { filtrarAcoes, LIMITE_ACOES_SELECIONADAS, type AcaoListada } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';
import { nomeDoSetor } from './setores';

/** Uma linha da lista do menu de escolha. */
export interface ItemEscolha extends AcaoListada {
  /** Ação salva que sumiu do catálogo (ex.: código antigo); continua na lista para ser desmarcada. */
  foraDoCatalogo: boolean;
}

/** O que a lista mostra: tudo, só as que subiram ou caíram hoje, ou só as compradas. */
export type ModoEscolha = 'todas' | 'alta' | 'baixa' | 'compradas';

export interface FiltrosEscolha {
  busca: string;
  /** Setor como a brapi publica; null = todos. */
  setor: string | null;
  modo: ModoEscolha;
  /** Ações com compras registradas (usado no modo "compradas"). */
  compradas?: ReadonlySet<Ticker>;
}

export interface OpcaoSetor {
  setor: string;
  nome: string;
  quantidade: number;
}

/**
 * Marca ou desmarca uma ação mantendo a ordem de escolha: a nova vai para o fim.
 * Com o limite atingido, marcar não faz nada (desmarcar sempre funciona).
 */
export function alternarAcao(
  marcadas: readonly Ticker[],
  ticker: Ticker,
  limite = LIMITE_ACOES_SELECIONADAS,
): Ticker[] {
  if (marcadas.includes(ticker)) return marcadas.filter((t) => t !== ticker);
  if (marcadas.length >= limite) return [...marcadas];
  return [...marcadas, ticker];
}

const foraDoCatalogo = (ticker: Ticker): ItemEscolha => ({
  ticker,
  nome: '',
  setor: null,
  variacaoDoDia: null,
  foraDoCatalogo: true,
});

/** Maior variação primeiro (ou menor, com sentido -1); empate em ordem de código. */
const porVariacao =
  (sentido: 1 | -1) =>
  (a: ItemEscolha, b: ItemEscolha): number =>
    sentido * ((b.variacaoDoDia ?? 0) - (a.variacaoDoDia ?? 0)) || a.ticker.localeCompare(b.ticker);

/**
 * Lista do menu: primeiro as ações já salvas (na ordem da grade), depois o resto do catálogo,
 * filtradas por setor, modo e busca. As salvas ficam fixas no topo enquanto o menu está aberto,
 * para uma linha não pular de lugar sob o cursor ao ser marcada. Em alta e em baixa a ordem é a
 * da variação do dia (que não muda ao marcar).
 */
export function montarListaEscolha(
  catalogo: readonly AcaoListada[],
  salvas: readonly Ticker[],
  { busca, setor, modo, compradas = new Set() }: FiltrosEscolha,
): ItemEscolha[] {
  const porTicker = new Map(catalogo.map((acao) => [acao.ticker, acao]));
  const noTopo = new Set(salvas);
  let itens: ItemEscolha[] = [
    ...salvas.map((ticker) => {
      const acao = porTicker.get(ticker);
      return acao ? { ...acao, foraDoCatalogo: false } : foraDoCatalogo(ticker);
    }),
    ...catalogo
      .filter(({ ticker }) => !noTopo.has(ticker))
      .map((acao) => ({ ...acao, foraDoCatalogo: false })),
  ];

  if (modo === 'compradas') {
    // Uma ação comprada que saiu da bolsa também aparece, para ser encontrada.
    const presentes = new Set(itens.map(({ ticker }) => ticker));
    itens = [
      ...itens.filter(({ ticker }) => compradas.has(ticker)),
      ...[...compradas]
        .filter((ticker) => !presentes.has(ticker))
        .sort()
        .map(foraDoCatalogo),
    ];
  }
  if (setor !== null) itens = itens.filter((item) => item.setor === setor);
  if (modo === 'alta') {
    itens = itens.filter(({ variacaoDoDia }) => (variacaoDoDia ?? 0) > 0).sort(porVariacao(1));
  } else if (modo === 'baixa') {
    itens = itens.filter(({ variacaoDoDia }) => (variacaoDoDia ?? 0) < 0).sort(porVariacao(-1));
  }
  return filtrarAcoes(itens, busca);
}

/** Setores presentes no catálogo, com o nome em português e quantas ações cada um tem. */
export function contarSetores(catalogo: readonly AcaoListada[]): OpcaoSetor[] {
  const quantidades = new Map<string, number>();
  for (const { setor } of catalogo) {
    if (setor !== null) quantidades.set(setor, (quantidades.get(setor) ?? 0) + 1);
  }
  return [...quantidades]
    .map(([setor, quantidade]) => ({ setor, nome: nomeDoSetor(setor), quantidade }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Seleção a salvar: as que já estavam salvas mantêm a posição na grade e as novas vão para o fim,
 * na ordem em que foram marcadas. Desmarcar e marcar de novo não mexe na ordem.
 */
export function selecaoFinal(salvas: readonly Ticker[], marcadas: readonly Ticker[]): Ticker[] {
  const marcadasSet = new Set(marcadas);
  const salvasSet = new Set(salvas);
  return [
    ...salvas.filter((ticker) => marcadasSet.has(ticker)),
    ...marcadas.filter((ticker) => !salvasSet.has(ticker)),
  ];
}
