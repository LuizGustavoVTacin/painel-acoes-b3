import { ErroFonte } from './erroFonte.js';

/** Assinatura do fetch global; injetável para que nenhum teste acesse a internet. */
export type Buscar = typeof fetch;

/**
 * Únicos endereços externos que o app pode acessar, com os únicos parâmetros de URL aceitos
 * em cada um. Todos são gratuitos e sem chave: o app nunca usa APIs com conta, plano ou
 * pagamento, e por isso nenhum parâmetro de chave pode sequer ser montado.
 */
const PARAMETROS_POR_HOST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['brapi.dev', new Set(['type', 'limit'])],
  ['icons.brapi.dev', new Set<string>()],
]);
export const HOSTS_PERMITIDOS: ReadonlySet<string> = new Set(PARAMETROS_POR_HOST.keys());

const TEMPO_LIMITE_MS = 10_000;
const LIMITE_CORPO_DE_ERRO = 64 * 1024;
/** Espera máxima pedida por uma API (Retry-After) que respeitamos. */
const ESPERA_MAXIMA_MS = 24 * 60 * 60 * 1000;
/** Para 401/403 sem sinal de cobrança (ex.: bloqueio anti-robô): espera antes de insistir. */
const ESPERA_ACESSO_RECUSADO_MS = 60 * 60 * 1000;
const CABECALHOS_PROIBIDOS = /authorization|cookie|token|api-?key/i;

// Sinais de que a API passou a cobrar ou exigir conta.
const CABECALHOS_DE_COBRANCA = [
  'x-brapi-billing-action',
  'x-brapi-billing-status',
  'x-brapi-billing-warning',
  'x-brapi-upgrade-url',
];
const TEXTOS_DE_COBRANCA =
  /token|api[ -_]?key|chave|plano|upgrade|assinatura|premium|pagamento|subscription|payment/i;

export const MENSAGEM_COBRANCA = 'A API passou a exigir chave, plano ou pagamento';

export interface RespostaExterna {
  status: number;
  cabecalhos: Headers;
  corpo: Uint8Array;
  /** A resposta veio com dados, mas também com cabeçalhos de cobrança (aviso, não bloqueio). */
  avisoDeCobranca: boolean;
}

export interface OpcoesRequisicao {
  /** Tamanho máximo aceito para o corpo da resposta. */
  limiteBytes: number;
  /** Cabeçalhos extras (ex.: If-None-Match). Cabeçalhos de autenticação são proibidos. */
  cabecalhos?: Record<string, string>;
  /** Status além de 2xx que o chamador trata por conta própria (ex.: 304, 404). */
  statusAceitos?: readonly number[];
}

/** Garante que a URL é de um host permitido e só usa os parâmetros previstos para ele. */
export function validarUrlExterna(url: string): URL {
  const endereco = new URL(url);
  const parametrosAceitos = PARAMETROS_POR_HOST.get(endereco.hostname);
  if (endereco.protocol !== 'https:' || !parametrosAceitos) {
    throw new Error(`Endereço externo não permitido: ${endereco.origin}`);
  }
  for (const nome of endereco.searchParams.keys()) {
    if (!parametrosAceitos.has(nome)) {
      throw new Error(`Parâmetro não permitido em ${endereco.hostname}: "${nome}"`);
    }
  }
  return endereco;
}

/** Indica se um texto de resposta fala em chave, plano ou pagamento. */
export function mencionaCobranca(texto: string): boolean {
  return TEXTOS_DE_COBRANCA.test(texto);
}

function temCabecalhoDeCobranca(cabecalhos: Headers): boolean {
  return CABECALHOS_DE_COBRANCA.some((nome) => cabecalhos.has(nome));
}

/**
 * Quando a API pede para esperar. Só aceita números de segundos (valores enormes costumam
 * ser datas em formato epoch) e limita a espera a 24 h.
 */
export function lerRetryAfter(cabecalhos: Headers, agora: Date): Date | undefined {
  const valor = cabecalhos.get('retry-after') ?? cabecalhos.get('ratelimit-reset');
  if (valor === null || !/^\d{1,9}$/.test(valor.trim())) return undefined;
  const esperaMs = Math.min(Number(valor) * 1000, ESPERA_MAXIMA_MS);
  return new Date(agora.getTime() + esperaMs);
}

/** Classifica uma resposta HTTP que não foi bem-sucedida. */
export function classificarFalha(
  status: number,
  cabecalhos: Headers,
  corpoTexto: string,
  agora: Date,
): ErroFonte {
  if (status === 402 || temCabecalhoDeCobranca(cabecalhos)) {
    return new ErroFonte('bloqueada', MENSAGEM_COBRANCA, status);
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
  // Demais 4xx: o texto diz se é cobrança (ex.: "MISSING_TOKEN") ou outra coisa.
  if (mencionaCobranca(corpoTexto)) {
    return new ErroFonte('bloqueada', MENSAGEM_COBRANCA, status);
  }
  if (status === 401 || status === 403) {
    // Sem sinal de cobrança, pode ser temporário (bloqueio anti-robô, sessão expirada).
    return new ErroFonte(
      'instavel',
      'A API recusou o acesso (pode ser temporário)',
      status,
      new Date(agora.getTime() + ESPERA_ACESSO_RECUSADO_MS),
    );
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
  if (Object.keys(cabecalhos).some((nome) => CABECALHOS_PROIBIDOS.test(nome))) {
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
    throw new ErroFonte(
      'instavel',
      ehTempoEsgotado(erro)
        ? 'A API demorou demais para responder'
        : 'Não foi possível conectar à API',
    );
  }

  if (resposta.ok || statusAceitos.includes(resposta.status)) {
    try {
      return {
        status: resposta.status,
        cabecalhos: resposta.headers,
        corpo: await lerCorpoLimitado(resposta, limiteBytes),
        avisoDeCobranca: temCabecalhoDeCobranca(resposta.headers),
      };
    } catch (erro) {
      if (erro instanceof ErroFonte) throw erro;
      throw new ErroFonte(
        'instavel',
        ehTempoEsgotado(erro)
          ? 'A API demorou demais para responder'
          : 'A conexão com a API caiu no meio da resposta',
      );
    }
  }

  const corpoTexto = await lerCorpoLimitado(resposta, LIMITE_CORPO_DE_ERRO)
    .then((corpo) => new TextDecoder().decode(corpo))
    .catch(() => '');
  throw classificarFalha(resposta.status, resposta.headers, corpoTexto, agora);
}

function ehTempoEsgotado(erro: unknown): boolean {
  return erro instanceof DOMException && erro.name === 'TimeoutError';
}
