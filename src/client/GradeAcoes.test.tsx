import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GradeAcoes } from './GradeAcoes';
import { cotacao } from './testes/respostas';

// 8 ações; com 3 colunas a grade fica:
//  BBAS3 PETR4 VALE3
//  ITUB4 B3SA3 WEGE3
//  ABEV3 BBDC4
const TICKERS = ['BBAS3', 'PETR4', 'VALE3', 'ITUB4', 'B3SA3', 'WEGE3', 'ABEV3', 'BBDC4'];
const COTACOES = TICKERS.map((t, i) => cotacao(t, 1000 + i));

/** Layout simulado: o jsdom não monta a grade, então as colunas e o redimensionamento são falsos. */
let colunasDoLayout = '150px 150px 150px';
let avisarRedimensionamento: () => void = () => {};
let temHover = true;

function prepararAmbiente() {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((elemento, pseudo) => {
    const estilo = original(elemento, pseudo);
    if (!elemento.classList.contains('grade')) return estilo;
    return new Proxy(estilo, {
      get: (alvo, chave) => {
        if (chave === 'gridTemplateColumns') return colunasDoLayout;
        const valor = Reflect.get(alvo, chave) as unknown;
        return typeof valor === 'function' ? (valor as () => unknown).bind(alvo) : valor;
      },
    });
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly aviso: () => void) {}
      // Só avisa depois de observar de fato a grade.
      observe() {
        avisarRedimensionamento = this.aviso;
      }
      disconnect() {
        avisarRedimensionamento = () => {};
      }
    },
  );
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    get matches() {
      return consulta === '(hover: hover)' && temHover;
    },
    addEventListener(_tipo: string, aviso: () => void) {
      avisarMudancaDeHover = aviso;
    },
    removeEventListener() {
      avisarMudancaDeHover = () => {};
    },
  }));
  // O jsdom diz que a janela nunca tem foco; no navegador, ela tem enquanto o usuário está nela.
  vi.spyOn(document, 'hasFocus').mockImplementation(() => janelaComFoco);
}

let avisarMudancaDeHover: () => void = () => {};
let janelaComFoco = true;

const quadrado = (ticker: string) => screen.getByText(ticker).closest('li')!;

function destaques() {
  const ativo = TICKERS.filter((t) => quadrado(t).classList.contains('quadrado-ativo'));
  const vizinhos = TICKERS.filter((t) => quadrado(t).classList.contains('quadrado-vizinho'));
  return { ativo, vizinhos };
}

const passarMouse = (ticker: string) =>
  fireEvent.pointerOver(quadrado(ticker), { pointerType: 'mouse' });

function tocar(elemento: Element) {
  fireEvent.pointerDown(elemento, { pointerType: 'touch' });
  fireEvent.click(elemento);
}

describe('GradeAcoes', () => {
  beforeEach(() => {
    colunasDoLayout = '150px 150px 150px';
    temHover = true;
    janelaComFoco = true;
    prepararAmbiente();
  });
  afterEach(cleanup);

  describe('com mouse', () => {
    it('passar por cima destaca o quadrado e os 4 vizinhos', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      passarMouse('B3SA3');

      expect(destaques()).toEqual({
        ativo: ['B3SA3'],
        vizinhos: ['PETR4', 'ITUB4', 'WEGE3', 'BBDC4'],
      });
    });

    it('no canto e na última linha, só os vizinhos que existem', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      passarMouse('WEGE3');
      expect(destaques().vizinhos).toEqual(['VALE3', 'B3SA3']); // abaixo não há quadrado

      passarMouse('ABEV3');
      expect(destaques().vizinhos).toEqual(['ITUB4', 'BBDC4']);
    });

    it('sair da grade apaga o destaque', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      passarMouse('B3SA3');

      fireEvent.pointerOut(quadrado('B3SA3'), {
        pointerType: 'mouse',
        relatedTarget: document.body,
      });

      expect(destaques()).toEqual({ ativo: [], vizinhos: [] });
    });

    it('ao redimensionar, os vizinhos seguem as novas colunas', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      passarMouse('B3SA3');

      colunasDoLayout = '150px 150px';
      act(() => avisarRedimensionamento());

      // Em 2 colunas: B3SA3 é o índice 4, na 3ª linha, 1ª coluna.
      expect(destaques().vizinhos).toEqual(['VALE3', 'WEGE3', 'ABEV3']);
    });

    it('sem saber as colunas, destaca só o quadrado ativo', () => {
      colunasDoLayout = 'none';
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      passarMouse('B3SA3');

      expect(destaques()).toEqual({ ativo: ['B3SA3'], vizinhos: [] });
    });

    it('clique de mouse não liga nem desliga (quem manda é o passar por cima)', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      passarMouse('B3SA3');

      fireEvent.pointerDown(quadrado('B3SA3'), { pointerType: 'mouse' });
      fireEvent.click(quadrado('B3SA3'));

      expect(destaques().ativo).toEqual(['B3SA3']);
    });
  });

  describe('com toque', () => {
    beforeEach(() => {
      temHover = false;
    });

    it('sem hover, o ponteiro passando por cima não destaca', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      passarMouse('B3SA3');

      expect(destaques().ativo).toEqual([]);
    });

    it('um toque liga, outro no mesmo quadrado desliga, em outro muda', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      tocar(quadrado('B3SA3'));
      expect(destaques().ativo).toEqual(['B3SA3']);

      tocar(quadrado('BBAS3'));
      expect(destaques()).toEqual({ ativo: ['BBAS3'], vizinhos: ['PETR4', 'ITUB4'] });

      tocar(quadrado('BBAS3'));
      expect(destaques().ativo).toEqual([]);
    });

    it('tocar em algo dentro do quadrado (o preço) também conta', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      tocar(screen.getByText('R$ 10,04'));

      expect(destaques().ativo).toEqual(['B3SA3']);
    });

    it('o foco que vem junto do toque não desfaz o toque', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      const alvo = quadrado('B3SA3');

      fireEvent.pointerDown(alvo, { pointerType: 'touch' });
      fireEvent.focus(alvo);
      fireEvent.click(alvo);

      expect(destaques().ativo).toEqual(['B3SA3']);
    });

    it('tocar fora da grade apaga', () => {
      render(
        <>
          <GradeAcoes cotacoes={COTACOES} rodada={1} />
          <p>fora</p>
        </>,
      );
      tocar(quadrado('B3SA3'));

      fireEvent.pointerDown(screen.getByText('fora'), { pointerType: 'touch' });

      expect(destaques().ativo).toEqual([]);
    });

    it('tocar no vão entre os quadrados apaga', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      tocar(quadrado('B3SA3'));

      tocar(screen.getByRole('list', { name: 'Ações acompanhadas' }));

      expect(destaques().ativo).toEqual([]);
    });

    it('mouse ligado num tablet: passa a destacar ao passar por cima', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      temHover = true;
      act(() => avisarMudancaDeHover());
      passarMouse('B3SA3');

      expect(destaques().ativo).toEqual(['B3SA3']);
    });

    it('mouse num aparelho sem hover funciona como toque', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      fireEvent.pointerDown(quadrado('B3SA3'), { pointerType: 'mouse' });
      fireEvent.click(quadrado('B3SA3'));

      expect(destaques().ativo).toEqual(['B3SA3']);
    });
  });

  describe('com teclado', () => {
    it('só um quadrado entra no Tab: o primeiro, depois o último focado ou tocado', () => {
      temHover = false;
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      const tabulaveis = () => TICKERS.filter((t) => quadrado(t).tabIndex === 0);

      expect(tabulaveis()).toEqual(['BBAS3']);

      tocar(quadrado('B3SA3'));
      expect(tabulaveis()).toEqual(['B3SA3']);

      act(() => quadrado('WEGE3').focus());
      expect(tabulaveis()).toEqual(['WEGE3']);
    });

    it('o mouse passando não tira o ponto de Tab do quadrado focado', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      act(() => quadrado('BBDC4').focus());

      passarMouse('BBAS3');

      expect(quadrado('BBDC4').tabIndex).toBe(0);
      expect(destaques().ativo).toEqual(['BBAS3']);
      // A seta parte do quadrado focado.
      fireEvent.keyDown(quadrado('BBDC4'), { key: 'ArrowLeft' });
      expect(destaques().ativo).toEqual(['ABEV3']);
    });

    it('mouse saindo da grade devolve o destaque ao quadrado focado pelo teclado', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      act(() => quadrado('BBDC4').focus());
      passarMouse('BBAS3');

      fireEvent.pointerOut(quadrado('BBAS3'), {
        pointerType: 'mouse',
        relatedTarget: document.body,
      });

      expect(destaques().ativo).toEqual(['BBDC4']);
    });

    it('teclas com Alt, Ctrl, Shift ou Meta ficam com o navegador', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      act(() => quadrado('PETR4').focus());

      for (const modificador of ['altKey', 'ctrlKey', 'shiftKey', 'metaKey']) {
        const naoBloqueou = fireEvent.keyDown(quadrado('PETR4'), {
          key: 'ArrowLeft',
          [modificador]: true,
        });
        expect(naoBloqueou).toBe(true);
      }
      expect(destaques().ativo).toEqual(['PETR4']);
    });

    it('anuncia o ativo e explica as setas para leitores de tela', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      act(() => quadrado('PETR4').focus());

      expect(quadrado('PETR4')).toHaveAttribute('aria-current', 'true');
      expect(quadrado('BBAS3')).not.toHaveAttribute('aria-current');
      expect(screen.getByRole('list', { name: 'Ações acompanhadas' })).toHaveAccessibleDescription(
        /Use as setas/,
      );
    });

    it('trocar de janela e voltar não muda o destaque', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      act(() => quadrado('PETR4').focus());
      fireEvent.keyDown(quadrado('PETR4'), { key: 'Escape' });

      // Alt+Tab: o quadrado perde o foco com a janela e o recebe de volta ao voltar.
      janelaComFoco = false;
      fireEvent.blur(quadrado('PETR4'));
      janelaComFoco = true;
      fireEvent.focus(quadrado('PETR4'));

      expect(destaques().ativo).toEqual([]);
    });

    it('focar destaca; as setas movem o foco e o destaque; Esc apaga', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);

      act(() => quadrado('BBAS3').focus());
      expect(destaques().ativo).toEqual(['BBAS3']);

      fireEvent.keyDown(quadrado('BBAS3'), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(quadrado('PETR4'));
      expect(destaques().ativo).toEqual(['PETR4']);

      fireEvent.keyDown(quadrado('PETR4'), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(quadrado('B3SA3'));
      expect(destaques().vizinhos).toEqual(['PETR4', 'ITUB4', 'WEGE3', 'BBDC4']);

      fireEvent.keyDown(quadrado('B3SA3'), { key: 'End' });
      expect(document.activeElement).toBe(quadrado('BBDC4'));

      fireEvent.keyDown(quadrado('BBDC4'), { key: 'Escape' });
      expect(destaques().ativo).toEqual([]);
      expect(document.activeElement).toBe(quadrado('BBDC4'));
    });

    it('setas impedem a rolagem da página; outras teclas não', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      act(() => quadrado('BBAS3').focus());

      expect(fireEvent.keyDown(quadrado('BBAS3'), { key: 'ArrowDown' })).toBe(false);
      expect(fireEvent.keyDown(quadrado('ITUB4'), { key: 'a' })).toBe(true);
    });

    it('foco depois de um arraste que terminou fora da grade volta a destacar', () => {
      const relogio = vi.spyOn(performance, 'now').mockReturnValue(1000);
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      fireEvent.pointerDown(quadrado('B3SA3'), { pointerType: 'mouse' }); // soltou fora: sem clique

      relogio.mockReturnValue(5000);
      act(() => quadrado('PETR4').focus());

      expect(destaques().ativo).toEqual(['PETR4']);
    });

    it('toque cancelado pela rolagem não deixa o ponteiro preso', () => {
      render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      fireEvent.pointerDown(quadrado('B3SA3'), { pointerType: 'touch' });
      fireEvent.pointerCancel(quadrado('B3SA3'), { pointerType: 'touch' });

      act(() => quadrado('PETR4').focus());

      expect(destaques().ativo).toEqual(['PETR4']);
    });

    it('sair da grade com o Tab apaga o destaque', () => {
      render(
        <>
          <GradeAcoes cotacoes={COTACOES} rodada={1} />
          <button>fora</button>
        </>,
      );
      act(() => quadrado('BBAS3').focus());

      act(() => screen.getByText('fora').focus());

      expect(destaques().ativo).toEqual([]);
    });
  });

  describe('lista que muda', () => {
    it('o destaque acompanha a ação quando a ordem muda', () => {
      const { rerender } = render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      passarMouse('B3SA3');

      rerender(<GradeAcoes cotacoes={[...COTACOES].reverse()} rodada={2} />);

      // Invertida: BBDC4 ABEV3 WEGE3 / B3SA3 ITUB4 VALE3 / PETR4 BBAS3 (vizinhos em ordem de TICKERS)
      expect(destaques()).toEqual({ ativo: ['B3SA3'], vizinhos: ['PETR4', 'ITUB4', 'BBDC4'] });
    });

    it('ação que sai e volta para a lista não traz o destaque de volta', () => {
      const { rerender } = render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      passarMouse('B3SA3');

      rerender(<GradeAcoes cotacoes={COTACOES.filter((c) => c.ticker !== 'B3SA3')} rodada={2} />);
      rerender(<GradeAcoes cotacoes={COTACOES} rodada={3} />);

      expect(destaques().ativo).toEqual([]);
    });

    it('funciona igual no StrictMode (efeitos montados duas vezes)', () => {
      temHover = false;
      render(
        <StrictMode>
          <GradeAcoes cotacoes={COTACOES} rodada={1} />
        </StrictMode>,
      );

      tocar(quadrado('B3SA3'));
      expect(destaques().ativo).toEqual(['B3SA3']);
      colunasDoLayout = '150px 150px';
      act(() => avisarRedimensionamento());
      expect(destaques().vizinhos).toEqual(['VALE3', 'WEGE3', 'ABEV3']);
    });

    it('ação que sai da lista leva o destaque junto', () => {
      const { rerender } = render(<GradeAcoes cotacoes={COTACOES} rodada={1} />);
      passarMouse('B3SA3');

      const semB3 = COTACOES.filter((c) => c.ticker !== 'B3SA3');
      rerender(<GradeAcoes cotacoes={semB3} rodada={2} />);

      const restantes = semB3.map((c) => quadrado(c.ticker));
      expect(restantes.some((li) => li.className.includes('quadrado-'))).toBe(false);
    });
  });
});
