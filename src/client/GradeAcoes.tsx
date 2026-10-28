import {
  useEffect,
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
  const colunas = useColunas(grade, cotacoes.length);
  const podePassarPorCima = usePodePassarPorCima();
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  /** Quadrado que recebe o Tab ao entrar na grade (um só ponto de parada). */
  const [focavel, setFocavel] = useState<Ticker | null>(null);
  /** Tipo do último ponteiro pressionado, para o clique saber se veio de um toque. */
  const ultimoPonteiro = useRef<string | null>(null);

  // O destaque acompanha a ação; se ela sair da lista, some.
  const indiceAtivo = ativo ? cotacoes.findIndex((c) => c.ticker === ativo.ticker) : -1;
  const indicesVizinhos = new Set(vizinhos(indiceAtivo, cotacoes.length, colunas));
  const tickerFocavel = cotacoes.some((c) => c.ticker === focavel)
    ? focavel
    : (cotacoes[0]?.ticker ?? null);

  // Tocar fora da grade apaga o destaque.
  useEffect(() => {
    const aoPressionar = (evento: globalThis.PointerEvent) => {
      if (!grade.current?.contains(evento.target as Node)) setAtivo(null);
    };
    document.addEventListener('pointerdown', aoPressionar);
    return () => document.removeEventListener('pointerdown', aoPressionar);
  }, []);

  function ativar(ticker: Ticker, origem: Origem) {
    setAtivo({ ticker, origem });
    setFocavel(ticker);
  }

  function aoPassarPorCima(evento: PointerEvent) {
    const ticker = tickerDoEvento(evento);
    if (ticker && evento.pointerType === 'mouse' && podePassarPorCima) ativar(ticker, 'mouse');
  }

  function aoSairDaGrade(evento: PointerEvent) {
    if (evento.pointerType === 'mouse' && ativo?.origem === 'mouse') setAtivo(null);
  }

  function aoPressionar(evento: PointerEvent) {
    ultimoPonteiro.current = evento.pointerType;
  }

  // Toque (ou ponteiro sem hover): liga, desliga no mesmo quadrado, ou muda para outro.
  function aoClicar(evento: SyntheticEvent) {
    const tipo = ultimoPonteiro.current;
    ultimoPonteiro.current = null;
    const ticker = tickerDoEvento(evento);
    if (!ticker || tipo === null || (tipo === 'mouse' && podePassarPorCima)) return;
    if (ativo?.ticker === ticker) setAtivo(null);
    else ativar(ticker, 'toque');
  }

  // Foco pelo teclado ativa; o foco que vem junto de um clique ou toque é tratado pelo clique.
  function aoFocar(evento: FocusEvent) {
    const ticker = tickerDoEvento(evento);
    if (!ticker) return;
    if (ultimoPonteiro.current !== null) setFocavel(ticker);
    else ativar(ticker, 'teclado');
  }

  function aoDesfocar(evento: FocusEvent) {
    const saiuDaGrade = !grade.current?.contains(evento.relatedTarget as Node | null);
    if (saiuDaGrade && ativo?.origem === 'teclado') setAtivo(null);
  }

  function aoTeclar(evento: KeyboardEvent) {
    const ticker = tickerDoEvento(evento);
    if (!ticker) return;
    if (evento.key === 'Escape') {
      setAtivo(null);
      return;
    }
    const indice = cotacoes.findIndex((c) => c.ticker === ticker);
    const destino = moverComSeta(indice, evento.key, cotacoes.length, colunas);
    if (destino === null) return;
    evento.preventDefault(); // as setas não rolam a página enquanto movem o destaque
    const novo = cotacoes[destino].ticker;
    ativar(novo, 'teclado');
    grade.current?.querySelector<HTMLElement>(`[data-ticker="${novo}"]`)?.focus();
  }

  function destaqueDe(indice: number): Destaque {
    if (indice === indiceAtivo) return 'ativo';
    return indicesVizinhos.has(indice) ? 'vizinho' : null;
  }

  return (
    <ul
      ref={grade}
      className="grade"
      aria-label="Ações acompanhadas"
      onPointerOver={aoPassarPorCima}
      onPointerLeave={aoSairDaGrade}
      onPointerDown={aoPressionar}
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
  );
}
