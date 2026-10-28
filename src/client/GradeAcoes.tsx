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
}

/**
 * Um ponteiro pressionado só explica o foco e o clique logo em seguida. Depois disso
 * (arrastou para fora, a rolagem com o dedo cancelou o toque), o registro é esquecido.
 */
const VALIDADE_PONTEIRO_MS = 1000;

/** Ticker do quadrado onde o evento aconteceu (o evento é tratado na grade, por delegação). */
function tickerDoEvento(evento: SyntheticEvent): Ticker | null {
  const alvo = evento.target as Element | null;
  return alvo?.closest<HTMLElement>('[data-ticker]')?.dataset.ticker ?? null;
}

/**
 * Grade de ações com destaque: o quadrado ativo fica forte e os 4 vizinhos, suaves.
 * Mouse (só onde há hover), toque (liga/desliga) e teclado (setas) movem o destaque.
 */
export function GradeAcoes({ cotacoes, rodada }: PropsGrade) {
  const grade = useRef<HTMLUListElement>(null);
  const idDica = useId();
  const colunas = useColunas(grade);
  const podePassarPorCima = usePodePassarPorCima();
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  /** Quadrado que recebe o Tab ao entrar na grade (um só ponto de parada). */
  const [focavel, setFocavel] = useState<Ticker | null>(null);
  /** Último ponteiro pressionado, para o foco e o clique saberem se vieram dele. */
  const ultimoPonteiro = useRef<{ tipo: string; em: number } | null>(null);
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

  // Tocar fora da grade apaga o destaque.
  useEffect(() => {
    const aoPressionar = (evento: globalThis.PointerEvent) => {
      if (!grade.current?.contains(evento.target as Node)) setAtivo(null);
    };
    document.addEventListener('pointerdown', aoPressionar);
    return () => document.removeEventListener('pointerdown', aoPressionar);
  }, []);

  function ativar(ticker: Ticker, origem: Origem) {
    // Mesmo destaque: não recria o estado, para não redesenhar a grade a cada movimento.
    setAtivo((atual) =>
      atual?.ticker === ticker && atual.origem === origem ? atual : { ticker, origem },
    );
  }

  /** Tipo do ponteiro pressionado há pouco, ou null se o evento não veio de um ponteiro. */
  function ponteiroRecente(): string | null {
    const registro = ultimoPonteiro.current;
    if (!registro || performance.now() - registro.em > VALIDADE_PONTEIRO_MS) return null;
    return registro.tipo;
  }

  function aoPassarPorCima(evento: PointerEvent) {
    const ticker = tickerDoEvento(evento);
    if (ticker && evento.pointerType === 'mouse' && podePassarPorCima) ativar(ticker, 'mouse');
  }

  // O mouse saiu: se o teclado estava na grade, o destaque volta para o quadrado focado.
  function aoSairDaGrade(evento: PointerEvent) {
    if (evento.pointerType !== 'mouse' || ativo?.origem !== 'mouse') return;
    const focado = focoDoTeclado.current;
    if (focado) ativar(focado, 'teclado');
    else setAtivo(null);
  }

  function aoPressionar(evento: PointerEvent) {
    ultimoPonteiro.current = { tipo: evento.pointerType, em: performance.now() };
  }

  function aoCancelarPonteiro() {
    ultimoPonteiro.current = null;
  }

  // Toque (ou ponteiro sem hover): liga, desliga no mesmo quadrado, ou muda para outro.
  function aoClicar(evento: SyntheticEvent) {
    const tipo = ponteiroRecente();
    ultimoPonteiro.current = null;
    if (tipo === null || (tipo === 'mouse' && podePassarPorCima)) return;
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
    if (focoAoSairDaJanela.current === ticker) {
      focoAoSairDaJanela.current = null;
      return;
    }
    // O foco que vem junto de um clique ou toque é tratado pelo próprio clique.
    if (ponteiroRecente() !== null) return;
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
          />
        ))}
      </ul>
    </>
  );
}
