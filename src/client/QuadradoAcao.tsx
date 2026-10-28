import { useState } from 'react';
import { formatarBRL } from '../shared/dinheiro';
import type { Cotacao } from '../shared/painel';

/** Um quadrado da grade: logo, código e preço atual. */
export function QuadradoAcao({ cotacao }: { cotacao: Cotacao }) {
  const { ticker, precoCentavos, desatualizada } = cotacao;
  const [semLogo, setSemLogo] = useState(false);

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
          onError={() => setSemLogo(true)}
        />
      )}
      <span className="ticker">{ticker}</span>
      <span className="preco">
        {precoCentavos === null ? 'sem cotação' : formatarBRL(precoCentavos)}
      </span>
      {desatualizada && (
        <span className="selo-desatualizado" title="O preço não foi atualizado nas últimas buscas">
          desatualizado
        </span>
      )}
    </li>
  );
}
