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
  /** Quantas buscas deram certo; muda a cada busca, para a tela tentar de novo o que falhou. */
  recebimentos: number;
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
    recebimentos: 0,
  });

  useEffect(() => {
    let ativo = true;
    let buscando = false;
    /** O horário da busca chegou com a aba escondida: fica para quando ela voltar. */
    let adiada = false;
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
        setEstado((anterior) => ({
          dados,
          erro: null,
          carregando: false,
          recebimentos: anterior.recebimentos + 1,
        }));
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
      proxima = setTimeout(buscarSeVisivel, esperaMs);
    }

    // Aba escondida não busca: ninguém está olhando, e várias abas não multiplicam as buscas.
    function buscarSeVisivel(): void {
      if (document.visibilityState === 'hidden') {
        adiada = true;
        return;
      }
      void buscar();
    }

    // Ao voltar para a aba, busca se a vez dela passou ou se a última busca já é antiga
    // (abas em segundo plano também atrasam os temporizadores).
    function aoMudarVisibilidade(): void {
      if (
        document.visibilityState === 'visible' &&
        !buscando &&
        (adiada || Date.now() - ultimaBusca >= INTERVALO_ATUALIZACAO_MS)
      ) {
        adiada = false;
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
