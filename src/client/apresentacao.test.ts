import { describe, expect, it } from 'vitest';
import { avisosDoRodape, textoFontesEmUso, textoMercado, ultimaAtualizacao } from './apresentacao';
import { cotacao, fonte, resposta } from './testes/respostas';

describe('textoMercado', () => {
  it.each([
    [true, 'Mercado aberto'],
    [false, 'Mercado fechado · último fechamento'],
    [null, 'Pregão de hoje ainda não confirmado'],
  ])('%s → %s', (aberto, texto) => {
    expect(textoMercado(aberto)).toBe(texto);
  });
});

describe('ultimaAtualizacao', () => {
  it('escolhe o instante mais recente, ignorando ações sem preço', () => {
    expect(
      ultimaAtualizacao([
        cotacao('BBAS3', 1738, { atualizadoEm: '2026-10-27T20:00:00.000Z' }),
        cotacao('ELET3', null),
        cotacao('PETR4', 5279, { atualizadoEm: '2026-10-27T20:30:00.000Z' }),
        cotacao('VALE3', 6000, { atualizadoEm: '2026-10-27T19:00:00.000Z' }),
      ]),
    ).toBe('2026-10-27T20:30:00.000Z');
  });

  it('compara instantes, não textos (fusos diferentes)', () => {
    expect(
      ultimaAtualizacao([
        cotacao('BBAS3', 1738, { atualizadoEm: '2026-10-27T20:00:00-03:00' }),
        cotacao('PETR4', 5279, { atualizadoEm: '2026-10-27T22:00:00Z' }),
      ]),
    ).toBe('2026-10-27T20:00:00-03:00');
  });

  it('null quando nenhuma ação tem preço', () => {
    expect(ultimaAtualizacao([cotacao('ELET3', null)])).toBeNull();
    expect(ultimaAtualizacao([])).toBeNull();
  });
});

describe('textoFontesEmUso', () => {
  it('nomeia as fontes em uso, com a brapi como reserva', () => {
    expect(textoFontesEmUso(resposta())).toBe('Cotações: Yahoo Finance');
    expect(textoFontesEmUso(resposta({ fontesEmUso: ['yahoo', 'brapi'] }))).toBe(
      'Cotações: Yahoo Finance + brapi (reserva)',
    );
    expect(textoFontesEmUso(resposta({ fontesEmUso: ['brapi'] }))).toBe(
      'Cotações: brapi (reserva)',
    );
  });

  it('sem fonte em uso mas com preços salvos, avisa que são dados salvos', () => {
    expect(textoFontesEmUso(resposta({ fontesEmUso: [] }))).toMatch(/últimos dados salvos/);
  });

  it('nada a dizer sem nenhum preço', () => {
    expect(
      textoFontesEmUso(resposta({ fontesEmUso: [], cotacoes: [cotacao('ELET3', null)] })),
    ).toBeNull();
    expect(textoFontesEmUso(resposta({ fontesEmUso: [], cotacoes: [] }))).toBeNull();
  });
});

describe('avisosDoRodape', () => {
  it('sem problemas, sem avisos', () => {
    expect(avisosDoRodape(resposta())).toEqual([]);
  });

  it('descreve cada situação de falha, com o Yahoo primeiro', () => {
    const avisos = avisosDoRodape(
      resposta({
        fontes: [
          fonte('brapi_icones', 'formato_alterado'),
          fonte('brapi', 'instavel'),
          fonte('yahoo', 'bloqueada'),
        ],
      }),
    );

    expect(avisos).toEqual([
      {
        nivel: 'erro',
        texto:
          'Yahoo Finance passou a exigir pagamento ou chave e não está sendo usada. Nova verificação em até 24 h.',
      },
      { nivel: 'atencao', texto: 'brapi indisponível no momento. Usando os últimos dados salvos.' },
      {
        nivel: 'erro',
        texto:
          'Logos da brapi mudou o formato dos dados e não está sendo usada. Nova verificação em até 24 h.',
      },
    ]);
  });

  it('API funcionando com aviso (ex.: menção a cobrança) aparece como atenção', () => {
    expect(
      avisosDoRodape(resposta({ fontes: [fonte('brapi', 'ok', 'A API mencionou cobrança')] })),
    ).toEqual([{ nivel: 'atencao', texto: 'brapi: A API mencionou cobrança' }]);
  });

  it('lista as ações sem cotação no Yahoo', () => {
    expect(avisosDoRodape(resposta({ semCotacaoNoYahoo: ['ELET3', 'XXXX3'] }))).toEqual([
      {
        nivel: 'atencao',
        texto: 'Sem cotação no Yahoo: ELET3, XXXX3. O código pode ter mudado.',
      },
    ]);
  });
});
