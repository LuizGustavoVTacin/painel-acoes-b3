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
let relogio = new Date();

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
    signal?.addEventListener('abort', () => controle.abort());
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
    expect(
      await screen.findByText(/Nenhuma ação selecionada/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();

    // 2. Escolhe BBAS3 e PETR4 pelo menu: os quadrados aparecem com os preços do Yahoo.
    await escolherAcoes('BBAS3', 'PETR4');
    await waitFor(() => expect(tickersNaGrade()).toEqual(['BBAS3', 'PETR4']), { timeout: 5000 });
    await waitFor(() => expect(quadrado('BBAS3')).toHaveTextContent('R$ 17,38'));
    expect(quadrado('PETR4')).toHaveTextContent('R$ 52,79');
    expect(quadrado('BBAS3')).not.toHaveTextContent('%');

    // 3. Registra uma compra de BBAS3: 100 a R$ 15,00 com R$ 0,00 de taxas → +15,87%.
    const painel = await abrirCompras();
    preencher({
      Código: 'BBAS3',
      Data: '20/10/2026',
      Quantidade: '100',
      'Preço unitário (R$)': '15,00',
      'Taxas (R$)': '0',
      Plataforma: 'Itaú Íon',
    });
    fireEvent.click(within(painel).getByRole('button', { name: 'Registrar compra' }));
    await waitFor(() => expect(quadrado('BBAS3')).toHaveTextContent('▲ +15,87%'));

    // 4. Edita para R$ 20,00: vira perda de 13,10%.
    fireEvent.click(
      await within(painel).findByRole('button', { name: /Editar a compra de BBAS3/ }),
    );
    preencher({ 'Preço unitário (R$)': '20,00' });
    fireEvent.click(within(painel).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(quadrado('BBAS3')).toHaveTextContent('▼ -13,10%'));

    // 5. Exclui: a seta some. Registra outra para conferir a reabertura.
    fireEvent.click(within(painel).getByRole('button', { name: /Excluir a compra de BBAS3/ }));
    fireEvent.click(within(painel).getByRole('button', { name: 'Sim, excluir' }));
    await waitFor(() => expect(quadrado('BBAS3')).not.toHaveTextContent('%'));
    preencher({
      Código: 'PETR4',
      Data: '21/10/2026',
      Quantidade: '10',
      'Preço unitário (R$)': '60,00',
      'Taxas (R$)': '0',
      Plataforma: 'BTG',
    });
    fireEvent.click(within(painel).getByRole('button', { name: 'Registrar compra' }));
    await waitFor(() => expect(quadrado('PETR4')).toHaveTextContent('▼ -12,02%'));

    // 6. Fecha tudo e abre de novo com o mesmo arquivo: seleção e compras continuam lá.
    await fecharTudo();
    await abrirApp(buscar);
    await waitFor(() => expect(tickersNaGrade()).toEqual(['BBAS3', 'PETR4']), { timeout: 5000 });
    await waitFor(() => expect(quadrado('PETR4')).toHaveTextContent('▼ -12,02%'));
    const plataforma = await abrirCompras();
    expect(await within(plataforma).findByText('BTG')).toBeInTheDocument();

    // 7. A internet cai horas depois: o último preço continua, com aviso, e a grade não quebra.
    await fecharTudo();
    internet.foraDoAr = true;
    const chamadasAntes = internet.chamadas.length;
    relogio = new Date(relogio.getTime() + 3 * 60 * 60 * 1000);
    await abrirApp(buscar);
    await waitFor(() => expect(tickersNaGrade()).toEqual(['BBAS3', 'PETR4']), {
      timeout: 15000,
    });
    await waitFor(() => expect(quadrado('BBAS3')).toHaveTextContent('desatualizado'), {
      timeout: 15000,
    });
    expect(internet.chamadas.length).toBeGreaterThan(chamadasAntes);
    expect(quadrado('BBAS3')).toHaveTextContent('R$ 17,38');
    expect(quadrado('PETR4')).toHaveTextContent('▼ -12,02%');
  }, 60000);
});
