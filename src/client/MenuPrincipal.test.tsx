import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EscolhaAcoes } from './EscolhaAcoes';
import { MenuPrincipal } from './MenuPrincipal';

const acao = (
  ticker: string,
  nome: string,
  setor: string | null,
  variacaoDoDia: number | null,
) => ({
  ticker,
  nome,
  setor,
  variacaoDoDia,
  logo: `/api/logos/${ticker}`,
});

const CATALOGO = [
  acao('BBAS3', 'Banco do Brasil', 'Finance', 235),
  acao('ITUB4', 'Itaú Unibanco', 'Finance', -110),
  acao('PETR4', 'Petrobras', 'Energy Minerals', 512),
  acao('VALE3', 'Vale', 'Non-Energy Minerals', null),
];
const LISTA_DE = '2026-10-28T17:35:00.000Z';
const PREGAO = '2026-10-28';

/** Compra mínima no formato de GET /api/transacoes. */
const compra = (id: number, ticker: string) => ({
  id,
  ticker,
  data: '2026-10-20',
  quantidade: 100,
  precoUnitario: 1000,
  taxas: 0,
  plataforma: 'BTG',
  criadoEm: '2026-10-20T13:00:00.000Z',
  atualizadoEm: '2026-10-20T13:00:00.000Z',
});

type Rota = (signal?: AbortSignal | null) => Response | Promise<Response>;

/** Resposta que nunca chega; só termina (com erro) se o pedido for cancelado. */
function nuncaResponde(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, falhar) =>
    signal?.addEventListener('abort', () => falhar(new DOMException('Abortado', 'AbortError'))),
  );
}

/** Servidor falso: responde por endereço e método; guarda o corpo de cada PUT recebido. */
function simularServidor(
  rotas: { catalogo?: Rota; selecao?: Rota; salvar?: Rota; transacoes?: Rota } = {},
) {
  const salvas: unknown[] = [];
  let selecao: string[] = ['PETR4'];
  const fetchFalso = vi.fn(async (endereco: string, opcoes: RequestInit = {}) => {
    if (endereco === '/api/catalogo') {
      return rotas.catalogo
        ? rotas.catalogo(opcoes.signal)
        : Response.json({ acoes: CATALOGO, atualizadoEm: LISTA_DE, variacaoDoPregao: PREGAO });
    }
    if (endereco === '/api/transacoes') {
      return rotas.transacoes
        ? rotas.transacoes(opcoes.signal)
        : Response.json({
            transacoes: [compra(1, 'ITUB4'), compra(2, 'ITUB4'), compra(3, 'ELET3')],
          });
    }
    if (endereco === '/api/selecao' && opcoes.method === 'PUT') {
      const corpo = JSON.parse(opcoes.body as string) as { tickers: string[] };
      salvas.push(corpo);
      if (rotas.salvar) return rotas.salvar(opcoes.signal);
      selecao = corpo.tickers;
      return Response.json({ tickers: selecao, limite: 50 });
    }
    if (endereco === '/api/selecao') {
      return rotas.selecao
        ? rotas.selecao(opcoes.signal)
        : Response.json({ tickers: selecao, limite: 50 });
    }
    return new Response('não encontrado', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchFalso);
  return { fetchFalso, salvas };
}

function abrirMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
}

async function abrirEscolha() {
  abrirMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Escolher ações' }));
  return screen.findByRole('list', { name: 'Ações disponíveis' });
}

function caixa(ticker: string) {
  return screen.getByRole('checkbox', { name: new RegExp(`^${ticker}\\b`) });
}

function linhas() {
  return within(screen.getByRole('list', { name: 'Ações disponíveis' }))
    .getAllByRole('checkbox')
    .map((c) => c.closest('label')!.querySelector('.ticker')!.textContent);
}

describe('MenuPrincipal', () => {
  afterEach(cleanup);

  it('abre e fecha a lista de opções', () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    const botao = screen.getByRole('button', { name: 'Menu' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');

    abrirMenu();
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Registrar compras' })).toBeEnabled();

    abrirMenu();
    expect(screen.queryByRole('button', { name: 'Escolher ações' })).not.toBeInTheDocument();
  });

  it('Esc e clique fora fecham as opções', () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    const botao = screen.getByRole('button', { name: 'Menu' });

    abrirMenu();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Escolher ações' }), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Escolher ações' })).not.toBeInTheDocument();
    expect(botao).toHaveFocus();

    abrirMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: 'Escolher ações' })).not.toBeInTheDocument();
  });

  it('mostra as salvas no topo, depois o catálogo, com o contador', async () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    expect(screen.getByRole('dialog', { name: 'Escolher ações' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar ação' })).toHaveFocus();
    expect(linhas()).toEqual(['PETR4', 'BBAS3', 'ITUB4', 'VALE3']);
    expect(caixa('PETR4')).toBeChecked();
    expect(caixa('BBAS3')).not.toBeChecked();
    expect(screen.getByText('1 de 50 selecionadas')).toBeInTheDocument();
  });

  it('busca por nome sem acento', async () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'itau' } });
    expect(linhas()).toEqual(['ITUB4']);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'xyz' } });
    expect(screen.getByText('Nenhuma ação encontrada com estes filtros.')).toBeInTheDocument();
  });

  it('marca, desmarca e salva na ordem de escolha; depois avisa e fecha', async () => {
    const { salvas } = simularServidor();
    const aoSalvar = vi.fn();
    render(<MenuPrincipal aoSalvarSelecao={aoSalvar} />);
    await abrirEscolha();

    const salvar = screen.getByRole('button', { name: 'Salvar' });
    expect(salvar).toBeDisabled();

    fireEvent.click(caixa('VALE3'));
    fireEvent.click(caixa('BBAS3'));
    fireEvent.click(caixa('PETR4'));
    expect(screen.getByText('2 de 50 selecionadas')).toBeInTheDocument();
    // A linha marcada não muda de lugar enquanto o painel está aberto.
    expect(linhas()).toEqual(['PETR4', 'BBAS3', 'ITUB4', 'VALE3']);

    fireEvent.click(salvar);

    await waitFor(() => expect(aoSalvar).toHaveBeenCalledOnce());
    expect(salvas).toEqual([{ tickers: ['VALE3', 'BBAS3'] }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus();
  });

  it('voltar ao estado salvo desabilita o Salvar de novo', async () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    fireEvent.click(caixa('BBAS3'));
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    fireEvent.click(caixa('BBAS3'));
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('Cancelar e Esc descartam o rascunho sem salvar', async () => {
    const { salvas } = simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);

    await abrirEscolha();
    fireEvent.click(caixa('BBAS3'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus();

    await abrirEscolha();
    expect(caixa('BBAS3')).not.toBeChecked();
    fireEvent.keyDown(caixa('BBAS3'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(salvas).toEqual([]);
  });

  it('no limite de 50, as caixas desmarcadas ficam desabilitadas', async () => {
    const cheias = Array.from({ length: 50 }, (_, i) => `ABCD${i + 1}`);
    simularServidor({ selecao: () => Response.json({ tickers: cheias, limite: 50 }) });
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    expect(screen.getByText('50 de 50 selecionadas · limite atingido')).toBeInTheDocument();
    expect(caixa('BBAS3')).toBeDisabled();
    expect(caixa('ABCD1')).toBeEnabled();

    fireEvent.click(caixa('ABCD1'));
    expect(caixa('BBAS3')).toBeEnabled();
  });

  it('ação salva fora do catálogo continua na lista para ser desmarcada', async () => {
    simularServidor({ selecao: () => Response.json({ tickers: ['ELET3'], limite: 50 }) });
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    expect(caixa('ELET3')).toBeChecked();
    expect(caixa('ELET3').closest('label')).toHaveTextContent('fora da lista atual da B3');
  });

  it('falha no catálogo: avisa, mostra as salvas e tenta de novo', async () => {
    let falhar = true;
    simularServidor({
      catalogo: () =>
        falhar ? new Response('erro', { status: 500 }) : Response.json({ acoes: CATALOGO }),
    });
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a lista');
    expect(linhas()).toEqual(['PETR4']);
    expect(caixa('PETR4').closest('label')).not.toHaveTextContent('fora da lista');

    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(linhas()).toEqual(['PETR4', 'BBAS3', 'ITUB4', 'VALE3']));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falha ao ler a seleção salva: não mostra lista nem deixa salvar', async () => {
    let falhar = true;
    simularServidor({
      selecao: () =>
        falhar ? new Response('erro', { status: 500 }) : Response.json({ tickers: [], limite: 50 }),
    });
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    abrirMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Escolher ações' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as ações selecionadas',
    );
    expect(screen.queryByRole('list', { name: 'Ações disponíveis' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();

    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('list', { name: 'Ações disponíveis' })).toBeInTheDocument();
  });

  it('falha ao salvar: mostra o motivo e mantém o rascunho aberto', async () => {
    simularServidor({
      salvar: () => Response.json({ erro: 'Selecione no máximo 50 ações' }, { status: 400 }),
    });
    const aoSalvar = vi.fn();
    render(<MenuPrincipal aoSalvarSelecao={aoSalvar} />);
    await abrirEscolha();

    fireEvent.click(caixa('BBAS3'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Selecione no máximo 50 ações');
    expect(caixa('BBAS3')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it('catálogo vazio (brapi ainda não baixada) é falha, com "Tentar de novo"', async () => {
    simularServidor({ catalogo: () => Response.json({ acoes: [] }) });
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    expect(screen.getByRole('alert')).toHaveTextContent('lista de ações da B3');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    expect(caixa('PETR4').closest('label')).toHaveTextContent('nome indisponível');
  });

  it('as salvas aparecem enquanto o catálogo ainda carrega', async () => {
    simularServidor({ catalogo: nuncaResponde });
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    expect(linhas()).toEqual(['PETR4']);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando a lista de ações da B3');
  });

  it('durante o salvamento, caixas, busca, Cancelar e Esc ficam travados', async () => {
    let concluir: (resposta: Response) => void = () => {};
    simularServidor({ salvar: () => new Promise((r) => (concluir = r)) });
    const aoSalvar = vi.fn();
    render(<MenuPrincipal aoSalvarSelecao={aoSalvar} />);
    await abrirEscolha();

    fireEvent.click(caixa('BBAS3'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(caixa('VALE3')).toBeDisabled();
    expect(screen.getByRole('searchbox')).toHaveAttribute('readonly');
    fireEvent.keyDown(caixa('BBAS3'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    concluir(Response.json({ tickers: ['PETR4', 'BBAS3'], limite: 50 }));
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledOnce());
  });

  it('desmarcar e marcar de novo não conta como mudança nem reordena', async () => {
    const { salvas } = simularServidor({
      selecao: () => Response.json({ tickers: ['PETR4', 'BBAS3'], limite: 50 }),
    });
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();

    fireEvent.click(caixa('PETR4'));
    fireEvent.click(caixa('PETR4'));
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();

    fireEvent.click(caixa('PETR4'));
    fireEvent.click(caixa('VALE3'));
    fireEvent.click(caixa('PETR4'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(salvas).toEqual([{ tickers: ['PETR4', 'BBAS3', 'VALE3'] }]));
  });

  it('Esc com texto na busca só limpa a busca; vazio, fecha o painel', async () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();
    fireEvent.click(caixa('BBAS3'));

    const campo = screen.getByRole('searchbox');
    fireEvent.change(campo, { target: { value: 'vale' } });
    fireEvent.keyDown(campo, { key: 'Escape' });

    expect(campo).toHaveValue('');
    expect(caixa('BBAS3')).toBeChecked();

    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('o Tab não sai do painel', async () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();
    const campo = screen.getByRole('searchbox');
    const cancelar = screen.getByRole('button', { name: 'Cancelar' });

    // Salvar está desabilitado: Cancelar é o último elemento focável.
    cancelar.focus();
    fireEvent.keyDown(cancelar, { key: 'Tab' });
    expect(campo).toHaveFocus();

    fireEvent.keyDown(campo, { key: 'Tab', shiftKey: true });
    expect(cancelar).toHaveFocus();
  });
});

describe('EscolhaAcoes: o foco não escapa do painel', () => {
  afterEach(cleanup);

  async function abrirPainel() {
    simularServidor();
    render(
      <>
        <button type="button">fora</button>
        <EscolhaAcoes aoFechar={() => {}} aoSalvar={() => {}} />
      </>,
    );
    await screen.findByRole('list', { name: 'Ações disponíveis' });
  }

  it('foco que vai para fora do painel volta para a busca', async () => {
    await abrirPainel();
    screen.getByRole('button', { name: 'fora' }).focus();
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('ao clicar em Salvar, o foco fica na busca (o botão é desabilitado)', async () => {
    simularServidor({ salvar: nuncaResponde });
    render(<EscolhaAcoes aoFechar={() => {}} aoSalvar={() => {}} />);
    await screen.findByRole('list', { name: 'Ações disponíveis' });
    fireEvent.click(caixa('BBAS3'));
    screen.getByRole('button', { name: 'Salvar' }).focus();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('com o foco no próprio painel, Tab vai para a busca e Esc fecha', async () => {
    simularServidor();
    const aoFechar = vi.fn();
    render(<EscolhaAcoes aoFechar={aoFechar} aoSalvar={() => {}} />);
    await screen.findByRole('list', { name: 'Ações disponíveis' });
    const dialogo = screen.getByRole('dialog');

    dialogo.focus();
    fireEvent.keyDown(dialogo, { key: 'Tab' });
    expect(screen.getByRole('searchbox')).toHaveFocus();

    dialogo.focus();
    fireEvent.keyDown(dialogo, { key: 'Escape' });
    expect(aoFechar).toHaveBeenCalledOnce();
  });
});

describe('EscolhaAcoes com tempo limite', () => {
  afterEach(cleanup);

  it('servidor travado: depois do tempo limite oferece "Tentar de novo"', async () => {
    simularServidor({ selecao: nuncaResponde, catalogo: nuncaResponde });
    render(<EscolhaAcoes aoFechar={() => {}} aoSalvar={() => {}} tempoLimiteMs={30} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as ações selecionadas',
    );
  });

  it('salvamento que expira avisa que pode ter sido salvo e pede para a grade conferir', async () => {
    simularServidor({ salvar: nuncaResponde });
    const aoSalvar = vi.fn();
    const aoTalvezSalvo = vi.fn();
    render(
      <EscolhaAcoes
        aoFechar={() => {}}
        aoSalvar={aoSalvar}
        aoTalvezSalvo={aoTalvezSalvo}
        tempoLimiteMs={30}
      />,
    );
    await screen.findByRole('list', { name: 'Ações disponíveis' });

    fireEvent.click(caixa('BBAS3'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('a seleção pode ter sido salva');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    expect(aoTalvezSalvo).toHaveBeenCalledOnce();
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it('erro comum ao salvar não pede para a grade conferir', async () => {
    simularServidor({ salvar: () => new Response('erro', { status: 500 }) });
    const aoTalvezSalvo = vi.fn();
    render(<EscolhaAcoes aoFechar={() => {}} aoSalvar={() => {}} aoTalvezSalvo={aoTalvezSalvo} />);
    await screen.findByRole('list', { name: 'Ações disponíveis' });

    fireEvent.click(caixa('BBAS3'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('respondeu com erro (500)');
    expect(aoTalvezSalvo).not.toHaveBeenCalled();
  });
});

describe('EscolhaAcoes: filtros', () => {
  afterEach(cleanup);

  const setor = () => screen.getByRole('combobox', { name: 'Setor' });
  const mostrar = () => screen.getByRole('combobox', { name: 'Mostrar' });

  async function abrir() {
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();
    await screen.findByText(/Variação do dia segundo a brapi/);
  }

  it('setores em português, com a quantidade de ações de cada um', async () => {
    simularServidor();
    await abrir();

    expect(
      within(setor())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Todos (4)',
      'Finanças (2)',
      'Mineração e siderurgia (1)',
      'Petróleo, gás e carvão (1)',
    ]);

    fireEvent.change(setor(), { target: { value: 'Finance' } });
    expect(linhas()).toEqual(['BBAS3', 'ITUB4']);
    expect(screen.getByText(/Mostrando 2 ações\./)).toBeInTheDocument();
  });

  it('em alta e em baixa ordenam pela variação do dia', async () => {
    simularServidor();
    await abrir();

    fireEvent.change(mostrar(), { target: { value: 'alta' } });
    expect(linhas()).toEqual(['PETR4', 'BBAS3']);

    fireEvent.change(mostrar(), { target: { value: 'baixa' } });
    expect(linhas()).toEqual(['ITUB4']);
    expect(screen.getByText(/Mostrando 1 ação\./)).toBeInTheDocument();
  });

  it('cada linha mostra a variação do dia; sem variação, nada', async () => {
    simularServidor();
    await abrir();

    expect(caixa('PETR4').closest('label')).toHaveTextContent('▲ +5,12%');
    expect(caixa('ITUB4').closest('label')).toHaveTextContent('▼ -1,10%');
    expect(caixa('VALE3').closest('label')).not.toHaveTextContent('%');
    expect(screen.getByText(/lista de 28\/10\/2026 14:35/)).toBeInTheDocument();
  });

  it('que comprei: só as compradas, inclusive as que saíram da bolsa', async () => {
    simularServidor();
    await abrir();

    expect(await within(mostrar()).findByRole('option', { name: 'Que comprei' })).toBeEnabled();
    fireEvent.change(mostrar(), { target: { value: 'compradas' } });

    expect(linhas()).toEqual(['ITUB4', 'ELET3']);
    expect(caixa('ELET3').closest('label')).toHaveTextContent('fora da lista atual da B3');
  });

  it('sem as compras, "Que comprei" fica desabilitado e o painel avisa', async () => {
    simularServidor({ transacoes: () => new Response('erro', { status: 500 }) });
    await abrir();

    expect(
      await within(mostrar()).findByRole('option', { name: 'Que comprei (indisponível)' }),
    ).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar suas compras',
    );
    expect(linhas()).toEqual(['PETR4', 'BBAS3', 'ITUB4', 'VALE3']);
  });

  it('marcar uma ação filtrada mantém a marcação ao trocar de filtro', async () => {
    simularServidor();
    await abrir();

    fireEvent.change(setor(), { target: { value: 'Finance' } });
    fireEvent.click(caixa('ITUB4'));
    fireEvent.change(setor(), { target: { value: '' } });

    expect(caixa('ITUB4')).toBeChecked();
    expect(screen.getByText('2 de 50 selecionadas')).toBeInTheDocument();
  });
});

describe('EscolhaAcoes: data da lista e recargas', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mostrar = () => screen.getByRole('combobox', { name: 'Mostrar' });
  const opcoes = () =>
    within(mostrar())
      .getAllByRole('option')
      .map((o) => o.textContent);

  async function abrir() {
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    await abrirEscolha();
    await screen.findByText(/Variação do dia segundo a brapi/);
  }

  it('variação do pregão de hoje: "Em alta hoje", sem aviso de data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T20:00:00Z'));
    simularServidor();
    await abrir();

    expect(opcoes()).toContain('Em alta hoje');
    expect(screen.queryByText(/A variação é/)).not.toBeInTheDocument();
  });

  it('variação de outro pregão (ex.: sábado): os filtros dizem de qual dia', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T15:00:00Z'));
    simularServidor();
    await abrir();

    expect(opcoes()).toEqual(
      expect.arrayContaining([
        'Em alta no pregão de 28/10/2026',
        'Em baixa no pregão de 28/10/2026',
      ]),
    );
    expect(screen.getByText(/A variação é do pregão de 28\/10\/2026\./)).toBeInTheDocument();
  });

  it('pregão desconhecido: não diz "hoje", mesmo com a lista baixada hoje', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T20:00:00Z'));
    simularServidor({
      catalogo: () =>
        Response.json({ acoes: CATALOGO, atualizadoEm: LISTA_DE, variacaoDoPregao: null }),
    });
    await abrir();

    expect(opcoes()).toContain('Em alta na última lista');
    expect(screen.getByText(/pode não ser do pregão de hoje/)).toBeInTheDocument();
  });

  it('"Que comprei" sem as compras carregadas mostra que estão carregando, não lista vazia', async () => {
    simularServidor({ transacoes: nuncaResponde });
    await abrir();

    fireEvent.change(mostrar(), { target: { value: 'compradas' } });

    expect(screen.getByText('Carregando suas compras…')).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma ação encontrada/)).not.toBeInTheDocument();
  });
});
