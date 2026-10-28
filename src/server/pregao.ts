import { hojeEmBrasilia } from '../shared/datas.js';

/** Pregão regular informado pelo Yahoo (instantes ISO em UTC). */
export interface Pregao {
  inicio: string;
  fim: string;
}

/**
 * - aberto: pregão regular em andamento;
 * - leilao: logo após o fim, quando sai o preço de fechamento (leilão até ~17h10);
 * - desconhecido: dia útil perto do horário de pregão, mas o Yahoo ainda não confirmou o
 *   pregão do dia (início do dia ou feriado);
 * - fechado: noite, fim de semana.
 */
export type SituacaoPregao = 'aberto' | 'leilao' | 'desconhecido' | 'fechado';

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
/** Depois do fim do pregão, o preço de fechamento sai no leilão; 30 min cobrem com folga. */
export const APOS_FECHAMENTO_MS = 30 * MINUTO;
/** Folga antes da abertura projetada, caso a B3 abra mais cedo que no dia anterior. */
const ANTES_DA_ABERTURA_MS = HORA;
/** Logo após a abertura projetada, busca no ritmo do pregão para não atrasar os 1ºs preços. */
const INICIO_DO_DIA_MS = 30 * MINUTO;

const INTERVALOS: Record<SituacaoPregao, number> = {
  aberto: 5 * MINUTO,
  leilao: 5 * MINUTO,
  desconhecido: 15 * MINUTO,
  fechado: HORA,
};

const somar = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

function ehDiaUtil(instante: Date): boolean {
  const diaDaSemana = new Date(`${hojeEmBrasilia(instante)}T12:00:00Z`).getUTCDay();
  return diaDaSemana >= 1 && diaDaSemana <= 5;
}

/** Horário habitual da B3 (10h às 17h em Brasília), usado se o Yahoo nunca informar o pregão. */
function pregaoHabitual(agora: Date): Pregao {
  const hoje = hojeEmBrasilia(agora);
  return { inicio: `${hoje}T13:00:00.000Z`, fim: `${hoje}T20:00:00.000Z` };
}

/** Pregão guardado projetado para o dia de hoje (mesmo horário), se for de um dia anterior. */
function projetarParaHoje(pregao: Pregao, agora: Date): Pregao | null {
  const dias = Math.floor(
    (agora.getTime() + ANTES_DA_ABERTURA_MS - Date.parse(pregao.inicio)) / DIA,
  );
  if (dias < 1) return null;
  return { inicio: somar(pregao.inicio, dias * DIA), fim: somar(pregao.fim, dias * DIA) };
}

export function situacaoDoPregao(pregao: Pregao | undefined, agora: Date): SituacaoPregao {
  const instante = agora.toISOString();
  if (!pregao) {
    // Sem confirmação do Yahoo, o horário habitual pode ser feriado: situação desconhecida.
    const habitual = pregaoHabitual(agora);
    const fimDoLeilao = somar(habitual.fim, APOS_FECHAMENTO_MS);
    const naJanela = habitual.inicio <= instante && instante < fimDoLeilao;
    return ehDiaUtil(agora) && naJanela ? 'desconhecido' : 'fechado';
  }
  const conhecido = pregao;
  if (conhecido.inicio <= instante && instante < conhecido.fim) return 'aberto';
  const fimDoLeilao = somar(conhecido.fim, APOS_FECHAMENTO_MS);
  if (conhecido.fim <= instante && instante < fimDoLeilao) return 'leilao';

  const hoje = pregao && projetarParaHoje(pregao, agora);
  if (hoje && ehDiaUtil(new Date(hoje.inicio))) {
    const abreJanela = somar(hoje.inicio, -ANTES_DA_ABERTURA_MS);
    const fechaJanela = somar(hoje.fim, APOS_FECHAMENTO_MS);
    if (abreJanela <= instante && instante < fechaJanela) return 'desconhecido';
  }
  return 'fechado';
}

/** Intervalo mínimo entre atualizações de uma mesma ação. */
export function intervaloDeAtualizacao(pregao: Pregao | undefined, agora: Date): number {
  const situacao = situacaoDoPregao(pregao, agora);
  const hoje = pregao && projetarParaHoje(pregao, agora);
  if (situacao === 'desconhecido' && hoje) {
    const instante = agora.toISOString();
    const inicioDoDia = hoje.inicio <= instante && instante < somar(hoje.inicio, INICIO_DO_DIA_MS);
    if (inicioDoDia) return INTERVALOS.aberto;
  }
  return INTERVALOS[situacao];
}

/**
 * Momentos em que vale buscar de novo, mesmo dentro do intervalo: o fim do leilão (preço de
 * fechamento definitivo) e a abertura projetada do dia (para descobrir logo o pregão novo).
 * Devolve só os que já passaram.
 */
export function marcosDoPregao(pregao: Pregao | undefined, agora: Date): string[] {
  if (!pregao) return [];
  const marcos = [somar(pregao.fim, APOS_FECHAMENTO_MS)];
  const hoje = projetarParaHoje(pregao, agora);
  if (hoje) marcos.push(hoje.inicio);
  const instante = agora.toISOString();
  return marcos.filter((marco) => marco <= instante);
}
