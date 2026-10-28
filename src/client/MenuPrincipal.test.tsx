import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuPrincipal } from './MenuPrincipal';

const CATALOGO = [
  { ticker: 'BBAS3', nome: 'Banco do Brasil', logo: '/api/logos/BBAS3' },
  { ticker: 'ITUB4', nome: 'Itaú Unibanco', logo: '/api/logos/ITUB4' },
  { ticker: 'PETR4', nome: 'Petrobras', logo: '/api/logos/PETR4' },
  { ticker: 'VALE3', nome: 'Vale', logo: '/api/logos/VALE3' },
];

type Rota = () => Response | Promise<Response>;

/** Servidor falso: responde por endereço e método; guarda o corpo de cada PUT recebido. */
function simularServidor(rotas: { catalogo?: Rota; selecao?: Rota; salvar?: Rota } = {}) {
  const salvas: unknown[] = [];
  let selecao: string[] = ['PETR4'];
  const fetchFalso = vi.fn(async (endereco: string, opcoes: RequestInit = {}) => {
    if (endereco === '/api/catalogo') {
      return rotas.catalogo ? rotas.catalogo() : Response.json({ acoes: CATALOGO });
    }
    if (endereco === '/api/selecao' && opcoes.method === 'PUT') {
      const corpo = JSON.parse(opcoes.body as string) as { tickers: string[] };
      salvas.push(corpo);
      if (rotas.salvar) return rotas.salvar();
      selecao = corpo.tickers;
      return Response.json({ tickers: selecao, limite: 50 });
    }
    if (endereco === '/api/selecao') {
      return rotas.selecao ? rotas.selecao() : Response.json({ tickers: selecao, limite: 50 });
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

  it('abre e fecha a lista de opções; registrar compras ainda está desabilitado', () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    const botao = screen.getByRole('button', { name: 'Menu' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');

    abrirMenu();
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Registrar compras/ })).toBeDisabled();

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
    expect(screen.getByText('Nenhuma ação encontrada.')).toBeInTheDocument();
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
});
