import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LIMITE_ACOES_SELECIONADAS } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';
import { buscarCatalogo, buscarSelecao, ErroApi, salvarSelecao } from './api';
import { alternarAcao, montarListaEscolha } from './escolha';

interface PropsEscolha {
  aoFechar: () => void;
  /** Chamado depois que o servidor confirmou a nova seleção. */
  aoSalvar: () => void;
}

type Carga<T> = { situacao: 'carregando' } | { situacao: 'ok'; dados: T } | { situacao: 'erro' };

const iguais = (a: readonly Ticker[], b: readonly Ticker[]) =>
  a.length === b.length && a.every((ticker, i) => ticker === b[i]);

/**
 * Carrega os dados de uma busca ao servidor local; repete quando `tentativa` muda.
 * Um resultado que já carregou não é buscado de novo.
 */
function useCarga<T>(
  buscar: (signal: AbortSignal) => Promise<T>,
  tentativa: number,
): [Carga<T>, () => void] {
  const [carga, setCarga] = useState<Carga<T>>({ situacao: 'carregando' });
  const carregou = carga.situacao === 'ok';

  useEffect(() => {
    if (carregou) return;
    const controle = new AbortController();
    buscar(controle.signal).then(
      (dados) => setCarga({ situacao: 'ok', dados }),
      () => {
        if (!controle.signal.aborted) setCarga({ situacao: 'erro' });
      },
    );
    return () => controle.abort();
  }, [buscar, tentativa, carregou]);

  const reiniciar = () =>
    setCarga((atual) => (atual.situacao === 'erro' ? { situacao: 'carregando' } : atual));
  return [carga, reiniciar];
}

/**
 * Painel para escolher as ações da grade. As marcações são um rascunho até "Salvar":
 * cada clique não dispara uma busca de cotações.
 */
export function EscolhaAcoes({ aoFechar, aoSalvar }: PropsEscolha) {
  const [tentativa, setTentativa] = useState(0);
  const [salvas, reiniciarSalvas] = useCarga(buscarSelecao, tentativa);
  const [catalogo, reiniciarCatalogo] = useCarga(buscarCatalogo, tentativa);
  /** Rascunho; null até a seleção salva chegar. */
  const [rascunho, setRascunho] = useState<Ticker[] | null>(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    campoBusca.current?.focus();
  }, []);

  const tickersSalvos = salvas.situacao === 'ok' ? salvas.dados : null;
  const acoesDoCatalogo = catalogo.situacao === 'ok' ? catalogo.dados : null;
  const marcadas = rascunho ?? tickersSalvos ?? [];
  const itens = useMemo(
    () => (tickersSalvos ? montarListaEscolha(acoesDoCatalogo ?? [], tickersSalvos, busca) : []),
    [acoesDoCatalogo, tickersSalvos, busca],
  );

  function tentarDeNovo(): void {
    reiniciarSalvas();
    reiniciarCatalogo();
    setTentativa((n) => n + 1);
  }

  function alternar(ticker: Ticker): void {
    setRascunho((atual) => alternarAcao(atual ?? tickersSalvos ?? [], ticker));
  }

  async function salvar(): Promise<void> {
    setSalvando(true);
    setErroAoSalvar(null);
    try {
      await salvarSelecao(marcadas);
      aoSalvar();
    } catch (erro) {
      setErroAoSalvar(erro instanceof ErroApi ? erro.message : 'Não foi possível salvar a seleção');
      setSalvando(false);
    }
  }

  const cheio = marcadas.length >= LIMITE_ACOES_SELECIONADAS;
  const marcadasSet = new Set(marcadas);
  const houveMudanca = tickersSalvos !== null && !iguais(marcadas, tickersSalvos);

  let aviso: string | null = null;
  if (salvas.situacao === 'erro') aviso = 'Não foi possível carregar as ações selecionadas.';
  else if (catalogo.situacao === 'erro') {
    aviso = 'Não foi possível carregar a lista de ações; por enquanto só as selecionadas aparecem.';
  }

  let lista;
  if (salvas.situacao === 'carregando' || (tickersSalvos && catalogo.situacao === 'carregando')) {
    lista = <p role="status">Carregando ações…</p>;
  } else if (!tickersSalvos) {
    lista = null;
  } else if (itens.length === 0) {
    lista = <p className="vazio">Nenhuma ação encontrada.</p>;
  } else {
    lista = (
      <ul className="escolha-lista" aria-label="Ações disponíveis">
        {itens.map(({ ticker, nome, foraDoCatalogo }) => {
          const marcada = marcadasSet.has(ticker);
          return (
            <li key={ticker}>
              <label className="escolha-item">
                <input
                  type="checkbox"
                  checked={marcada}
                  disabled={!marcada && cheio}
                  onChange={() => alternar(ticker)}
                />
                <span className="ticker">{ticker}</span>{' '}
                <span className="escolha-nome">
                  {foraDoCatalogo && acoesDoCatalogo ? 'fora da lista atual da B3' : nome}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section
      className="escolha"
      role="dialog"
      aria-labelledby={idTitulo}
      onKeyDown={(evento) => {
        if (evento.key === 'Escape') aoFechar();
      }}
    >
      <h2 id={idTitulo}>Escolher ações</h2>

      <input
        ref={campoBusca}
        className="escolha-busca"
        type="search"
        placeholder="Buscar por código ou nome"
        aria-label="Buscar ação"
        value={busca}
        onChange={(evento) => setBusca(evento.target.value)}
      />

      {tickersSalvos && (
        <p className="escolha-contador" aria-live="polite">
          {marcadas.length} de {LIMITE_ACOES_SELECIONADAS} selecionadas
          {cheio && ' · limite atingido'}
        </p>
      )}

      {aviso && (
        <div role="alert" className="erro escolha-aviso">
          {aviso}{' '}
          <button type="button" onClick={tentarDeNovo}>
            Tentar de novo
          </button>
        </div>
      )}

      <div className="escolha-rolagem">{lista}</div>

      {erroAoSalvar && (
        <p role="alert" className="erro">
          {erroAoSalvar}
        </p>
      )}

      <div className="escolha-botoes">
        <button type="button" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          type="button"
          className="botao-principal"
          disabled={!houveMudanca || salvando}
          onClick={() => void salvar()}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </section>
  );
}
