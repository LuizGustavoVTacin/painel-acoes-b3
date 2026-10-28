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

/**
 * Plataformas para sugerir: as já usadas (mais frequentes primeiro) e depois as padrão.
 * Grafias que só diferem em maiúsculas contam como uma; vale a mais usada.
 */
export function sugerirPlataformas(compras: readonly Transacao[]): string[] {
  const chave = (plataforma: string) => plataforma.toLocaleLowerCase('pt-BR');
  const grafias = new Map<string, Map<string, number>>();
  for (const { plataforma } of compras) {
    const contagem = grafias.get(chave(plataforma)) ?? new Map<string, number>();
    contagem.set(plataforma, (contagem.get(plataforma) ?? 0) + 1);
    grafias.set(chave(plataforma), contagem);
  }
  const usadas = [...grafias.values()]
    .map((contagem) => {
      const [grafia] = [...contagem].sort((a, b) => b[1] - a[1])[0];
      const total = [...contagem.values()].reduce((soma, n) => soma + n, 0);
      return { grafia, total };
    })
    .sort((a, b) => b.total - a.total);
  const conhecidas = new Set(usadas.map(({ grafia }) => chave(grafia)));
  return [
    ...usadas.map(({ grafia }) => grafia),
    ...PLATAFORMAS_SUGERIDAS.filter((plataforma) => !conhecidas.has(chave(plataforma))),
  ];
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
      // Uma ação com valores fora do limite não pode derrubar o painel inteiro.
      try {
        const posicao = calcularPosicao(lista);
        return posicao ? [{ ticker, ...posicao }] : [];
      } catch (erro) {
        console.error(`Não foi possível resumir as compras de ${ticker}:`, erro);
        return [];
      }
    });
}
