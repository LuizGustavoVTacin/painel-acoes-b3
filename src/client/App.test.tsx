import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RespostaCotacoes } from '../shared/painel';
import { ESPERA_ACAO_SEM_DADOS_MS, ESPERA_APOS_FALHA_MS, INTERVALO_ATUALIZACAO_MS } from './agenda';
import { App } from './App';
import { cotacao, fonte, resposta } from './testes/respostas';

type Resposta = RespostaCotacoes | Response | Error;

/** Simula o servidor: cada chamada consome a próxima resposta; a última se repete. */
function simularServidor(...respostas: Resposta[]) {
  const fetchFalso = vi.fn(async () => {
    const proxima = respostas.length > 1 ? respostas.shift()! : respostas[0];
    if (proxima instanceof Error) throw proxima;
    if (proxima instanceof Response) return proxima.clone();
    return Response.json(proxima);
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

/** Deixa promessas e temporizadores correrem dentro do act, com o relógio falso. */
async function avancar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function quadrados() {
  return within(screen.getByRole('list', { name: 'Ações acompanhadas' })).getAllByRole('listitem');
}

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T21:00:00Z'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mostra o carregamento e depois a grade com logo, código e preço', async () => {
    simularServidor(resposta());
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando cotações…');

    await avancar();

    const [bbas3, petr4] = quadrados();
    expect(bbas3).toHaveTextContent('BBAS3');
    expect(bbas3).toHaveTextContent('R$ 17,38');
    expect(bbas3.querySelector('img')).toHaveAttribute('src', '/api/logos/BBAS3');
    expect(petr4).toHaveTextContent('R$ 52,79');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('mostra a situação do mercado e o horário da última atualização (Brasília)', async () => {
    simularServidor(resposta());
    render(<App />);
    await avancar();

    expect(screen.getByText('Mercado fechado · último fechamento')).toBeInTheDocument();
    expect(screen.getByText('Atualizado em 27/10/2026 17:44')).toBeInTheDocument();
  });

  it('ação sem preço mostra "sem cotação"; desatualizada ganha um selo', async () => {
    simularServidor(
      resposta({
        cotacoes: [cotacao('ELET3', null), cotacao('BBAS3', 1738, { desatualizada: true })],
      }),
    );
    render(<App />);
    await avancar();

    const [elet3, bbas3] = quadrados();
    expect(elet3).toHaveTextContent('sem cotação');
    expect(bbas3).toHaveTextContent('desatualizado');
    expect(bbas3).toHaveClass('quadrado-desatualizado');
  });

  it('logo que não carrega vira as iniciais do código', async () => {
    simularServidor(resposta());
    render(<App />);
    await avancar();

    const [bbas3] = quadrados();
    fireEvent.error(bbas3.querySelector('img')!);

    expect(bbas3.querySelector('img')).toBeNull();
    expect(bbas3).toHaveTextContent('BB');
  });

  it('nenhuma ação selecionada: mostra a mensagem, sem grade', async () => {
    simularServidor(resposta({ cotacoes: [], fontesEmUso: [] }));
    render(<App />);
    await avancar();

    expect(screen.getByText(/Nenhuma ação selecionada/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Ações acompanhadas' })).not.toBeInTheDocument();
  });

  it('rodapé mostra a fonte em uso e os avisos das APIs', async () => {
    simularServidor(
      resposta({
        fontesEmUso: ['brapi'],
        semCotacaoNoYahoo: ['ELET3'],
        fontes: [fonte('yahoo', 'bloqueada'), fonte('brapi')],
      }),
    );
    render(<App />);
    await avancar();

    const rodape = screen.getByRole('contentinfo');
    expect(rodape).toHaveTextContent('Cotações: brapi (reserva)');
    const avisos = within(rodape).getAllByRole('listitem');
    expect(avisos[0]).toHaveTextContent('Yahoo Finance passou a exigir pagamento ou chave');
    expect(avisos[0]).toHaveClass('aviso-erro');
    expect(avisos[1]).toHaveTextContent('Sem cotação no Yahoo: ELET3');
  });

  it('servidor fora do ar na abertura: mostra o erro', async () => {
    simularServidor(new TypeError('Failed to fetch'));
    render(<App />);
    await avancar();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível falar com o servidor do dashboard.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('servidor que não responde a tempo: desiste e mostra o erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opcoes?: RequestInit) =>
          new Promise((_resolver, rejeitar) => {
            opcoes?.signal?.addEventListener('abort', () =>
              rejeitar(new DOMException('Abortado', 'AbortError')),
            );
          }),
      ),
    );
    render(<App tempoLimiteMs={1000} />);
    await avancar(1000);

    expect(screen.getByRole('alert')).toHaveTextContent('demorou demais para responder');
  });

  it('atualiza a cada 5 minutos', async () => {
    const fetchFalso = simularServidor(
      resposta(),
      resposta({ cotacoes: [cotacao('BBAS3', 1800), cotacao('PETR4', 5279)] }),
    );
    render(<App />);
    await avancar();
    await avancar(INTERVALO_ATUALIZACAO_MS - 1);
    expect(fetchFalso).toHaveBeenCalledTimes(1);

    await avancar(1);

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(quadrados()[0]).toHaveTextContent('R$ 18,00');
  });

  it('falha numa atualização mantém os últimos preços e avisa; volta ao normal depois', async () => {
    const fetchFalso = simularServidor(
      resposta(),
      new Response('falhou', { status: 500 }),
      resposta(),
    );
    render(<App />);
    await avancar();
    await avancar(INTERVALO_ATUALIZACAO_MS);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'O servidor do dashboard respondeu com erro (500). Mostrando os últimos dados recebidos.',
    );
    expect(quadrados()[0]).toHaveTextContent('R$ 17,38');

    await avancar(ESPERA_APOS_FALHA_MS);

    expect(fetchFalso).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ação recém-marcada sem preço: pergunta de novo em 10 s', async () => {
    const fetchFalso = simularServidor(
      resposta({ cotacoes: [cotacao('AXIA3', null)] }),
      resposta({ cotacoes: [cotacao('AXIA3', 4200)] }),
    );
    render(<App />);
    await avancar();
    await avancar(ESPERA_ACAO_SEM_DADOS_MS);

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(quadrados()[0]).toHaveTextContent('R$ 42,00');

    // Com o preço, volta ao ritmo normal.
    await avancar(INTERVALO_ATUALIZACAO_MS - 1);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('ao voltar para a aba, atualiza só se a última busca tiver mais de 5 minutos', async () => {
    const fetchFalso = simularServidor(resposta());
    let visibilidade: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilidade);
    render(<App />);
    await avancar();

    // Volta logo: nada a fazer.
    visibilidade = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibilidade = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await avancar();
    expect(fetchFalso).toHaveBeenCalledTimes(1);

    // Aba em segundo plano com temporizadores atrasados: o relógio anda, o temporizador não.
    vi.setSystemTime(Date.now() + INTERVALO_ATUALIZACAO_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    await avancar();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('ao fechar, para de buscar', async () => {
    const fetchFalso = simularServidor(resposta());
    const { unmount } = render(<App />);
    await avancar();
    unmount();

    await avancar(INTERVALO_ATUALIZACAO_MS * 3);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
