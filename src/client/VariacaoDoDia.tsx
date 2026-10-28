import { formatarPercentual } from '../shared/posicao';

/**
 * Variação do dia com seta e sinal: "▲ +2,35%", "▼ -1,10%", "0,00%". A cor nunca é a única
 * pista (há seta e sinal), e o leitor de tela ouve "variação do dia +2,35%".
 */
export function VariacaoDoDia({ centesimos }: { centesimos: number }) {
  const direcao = centesimos > 0 ? 'alta' : centesimos < 0 ? 'baixa' : 'neutra';
  const seta = { alta: '▲ ', baixa: '▼ ', neutra: '' }[direcao];
  return (
    <span className={`escolha-variacao variacao-${direcao}`}>
      <span className="so-leitor">variação do dia </span>
      <span aria-hidden="true">{seta}</span>
      {formatarPercentual(centesimos)}
    </span>
  );
}
