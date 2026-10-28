import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function simularFetch(implementacao: () => Promise<Response>) {
  const fetchFalso = vi.fn(implementacao);
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

describe('App', () => {
  afterEach(cleanup);

  it('mostra o título e o estado inicial de verificação', () => {
    simularFetch(() => new Promise(() => {}));
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Dashboard B3' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Servidor: verificando…');
  });

  it('consulta /api/saude e mostra ok quando o servidor responde', async () => {
    const fetchFalso = simularFetch(async () => Response.json({ status: 'ok' }));
    render(<App />);

    expect(await screen.findByText('Servidor: ok')).toBeInTheDocument();
    expect(fetchFalso).toHaveBeenCalledWith('/api/saude', expect.anything());
  });

  it('mostra indisponível quando a requisição falha', async () => {
    simularFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<App />);

    expect(await screen.findByText('Servidor indisponível')).toBeInTheDocument();
  });

  it('mostra indisponível quando o servidor responde com erro', async () => {
    simularFetch(async () => new Response('falhou', { status: 500 }));
    render(<App />);

    expect(await screen.findByText('Servidor indisponível')).toBeInTheDocument();
  });

  it('mostra indisponível quando o servidor não responde dentro do tempo limite', async () => {
    const fetchFalso = vi.fn(
      (_url: string, opcoes?: RequestInit) =>
        new Promise<Response>((_resolver, rejeitar) => {
          opcoes?.signal?.addEventListener('abort', () =>
            rejeitar(new DOMException('Abortado', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchFalso);
    render(<App tempoLimiteMs={20} />);

    expect(await screen.findByText('Servidor indisponível')).toBeInTheDocument();
  });
});
