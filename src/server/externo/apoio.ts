import { hojeEmBrasilia } from '../../shared/datas.js';
import type { RepositorioUsoApi } from '../banco/usoApi.js';
import { ErroFonte } from './erroFonte.js';
import type { EstadoFontes, Provedor } from './estadoFontes.js';

/**
 * Indica se já passou o intervalo desde o instante gravado. Um instante no futuro só existe
 * se o relógio do computador foi atrasado; nesse caso considera que já passou.
 */
export function passou(intervaloMs: number, desde: string | undefined, agora: Date): boolean {
  if (desde === undefined) return true;
  const decorrido = agora.getTime() - Date.parse(desde);
  return !(decorrido >= 0 && decorrido < intervaloMs);
}

/** Executa uma gravação auxiliar sem nunca lançar: um erro aqui não pode derrubar a rota. */
export function semFalhar(descricao: string, gravacao: () => void): void {
  try {
    gravacao();
  } catch (erro) {
    console.error(`Não foi possível ${descricao}:`, erro);
  }
}

/** Registra a falha de uma API sem nunca lançar; erros não classificados viram instabilidade. */
export function registrarFalha(
  estado: EstadoFontes,
  provedor: Provedor,
  erro: unknown,
  momento: Date,
): void {
  const falha =
    erro instanceof ErroFonte
      ? erro
      : new ErroFonte('instavel', 'Erro inesperado ao processar os dados da API');
  if (!(erro instanceof ErroFonte)) console.error(`Erro inesperado (${provedor}):`, erro);
  semFalhar(`registrar a falha de ${provedor}`, () =>
    estado.registrarFalha(provedor, falha, momento),
  );
}

/** Consulta se a API pode ser chamada; se o banco falhar, não chama (sem nunca lançar). */
export function podeChamar(estado: EstadoFontes, provedor: Provedor, momento: Date): boolean {
  try {
    return estado.podeChamar(provedor, momento);
  } catch (erro) {
    console.error(`Não foi possível consultar o estado de ${provedor}:`, erro);
    return false;
  }
}

/** Conta uma chamada à API no mês corrente (horário de Brasília), sem nunca lançar. */
export function contarUso(uso: RepositorioUsoApi, provedor: Provedor, momento: Date): void {
  semFalhar(`contar o uso de ${provedor}`, () =>
    uso.registrar(provedor, hojeEmBrasilia(momento).slice(0, 7)),
  );
}
