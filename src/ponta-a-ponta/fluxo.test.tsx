/**
 * Teste ponta a ponta: o app React inteiro (jsdom) conversa por HTTP de verdade com o servidor
 * Express real, gravando num banco SQLite em arquivo temporário. Só a internet é simulada:
 * Yahoo e brapi respondem com dados gravados, e nenhuma chamada sai do computador.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../client/App';
import { criarApp } from '../server/app';
import { abrirBanco, fecharBanco, type Banco } from '../server/banco/conexao';
import type { Buscar } from '../server/externo/http';
import { json } from '../server/testes/fetchFalso';
import { itemSpark, spark } from '../server/testes/yahooFalso';

/** Ida e volta HTTP real mais a renderização: folga para máquinas carregadas. */
const ESPERA = { timeout: 5000 };

const PRECOS = { BBAS3: 17.38, PETR4: 52.79, VALE3: 61.38 } as const;

const listaBrapi = () =>
  json({
    stocks: Object.entries(PRECOS).map(([stock, close]) => ({
      stock,
      name: stock,
      close,
      logo: null,
      sector: 'Finance',
      change: 1,
    })),
  });

/** Internet simulada: Yahoo e brapi respondem, ou ficam fora do ar quando `foraDoAr`. */
function criarInternet() {
  const internet = { foraDoAr: false, chamadas: [] as string[] };
  const buscar: Buscar = async (entrada) => {
    const url = String(entrada);
    internet.chamadas.push(url);
    if (internet.foraDoAr) throw new TypeError('fetch failed');
    if (url.startsWith('https://query1.finance.yahoo.com/v7/finance/spark')) {
      return spark(...Object.entries(PRECOS).map(([ticker, preco]) => itemSpark(ticker, preco)));
    }
    if (url.startsWith('https://brapi.dev/api/quote/list')) return listaBrapi();
    throw new Error(`Endereço inesperado no teste: ${url}`);
  };
  return { internet, buscar };
}

interface ServidorNoAr {
  banco: Banco;
  servidor: Server;
  endereco: string;
}

let pasta: string;
let arquivoBanco: string;
let noAr: ServidorNoAr | null = null;
/** Quarta-feira, 28/10/2026, 14h em Brasília: pregão aberto (o resultado não depende do dia). */
const INICIO = new Date('2026-10-28T17:00:00Z');
let relogio = INICIO;

function ligarServidor(buscar: Buscar): Promise<ServidorNoAr> {
  const banco = abrirBanco(arquivoBanco);
  const app = criarApp({ banco, buscar, agora: () => relogio });
  return new Promise((resolver) => {
    const servidor = app.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as AddressInfo;
      resolver({ banco, servidor, endereco: `http://127.0.0.1:${port}` });
    });
  });
}

async function desligarServidor() {
  if (!noAr) return;
  const { servidor, banco } = noAr;
  noAr = null;
  servidor.closeAllConnections();
  await new Promise((resolver) => servidor.close(resolver));
  fecharBanco(banco);
}

/**
 * O app pede "/api/..." como no navegador; aqui o endereço ganha o host do servidor de teste.
 * O sinal de cancelamento do jsdom não é aceito pelo fetch do Node, então o cancelamento é
 * repassado à mão.
 */
function apontarFetchPara(endereco: string) {
  const fetchDoNode = globalThis.fetch;
  vi.stubGlobal('fetch', (entrada: string, opcoes: RequestInit = {}) => {
    const { signal, ...resto } = opcoes;
    const controle = new AbortController();
    signal?.addEventListener('abort', () => controle.abort(), { once: true });
    if (signal?.aborted) controle.abort();
    return fetchDoNode(new URL(entrada, endereco), { ...resto, signal: controle.signal }).catch(
      (erro: unknown) => {
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        throw erro;
      },
    );
  });
}

async function abrirApp(buscar: Buscar) {
  noAr = await ligarServidor(buscar);
  apontarFetchPara(noAr.endereco);
  render(<App />);
}

/** Fecha o navegador e o servidor (como fechar a janela do iniciar.bat). */
async function fecharTudo() {
  cleanup();
  await desligarServidor();
}

const quadrado = (ticker: string) =>
  screen.getAllByRole('listitem').find((item) => item.dataset.ticker === ticker)!;
const tickersNaGrade = () =>
  screen
    .queryAllByRole('listitem')
    .map((item) => item.dataset.ticker)
    .filter(Boolean);

async function escolherAcoes(...tickers: string[]) {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Escolher ações' }));
  for (const ticker of tickers) {
    fireEvent.click(await screen.findByRole('checkbox', { name: new RegExp(`^${ticker}\\b`) }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
}

async function abrirCompras() {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Registrar compras' }));
  return screen.findByRole('dialog');
}

function preencher(valores: Record<string, string>) {
  for (const [rotulo, valor] of Object.entries(valores)) {
    fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
  }
}

/** Registra uma compra sem taxas: código, data, quantidade, preço unitário e plataforma. */
function registrarCompra(
  painel: HTMLElement,
  [codigo, data, quantidade, preco, plataforma]: [string, string, string, string, string],
) {
  preencher({
    Código: codigo,
    Data: data,
    Quantidade: quantidade,
    'Preço unitário (R$)': preco,
    'Taxas (R$)': '0',
    Plataforma: plataforma,
  });
  fireEvent.click(within(painel).getByRole('button', { name: 'Registrar compra' }));
}

beforeAll(() => {
  pasta = mkdtempSync(path.join(tmpdir(), 'dashboard-ponta-a-ponta-'));
  arquivoBanco = path.join(pasta, 'dados.db');
});

afterEach(fecharTudo);

afterAll(() => {
  rmSync(pasta, { recursive: true, force: true });
});

describe('ponta a ponta: do primeiro uso à reabertura', () => {
  it('escolher ações, registrar, editar e excluir compras, reabrir e sobreviver à queda da fonte', async () => {
    const { internet, buscar } = criarInternet();

    // 1. Primeiro uso: nenhuma ação escolhida.
    await abrirApp(buscar);
    expect(await screen.findByText(/Nenhuma ação selecionada/, {}, ESPERA)).toBeInTheDocument();

    // 2. Escolhe BBAS3 e PETR4 pelo menu: os quadrados aparecem com os preços do Yahoo.
    await escolherAcoes('BBAS3', 'PETR4');
    await waitFor(() => expect(tickersNaGrade()).toEqual(['BBAS3', 'PETR4']), ESPERA);
    await waitFor(() => expect(quadrado('BBAS3')).toHaveTextContent('R$ 17,38'), ESPERA);
    expect(quadrado('PETR4')).toHaveTextContent('R$ 52,79');
    expect(quadrado('BBAS3')).not.toHaveTextContent('%');

    // 3. Registra uma compra de BBAS3: 100 a R$ 15,00 com R$ 0,00 de taxas → +15,87%.
    const painel = await abrirCompras();
    registrarCompra(painel, ['BBAS3', '20/10/2026', '100', '15,00', 'Itaú Íon']);
    await waitFor(() => expect(quadrado('BBAS3')).toHaveTextContent('▲ +15,87%'), ESPERA);

    // 4. Edita para R$ 20,00: vira perda de 13,10%.
    fireEvent.click(
      await within(painel).findByRole('button', { name: /Editar a compra de BBAS3/ }),
    );
    preencher({ 'Preço unitário (R$)': '20,00' });
    fireEvent.click(within(painel).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(quadrado('BBAS3')).toHaveTextContent('▼ -13,10%'), ESPERA);

    // 5. Exclui: a seta some. Registra outra para conferir a reabertura.
    fireEvent.click(within(painel).getByRole('button', { name: /Excluir a compra de BBAS3/ }));
    fireEvent.click(within(painel).getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(quadrado('BBAS3')).not.toHaveTextContent('%'), ESPERA);
    registrarCompra(painel, ['PETR4', '21/10/2026', '10', '60,00', 'BTG']);
    await waitFor(() => expect(quadrado('PETR4')).toHaveTextContent('▼ -12,02%'), ESPERA);

    // 6. Fecha tudo e abre de novo com o mesmo arquivo: seleção e compras continuam lá.
    await fecharTudo();
    await abrirApp(buscar);
    await waitFor(() => expect(tickersNaGrade()).toEqual(['BBAS3', 'PETR4']), ESPERA);
    await waitFor(() => expect(quadrado('PETR4')).toHaveTextContent('▼ -12,02%'), ESPERA);
    // A edição e a exclusão também ficaram gravadas: BBAS3 sem seta e sem compra na lista.
    expect(quadrado('BBAS3')).not.toHaveTextContent('%');
    const compras = await abrirCompras();
    expect(await within(compras).findByText('BTG')).toBeInTheDocument();
    expect(
      within(compras).queryByRole('button', { name: /Editar a compra de BBAS3/ }),
    ).not.toBeInTheDocument();

    // 7. A internet cai 20 minutos depois (antes de o preço ficar velho pela idade): o último
    // preço continua, o rodapé avisa a falha do Yahoo e a grade não quebra.
    await fecharTudo();
    internet.foraDoAr = true;
    const chamadasAntes = internet.chamadas.length;
    relogio = new Date(INICIO.getTime() + 20 * 60 * 1000);
    await abrirApp(buscar);
    await waitFor(() => expect(tickersNaGrade()).toEqual(['BBAS3', 'PETR4']), ESPERA);
    expect(
      await screen.findByText(/Yahoo Finance: indisponível no momento/, {}, { timeout: 15000 }),
    ).toBeInTheDocument();
    const novasChamadas = internet.chamadas.slice(chamadasAntes);
    expect(novasChamadas.some((url) => url.includes('finance.yahoo.com'))).toBe(true);
    expect(quadrado('BBAS3')).toHaveTextContent('R$ 17,38');
    expect(quadrado('PETR4')).toHaveTextContent('▼ -12,02%');
  }, 60000);
});
