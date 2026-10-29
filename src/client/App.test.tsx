import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RespostaCotacoes } from '../shared/painel';
import { ESPERA_ACAO_SEM_DADOS_MS, ESPERA_APOS_FALHA_MS, INTERVALO_ATUALIZACAO_MS } from './agenda';
import { App } from './App';
import { LimiteDeErro } from './LimiteDeErro';
import { cotacao, fonte, resposta } from './testes/respostas';

type Resposta = RespostaCotacoes | Response | Error;

/** Posições que GET /api/posicoes devolve nos testes (o padrão: nenhuma compra). */
let posicoesFalsas: () => Response | Promise<Response> = () =>
  Response.json({ posicoes: {}, erros: {} });
let pedidosDePosicoes = 0;

/**
 * Instala o fetch falso: /api/posicoes é respondido à parte, para os testes de cotação
 * contarem só as próprias chamadas.
 */
function instalarFetch(fetchFalso: (endereco: string, opcoes?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', (endereco: string, opcoes?: RequestInit) => {
    if (endereco === '/api/posicoes') {
      pedidosDePosicoes++;
      return Promise.resolve(posicoesFalsas());
    }
    return fetchFalso(endereco, opcoes);
  });
}

/** Simula o servidor: cada chamada consome a próxima resposta; a última se repete. */
function simularServidor(...respostas: Resposta[]) {
  const fetchFalso = vi.fn(async () => {
    const proxima = respostas.length > 1 ? respostas.shift()! : respostas[0];
    if (proxima instanceof Error) throw proxima;
    if (proxima instanceof Response) return proxima.clone();
    return Response.json(proxima);
  });
  instalarFetch(fetchFalso);
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
    posicoesFalsas = () => Response.json({ posicoes: {}, erros: {} });
    pedidosDePosicoes = 0;
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
    expect(avisos[0]).toHaveTextContent('Yahoo Finance: passou a exigir pagamento ou chave');
    expect(avisos[0]).toHaveClass('aviso-erro');
    expect(avisos[1]).toHaveTextContent('Sem cotação no Yahoo: ELET3');
  });

  it('servidor fora do ar na abertura: mostra o erro', async () => {
    simularServidor(new TypeError('Failed to fetch'));
    render(<App />);
    await avancar();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível falar com o servidor do dashboard. Nova tentativa em 1 minuto.',
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

  it('logo que falhou é testado por fora a cada atualização, sem piscar', async () => {
    // O jsdom não carrega imagens: cada teste de logo fica registrado e é concluído à mão.
    const testes: { src: string; onload: (() => void) | null }[] = [];
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload: (() => void) | null = null;
        constructor() {
          testes.push(this);
        }
      },
    );
    simularServidor(resposta());
    render(<App />);
    await avancar();
    fireEvent.error(quadrados()[0].querySelector('img')!);
    expect(testes).toHaveLength(1); // o teste começa logo após a falha
    expect(testes[0].src).toBe('/api/logos/BBAS3');

    // Nova atualização: outro teste, e as iniciais continuam enquanto ele não carrega.
    await avancar(INTERVALO_ATUALIZACAO_MS);
    expect(testes).toHaveLength(2);
    expect(quadrados()[0].querySelector('img')).toBeNull();
    expect(quadrados()[0]).toHaveTextContent('BB');

    await act(async () => testes[1].onload?.());

    expect(quadrados()[0].querySelector('img')).toHaveAttribute('src', '/api/logos/BBAS3');
  });

  it('aba escondida não busca; a busca adiada acontece ao voltar', async () => {
    const fetchFalso = simularServidor(resposta());
    let visibilidade: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilidade);
    render(<App />);
    await avancar();

    visibilidade = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await avancar(INTERVALO_ATUALIZACAO_MS * 3);
    expect(fetchFalso).toHaveBeenCalledTimes(1);

    visibilidade = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await avancar();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('busca rápida adiada pela aba escondida acontece logo ao voltar', async () => {
    const fetchFalso = simularServidor(
      resposta({ cotacoes: [cotacao('AXIA3', null)] }),
      resposta({ cotacoes: [cotacao('AXIA3', 4200)] }),
    );
    let visibilidade: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilidade);
    render(<App />);
    await avancar();

    visibilidade = 'hidden';
    await avancar(ESPERA_ACAO_SEM_DADOS_MS * 2);
    expect(fetchFalso).toHaveBeenCalledTimes(1);

    // Voltou bem antes de 5 minutos: a busca rápida que ficou para trás sai agora.
    visibilidade = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await avancar();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(quadrados()[0]).toHaveTextContent('R$ 42,00');
  });

  it('voltar para a aba durante uma busca não abre outra', async () => {
    let responder: (r: Response) => void = () => {};
    const fetchFalso = vi.fn(
      () =>
        new Promise<Response>((resolver) => {
          responder = resolver;
        }),
    );
    instalarFetch(fetchFalso);
    render(<App />);
    vi.setSystemTime(Date.now() + INTERVALO_ATUALIZACAO_MS * 2);
    document.dispatchEvent(new Event('visibilitychange'));
    await avancar();

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    responder(Response.json(resposta()));
    await avancar();
    expect(quadrados()).toHaveLength(2);
  });

  it('fechar no meio de uma busca cancela o pedido sem mexer na tela', async () => {
    let sinal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opcoes?: RequestInit) => {
        sinal = opcoes?.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    const erroDoConsole = vi.spyOn(console, 'error');
    const { unmount } = render(<App />);
    await avancar();

    unmount();
    await avancar(INTERVALO_ATUALIZACAO_MS);

    expect(sinal?.aborted).toBe(true);
    expect(erroDoConsole).not.toHaveBeenCalled();
  });

  it('servidor fora do ar na abertura: tenta de novo em 1 minuto e mostra a grade', async () => {
    const fetchFalso = simularServidor(new TypeError('Failed to fetch'), resposta());
    render(<App />);
    await avancar();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await avancar(ESPERA_APOS_FALHA_MS);

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(quadrados()).toHaveLength(2);
  });

  it('com o StrictMode (desenvolvimento), não duplica a atualização periódica', async () => {
    const fetchFalso = simularServidor(resposta());
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await avancar();
    const naAbertura = fetchFalso.mock.calls.length;

    await avancar(INTERVALO_ATUALIZACAO_MS);

    expect(fetchFalso).toHaveBeenCalledTimes(naAbertura + 1);
    expect(quadrados()).toHaveLength(2);
  });

  describe('setas de ganho e perda', () => {
    const pos = (quantidadeTotal: number, custoTotal: number) => ({
      quantidadeTotal,
      custoTotal,
      precoMedio: Math.round(custoTotal / quantidadeTotal),
    });
    const usarPosicoes = (posicoes: Record<string, ReturnType<typeof pos>>) => {
      posicoesFalsas = () => Response.json({ posicoes, erros: {} });
    };
    const quadrado = (ticker: string) => quadrados().find((q) => q.dataset.ticker === ticker)!;

    it('acima do preço médio: seta verde com o ganho; abaixo: seta vermelha com a perda', async () => {
      usarPosicoes({ BBAS3: pos(100, 150000), PETR4: pos(10, 60000) });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      // 17,38 × 100 contra R$ 1.500,00: +15,87%. 52,79 × 10 contra R$ 600,00: -12,02%.
      const ganho = quadrado('BBAS3').querySelector('.ganho-perda')!;
      expect(ganho).toHaveTextContent('▲ +15,87%');
      expect(ganho).toHaveClass('variacao-alta');
      expect(ganho).toHaveAttribute('title', 'Preço médio R$ 15,00 · 100 ações');
      const perda = quadrado('PETR4').querySelector('.ganho-perda')!;
      expect(perda).toHaveTextContent('▼ -12,02%');
      expect(perda).toHaveClass('variacao-baixa');
    });

    it('sem compra registrada: só o preço, sem seta', async () => {
      usarPosicoes({ BBAS3: pos(100, 150000) });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      expect(quadrado('PETR4')).toHaveTextContent('R$ 52,79');
      expect(quadrado('PETR4')).not.toHaveTextContent('%');
    });

    it('preço igual ao médio: 0,00% em cinza, sem seta', async () => {
      usarPosicoes({ BBAS3: pos(2, 3476) });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      const indicador = quadrado('BBAS3').querySelector('.ganho-perda')!;
      expect(indicador).toHaveTextContent(/^igual ao preço médio: 0,00%$/);
      expect(indicador).toHaveClass('variacao-neutra');
    });

    it('sem cotação não tem seta; preço desatualizado mantém a seta com o último preço', async () => {
      usarPosicoes({ ELET3: pos(10, 40000), BBAS3: pos(100, 150000) });
      simularServidor(
        resposta({
          cotacoes: [cotacao('ELET3', null), cotacao('BBAS3', 1738, { desatualizada: true })],
        }),
      );
      render(<App />);
      await avancar();

      expect(quadrado('ELET3')).not.toHaveTextContent('%');
      expect(quadrado('BBAS3')).toHaveTextContent('desatualizado');
      expect(quadrado('BBAS3')).toHaveTextContent('▲ +15,87%');
    });

    it('o leitor de tela ouve a que a porcentagem se refere', async () => {
      usarPosicoes({ BBAS3: pos(100, 150000) });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      // O que o leitor ouve: o texto sem as partes escondidas dele (a seta).
      const copia = quadrado('BBAS3').cloneNode(true) as HTMLElement;
      copia.querySelectorAll('[aria-hidden="true"]').forEach((no) => no.remove());
      expect(copia.textContent).toContain(
        'ganho sobre o preço médio: +15,87%, Preço médio R$ 15,00 · 100 ações',
      );
      expect(quadrado('PETR4').textContent).not.toContain('perda');
    });

    it('falha ao ler as compras: a grade continua, avisa e se recupera na próxima rodada', async () => {
      posicoesFalsas = () => new Response('erro', { status: 500 });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      expect(quadrados()).toHaveLength(2);
      expect(screen.getByText(/Não foi possível ler suas compras/)).toHaveTextContent(
        'as setas de ganho e perda não aparecem',
      );

      usarPosicoes({ BBAS3: pos(100, 150000) });
      await avancar(INTERVALO_ATUALIZACAO_MS);

      expect(screen.queryByText(/Não foi possível ler suas compras/)).not.toBeInTheDocument();
      expect(quadrado('BBAS3')).toHaveTextContent('+15,87%');
    });

    it('falha numa releitura mantém as setas e avisa que podem estar desatualizadas', async () => {
      usarPosicoes({ BBAS3: pos(100, 150000) });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      posicoesFalsas = () => new Response('erro', { status: 500 });
      await avancar(INTERVALO_ATUALIZACAO_MS);

      expect(quadrado('BBAS3')).toHaveTextContent('+15,87%');
      expect(screen.getByText(/podem estar desatualizadas/)).toBeInTheDocument();
    });

    it('perda menor que 0,005%: seta vermelha com "-0,00%", não um zero sem sinal', async () => {
      // 1.000 ações a R$ 17,38 com R$ 0,30 de taxas; preço atual R$ 17,38.
      usarPosicoes({ BBAS3: pos(1000, 1738030) });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      const indicador = quadrado('BBAS3').querySelector('.ganho-perda')!;
      expect(indicador).toHaveTextContent('perda sobre o preço médio: ▼ -0,00%');
      expect(indicador).toHaveClass('variacao-baixa');
    });

    it('compras que o servidor não calculou aparecem como erro, não como ação sem compra', async () => {
      posicoesFalsas = () => Response.json({ posicoes: {}, erros: { PETR4: 'falhou' } });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      expect(quadrado('PETR4')).toHaveTextContent('erro nas compras');
      expect(quadrado('PETR4')).toHaveTextContent('Confira as compras desta ação');
      expect(quadrado('BBAS3')).not.toHaveTextContent('erro nas compras');
    });

    it('com falha, tenta de novo a cada minuto mesmo sem novas cotações; o aviso não pisca', async () => {
      posicoesFalsas = () => new Response('erro', { status: 500 });
      simularServidor(resposta());
      render(<App />);
      await avancar();
      expect(pedidosDePosicoes).toBe(1);

      await avancar(ESPERA_APOS_FALHA_MS);
      expect(pedidosDePosicoes).toBe(2);
      expect(screen.getByText(/Não foi possível ler suas compras/)).toBeInTheDocument();

      usarPosicoes({ BBAS3: pos(100, 150000) });
      await avancar(ESPERA_APOS_FALHA_MS);
      expect(screen.queryByText(/Não foi possível ler suas compras/)).not.toBeInTheDocument();
      expect(quadrado('BBAS3')).toHaveTextContent('+15,87%');

      // Sem falha, não fica relendo a cada minuto.
      await avancar(ESPERA_APOS_FALHA_MS);
      expect(pedidosDePosicoes).toBe(3);
    });

    it('o aviso fica na tela enquanto a nova tentativa está em andamento', async () => {
      let responder: (resposta: Response) => void = () => {};
      posicoesFalsas = () => new Response('erro', { status: 500 });
      simularServidor(resposta());
      render(<App />);
      await avancar();

      posicoesFalsas = () => new Promise<Response>((resolver) => (responder = resolver));
      fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
      await avancar();
      expect(pedidosDePosicoes).toBe(2);
      expect(screen.getByText(/Não foi possível ler suas compras/)).toBeInTheDocument();

      responder(Response.json({ posicoes: {}, erros: {} }));
      await avancar();
      expect(screen.queryByText(/Não foi possível ler suas compras/)).not.toBeInTheDocument();
    });

    it('as posições são lidas na abertura e de novo a cada rodada de cotações', async () => {
      simularServidor(resposta());
      render(<App />);
      await avancar();
      expect(pedidosDePosicoes).toBe(1);

      await avancar(INTERVALO_ATUALIZACAO_MS);

      expect(pedidosDePosicoes).toBe(2);
    });
  });

  describe('menu de escolha das ações', () => {
    /** Servidor com seleção de verdade: as cotações seguem o que foi salvo pelo menu. */
    function simularServidorComSelecao(inicial: string[]) {
      let selecao = inicial;
      let cotacoesPendentes: (() => void) | null = null;
      let segurarCotacoes = false;
      const responderCotacoes = () =>
        Response.json(resposta({ cotacoes: selecao.map((t) => cotacao(t, 1000)) }));
      const fetchFalso = vi.fn(async (endereco: string, opcoes: RequestInit = {}) => {
        if (endereco === '/api/catalogo') {
          return Response.json({
            acoes: [
              { ticker: 'BBAS3', nome: 'Banco do Brasil' },
              { ticker: 'VALE3', nome: 'Vale' },
            ],
          });
        }
        if (endereco === '/api/transacoes') return Response.json({ transacoes: [] });
        if (endereco === '/api/selecao') {
          if (opcoes.method === 'PUT') {
            selecao = (JSON.parse(opcoes.body as string) as { tickers: string[] }).tickers;
          }
          return Response.json({ tickers: selecao, limite: 50 });
        }
        if (segurarCotacoes) {
          const antes = selecao;
          await new Promise<void>((liberar) => (cotacoesPendentes = liberar));
          return Response.json(resposta({ cotacoes: antes.map((t) => cotacao(t, 1000)) }));
        }
        return responderCotacoes();
      });
      instalarFetch(fetchFalso);
      const chamadasCotacoes = () =>
        fetchFalso.mock.calls.filter(([endereco]) => endereco === '/api/cotacoes').length;
      return {
        chamadasCotacoes,
        segurar: () => (segurarCotacoes = true),
        liberar: () => {
          segurarCotacoes = false;
          cotacoesPendentes?.();
        },
      };
    }

    async function escolherESalvar(ticker: string) {
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      fireEvent.click(screen.getByRole('button', { name: 'Escolher ações' }));
      await avancar();
      fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^${ticker}\\b`) }));
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      await avancar();
    }

    it('o menu aparece mesmo antes das cotações chegarem', () => {
      simularServidorComSelecao([]);
      render(<App />);
      expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
    });

    it('salvar a seleção busca as cotações na hora e a grade muda', async () => {
      const servidor = simularServidorComSelecao([]);
      render(<App />);
      await avancar();
      expect(screen.getByText(/Abra o menu no canto superior direito/)).toBeInTheDocument();

      await escolherESalvar('VALE3');

      expect(servidor.chamadasCotacoes()).toBe(2);
      expect(quadrados().map((q) => q.dataset.ticker)).toEqual(['VALE3']);
    });

    it('salvar durante uma busca em andamento busca de novo assim que ela termina', async () => {
      const servidor = simularServidorComSelecao(['BBAS3']);
      render(<App />);
      await avancar();

      // A busca periódica começa e fica presa com a seleção antiga.
      servidor.segurar();
      await avancar(INTERVALO_ATUALIZACAO_MS);
      expect(servidor.chamadasCotacoes()).toBe(2);

      await escolherESalvar('VALE3');
      expect(servidor.chamadasCotacoes()).toBe(2);

      servidor.liberar();
      await avancar();

      expect(servidor.chamadasCotacoes()).toBe(3);
      expect(quadrados().map((q) => q.dataset.ticker)).toEqual(['BBAS3', 'VALE3']);
    });
  });
});

describe('LimiteDeErro', () => {
  afterEach(cleanup);

  it('erro inesperado ao desenhar vira mensagem, não página em branco', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Quebra = () => {
      throw new Error('falha');
    };
    render(
      <LimiteDeErro>
        <Quebra />
      </LimiteDeErro>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Algo deu errado ao mostrar o painel');
  });
});
