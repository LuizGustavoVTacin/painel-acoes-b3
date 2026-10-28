import type { Banco } from '../banco/conexao.js';
import type { ErroFonte, SituacaoFonte } from './erroFonte.js';

export type Provedor = 'brapi' | 'yahoo';

export interface EstadoFonte {
  provedor: Provedor;
  situacao: SituacaoFonte;
  mensagem: string | null;
  /** Desde quando a API está nesta situação. */
  desde: string;
  ultimaTentativa: string;
  ultimoSucesso: string | null;
  /** Antes deste horário a API não deve ser chamada. */
  proximaTentativa: string | null;
}

/** APIs bloqueadas ou com formato alterado são testadas de novo uma vez por dia. */
export const INTERVALO_RECHECAGEM_MS = 24 * 60 * 60 * 1000;

interface LinhaEstado {
  provedor: Provedor;
  situacao: SituacaoFonte;
  mensagem: string | null;
  desde: string;
  ultima_tentativa: string;
  ultimo_sucesso: string | null;
  proxima_tentativa: string | null;
}

function paraEstado(linha: LinhaEstado): EstadoFonte {
  return {
    provedor: linha.provedor,
    situacao: linha.situacao,
    mensagem: linha.mensagem,
    desde: linha.desde,
    ultimaTentativa: linha.ultima_tentativa,
    ultimoSucesso: linha.ultimo_sucesso,
    proximaTentativa: linha.proxima_tentativa,
  };
}

export type EstadoFontes = ReturnType<typeof criarEstadoFontes>;

/** Guarda no banco a situação de cada API externa, para avisar o usuário e evitar chamadas inúteis. */
export function criarEstadoFontes(banco: Banco) {
  const consultarUma = banco.prepare('SELECT * FROM estado_api WHERE provedor = ?');
  const listarTodas = banco.prepare('SELECT * FROM estado_api ORDER BY provedor');
  // "desde" só muda quando a situação muda; "ultimo_sucesso" só quando há sucesso.
  const gravar = banco.prepare(
    `INSERT INTO estado_api
       (provedor, situacao, mensagem, desde, ultima_tentativa, ultimo_sucesso, proxima_tentativa)
     VALUES (:provedor, :situacao, :mensagem, :agora, :agora, :sucesso, :proxima)
     ON CONFLICT (provedor) DO UPDATE SET
       situacao = excluded.situacao,
       mensagem = excluded.mensagem,
       desde = CASE WHEN estado_api.situacao = excluded.situacao
                    THEN estado_api.desde ELSE excluded.desde END,
       ultima_tentativa = excluded.ultima_tentativa,
       ultimo_sucesso = coalesce(excluded.ultimo_sucesso, estado_api.ultimo_sucesso),
       proxima_tentativa = excluded.proxima_tentativa`,
  );

  return {
    consultar(provedor: Provedor): EstadoFonte | null {
      const linha = consultarUma.get(provedor) as LinhaEstado | undefined;
      return linha ? paraEstado(linha) : null;
    },

    listar(): EstadoFonte[] {
      return (listarTodas.all() as unknown as LinhaEstado[]).map(paraEstado);
    },

    /** Falso enquanto a API estiver em espera (bloqueada, formato alterado ou limite atingido). */
    podeChamar(provedor: Provedor, agora: Date): boolean {
      const proxima = this.consultar(provedor)?.proximaTentativa;
      return !proxima || agora.getTime() >= Date.parse(proxima);
    },

    registrarSucesso(provedor: Provedor, agora: Date): void {
      const momento = agora.toISOString();
      gravar.run({
        provedor,
        situacao: 'ok',
        mensagem: null,
        agora: momento,
        sucesso: momento,
        proxima: null,
      });
    },

    registrarFalha(provedor: Provedor, erro: ErroFonte, agora: Date): void {
      const esperaLonga = erro.situacao === 'bloqueada' || erro.situacao === 'formato_alterado';
      const proxima = esperaLonga
        ? new Date(agora.getTime() + INTERVALO_RECHECAGEM_MS)
        : erro.esperarAte;
      gravar.run({
        provedor,
        situacao: erro.situacao,
        mensagem: erro.message,
        agora: agora.toISOString(),
        sucesso: null,
        proxima: proxima?.toISOString() ?? null,
      });
    },
  };
}
