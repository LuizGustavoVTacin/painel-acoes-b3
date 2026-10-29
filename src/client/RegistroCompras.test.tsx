import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatarData, hojeEmBrasilia } from '../shared/datas';
import type { Transacao } from '../shared/transacao';
import { MenuPrincipal } from './MenuPrincipal';
import { RegistroCompras } from './RegistroCompras';

const compra = (id: number, extra: Partial<Transacao> = {}): Transacao => ({
  id,
  ticker: 'PETR4',
  data: '2026-10-10',
  quantidade: 100,
  precoUnitario: 5000,
  taxas: 0,
  plataforma: 'BTG',
  criadoEm: '2026-10-10T13:00:00.000Z',
  atualizadoEm: '2026-10-10T13:00:00.000Z',
  ...extra,
});

type Recusa = () => Response | Promise<Response>;
/** Resposta da listagem; null usa a lista em memória. */
type Listagem = () => Response | null;

/** Resposta que nunca chega; só termina (com erro) se o pedido for cancelado. */
function nuncaResponde(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, falhar) =>
    signal?.addEventListener('abort', () => falhar(new DOMException('Abortado', 'AbortError'))),
  );
}

/** Servidor falso com compras e seleção em memória; registra cada pedido recebido. */
function simularServidor(
  opcoes: {
    compras?: Transacao[];
    selecao?: string[];
    listar?: Listagem;
    gravar?: Recusa;
    excluir?: Recusa;
    catalogo?: string[];
    travarGravacao?: boolean;
  } = {},
) {
  let compras = [...(opcoes.compras ?? [compra(1)])];
  let selecao = [...(opcoes.selecao ?? ['PETR4'])];
  let proximoId = 100;
  const pedidos: { metodo: string; endereco: string; corpo?: unknown }[] = [];

  const fetchFalso = vi.fn(async (endereco: string, init: RequestInit = {}) => {
    const metodo = init.method ?? 'GET';
    const corpo = init.body ? JSON.parse(init.body as string) : undefined;
    pedidos.push({ metodo, endereco, corpo });

    if (endereco === '/api/catalogo') {
      const codigos = opcoes.catalogo ?? ['BBAS3', 'PETR4'];
      return Response.json({
        acoes: codigos.map((ticker) => ({ ticker, nome: `Empresa ${ticker}` })),
      });
    }
    if (endereco === '/api/selecao') {
      if (metodo === 'PUT') selecao = corpo.tickers;
      return Response.json({ tickers: selecao, limite: 50 });
    }
    if (endereco === '/api/transacoes' && metodo === 'GET') {
      const resposta = opcoes.listar?.();
      if (resposta) return resposta;
      // Como o servidor real: data mais recente primeiro; no mesmo dia, o maior id.
      const ordenadas = [...compras].sort((a, b) =>
        a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1,
      );
      return Response.json({ transacoes: ordenadas });
    }
    if (metodo === 'POST' || metodo === 'PUT') {
      if (opcoes.travarGravacao) return nuncaResponde(init.signal);
      if (opcoes.gravar) return opcoes.gravar();
      const id = metodo === 'POST' ? proximoId++ : Number(endereco.split('/').pop());
      const salva = compra(id, { ...corpo });
      compras = [...compras.filter((c) => c.id !== id), salva];
      return Response.json({ transacao: salva }, { status: metodo === 'POST' ? 201 : 200 });
    }
    if (metodo === 'DELETE') {
      if (opcoes.excluir) return opcoes.excluir();
      const id = Number(endereco.split('/').pop());
      compras = compras.filter((c) => c.id !== id);
      return new Response(null, { status: 204 });
    }
    return new Response('não encontrado', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchFalso);
  return {
    pedidos,
    gravacoes: () => pedidos.filter((p) => p.metodo !== 'GET'),
    /** Apaga direto no servidor, como se fosse outra aba. */
    apagar: (id: number) => {
      compras = compras.filter((c) => c.id !== id);
    },
  };
}

function campo(rotulo: string) {
  return screen.getByLabelText(rotulo) as HTMLInputElement;
}

function preencher(valores: Record<string, string>) {
  for (const [rotulo, valor] of Object.entries(valores)) {
    fireEvent.change(campo(rotulo), { target: { value: valor } });
  }
}

const compraBBAS3 = {
  Código: 'bbas3',
  Data: '20/10/2026',
  Quantidade: '1.000',
  'Preço unitário (R$)': '17,38',
  'Taxas (R$)': '4,90',
  Plataforma: 'Itaú Íon',
};

async function abrirPainel(props: Partial<Parameters<typeof RegistroCompras>[0]> = {}) {
  render(<RegistroCompras aoFechar={() => {}} aoMudarGrade={() => {}} {...props} />);
  await screen.findByRole('table', { name: 'Compras registradas' });
}

function linhas() {
  const tabela = screen.getByRole('table', { name: 'Compras registradas' });
  return within(tabela).getAllByRole('row').slice(1);
}

describe('RegistroCompras', () => {
  afterEach(cleanup);

  it('abre pelo menu com o foco no código, a data de hoje e as compras salvas', async () => {
    simularServidor();
    render(<MenuPrincipal aoSalvarSelecao={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compras' }));

    expect(screen.getByRole('dialog', { name: 'Registrar compras' })).toBeInTheDocument();
    expect(campo('Código')).toHaveFocus();
    expect(campo('Data')).toHaveValue(formatarData(hojeEmBrasilia()));
    expect(campo('Taxas (R$)')).toHaveValue('0,00');

    await screen.findByRole('table', { name: 'Compras registradas' });
    expect(linhas()[0]).toHaveTextContent('10/10/2026PETR4100R$ 50,00R$ 0,00R$ 5.000,00BTG');
    const resumo = screen.getByRole('table', { name: 'Resumo por ação' });
    expect(within(resumo).getAllByRole('row')[1]).toHaveTextContent('PETR4100R$ 50,00R$ 5.000,00');
  });

  it('mostra o total enquanto se digita', async () => {
    simularServidor();
    await abrirPainel();
    expect(screen.getByText(/Total da compra/)).toHaveTextContent('—');

    preencher({ Quantidade: '1.000', 'Preço unitário (R$)': '17,38', 'Taxas (R$)': '4,90' });
    expect(screen.getByText(/Total da compra/)).toHaveTextContent('R$ 17.384,90');
  });

  it('registra a compra em centavos, mostra na lista e recomeça mantendo data e plataforma', async () => {
    const { gravacoes } = simularServidor();
    await abrirPainel();

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    await waitFor(() => expect(linhas()).toHaveLength(2));
    expect(gravacoes()).toEqual([
      {
        metodo: 'POST',
        endereco: '/api/transacoes',
        corpo: {
          ticker: 'BBAS3',
          data: '2026-10-20',
          quantidade: 1000,
          precoUnitario: 1738,
          taxas: 490,
          plataforma: 'Itaú Íon',
        },
      },
    ]);
    // Mais recente primeiro.
    expect(linhas()[0]).toHaveTextContent('20/10/2026BBAS31.000R$ 17,38R$ 4,90R$ 17.384,90');
    expect(campo('Código')).toHaveValue('');
    expect(campo('Quantidade')).toHaveValue('');
    expect(campo('Data')).toHaveValue('20/10/2026');
    expect(campo('Plataforma')).toHaveValue('Itaú Íon');
    expect(campo('Código')).toHaveFocus();
  });

  it('compra de ação fora da grade oferece "Adicionar à grade"', async () => {
    const { gravacoes } = simularServidor({ selecao: ['PETR4'] });
    const aoMudarGrade = vi.fn();
    await abrirPainel({ aoMudarGrade });

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));
    expect(await screen.findByText('BBAS3 não está na grade.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à grade' }));

    expect(await screen.findByText('BBAS3 foi adicionada à grade.')).toBeInTheDocument();
    expect(gravacoes().at(-1)).toEqual({
      metodo: 'PUT',
      endereco: '/api/selecao',
      corpo: { tickers: ['PETR4', 'BBAS3'] },
    });
    expect(aoMudarGrade).toHaveBeenCalledOnce();
  });

  it('compra de ação que já está na grade não mostra aviso', async () => {
    simularServidor({ selecao: ['PETR4', 'BBAS3'] });
    await abrirPainel();

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));
    await waitFor(() => expect(linhas()).toHaveLength(2));

    expect(screen.queryByText(/não está na grade/)).not.toBeInTheDocument();
  });

  it('grade cheia: explica, sem botão de adicionar', async () => {
    const cheia = Array.from({ length: 50 }, (_, i) => `ABCD${i + 1}`);
    simularServidor({ selecao: cheia });
    await abrirPainel();

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    expect(await screen.findByText(/A grade já tem 50 ações/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar à grade' })).not.toBeInTheDocument();
  });

  it('dados inválidos: erro embaixo de cada campo, foco no primeiro, nada enviado', async () => {
    const { gravacoes } = simularServidor();
    await abrirPainel();

    preencher({ ...compraBBAS3, Código: '', Quantidade: '1,5', Plataforma: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    expect(campo('Código')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Código')).toHaveAccessibleDescription(
      'Informe um código da B3 válido, como BBAS3',
    );
    expect(campo('Quantidade')).toHaveAccessibleDescription('Use só números inteiros, como 100');
    expect(campo('Plataforma')).toHaveAccessibleDescription(
      'Informe a plataforma (até 40 caracteres)',
    );
    expect(campo('Data')).not.toHaveAttribute('aria-invalid');
    expect(campo('Código')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Verifique os campos destacados');
    expect(gravacoes()).toEqual([]);
  });

  it('erro de campo vindo do servidor aparece no campo certo e mantém o que foi digitado', async () => {
    simularServidor({
      gravar: () =>
        Response.json(
          {
            erro: 'Verifique os campos destacados',
            campos: { data: 'A data da compra não pode ser no futuro' },
          },
          { status: 400 },
        ),
    });
    await abrirPainel();

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    await waitFor(() =>
      expect(campo('Data')).toHaveAccessibleDescription('A data da compra não pode ser no futuro'),
    );
    expect(campo('Data')).toHaveFocus();
    expect(campo('Quantidade')).toHaveValue('1.000');
  });

  it('edita uma compra: carrega no formulário, salva com PUT e volta ao formulário vazio', async () => {
    const { gravacoes } = simularServidor();
    await abrirPainel();

    fireEvent.click(screen.getByRole('button', { name: 'Editar a compra de PETR4 de 10/10/2026' }));

    expect(screen.getByRole('dialog', { name: 'Editar compra' })).toBeInTheDocument();
    expect(campo('Código')).toHaveValue('PETR4');
    expect(campo('Preço unitário (R$)')).toHaveValue('50,00');
    expect(campo('Código')).toHaveFocus();
    expect(linhas()[0]).toHaveClass('compra-editando');

    preencher({ Quantidade: '150' });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(linhas()[0]).toHaveTextContent('150'));
    expect(gravacoes()).toEqual([
      expect.objectContaining({ metodo: 'PUT', endereco: '/api/transacoes/1' }),
    ]);
    expect(screen.getByRole('dialog', { name: 'Registrar compras' })).toBeInTheDocument();
    expect(campo('Código')).toHaveValue('');
  });

  it('cancelar a edição volta ao formulário vazio sem gravar', async () => {
    const { gravacoes } = simularServidor();
    await abrirPainel();

    fireEvent.click(screen.getByRole('button', { name: /Editar a compra/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }));

    expect(campo('Código')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Registrar compra' })).toBeInTheDocument();
    expect(gravacoes()).toEqual([]);
  });

  it('excluir pede confirmação; "Não" desiste e "Sim" remove', async () => {
    const { gravacoes } = simularServidor({ compras: [compra(1), compra(2, { ticker: 'VALE3' })] });
    await abrirPainel();

    fireEvent.click(
      screen.getByRole('button', { name: 'Excluir a compra de VALE3 de 10/10/2026' }),
    );
    expect(screen.getByText('Excluir esta compra?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(gravacoes()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /Excluir a compra de VALE3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));

    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(linhas()[0]).toHaveTextContent('PETR4');
    expect(gravacoes()).toEqual([{ metodo: 'DELETE', endereco: '/api/transacoes/2' }]);
    expect(campo('Código')).toHaveFocus();
  });

  it('falha ao excluir mostra o motivo na linha e mantém a compra', async () => {
    simularServidor({
      excluir: () => Response.json({ erro: 'Exclusão recusada' }, { status: 400 }),
    });
    await abrirPainel();

    fireEvent.click(screen.getByRole('button', { name: /Excluir a compra/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Exclusão recusada');
    expect(linhas()).toHaveLength(1);
  });

  it('excluir compra que já não existe (404) só tira a linha da tela', async () => {
    const servidor = simularServidor({
      compras: [compra(1), compra(2, { ticker: 'VALE3' })],
      excluir: () => {
        servidor.apagar(2);
        return Response.json({ erro: 'Transação não encontrada' }, { status: 404 });
      },
    });
    await abrirPainel();

    fireEvent.click(screen.getByRole('button', { name: /Excluir a compra de VALE3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));

    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('editar compra que já não existe (404) sai da edição e avisa', async () => {
    const servidor = simularServidor({
      compras: [compra(1), compra(2, { ticker: 'VALE3' })],
      gravar: () => {
        servidor.apagar(2);
        return Response.json({ erro: 'Transação não encontrada' }, { status: 404 });
      },
    });
    await abrirPainel();

    fireEvent.click(screen.getByRole('button', { name: /Editar a compra de VALE3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(
      await screen.findByText(/A compra que você editava não existe mais/),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Registrar compras' })).toBeInTheDocument();
    await waitFor(() => expect(linhas()).toHaveLength(1));
    // O que foi digitado fica, para registrar como compra nova se quiser.
    expect(campo('Código')).toHaveValue('VALE3');
    expect(screen.getByRole('button', { name: 'Registrar compra' })).toBeInTheDocument();
  });

  it('recarga que falha depois de gravar mantém a lista e avisa', async () => {
    let falharListagem = false;
    simularServidor({
      listar: () => (falharListagem ? new Response('erro', { status: 500 }) : null),
    });
    await abrirPainel();

    falharListagem = true;
    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    expect(await screen.findByText(/a lista; ela pode estar desatualizada/)).toBeInTheDocument();
    expect(linhas()).toHaveLength(1);
    expect(screen.getByRole('table', { name: 'Resumo por ação' })).toBeInTheDocument();

    falharListagem = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(linhas()).toHaveLength(2));
    expect(screen.queryByText(/pode estar desatualizada/)).not.toBeInTheDocument();
  });

  it('linha em confirmação que some numa recarga: a pergunta some e o foco volta ao formulário', async () => {
    const servidor = simularServidor({ compras: [compra(1), compra(2, { ticker: 'VALE3' })] });
    await abrirPainel();

    fireEvent.click(screen.getByRole('button', { name: /Excluir a compra de VALE3/ }));
    expect(screen.getByRole('button', { name: 'Não' })).toHaveFocus();

    // Outra aba exclui a mesma compra; uma gravação aqui faz a lista ser buscada de novo.
    servidor.apagar(2);
    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    await waitFor(() => expect(screen.queryByText('Excluir esta compra?')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('avisa a grade quando as compras mudam: registrar, editar e excluir', async () => {
    simularServidor({ compras: [compra(1), compra(2, { ticker: 'VALE3' })] });
    const aoMudarCompras = vi.fn();
    await abrirPainel({ aoMudarCompras });
    expect(aoMudarCompras).not.toHaveBeenCalled();

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));
    await waitFor(() => expect(aoMudarCompras).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Editar a compra de VALE3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(aoMudarCompras).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /Excluir a compra de VALE3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(aoMudarCompras).toHaveBeenCalledTimes(3));
  });

  it('uma gravação recusada não avisa a grade', async () => {
    simularServidor();
    const aoMudarCompras = vi.fn();
    await abrirPainel({ aoMudarCompras });

    preencher({ ...compraBBAS3, Quantidade: '0' });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    expect(await screen.findByText(/A quantidade deve ser/)).toBeInTheDocument();
    expect(aoMudarCompras).not.toHaveBeenCalled();
  });

  it('Esc na pergunta de exclusão desiste só dela; o foco fica no painel', async () => {
    const aoFechar = vi.fn();
    simularServidor();
    await abrirPainel({ aoFechar });

    fireEvent.click(screen.getByRole('button', { name: /Excluir a compra/ }));
    const nao = screen.getByRole('button', { name: 'Não' });
    expect(nao).toHaveFocus();

    fireEvent.keyDown(nao, { key: 'Escape' });

    expect(screen.queryByText('Excluir esta compra?')).not.toBeInTheDocument();
    expect(aoFechar).not.toHaveBeenCalled();
    expect(campo('Código')).toHaveFocus();
  });

  it('código fora da lista da B3: avisa no campo e depois, sem oferecer a grade', async () => {
    simularServidor({ catalogo: ['PETR4'] });
    await abrirPainel();
    const sugestoes = () => document.getElementById(campo('Código').getAttribute('list')!)!;
    await waitFor(() => expect(sugestoes().querySelectorAll('option')).toHaveLength(1));

    preencher({ ...compraBBAS3, Código: 'bbsa3' });
    expect(campo('Código')).toHaveAccessibleDescription(
      'Este código não está na lista de ações da B3; confira antes de registrar',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    expect(
      await screen.findByText(/BBSA3 foi registrada, mas não está na lista/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar à grade' })).not.toBeInTheDocument();
  });

  it('lista que não carregou: registrar uma compra busca a lista completa de novo', async () => {
    let falhar = true;
    simularServidor({
      compras: [compra(1), compra(2, { ticker: 'VALE3' })],
      listar: () => (falhar ? new Response('erro', { status: 500 }) : null),
    });
    render(<RegistroCompras aoFechar={() => {}} aoMudarGrade={() => {}} />);
    await screen.findByText(/Não foi possível carregar as compras/);

    falhar = false;
    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    await waitFor(() => expect(linhas()).toHaveLength(3));
  });

  it('"Adicionar à grade" relê a seleção antes de gravar', async () => {
    const { gravacoes } = simularServidor({ selecao: ['PETR4'] });
    await abrirPainel();
    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));
    await screen.findByText('BBAS3 não está na grade.');

    // Outra aba mudou a grade enquanto o painel estava aberto.
    await fetch('/api/selecao', {
      method: 'PUT',
      body: JSON.stringify({ tickers: ['PETR4', 'VALE3'] }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar à grade' }));

    await screen.findByText('BBAS3 foi adicionada à grade.');
    expect(gravacoes().at(-1)).toMatchObject({ corpo: { tickers: ['PETR4', 'VALE3', 'BBAS3'] } });
  });

  it('filtra a lista e o resumo pelo código', async () => {
    simularServidor({ compras: [compra(1), compra(2, { ticker: 'VALE3' })] });
    await abrirPainel();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filtrar compras por código' }), {
      target: { value: 'vale' },
    });

    expect(linhas()).toHaveLength(1);
    expect(linhas()[0]).toHaveTextContent('VALE3');
    const resumo = screen.getByRole('table', { name: 'Resumo por ação' });
    expect(within(resumo).getAllByRole('row')).toHaveLength(2);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'itub' } });
    expect(screen.getByText('Nenhuma compra deste código.')).toBeInTheDocument();
  });

  it('sem compras: mostra a mensagem, e o formulário funciona', async () => {
    simularServidor({ compras: [] });
    render(<RegistroCompras aoFechar={() => {}} aoMudarGrade={() => {}} />);

    expect(await screen.findByText('Nenhuma compra registrada ainda.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar compra' })).toBeEnabled();
  });

  it('lista que não carrega: avisa e tenta de novo', async () => {
    let falhar = true;
    simularServidor({
      listar: () =>
        falhar ? new Response('erro', { status: 500 }) : Response.json({ transacoes: [compra(1)] }),
    });
    render(<RegistroCompras aoFechar={() => {}} aoMudarGrade={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as compras registradas',
    );
    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByRole('table', { name: 'Compras registradas' });
  });

  it('gravação que expira: avisa que pode ter sido salva e busca a lista de novo', async () => {
    const { pedidos } = simularServidor({ travarGravacao: true });
    await abrirPainel({ tempoLimiteMs: 50 });
    const listagens = () =>
      pedidos.filter((p) => p.endereco === '/api/transacoes' && p.metodo === 'GET');
    expect(listagens()).toHaveLength(1);

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('a compra pode ter sido salva');
    await waitFor(() => expect(listagens()).toHaveLength(2));
    expect(campo('Quantidade')).toHaveValue('1.000');
  });

  it('enquanto grava, Esc não fecha e o foco fica no painel', async () => {
    simularServidor({ travarGravacao: true });
    const aoFechar = vi.fn();
    await abrirPainel({ aoFechar });

    preencher(compraBBAS3);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar compra' }));

    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    expect(campo('Código')).toHaveFocus();
    fireEvent.keyDown(campo('Código'), { key: 'Escape' });
    expect(aoFechar).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();
  });

  it('Esc fecha o painel; com texto no filtro, só limpa o filtro', async () => {
    simularServidor();
    const aoFechar = vi.fn();
    await abrirPainel({ aoFechar });

    const filtro = screen.getByRole('searchbox');
    fireEvent.change(filtro, { target: { value: 'pe' } });
    fireEvent.keyDown(filtro, { key: 'Escape' });
    expect(filtro).toHaveValue('');
    expect(aoFechar).not.toHaveBeenCalled();

    fireEvent.keyDown(filtro, { key: 'Escape' });
    expect(aoFechar).toHaveBeenCalledOnce();
  });

  it('sugere códigos do catálogo e plataformas já usadas', async () => {
    simularServidor();
    await abrirPainel();

    const sugestoes = (rotulo: string) => {
      const id = campo(rotulo).getAttribute('list')!;
      return [...document.getElementById(id)!.querySelectorAll('option')].map((o) => o.value);
    };
    await waitFor(() => expect(sugestoes('Código')).toEqual(['BBAS3', 'PETR4']));
    expect(sugestoes('Plataforma')).toEqual(['BTG', 'Itaú Íon']);
  });
});
