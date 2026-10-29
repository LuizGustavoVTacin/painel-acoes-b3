import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';
import type { Cotacao } from '../shared/painel';
import type { Posicao } from '../shared/posicao';
import type { Ticker } from '../shared/ticker';
import { QuadradoAcao, type Destaque } from './QuadradoAcao';
import { useColunas, usePodePassarPorCima } from './useLayoutGrade';
import { moverComSeta, vizinhos } from './vizinhos';

type Origem = 'mouse' | 'toque' | 'teclado';

interface Ativo {
  ticker: Ticker;
  origem: Origem;
}

interface PropsGrade {
  cotacoes: readonly Cotacao[];
  rodada: number;
  /** Posição de cada ação comprada (para a seta de ganho ou perda). */
  posicoes?: ReadonlyMap<Ticker, Posicao>;
}

/** Ticker do quadrado onde o evento aconteceu (o evento é tratado na grade, por delegação). */
function tickerDoEvento(evento: SyntheticEvent): Ticker | null {
  const alvo = evento.target as Element | null;
  return alvo?.closest<HTMLElement>('[data-ticker]')?.dataset.ticker ?? null;
}

/**
 * Grade de ações com destaque: o quadrado ativo fica forte e os 4 vizinhos, suaves.
 * Mouse (só onde há hover), toque (liga/desliga) e teclado (setas) movem o destaque.
 */
export function GradeAcoes({ cotacoes, rodada, posicoes }: PropsGrade) {
  const grade = useRef<HTMLUListElement>(null);
  const idDica = useId();
  const colunas = useColunas(grade);
  const podePassarPorCima = usePodePassarPorCima();
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  /** Quadrado que recebe o Tab ao entrar na grade (um só ponto de parada). */
  const [focavel, setFocavel] = useState<Ticker | null>(null);
  /**
   * Ponteiro pressionado agora, para o foco e o clique saberem se vieram dele. Vale até o fim
   * do gesto (logo após soltar) ou até ele ser cancelado pela rolagem com o dedo.
   */
  const ultimoPonteiro = useRef<string | null>(null);
  /** Quadrado focado pelo teclado (não por clique ou toque). */
  const focoDoTeclado = useRef<Ticker | null>(null);
  /** Quadrado que tinha o foco quando a janela perdeu o foco (Alt+Tab). */
  const focoAoSairDaJanela = useRef<Ticker | null>(null);

  // O destaque acompanha a ação; se ela sair da lista, some.
  const indiceAtivo = ativo ? cotacoes.findIndex((c) => c.ticker === ativo.ticker) : -1;
  const indicesVizinhos = new Set(vizinhos(indiceAtivo, cotacoes.length, colunas));
  const tickerFocavel = cotacoes.some((c) => c.ticker === focavel)
    ? focavel
    : (cotacoes[0]?.ticker ?? null);

  // E não volta sozinho se a ação for escolhida de novo depois (ajuste durante a renderização).
  if (ativo && indiceAtivo === -1) setAtivo(null);

  // Tocar fora da grade apaga o destaque. Ao soltar o ponteiro (mesmo fora da grade), o gesto
  // termina: depois do foco e do clique que ele causa, o registro é esquecido.
  useEffect(() => {
    const aoPressionar = (evento: globalThis.PointerEvent) => {
      if (!grade.current?.contains(evento.target as Node)) setAtivo(null);
    };
    let esquecer: ReturnType<typeof setTimeout> | undefined;
    const aoSoltar = () => {
      clearTimeout(esquecer);
      esquecer = setTimeout(() => (ultimoPonteiro.current = null), 0);
    };
    document.addEventListener('pointerdown', aoPressionar);
    document.addEventListener('pointerup', aoSoltar);
    return () => {
      clearTimeout(esquecer);
      document.removeEventListener('pointerdown', aoPressionar);
      document.removeEventListener('pointerup', aoSoltar);
    };
  }, []);

  function ativar(ticker: Ticker, origem: Origem) {
    // Mesmo destaque: não recria o estado, para não redesenhar a grade a cada movimento.
    setAtivo((atual) =>
      atual?.ticker === ticker && atual.origem === origem ? atual : { ticker, origem },
    );
  }

  function aoPassarPorCima(evento: PointerEvent) {
    const ticker = tickerDoEvento(evento);
    if (ticker && evento.pointerType === 'mouse' && podePassarPorCima) ativar(ticker, 'mouse');
  }

  // O mouse saiu: se o teclado estava na grade, o destaque volta para o quadrado focado.
  function aoSairDaGrade(evento: PointerEvent) {
    if (evento.pointerType !== 'mouse' || ativo?.origem !== 'mouse') return;
    const focado = focoDoTeclado.current;
    if (focado && cotacoes.some((c) => c.ticker === focado)) ativar(focado, 'teclado');
    else setAtivo(null);
  }

  function aoPressionar(evento: PointerEvent) {
    ultimoPonteiro.current = evento.pointerType;
  }

  function aoCancelarPonteiro() {
    ultimoPonteiro.current = null;
  }

  // Toque (ou ponteiro sem hover): liga, desliga no mesmo quadrado, ou muda para outro.
  function aoClicar(evento: SyntheticEvent) {
    // O clique já diz de que ponteiro veio (Chromium e Firefox); o registro é o plano B.
    const tipo =
      (evento.nativeEvent as globalThis.PointerEvent).pointerType || ultimoPonteiro.current;
    ultimoPonteiro.current = null;
    if (!tipo || (tipo === 'mouse' && podePassarPorCima)) return;
    const ticker = tickerDoEvento(evento);
    if (!ticker || ativo?.ticker === ticker) {
      setAtivo(null); // no próprio quadrado ativo ou no vão entre os quadrados
      return;
    }
    ativar(ticker, 'toque');
    setFocavel(ticker);
  }

  function aoFocar(evento: FocusEvent) {
    const ticker = tickerDoEvento(evento);
    if (!ticker) return;
    setFocavel(ticker);
    // A janela voltou a ter foco: o quadrado recupera o foco, mas o destaque fica como estava.
    const voltouDaJanela = focoAoSairDaJanela.current === ticker;
    focoAoSairDaJanela.current = null;
    if (voltouDaJanela) return;
    // O foco que vem junto de um clique ou toque é tratado pelo próprio clique.
    if (ultimoPonteiro.current !== null) {
      focoDoTeclado.current = null;
      return;
    }
    focoDoTeclado.current = ticker;
    ativar(ticker, 'teclado');
  }

  function aoDesfocar(evento: FocusEvent) {
    const ticker = tickerDoEvento(evento);
    if (!document.hasFocus()) {
      // Foi a janela que perdeu o foco (Alt+Tab): nada muda.
      focoAoSairDaJanela.current = ticker;
      return;
    }
    if (grade.current?.contains(evento.relatedTarget as Node | null)) return;
    focoDoTeclado.current = null;
    if (ativo?.origem === 'teclado') setAtivo(null);
  }

  function aoTeclar(evento: KeyboardEvent) {
    const ticker = tickerDoEvento(evento);
    // Com modificadores a tecla é do navegador (ex.: Alt+← volta a página).
    if (!ticker || evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
    if (evento.key === 'Escape') {
      setAtivo(null);
      return;
    }
    const indice = cotacoes.findIndex((c) => c.ticker === ticker);
    const destino = moverComSeta(indice, evento.key, cotacoes.length, colunas);
    if (destino === null) return;
    evento.preventDefault(); // as setas não rolam a página enquanto movem o destaque
    grade.current
      ?.querySelector<HTMLElement>(`[data-ticker="${cotacoes[destino].ticker}"]`)
      ?.focus();
    // O foco já ativou o destino; se ele não mudou (borda da grade), reacende o destaque.
    ativar(cotacoes[destino].ticker, 'teclado');
  }

  function destaqueDe(indice: number): Destaque {
    if (indice === indiceAtivo) return 'ativo';
    return indicesVizinhos.has(indice) ? 'vizinho' : null;
  }

  return (
    <>
      <p id={idDica} className="apenas-leitor">
        Use as setas para navegar entre as ações e Esc para apagar o destaque.
      </p>
      <ul
        ref={grade}
        className="grade"
        aria-label="Ações acompanhadas"
        aria-describedby={idDica}
        onPointerOver={aoPassarPorCima}
        onPointerLeave={aoSairDaGrade}
        onPointerDown={aoPressionar}
        onPointerCancel={aoCancelarPonteiro}
        onClick={aoClicar}
        onFocus={aoFocar}
        onBlur={aoDesfocar}
        onKeyDown={aoTeclar}
      >
        {cotacoes.map((cotacao, indice) => (
          <QuadradoAcao
            key={cotacao.ticker}
            cotacao={cotacao}
            rodada={rodada}
            destaque={destaqueDe(indice)}
            focavel={cotacao.ticker === tickerFocavel}
            posicao={posicoes?.get(cotacao.ticker)}
          />
        ))}
      </ul>
    </>
  );
}
