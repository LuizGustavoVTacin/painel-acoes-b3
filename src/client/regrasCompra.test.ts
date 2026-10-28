import { describe, expect, it, vi } from 'vitest';
import type { Transacao } from '../shared/transacao';
import {
  compraEmBranco,
  lerCompra,
  resumirPorAcao,
  sugerirPlataformas,
  textoDaCompra,
  totalDigitado,
  type TextoCompra,
} from './regrasCompra';

const HOJE = '2026-10-28';

const texto = (extra: Partial<TextoCompra> = {}): TextoCompra => ({
  ticker: 'bbas3',
  data: '20/10/2026',
  quantidade: '1.000',
  precoUnitario: '17,38',
  taxas: '4,90',
  plataforma: '  Itaú Íon ',
  ...extra,
});

const compra = (id: number, extra: Partial<Transacao> = {}): Transacao => ({
  id,
  ticker: 'BBAS3',
  data: '2026-10-20',
  quantidade: 100,
  precoUnitario: 1738,
  taxas: 490,
  plataforma: 'Itaú Íon',
  criadoEm: '2026-10-20T13:00:00.000Z',
  atualizadoEm: '2026-10-20T13:00:00.000Z',
  ...extra,
});

describe('compraEmBranco', () => {
  it('começa com a data de hoje e taxas zeradas', () => {
    expect(compraEmBranco(HOJE)).toEqual({
      ticker: '',
      data: '28/10/2026',
      quantidade: '',
      precoUnitario: '',
      taxas: '0,00',
      plataforma: '',
    });
  });
});

describe('lerCompra', () => {
  it('converte o texto em centavos, data ISO e código normalizado', () => {
    expect(lerCompra(texto(), HOJE)).toEqual({
      valida: true,
      dados: {
        ticker: 'BBAS3',
        data: '2026-10-20',
        quantidade: 1000,
        precoUnitario: 1738,
        taxas: 490,
        plataforma: 'Itaú Íon',
      },
    });
  });

  it('aceita "R$" no preço e taxas em branco (zero)', () => {
    const lida = lerCompra(texto({ precoUnitario: 'R$ 1.234,5', taxas: ' ' }), HOJE);
    expect(lida).toMatchObject({ valida: true, dados: { precoUnitario: 123450, taxas: 0 } });
  });

  it('campos ilegíveis recebem mensagem de formato', () => {
    const lida = lerCompra(
      texto({ data: '2026-10-20', quantidade: '1,5', precoUnitario: '17.38', taxas: 'abc' }),
      HOJE,
    );
    expect(lida).toEqual({
      valida: false,
      campos: {
        data: 'Use o formato dd/mm/aaaa',
        quantidade: 'Use só números inteiros, como 100',
        precoUnitario: 'Use o formato 1.234,56',
        taxas: 'Use o formato 1.234,56',
      },
    });
  });

  it('aplica as regras do servidor ao que foi lido', () => {
    const lida = lerCompra(
      texto({
        ticker: 'XX',
        data: '29/10/2026',
        quantidade: '0',
        precoUnitario: '0,00',
        plataforma: '',
      }),
      HOJE,
    );
    expect(lida.valida).toBe(false);
    expect(!lida.valida && lida.campos).toEqual({
      ticker: 'Informe um código da B3 válido, como BBAS3',
      data: 'A data da compra não pode ser no futuro',
      quantidade: 'A quantidade deve ser um número inteiro maior que zero',
      precoUnitario: 'O preço unitário deve ser maior que zero e até R$ 1.000.000,00',
      plataforma: 'Informe a plataforma (até 40 caracteres)',
    });
  });

  it('erro de formato num campo convive com erro de regra em outro', () => {
    const lida = lerCompra(texto({ ticker: '', precoUnitario: 'dez' }), HOJE);
    expect(!lida.valida && lida.campos).toEqual({
      ticker: 'Informe um código da B3 válido, como BBAS3',
      precoUnitario: 'Use o formato 1.234,56',
    });
  });
});

describe('textoDaCompra', () => {
  it('volta para o texto do formulário, e relê igual', () => {
    const salva = compra(1, { quantidade: 1500, precoUnitario: 123456, taxas: 0 });
    const comoTexto = textoDaCompra(salva);
    expect(comoTexto).toEqual({
      ticker: 'BBAS3',
      data: '20/10/2026',
      quantidade: '1500',
      precoUnitario: '1.234,56',
      taxas: '0,00',
      plataforma: 'Itaú Íon',
    });
    expect(lerCompra(comoTexto, HOJE)).toMatchObject({
      valida: true,
      dados: { quantidade: 1500, precoUnitario: 123456, taxas: 0, data: '2026-10-20' },
    });
  });
});

describe('totalDigitado', () => {
  it('quantidade × preço + taxas, em centavos', () => {
    expect(totalDigitado(texto())).toBe(1000 * 1738 + 490);
  });

  it('null enquanto falta algo ou há texto ilegível', () => {
    expect(totalDigitado(texto({ quantidade: '' }))).toBeNull();
    expect(totalDigitado(texto({ precoUnitario: '17,' }))).toBeNull();
    expect(totalDigitado(texto({ taxas: 'x' }))).toBeNull();
  });
});

describe('sugerirPlataformas', () => {
  it('as mais usadas primeiro, depois as padrão, sem repetir', () => {
    const lista = [
      compra(1, { plataforma: 'BTG' }),
      compra(2, { plataforma: 'XP' }),
      compra(3, { plataforma: 'XP' }),
    ];
    expect(sugerirPlataformas(lista)).toEqual(['XP', 'BTG', 'Itaú Íon']);
  });

  it('grafias que só diferem em maiúsculas viram uma (a mais usada)', () => {
    const lista = [
      compra(1, { plataforma: 'btg' }),
      compra(2, { plataforma: 'BTG' }),
      compra(3, { plataforma: 'BTG' }),
      compra(4, { plataforma: 'itaú íon' }),
    ];
    expect(sugerirPlataformas(lista)).toEqual(['BTG', 'itaú íon']);
  });

  it('sem compras, só as padrão', () => {
    expect(sugerirPlataformas([])).toEqual(['Itaú Íon', 'BTG']);
  });
});

describe('resumirPorAcao', () => {
  it('junta as compras de cada ação, em ordem de código', () => {
    const lista = [
      compra(1, { ticker: 'PETR4', quantidade: 10, precoUnitario: 5000, taxas: 0 }),
      compra(2, { quantidade: 100, precoUnitario: 1000, taxas: 100 }),
      compra(3, { quantidade: 100, precoUnitario: 2000, taxas: 100 }),
    ];
    expect(resumirPorAcao(lista)).toEqual([
      { ticker: 'BBAS3', quantidadeTotal: 200, custoTotal: 300200, precoMedio: 1501 },
      { ticker: 'PETR4', quantidadeTotal: 10, custoTotal: 50000, precoMedio: 5000 },
    ]);
  });

  it('ação cuja conta estoura os limites fica de fora, sem derrubar as outras', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const enorme = { quantidade: 1_000_000_000, precoUnitario: 100_000_000, taxas: 0 };
    const lista = [compra(1, enorme), compra(2, enorme), compra(3, { ticker: 'PETR4' })];
    expect(resumirPorAcao(lista).map((r) => r.ticker)).toEqual(['PETR4']);
  });
});
