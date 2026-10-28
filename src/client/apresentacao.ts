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
  brapi_icones: 'Logos da brapi',
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

function avisoDaFonte({ provedor, situacao, mensagem }: EstadoFonte): Aviso | null {
  const nome = NOME_PROVEDOR[provedor];
  switch (situacao) {
    case 'ok':
      return mensagem ? { nivel: 'atencao', texto: `${nome}: ${mensagem}` } : null;
    case 'instavel':
      return {
        nivel: 'atencao',
        texto: `${nome} indisponível no momento. Usando os últimos dados salvos.`,
      };
    case 'bloqueada':
      return {
        nivel: 'erro',
        texto: `${nome} passou a exigir pagamento ou chave e não está sendo usada. Nova verificação em até 24 h.`,
      };
    case 'formato_alterado':
      return {
        nivel: 'erro',
        texto: `${nome} mudou o formato dos dados e não está sendo usada. Nova verificação em até 24 h.`,
      };
  }
}

/** Avisos do rodapé: situação de cada API e ações que o Yahoo não conhece. */
export function avisosDoRodape({ fontes, semCotacaoNoYahoo }: RespostaCotacoes): Aviso[] {
  const avisos = [...fontes]
    .sort((a, b) => ORDEM_PROVEDORES.indexOf(a.provedor) - ORDEM_PROVEDORES.indexOf(b.provedor))
    .map(avisoDaFonte)
    .filter((aviso): aviso is Aviso => aviso !== null);
  if (semCotacaoNoYahoo.length > 0) {
    avisos.push({
      nivel: 'atencao',
      texto: `Sem cotação no Yahoo: ${semCotacaoNoYahoo.join(', ')}. O código pode ter mudado.`,
    });
  }
  return avisos;
}
