import type { Banco } from '../banco/conexao.js';
import type { ErroFonte, SituacaoFonte } from './erroFonte.js';

/** brapi: listagem (catálogo e preços); brapi_icones: imagens dos logos; yahoo: cotações. */
export type Provedor = 'brapi' | 'brapi_icones' | 'yahoo';

export interface EstadoFonte {
  provedor: Provedor;
  situacao: SituacaoFonte;
  /** Motivo da falha, ou um aviso quando a API funciona mas algo merece atenção. */
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

  function consultar(provedor: Provedor): EstadoFonte | null {
    const linha = consultarUma.get(provedor) as LinhaEstado | undefined;
    return linha ? paraEstado(linha) : null;
  }

  return {
    consultar,

    listar(): EstadoFonte[] {
      return (listarTodas.all() as unknown as LinhaEstado[]).map(paraEstado);
    },

    /**
     * Falso enquanto a API estiver em espera (bloqueada, formato alterado ou limite atingido).
     * Esperas que terminariam mais de 24 h no futuro só existem se o relógio do computador
     * foi atrasado depois de gravadas; nesse caso a espera é ignorada.
     */
    podeChamar(provedor: Provedor, agora: Date): boolean {
      const proxima = consultar(provedor)?.proximaTentativa;
      if (!proxima) return true;
      const faltaMs = Date.parse(proxima) - agora.getTime();
      return faltaMs <= 0 || faltaMs > INTERVALO_RECHECAGEM_MS;
    },

    /** Registra sucesso; um aviso opcional fica visível sem tirar a API de uso. */
    registrarSucesso(provedor: Provedor, agora: Date, aviso: string | null = null): void {
      const momento = agora.toISOString();
      gravar.run({
        provedor,
        situacao: 'ok',
        mensagem: aviso,
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
      const proximaValida = proxima && Number.isFinite(proxima.getTime()) ? proxima : null;
      gravar.run({
        provedor,
        situacao: erro.situacao,
        mensagem: erro.message,
        agora: agora.toISOString(),
        sucesso: null,
        proxima: proximaValida?.toISOString() ?? null,
      });
    },
  };
}
