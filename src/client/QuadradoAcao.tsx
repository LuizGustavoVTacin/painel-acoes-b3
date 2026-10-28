import { useEffect, useState } from 'react';
import { formatarBRL } from '../shared/dinheiro';
import type { Cotacao } from '../shared/painel';

/** Destaque forte no quadrado ativo e suave nos 4 vizinhos. */
export type Destaque = 'ativo' | 'vizinho' | null;

interface PropsQuadrado {
  cotacao: Cotacao;
  /** Muda a cada atualização da tela: um logo que falhou é tentado de novo. */
  rodada: number;
  destaque?: Destaque;
  /** O quadrado que recebe o Tab ao entrar na grade. */
  focavel?: boolean;
}

/** Um quadrado da grade: logo, código e preço atual. */
export function QuadradoAcao({ cotacao, rodada, destaque = null, focavel = false }: PropsQuadrado) {
  const { ticker, precoCentavos, desatualizada } = cotacao;
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
      {desatualizada && <span className="selo-desatualizado">desatualizado</span>}
    </li>
  );
}
