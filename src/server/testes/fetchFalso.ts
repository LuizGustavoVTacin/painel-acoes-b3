import type { Buscar } from '../externo/http.js';

/** Para testes que não devem acessar a internet: qualquer chamada falha o teste. */
export const fetchProibido: Buscar = async (entrada) => {
  throw new Error(`Teste tentou acessar a internet: ${String(entrada)}`);
};

export interface RequisicaoRegistrada {
  url: string;
  cabecalhos: Headers;
}

type Resposta = Response | Error | (() => Response | Promise<Response>);

/**
 * fetch falso: devolve as respostas configuradas por URL (exata ou prefixo) e registra cada
 * requisição, para os testes conferirem o que seria enviado à internet.
 */
export function criarFetchFalso(respostas: Record<string, Resposta | Resposta[]> = {}) {
  const requisicoes: RequisicaoRegistrada[] = [];
  const filas = new Map(
    Object.entries(respostas).map(([url, r]) => [url, Array.isArray(r) ? [...r] : [r]]),
  );

  const buscar: Buscar = async (entrada, opcoes) => {
    const url = String(entrada);
    requisicoes.push({ url, cabecalhos: new Headers(opcoes?.headers) });
    const chave = [...filas.keys()].find((padrao) => url === padrao || url.startsWith(padrao));
    const fila = chave === undefined ? undefined : filas.get(chave);
    if (!fila || fila.length === 0) throw new Error(`Sem resposta falsa para ${url}`);
    // A última resposta da fila se repete nas chamadas seguintes.
    const proxima = fila.length > 1 ? fila.shift()! : fila[0];
    if (proxima instanceof Error) throw proxima;
    const resposta = typeof proxima === 'function' ? await proxima() : proxima;
    // Resposta nova a cada chamada (clone() criaria ramos ligados, que travam ao cancelar).
    const corpo = await resposta.clone().arrayBuffer();
    return new Response(corpo.byteLength > 0 ? corpo : null, {
      status: resposta.status,
      headers: resposta.headers,
    });
  };

  return { buscar, requisicoes };
}

export const json = (corpo: unknown, init: ResponseInit = {}) => Response.json(corpo, init);

export const svg = (conteudo = '<svg xmlns="http://www.w3.org/2000/svg"/>', etag = '"v1"') =>
  new Response(conteudo, { headers: { 'content-type': 'image/svg+xml', etag } });
