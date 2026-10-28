import { formatarData, lerDataBR, type DataISO } from '../shared/datas';
import { formatarCentesimos, textoParaCentavos, type Centavos } from '../shared/dinheiro';
import { calcularPosicao, type Posicao } from '../shared/posicao';
import type { Ticker } from '../shared/ticker';
import {
  conferirDadosTransacao,
  totalDaCompra,
  type DadosTransacao,
  type ErrosDeCampo,
  type ResultadoConferencia,
  type Transacao,
} from '../shared/transacao';

/** O que está digitado em cada campo do formulário de compra. */
export interface TextoCompra {
  ticker: string;
  data: string;
  quantidade: string;
  precoUnitario: string;
  taxas: string;
  plataforma: string;
}

/** Plataformas sugeridas mesmo antes da primeira compra. */
export const PLATAFORMAS_SUGERIDAS = ['Itaú Íon', 'BTG'];

/** Formulário de uma compra nova: data de hoje e taxas zeradas. */
export function compraEmBranco(hoje: DataISO): TextoCompra {
  return {
    ticker: '',
    data: formatarData(hoje),
    quantidade: '',
    precoUnitario: '',
    taxas: '0,00',
    plataforma: '',
  };
}

/** Uma compra salva, como texto para editar. */
export function textoDaCompra(compra: DadosTransacao): TextoCompra {
  return {
    ticker: compra.ticker,
    data: formatarData(compra.data),
    quantidade: String(compra.quantidade),
    precoUnitario: formatarCentesimos(compra.precoUnitario),
    taxas: formatarCentesimos(compra.taxas),
    plataforma: compra.plataforma,
  };
}

// Inteiro, com ou sem pontos de milhar: "100", "1.000".
const PADRAO_QUANTIDADE = /^(?:\d{1,3}(?:\.\d{3})+|\d+)$/;

function lerQuantidade(texto: string): number | null {
  const limpo = texto.trim();
  return PADRAO_QUANTIDADE.test(limpo) ? Number(limpo.replaceAll('.', '')) : null;
}

function lerCentavos(texto: string): Centavos | null {
  try {
    return textoParaCentavos(texto);
  } catch {
    return null;
  }
}

function lerData(texto: string): DataISO | null {
  try {
    return lerDataBR(texto);
  } catch {
    return null;
  }
}

/**
 * Converte o texto do formulário numa compra, com as mesmas regras do servidor.
 * Um campo que nem dá para ler (ex.: "abc" no preço) recebe uma mensagem de formato.
 * Taxas em branco valem zero.
 */
export function lerCompra(texto: TextoCompra, hoje: DataISO): ResultadoConferencia {
  const formato: ErrosDeCampo = {};
  const data = lerData(texto.data);
  if (data === null) formato.data = 'Use o formato dd/mm/aaaa';
  const quantidade = lerQuantidade(texto.quantidade);
  if (quantidade === null) formato.quantidade = 'Use só números inteiros, como 100';
  const precoUnitario = lerCentavos(texto.precoUnitario);
  if (precoUnitario === null) formato.precoUnitario = 'Use o formato 1.234,56';
  const taxas = texto.taxas.trim() === '' ? 0 : lerCentavos(texto.taxas);
  if (taxas === null) formato.taxas = 'Use o formato 1.234,56';

  const conferida = conferirDadosTransacao(
    { ticker: texto.ticker, data, quantidade, precoUnitario, taxas, plataforma: texto.plataforma },
    hoje,
  );
  if (Object.keys(formato).length === 0) return conferida;
  // O erro de formato explica melhor o problema do que a regra que ele acabou quebrando.
  return { valida: false, campos: { ...(conferida.valida ? {} : conferida.campos), ...formato } };
}

/** Total enquanto se digita (quantidade × preço + taxas); null se ainda não dá para calcular. */
export function totalDigitado(texto: TextoCompra): Centavos | null {
  const quantidade = lerQuantidade(texto.quantidade);
  const precoUnitario = lerCentavos(texto.precoUnitario);
  const taxas = texto.taxas.trim() === '' ? 0 : lerCentavos(texto.taxas);
  if (!quantidade || !precoUnitario || taxas === null) return null;
  const total = totalDaCompra({ quantidade, precoUnitario, taxas });
  return Number.isSafeInteger(total) ? total : null;
}

/** Mesma ordem do servidor: data mais recente primeiro; no mesmo dia, a registrada por último. */
export function ordenarCompras(compras: readonly Transacao[]): Transacao[] {
  return [...compras].sort((a, b) => (a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1));
}

/** Plataformas para sugerir: as já usadas (mais frequentes primeiro) e depois as padrão. */
export function sugerirPlataformas(compras: readonly Transacao[]): string[] {
  const contagem = new Map<string, number>();
  for (const { plataforma } of compras)
    contagem.set(plataforma, (contagem.get(plataforma) ?? 0) + 1);
  const usadas = [...contagem].sort((a, b) => b[1] - a[1]).map(([plataforma]) => plataforma);
  return [...new Set([...usadas, ...PLATAFORMAS_SUGERIDAS])];
}

export interface ResumoAcao extends Posicao {
  ticker: Ticker;
}

/** Quantidade total, custo e preço médio de cada ação comprada, em ordem de código. */
export function resumirPorAcao(compras: readonly Transacao[]): ResumoAcao[] {
  const porAcao = new Map<Ticker, Transacao[]>();
  for (const compra of compras) {
    porAcao.set(compra.ticker, [...(porAcao.get(compra.ticker) ?? []), compra]);
  }
  return [...porAcao]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([ticker, lista]) => {
      const posicao = calcularPosicao(lista);
      return posicao ? [{ ticker, ...posicao }] : [];
    });
}
