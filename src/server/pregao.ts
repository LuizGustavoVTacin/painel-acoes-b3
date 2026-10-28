import { hojeEmBrasilia } from '../shared/datas.js';

/** Pregão regular informado pelo Yahoo (instantes ISO em UTC). */
export interface Pregao {
  inicio: string;
  fim: string;
}

/**
 * - aberto: pregão regular em andamento;
 * - leilao: logo após o fim, quando sai o preço de fechamento (leilão até ~17h10);
 * - desconhecido: dia útil no horário de pregão, mas o Yahoo ainda não confirmou o pregão
 *   do dia (início do dia ou feriado);
 * - fechado: noite, fim de semana.
 */
export type SituacaoPregao = 'aberto' | 'leilao' | 'desconhecido' | 'fechado';

const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;
/** Depois do fim do pregão, o preço de fechamento sai no leilão; 30 min cobrem com folga. */
export const APOS_FECHAMENTO_MS = 30 * MINUTO;

const INTERVALOS: Record<SituacaoPregao, number> = {
  aberto: 5 * MINUTO,
  leilao: 5 * MINUTO,
  desconhecido: 15 * MINUTO,
  fechado: 60 * MINUTO,
};

const somar = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** Dias inteiros desde o início do pregão guardado (0 = mesmo dia do pregão). */
function diasDesdeOPregao(pregao: Pregao, agora: Date): number {
  return Math.floor((agora.getTime() - Date.parse(pregao.inicio)) / DIA);
}

function ehDiaUtil(instante: Date): boolean {
  const diaDaSemana = new Date(`${hojeEmBrasilia(instante)}T12:00:00Z`).getUTCDay();
  return diaDaSemana >= 1 && diaDaSemana <= 5;
}

export function situacaoDoPregao(pregao: Pregao | undefined, agora: Date): SituacaoPregao {
  if (!pregao) return 'desconhecido';
  const instante = agora.toISOString();
  if (pregao.inicio <= instante && instante < pregao.fim) return 'aberto';
  if (pregao.fim <= instante && instante < somar(pregao.fim, APOS_FECHAMENTO_MS)) return 'leilao';

  // Pregão guardado é de outro dia: projeta o mesmo horário para hoje.
  const dias = diasDesdeOPregao(pregao, agora);
  if (dias >= 1) {
    const inicioHoje = somar(pregao.inicio, dias * DIA);
    const fimHoje = somar(pregao.fim, dias * DIA + APOS_FECHAMENTO_MS);
    if (inicioHoje <= instante && instante < fimHoje && ehDiaUtil(new Date(inicioHoje))) {
      return 'desconhecido';
    }
  }
  return 'fechado';
}

/** Intervalo mínimo entre atualizações de uma mesma ação. */
export function intervaloDeAtualizacao(situacao: SituacaoPregao): number {
  return INTERVALOS[situacao];
}

/**
 * Momentos em que vale buscar de novo, mesmo dentro do intervalo: o fim do leilão (preço de
 * fechamento definitivo) e a abertura projetada do dia (para descobrir logo o pregão novo).
 * Devolve só os que já passaram.
 */
export function marcosDoPregao(pregao: Pregao | undefined, agora: Date): string[] {
  if (!pregao) return [];
  const dias = diasDesdeOPregao(pregao, agora);
  const marcos = [somar(pregao.fim, APOS_FECHAMENTO_MS)];
  if (dias >= 1) marcos.push(somar(pregao.inicio, dias * DIA));
  const instante = agora.toISOString();
  return marcos.filter((marco) => marco <= instante);
}
