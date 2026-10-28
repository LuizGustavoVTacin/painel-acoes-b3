import { ehInstanteISO, formatarHorario } from '../shared/datas';
import type {
  Cotacao,
  EstadoFonte,
  FonteCotacao,
  Provedor,
  RespostaCotacoes,
} from '../shared/painel';

const NOME_FONTE: Record<FonteCotacao, string> = {
  yahoo: 'Yahoo Finance',
  brapi: 'brapi (reserva)',
};

const NOME_PROVEDOR: Record<Provedor, string> = {
  yahoo: 'Yahoo Finance',
  brapi: 'brapi',
  brapi_icones: 'Servidor de logos da brapi',
};

/** Ordem dos avisos no rodapé: primeiro a fonte principal. */
const ORDEM_PROVEDORES: Provedor[] = ['yahoo', 'brapi', 'brapi_icones'];

export function textoMercado(mercadoAberto: boolean | null): string {
  if (mercadoAberto === null) return 'Pregão de hoje ainda não confirmado';
  return mercadoAberto ? 'Mercado aberto' : 'Mercado fechado · último fechamento';
}

/** Instante mais recente em que alguma cotação foi obtida, ou null se nenhuma tem preço. */
export function ultimaAtualizacao(cotacoes: readonly Cotacao[]): string | null {
  let maisRecente: string | null = null;
  for (const { atualizadoEm } of cotacoes) {
    if (atualizadoEm && (!maisRecente || Date.parse(atualizadoEm) > Date.parse(maisRecente))) {
      maisRecente = atualizadoEm;
    }
  }
  return maisRecente;
}

/** "Cotações: Yahoo Finance", com a reserva e os dados salvos quando for o caso. */
export function textoFontesEmUso({ cotacoes, fontesEmUso }: RespostaCotacoes): string | null {
  if (fontesEmUso.length > 0) {
    return `Cotações: ${fontesEmUso.map((fonte) => NOME_FONTE[fonte]).join(' + ')}`;
  }
  if (cotacoes.some((cotacao) => cotacao.precoCentavos !== null)) {
    return 'Cotações: últimos dados salvos (nenhuma fonte atualizou recentemente)';
  }
  return null;
}

export interface Aviso {
  nivel: 'erro' | 'atencao';
  texto: string;
}

/** Por que o app deixou de chamar a API por 24 h. */
const MOTIVO_DA_PARADA = {
  bloqueada: 'passou a exigir pagamento ou chave',
  formato_alterado: 'mudou o formato dos dados',
} as const;

/** O que a tela mostra enquanto a API está fora. */
function substituto(provedor: Provedor, fontesEmUso: readonly FonteCotacao[]): string {
  if (provedor === 'brapi_icones') return 'Os logos já salvos continuam aparecendo.';
  if (provedor === 'yahoo' && fontesEmUso.includes('brapi')) {
    return 'Usando a brapi como reserva.';
  }
  return 'Usando os últimos dados salvos.';
}

function proximaVerificacao(proximaTentativa: string | null): string {
  return proximaTentativa && ehInstanteISO(proximaTentativa)
    ? `Nova verificação em ${formatarHorario(proximaTentativa)}.`
    : 'Nova verificação em até 24 h.';
}

function avisoDaFonte(
  { provedor, situacao, mensagem, proximaTentativa }: EstadoFonte,
  fontesEmUso: readonly FonteCotacao[],
): Aviso | null {
  const nome = NOME_PROVEDOR[provedor];
  switch (situacao) {
    case 'ok':
      return mensagem ? { nivel: 'atencao', texto: `${nome}: ${mensagem}` } : null;
    case 'instavel':
      return {
        nivel: 'atencao',
        texto: `${nome}: indisponível no momento. ${substituto(provedor, fontesEmUso)}`,
      };
    case 'bloqueada':
    case 'formato_alterado':
      return {
        nivel: 'erro',
        texto: `${nome}: ${MOTIVO_DA_PARADA[situacao]} e o app parou de chamá-lo. ${substituto(provedor, fontesEmUso)} ${proximaVerificacao(proximaTentativa)}`,
      };
  }
}

/** Avisos do rodapé: situação de cada API e ações que o Yahoo não conhece. */
export function avisosDoRodape({
  fontes,
  fontesEmUso,
  semCotacaoNoYahoo,
}: RespostaCotacoes): Aviso[] {
  const avisos = [...fontes]
    .sort((a, b) => ORDEM_PROVEDORES.indexOf(a.provedor) - ORDEM_PROVEDORES.indexOf(b.provedor))
    .map((fonte) => avisoDaFonte(fonte, fontesEmUso))
    .filter((aviso): aviso is Aviso => aviso !== null);
  if (semCotacaoNoYahoo.length > 0) {
    avisos.push({
      nivel: 'atencao',
      texto: `Sem cotação no Yahoo: ${semCotacaoNoYahoo.join(', ')}. O código pode ter mudado.`,
    });
  }
  return avisos;
}
