import { useEffect, useState } from 'react';

type EstadoServidor = 'carregando' | 'ok' | 'indisponivel';

const TEXTO_ESTADO: Record<EstadoServidor, string> = {
  carregando: 'Servidor: verificando…',
  ok: 'Servidor: ok',
  indisponivel: 'Servidor indisponível',
};

export const TEMPO_LIMITE_SAUDE_MS = 5000;

interface PropsApp {
  /** Tempo máximo de espera pela resposta de /api/saude. */
  tempoLimiteMs?: number;
}

export function App({ tempoLimiteMs = TEMPO_LIMITE_SAUDE_MS }: PropsApp) {
  const [estado, setEstado] = useState<EstadoServidor>('carregando');

  useEffect(() => {
    const controle = new AbortController();
    let expirou = false;
    const temporizador = setTimeout(() => {
      expirou = true;
      controle.abort();
    }, tempoLimiteMs);

    fetch('/api/saude', { signal: controle.signal })
      .then(async (resposta) => {
        const corpo: unknown = resposta.ok ? await resposta.json() : null;
        const ok = (corpo as { status?: unknown } | null)?.status === 'ok';
        setEstado(ok ? 'ok' : 'indisponivel');
      })
      .catch(() => {
        // Abortar por desmontagem do componente não é falha do servidor; por tempo esgotado, é.
        if (expirou || !controle.signal.aborted) setEstado('indisponivel');
      })
      .finally(() => clearTimeout(temporizador));

    return () => {
      clearTimeout(temporizador);
      controle.abort();
    };
  }, [tempoLimiteMs]);

  return (
    <main>
      <h1>Dashboard B3</h1>
      <p role="status">{TEXTO_ESTADO[estado]}</p>
    </main>
  );
}
