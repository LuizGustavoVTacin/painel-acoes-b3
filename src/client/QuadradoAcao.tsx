import { useState } from 'react';
import { formatarBRL } from '../shared/dinheiro';
import type { Cotacao } from '../shared/painel';

interface PropsQuadrado {
  cotacao: Cotacao;
  /** Muda a cada atualização da tela: um logo que falhou é tentado de novo. */
  rodada: number;
}

/** Um quadrado da grade: logo, código e preço atual. */
export function QuadradoAcao({ cotacao, rodada }: PropsQuadrado) {
  const { ticker, precoCentavos, desatualizada } = cotacao;
  const [falhouNaRodada, setFalhouNaRodada] = useState<number | null>(null);
  const semLogo = falhouNaRodada === rodada;

  return (
    <li className={desatualizada ? 'quadrado quadrado-desatualizado' : 'quadrado'}>
      {semLogo ? (
        <span className="logo logo-iniciais" aria-hidden="true">
          {ticker.slice(0, 2)}
        </span>
      ) : (
        <img
          className="logo"
          src={`/api/logos/${ticker}`}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          onError={() => setFalhouNaRodada(rodada)}
        />
      )}
      <span className="ticker">{ticker}</span>
      <span className="preco">
        {precoCentavos === null ? 'sem cotação' : formatarBRL(precoCentavos)}
      </span>
      {desatualizada && <span className="selo-desatualizado">desatualizado</span>}
    </li>
  );
}
