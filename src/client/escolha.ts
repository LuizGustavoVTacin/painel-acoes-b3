import { filtrarAcoes, LIMITE_ACOES_SELECIONADAS, type AcaoCatalogo } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';

/** Uma linha da lista do menu de escolha. */
export interface ItemEscolha extends AcaoCatalogo {
  /** Ação salva que sumiu do catálogo (ex.: código antigo); continua na lista para ser desmarcada. */
  foraDoCatalogo: boolean;
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

/**
 * Lista do menu: primeiro as ações já salvas (na ordem da grade), depois o resto do catálogo,
 * filtradas pela busca. As salvas ficam fixas no topo enquanto o menu está aberto, para uma
 * linha não pular de lugar sob o cursor ao ser marcada.
 */
export function montarListaEscolha(
  catalogo: readonly AcaoCatalogo[],
  salvas: readonly Ticker[],
  busca: string,
): ItemEscolha[] {
  const nomes = new Map(catalogo.map(({ ticker, nome }) => [ticker, nome]));
  const noTopo = new Set(salvas);
  const itens: ItemEscolha[] = [
    ...salvas.map((ticker) => ({
      ticker,
      nome: nomes.get(ticker) ?? '',
      foraDoCatalogo: !nomes.has(ticker),
    })),
    ...catalogo
      .filter(({ ticker }) => !noTopo.has(ticker))
      .map(({ ticker, nome }) => ({ ticker, nome, foraDoCatalogo: false })),
  ];
  return filtrarAcoes(itens, busca);
}
