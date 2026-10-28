import { describe, expect, it } from 'vitest';
import {
  ESPERA_ACAO_SEM_DADOS_MS,
  INTERVALO_ATUALIZACAO_MS,
  planejarProximaBusca,
  TENTATIVAS_ACAO_SEM_DADOS,
} from './agenda';
import { cotacao } from './testes/respostas';

describe('planejarProximaBusca', () => {
  it('todas as ações com preço: volta em 5 minutos', () => {
    const plano = planejarProximaBusca([cotacao('BBAS3', 1738)], new Map());

    expect(plano.esperaMs).toBe(INTERVALO_ATUALIZACAO_MS);
    expect(plano.tentativas.size).toBe(0);
  });

  it('ação ainda sem preço: pergunta de novo em 10 s, no máximo 3 vezes', () => {
    const cotacoes = [cotacao('BBAS3', 1738), cotacao('AXIA3', null)];
    let tentativas: ReadonlyMap<string, number> = new Map();
    const esperas: number[] = [];
    for (let i = 0; i < TENTATIVAS_ACAO_SEM_DADOS + 2; i++) {
      const plano = planejarProximaBusca(cotacoes, tentativas);
      esperas.push(plano.esperaMs);
      tentativas = plano.tentativas;
    }

    expect(esperas).toEqual([
      ESPERA_ACAO_SEM_DADOS_MS,
      ESPERA_ACAO_SEM_DADOS_MS,
      ESPERA_ACAO_SEM_DADOS_MS,
      INTERVALO_ATUALIZACAO_MS,
      INTERVALO_ATUALIZACAO_MS,
    ]);
  });

  it('ação que nunca terá preço não impede as buscas rápidas de uma nova', () => {
    const esgotada = new Map([['XXXX3', TENTATIVAS_ACAO_SEM_DADOS]]);
    const plano = planejarProximaBusca([cotacao('XXXX3', null), cotacao('AXIA3', null)], esgotada);

    expect(plano.esperaMs).toBe(ESPERA_ACAO_SEM_DADOS_MS);
    expect(plano.tentativas).toEqual(
      new Map([
        ['XXXX3', TENTATIVAS_ACAO_SEM_DADOS],
        ['AXIA3', 1],
      ]),
    );
  });

  it('ação que ganhou preço ou saiu da seleção é esquecida', () => {
    const plano = planejarProximaBusca(
      [cotacao('AXIA3', 4200)],
      new Map([
        ['AXIA3', 2],
        ['VALE3', 1],
      ]),
    );

    expect(plano.tentativas.size).toBe(0);
  });
});
