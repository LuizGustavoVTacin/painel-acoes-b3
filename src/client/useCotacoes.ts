import { useEffect, useState } from 'react';
import type { RespostaCotacoes } from '../shared/painel';
import type { Ticker } from '../shared/ticker';
import { ESPERA_APOS_FALHA_MS, INTERVALO_ATUALIZACAO_MS, planejarProximaBusca } from './agenda';
import { buscarCotacoes, ErroApi } from './api';

/** O servidor espera as APIs por até 8 s; acima disso algo travou. */
export const TEMPO_LIMITE_COTACOES_MS = 15 * 1000;

export interface EstadoCotacoes {
  /** Últimos dados recebidos; continuam na tela mesmo quando uma busca seguinte falha. */
  dados: RespostaCotacoes | null;
  /** Mensagem da última busca, se ela falhou. */
  erro: string | null;
  carregando: boolean;
}

function mensagemDeErro(erro: unknown, expirou: boolean): string {
  if (expirou) return 'O servidor do dashboard demorou demais para responder';
  if (erro instanceof ErroApi) return erro.message;
  return 'Não foi possível atualizar as cotações';
}

/**
 * Busca as cotações ao abrir, de novo a cada 5 minutos (mais cedo para ações ainda sem preço)
 * e ao voltar para a aba, se a última busca já tiver mais de 5 minutos.
 */
export function useCotacoes(tempoLimiteMs = TEMPO_LIMITE_COTACOES_MS): EstadoCotacoes {
  const [estado, setEstado] = useState<EstadoCotacoes>({
    dados: null,
    erro: null,
    carregando: true,
  });

  useEffect(() => {
    let ativo = true;
    let buscando = false;
    let ultimaBusca = 0;
    let proxima: ReturnType<typeof setTimeout> | undefined;
    let controle: AbortController | null = null;
    let tentativas: ReadonlyMap<Ticker, number> = new Map();

    async function buscar(): Promise<void> {
      clearTimeout(proxima);
      buscando = true;
      const atual = new AbortController();
      controle = atual;
      let expirou = false;
      const limite = setTimeout(() => {
        expirou = true;
        atual.abort();
      }, tempoLimiteMs);

      let esperaMs = ESPERA_APOS_FALHA_MS;
      try {
        const dados = await buscarCotacoes(atual.signal);
        if (!ativo) return;
        const plano = planejarProximaBusca(dados.cotacoes, tentativas);
        tentativas = plano.tentativas;
        esperaMs = plano.esperaMs;
        setEstado({ dados, erro: null, carregando: false });
      } catch (erro) {
        if (!ativo) return;
        setEstado((anterior) => ({
          ...anterior,
          erro: mensagemDeErro(erro, expirou),
          carregando: false,
        }));
      } finally {
        clearTimeout(limite);
        buscando = false;
      }
      ultimaBusca = Date.now();
      proxima = setTimeout(() => void buscar(), esperaMs);
    }

    // Abas em segundo plano atrasam temporizadores; ao voltar, atualiza se já passou da hora.
    function aoMudarVisibilidade(): void {
      if (
        document.visibilityState === 'visible' &&
        !buscando &&
        Date.now() - ultimaBusca >= INTERVALO_ATUALIZACAO_MS
      ) {
        void buscar();
      }
    }

    void buscar();
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      ativo = false;
      clearTimeout(proxima);
      controle?.abort();
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [tempoLimiteMs]);

  return estado;
}
