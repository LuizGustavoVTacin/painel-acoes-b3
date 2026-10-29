import { formatarPercentual, type Direcao } from '../shared/posicao';

interface PropsIndicador {
  /** Variação em centésimos de ponto percentual: 235 = +2,35%. */
  centesimos: number;
  /** O que a variação mede, lido só pelo leitor de tela (ex.: "variação do dia"). */
  descricao: string;
  /** Direção, quando vem de uma conta mais precisa que o percentual arredondado. */
  direcao?: Direcao;
  className?: string;
  title?: string;
}

const SETAS: Record<Direcao, string> = { alta: '▲ ', baixa: '▼ ', neutra: '' };

/**
 * Percentual com sinal. Uma variação menor que 0,005% arredonda para zero, mas tem direção:
 * aparece como "+0,00%" ou "-0,00%", para o texto não contradizer a seta e a cor.
 */
function textoDoPercentual(centesimos: number, direcao: Direcao): string {
  if (centesimos !== 0 || direcao === 'neutra') return formatarPercentual(centesimos);
  return `${direcao === 'alta' ? '+' : '-'}${formatarPercentual(0)}`;
}

/**
 * Variação com seta e sinal: "▲ +2,35%" em verde, "▼ -1,10%" em vermelho, "0,00%" em cinza.
 * A cor nunca é a única pista (há seta e sinal).
 */
export function IndicadorVariacao({
  centesimos,
  descricao,
  direcao = centesimos > 0 ? 'alta' : centesimos < 0 ? 'baixa' : 'neutra',
  className,
  title,
}: PropsIndicador) {
  return (
    <span
      className={['variacao', `variacao-${direcao}`, className].filter(Boolean).join(' ')}
      title={title}
    >
      <span className="apenas-leitor">{descricao} </span>
      <span aria-hidden="true">{SETAS[direcao]}</span>
      {textoDoPercentual(centesimos, direcao)}
    </span>
  );
}
