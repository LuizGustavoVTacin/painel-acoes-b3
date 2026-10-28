/** Data de calendário sem horário, no formato ISO "AAAA-MM-DD" (como fica guardada). */
export type DataISO = string;

const ANO_MINIMO = 1900;
const ANO_MAXIMO = 9999;
const PADRAO_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const PADRAO_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const FUSO_BRASILIA = 'America/Sao_Paulo';

function dataExiste(ano: number, mes: number, dia: number): boolean {
  if (ano < ANO_MINIMO || ano > ANO_MAXIMO || mes < 1 || mes > 12 || dia < 1) return false;
  // Dia 0 do mês seguinte é o último dia deste mês.
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia <= diasNoMes;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Converte "2026-10-27" em "27/10/2026". Lança RangeError se a data for inválida. */
export function formatarData(data: DataISO): string {
  if (!ehDataISO(data)) {
    throw new RangeError(`Data inválida: "${data}"`);
  }
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Lê uma data digitada como "27/10/2026" (ou "1/2/2026") e devolve "2026-10-27". */
export function lerDataBR(texto: string): DataISO {
  const partes = PADRAO_BR.exec(texto.trim());
  const [dia, mes, ano] = partes ? partes.slice(1).map(Number) : [];
  if (!partes || !dataExiste(ano, mes, dia)) {
    throw new RangeError(`Data inválida: "${texto}". Use o formato dd/mm/aaaa`);
  }
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

const formatoHorario = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_BRASILIA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Instante ISO completo com fuso explícito (Z ou ±hh:mm); sem fuso o resultado dependeria da máquina.
const PADRAO_INSTANTE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function instanteValido(instante: Date | number | string): Date | null {
  if (typeof instante === 'string') {
    const partes = PADRAO_INSTANTE.exec(instante);
    if (!partes) return null;
    const [ano, mes, dia, hora, minuto, segundo = 0] = partes.slice(1).map((p) => Number(p ?? 0));
    if (!dataExiste(ano, mes, dia) || hora > 23 || minuto > 59 || segundo > 59) return null;
  } else if (!(instante instanceof Date) && typeof instante !== 'number') {
    return null;
  }
  const data = new Date(instante);
  const ano = data.getUTCFullYear();
  return ano >= ANO_MINIMO && ano <= ANO_MAXIMO ? data : null;
}

/**
 * Formata um instante no horário de Brasília: "27/10/2026 14:35".
 * Aceita Date, milissegundos ou texto ISO com fuso ("2026-10-27T17:35:00Z").
 * Montado a partir das partes para não depender da pontuação de cada navegador.
 */
export function formatarHorario(instante: Date | number | string): string {
  const data = instanteValido(instante);
  if (!data) {
    throw new RangeError(`Horário inválido: "${String(instante)}"`);
  }
  const partes = partesEmBrasilia(data);
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}

/** Data de hoje no calendário de Brasília, como "2026-10-27". */
export function hojeEmBrasilia(agora: Date = new Date()): DataISO {
  const partes = partesEmBrasilia(agora);
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function partesEmBrasilia(data: Date): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  return Object.fromEntries(
    formatoHorario.formatToParts(data).map(({ type, value }) => [type, value]),
  );
}

/** Indica se o texto é um instante ISO completo, com fuso, que formatarHorario aceita. */
export function ehInstanteISO(texto: string): boolean {
  return instanteValido(texto) !== null;
}

/** Indica se o texto é uma data ISO "AAAA-MM-DD" que existe no calendário. */
export function ehDataISO(texto: string): boolean {
  const partes = PADRAO_ISO.exec(texto);
  if (!partes) return false;
  const [ano, mes, dia] = partes.slice(1).map(Number);
  return dataExiste(ano, mes, dia);
}
