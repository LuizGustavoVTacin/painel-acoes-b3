import type { Banco } from './conexao.js';

/** Mês de referência da contagem, como "2026-10". */
export type MesISO = string;

export type RepositorioUsoApi = ReturnType<typeof criarRepositorioUsoApi>;

/** Conta as requisições feitas a cada API externa por mês (para respeitar limites gratuitos). */
export function criarRepositorioUsoApi(banco: Banco) {
  const somar = banco.prepare(
    `INSERT INTO uso_api (provedor, mes, requisicoes) VALUES (:provedor, :mes, :quantidade)
     ON CONFLICT (provedor, mes) DO UPDATE SET requisicoes = requisicoes + :quantidade`,
  );
  const consultarMes = banco.prepare(
    'SELECT requisicoes FROM uso_api WHERE provedor = ? AND mes = ?',
  );

  return {
    registrar(provedor: string, mes: MesISO, quantidade = 1): void {
      if (!Number.isSafeInteger(quantidade) || quantidade < 1) {
        throw new RangeError(`Quantidade de requisições inválida: ${quantidade}`);
      }
      somar.run({ provedor, mes, quantidade });
    },

    consultar(provedor: string, mes: MesISO): number {
      const linha = consultarMes.get(provedor, mes) as { requisicoes: number } | undefined;
      return linha?.requisicoes ?? 0;
    },
  };
}
