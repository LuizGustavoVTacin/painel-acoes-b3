import { useEffect, useState } from 'react';

type EstadoServidor = 'carregando' | 'ok' | 'indisponivel';

const TEXTO_ESTADO: Record<EstadoServidor, string> = {
  carregando: 'Servidor: verificando…',
  ok: 'Servidor: ok',
  indisponivel: 'Servidor indisponível',
};

export function App() {
  const [estado, setEstado] = useState<EstadoServidor>('carregando');

  useEffect(() => {
    const controle = new AbortController();

    fetch('/api/saude', { signal: controle.signal })
      .then(async (resposta) => {
        const corpo: unknown = resposta.ok ? await resposta.json() : null;
        const ok = (corpo as { status?: unknown } | null)?.status === 'ok';
        setEstado(ok ? 'ok' : 'indisponivel');
      })
      .catch(() => {
        if (!controle.signal.aborted) setEstado('indisponivel');
      });

    return () => controle.abort();
  }, []);

  return (
    <main>
      <h1>Dashboard B3</h1>
      <p role="status">{TEXTO_ESTADO[estado]}</p>
    </main>
  );
}
