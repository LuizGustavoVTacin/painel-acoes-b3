import type { Ticker } from '../../shared/ticker.js';
import type { Banco } from './conexao.js';
import { emTransacao } from './emTransacao.js';

export type RepositorioSelecao = ReturnType<typeof criarRepositorioSelecao>;

/** Ações exibidas no dashboard, na ordem em que foram escolhidas. */
export function criarRepositorioSelecao(banco: Banco) {
  const listarTodas = banco.prepare('SELECT ticker FROM acoes_selecionadas ORDER BY ordem');
  const apagarTodas = banco.prepare('DELETE FROM acoes_selecionadas');
  const inserir = banco.prepare('INSERT INTO acoes_selecionadas (ticker, ordem) VALUES (?, ?)');

  return {
    listar(): Ticker[] {
      return (listarTodas.all() as { ticker: string }[]).map((linha) => linha.ticker);
    },

    /** Troca a seleção inteira de uma vez; se algo falhar, a seleção anterior é mantida. */
    substituir(tickers: readonly Ticker[]): void {
      emTransacao(banco, () => {
        apagarTodas.run();
        tickers.forEach((ticker, ordem) => inserir.run(ticker, ordem));
      });
    },
  };
}
