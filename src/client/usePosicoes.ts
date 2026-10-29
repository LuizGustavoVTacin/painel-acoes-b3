import { useEffect, useState } from 'react';
import { buscarPosicoes, type Posicoes } from './api';
import { ESPERA_APOS_FALHA_MS } from './agenda';
import { TEMPO_LIMITE_PAINEL_MS, useCarga } from './useCarga';

export interface EstadoPosicoes {
  /** Últimas posições lidas; null até a primeira leitura dar certo. */
  posicoes: Posicoes | null;
  /**
   * A última leitura falhou (e ainda não houve uma que desse certo). Vale também durante a
   * nova tentativa, para o aviso não piscar.
   */
  falhou: boolean;
  /** Ainda não houve leitura que desse certo (as setas não aparecem). */
  nuncaLeu: boolean;
  /** Lê de novo, mantendo as posições atuais até a resposta chegar. Função estável. */
  recarregar: () => void;
}

/**
 * Posições das ações compradas, para as setas de ganho e perda. São relidas a cada nova rodada
 * de cotações (só o banco local: compras feitas em outra aba aparecem) e, com falha, a cada
 * minuto, sem depender das cotações darem certo.
 */
export function usePosicoes(rodadaDeCotacoes: number): EstadoPosicoes {
  const [carga, , recarregar] = useCarga(buscarPosicoes, TEMPO_LIMITE_PAINEL_MS);
  const [falhou, setFalhou] = useState(false);

  const falhaAgora =
    carga.situacao === 'erro' || (carga.situacao === 'ok' && !!carga.desatualizada);
  const leuAgora = carga.situacao === 'ok' && !carga.desatualizada;
  // Ajuste durante a renderização: "carregando" (nova tentativa) não muda nada.
  if (falhaAgora && !falhou) setFalhou(true);
  if (leuAgora && falhou) setFalhou(false);

  // A primeira rodada coincide com a leitura da abertura; dali em diante, relê a cada uma.
  useEffect(() => {
    if (rodadaDeCotacoes > 1) recarregar();
  }, [rodadaDeCotacoes, recarregar]);

  useEffect(() => {
    if (!falhou) return;
    const repetir = setInterval(recarregar, ESPERA_APOS_FALHA_MS);
    return () => clearInterval(repetir);
  }, [falhou, recarregar]);

  return {
    posicoes: carga.situacao === 'ok' ? carga.dados : null,
    falhou,
    nuncaLeu: carga.situacao !== 'ok',
    recarregar,
  };
}
