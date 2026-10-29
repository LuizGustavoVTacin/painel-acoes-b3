import { useEffect, useState } from 'react';
import { formatarBRL } from '../shared/dinheiro';
import type { Cotacao } from '../shared/painel';
import { calcularVariacao, type Posicao, type Variacao } from '../shared/posicao';
import { IndicadorVariacao } from './IndicadorVariacao';

/** Destaque forte no quadrado ativo e suave nos 4 vizinhos. */
export type Destaque = 'ativo' | 'vizinho' | null;

interface PropsQuadrado {
  cotacao: Cotacao;
  /** Muda a cada atualização da tela: um logo que falhou é tentado de novo. */
  rodada: number;
  destaque?: Destaque;
  /** O quadrado que recebe o Tab ao entrar na grade. */
  focavel?: boolean;
  /** Compras desta ação; sem compras, o quadrado mostra só o preço. */
  posicao?: Posicao;
  /** A ação tem compras, mas elas não puderam ser calculadas. */
  comprasComErro?: boolean;
}

const DESCRICAO: Record<Variacao['direcao'], string> = {
  alta: 'ganho sobre o preço médio:',
  baixa: 'perda sobre o preço médio:',
  neutra: 'igual ao preço médio:',
};

/** Ganho ou perda do preço atual sobre o preço médio; null se não há como calcular. */
function ganhoOuPerda(precoCentavos: number | null, posicao?: Posicao): Variacao | null {
  if (precoCentavos === null || !posicao) return null;
  try {
    return calcularVariacao(precoCentavos, posicao);
  } catch (erro) {
    console.error('Não foi possível calcular o ganho ou a perda:', erro);
    return null;
  }
}

const ORIENTACAO_ERRO = 'Confira as compras desta ação em Menu → Registrar compras';

const quantasAcoes = (quantidade: number) =>
  `${quantidade.toLocaleString('pt-BR')} ${quantidade === 1 ? 'ação' : 'ações'}`;

const resumoDaPosicao = (posicao: Posicao) =>
  `Preço médio ${formatarBRL(posicao.precoMedio)} · ${quantasAcoes(posicao.quantidadeTotal)}`;

/** Um quadrado da grade: logo, código, preço atual e, se houve compra, o ganho ou a perda. */
export function QuadradoAcao({
  cotacao,
  rodada,
  destaque = null,
  focavel = false,
  posicao,
  comprasComErro = false,
}: PropsQuadrado) {
  const { ticker, precoCentavos, desatualizada } = cotacao;
  const variacao = ganhoOuPerda(precoCentavos, posicao);
  const [semLogo, setSemLogo] = useState(false);
  const endereco = `/api/logos/${ticker}`;

  // Sem logo, as iniciais ficam na tela e o logo é testado por fora a cada atualização;
  // só troca se carregar, para o quadrado não piscar.
  useEffect(() => {
    if (!semLogo) return;
    const teste = new Image();
    teste.onload = () => setSemLogo(false);
    teste.src = endereco;
    return () => {
      teste.onload = null;
    };
  }, [semLogo, rodada, endereco]);

  return (
    <li
      className={[
        'quadrado',
        desatualizada && 'quadrado-desatualizado',
        destaque && `quadrado-${destaque}`,
      ]
        .filter(Boolean)
        .join(' ')}
      data-ticker={ticker}
      tabIndex={focavel ? 0 : -1}
      aria-current={destaque === 'ativo' ? 'true' : undefined}
    >
      {semLogo ? (
        <span className="logo logo-iniciais" aria-hidden="true">
          {ticker.slice(0, 2)}
        </span>
      ) : (
        <img
          className="logo"
          src={endereco}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          onError={() => setSemLogo(true)}
        />
      )}
      <span className="ticker">{ticker}</span>
      <span className="preco">
        {precoCentavos === null ? 'sem cotação' : formatarBRL(precoCentavos)}
      </span>
      {variacao && posicao && (
        <>
          <IndicadorVariacao
            centesimos={variacao.centesimosDePercentual}
            direcao={variacao.direcao}
            descricao={DESCRICAO[variacao.direcao]}
            className="ganho-perda"
            title={resumoDaPosicao(posicao)}
          />
          {/* O title não aparece no toque nem no teclado; o leitor de tela ouve aqui. */}
          <span className="apenas-leitor">{`, ${resumoDaPosicao(posicao)}`}</span>
        </>
      )}
      {/* Comprada, mas sem como calcular: não pode parecer uma ação sem compras. */}
      {(comprasComErro || (posicao && precoCentavos !== null && !variacao)) && (
        <span className="ganho-perda variacao-neutra" title={ORIENTACAO_ERRO}>
          erro nas compras
          <span className="apenas-leitor">{`. ${ORIENTACAO_ERRO}`}</span>
        </span>
      )}
      {desatualizada && <span className="selo-desatualizado">desatualizado</span>}
    </li>
  );
}
