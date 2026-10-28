import { ErroFonte } from './erroFonte.js';

/** Assinatura do fetch global; injetável para que nenhum teste acesse a internet. */
export type Buscar = typeof fetch;

/**
 * Únicos endereços externos que o app pode acessar. Todos são gratuitos e sem chave:
 * o app nunca usa APIs com conta, plano ou pagamento.
 */
export const HOSTS_PERMITIDOS: ReadonlySet<string> = new Set(['brapi.dev', 'icons.brapi.dev']);

const TEMPO_LIMITE_MS = 10_000;
const LIMITE_CORPO_DE_ERRO = 64 * 1024;
const PARAMETROS_DE_CHAVE = ['token', 'apikey', 'api_key', 'key'];

// Sinais de que a API passou a cobrar ou exigir conta.
const CABECALHOS_DE_COBRANCA = [
  'x-brapi-billing-action',
  'x-brapi-billing-status',
  'x-brapi-billing-warning',
  'x-brapi-upgrade-url',
];
const TEXTOS_DE_COBRANCA =
  /token|chave|plano|upgrade|assinatura|premium|pagamento|subscription|payment|unauthori[sz]ed|forbidden|crumb/i;

export interface RespostaExterna {
  status: number;
  cabecalhos: Headers;
  corpo: Uint8Array;
}

export interface OpcoesRequisicao {
  /** Tamanho máximo aceito para o corpo da resposta. */
  limiteBytes: number;
  /** Cabeçalhos extras (ex.: If-None-Match). Cabeçalhos de autenticação são proibidos. */
  cabecalhos?: Record<string, string>;
  /** Status além de 2xx que o chamador trata por conta própria (ex.: 304, 404). */
  statusAceitos?: readonly number[];
}

/** Garante que a URL é de um host permitido e não carrega nenhuma chave de acesso. */
export function validarUrlExterna(url: string): URL {
  const endereco = new URL(url);
  if (endereco.protocol !== 'https:' || !HOSTS_PERMITIDOS.has(endereco.hostname)) {
    throw new Error(`Endereço externo não permitido: ${endereco.origin}`);
  }
  const parametroDeChave = PARAMETROS_DE_CHAVE.find((nome) => endereco.searchParams.has(nome));
  if (parametroDeChave) {
    throw new Error(`Chaves de API são proibidas (parâmetro "${parametroDeChave}")`);
  }
  return endereco;
}

function temCabecalhoDeCobranca(cabecalhos: Headers): boolean {
  return CABECALHOS_DE_COBRANCA.some((nome) => cabecalhos.has(nome));
}

function lerRetryAfter(cabecalhos: Headers, agora: Date): Date | undefined {
  const valor = cabecalhos.get('retry-after') ?? cabecalhos.get('ratelimit-reset');
  const segundos = valor !== null && /^\d+$/.test(valor) ? Number(valor) : NaN;
  return Number.isFinite(segundos) ? new Date(agora.getTime() + segundos * 1000) : undefined;
}

/** Classifica uma resposta HTTP que não foi bem-sucedida. */
export function classificarFalha(
  status: number,
  cabecalhos: Headers,
  corpoTexto: string,
  agora: Date,
): ErroFonte {
  if (status === 401 || status === 402 || status === 403 || temCabecalhoDeCobranca(cabecalhos)) {
    return new ErroFonte('bloqueada', 'A API passou a exigir chave, plano ou pagamento', status);
  }
  if (status === 429) {
    return new ErroFonte(
      'instavel',
      'Limite de requisições atingido',
      status,
      lerRetryAfter(cabecalhos, agora),
    );
  }
  if (status >= 500 || status === 408) {
    return new ErroFonte('instavel', `A API respondeu com erro ${status}`, status);
  }
  if (TEXTOS_DE_COBRANCA.test(corpoTexto)) {
    return new ErroFonte('bloqueada', 'A API passou a exigir chave, plano ou pagamento', status);
  }
  return new ErroFonte(
    'formato_alterado',
    `A API respondeu de forma inesperada (${status})`,
    status,
  );
}

async function lerCorpoLimitado(resposta: Response, limiteBytes: number): Promise<Uint8Array> {
  const declarado = Number(resposta.headers.get('content-length'));
  if (declarado > limiteBytes) {
    resposta.body?.cancel().catch(() => {});
    throw new ErroFonte('formato_alterado', 'Resposta maior que o esperado', resposta.status);
  }
  if (!resposta.body) return new Uint8Array();

  const partes: Uint8Array[] = [];
  let total = 0;
  for await (const parte of resposta.body) {
    total += parte.byteLength;
    if (total > limiteBytes) {
      throw new ErroFonte('formato_alterado', 'Resposta maior que o esperado', resposta.status);
    }
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

/**
 * Faz uma requisição GET a uma API externa permitida. Nunca envia chaves de acesso.
 * Qualquer falha vira ErroFonte já classificada; nada escapa sem classificação.
 */
export async function requisitarExterno(
  buscar: Buscar,
  url: string,
  agora: Date,
  { limiteBytes, cabecalhos = {}, statusAceitos = [] }: OpcoesRequisicao,
): Promise<RespostaExterna> {
  const endereco = validarUrlExterna(url);
  if (Object.keys(cabecalhos).some((nome) => /authorization|token|api-?key/i.test(nome))) {
    throw new Error('Cabeçalhos de autenticação são proibidos');
  }

  let resposta: Response;
  try {
    resposta = await buscar(endereco, {
      headers: { accept: 'application/json, image/*', ...cabecalhos },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      redirect: 'error',
    });
  } catch (erro) {
    const tempoEsgotado = erro instanceof DOMException && erro.name === 'TimeoutError';
    throw new ErroFonte(
      'instavel',
      tempoEsgotado ? 'A API demorou demais para responder' : 'Não foi possível conectar à API',
    );
  }

  const sucesso = resposta.ok || statusAceitos.includes(resposta.status);
  if (sucesso && !temCabecalhoDeCobranca(resposta.headers)) {
    try {
      return {
        status: resposta.status,
        cabecalhos: resposta.headers,
        corpo: await lerCorpoLimitado(resposta, limiteBytes),
      };
    } catch (erro) {
      if (erro instanceof ErroFonte) throw erro;
      throw new ErroFonte('instavel', 'A conexão com a API caiu no meio da resposta');
    }
  }

  const corpoTexto = await lerCorpoLimitado(resposta, LIMITE_CORPO_DE_ERRO)
    .then((corpo) => new TextDecoder().decode(corpo))
    .catch(() => '');
  throw classificarFalha(resposta.status, resposta.headers, corpoTexto, agora);
}
