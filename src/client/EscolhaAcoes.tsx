import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { LIMITE_ACOES_SELECIONADAS, type AcaoCatalogo } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';
import { buscarCatalogo, buscarSelecao, ErroApi, salvarSelecao } from './api';
import { alternarAcao, montarListaEscolha, selecaoFinal } from './escolha';

interface PropsEscolha {
  aoFechar: () => void;
  /** Chamado depois que o servidor confirmou a nova seleção. */
  aoSalvar: () => void;
}

/**
 * O catálogo pode esperar a brapi (que tem tempo limite próprio no servidor); passado isto,
 * algo travou e o painel oferece "Tentar de novo" em vez de carregar para sempre.
 */
export const TEMPO_LIMITE_ESCOLHA_MS = 20 * 1000;

type Carga<T> = { situacao: 'carregando' } | { situacao: 'ok'; dados: T } | { situacao: 'erro' };

const iguais = (a: readonly Ticker[], b: readonly Ticker[]) =>
  a.length === b.length && a.every((ticker, i) => ticker === b[i]);

/**
 * O servidor responde com lista vazia quando ainda não conseguiu baixar o catálogo da brapi;
 * para quem escolhe, isso é uma falha (com "Tentar de novo"), não "nenhuma ação".
 */
async function buscarCatalogoPreenchido(signal: AbortSignal): Promise<AcaoCatalogo[]> {
  const acoes = await buscarCatalogo(signal);
  if (acoes.length === 0) throw new ErroApi('Catálogo vazio');
  return acoes;
}

/** Roda `tarefa` com um sinal que é cancelado por `controle` ou ao passar o tempo limite. */
async function comTempoLimite<T>(
  tarefa: (signal: AbortSignal) => Promise<T>,
  controle: AbortController,
  tempoLimiteMs: number,
): Promise<T> {
  const limite = setTimeout(() => controle.abort(), tempoLimiteMs);
  try {
    return await tarefa(controle.signal);
  } finally {
    clearTimeout(limite);
  }
}

/**
 * Carrega os dados de uma busca ao servidor local; repete quando `tentativa` muda.
 * Um resultado que já carregou não é buscado de novo.
 */
function useCarga<T>(
  buscar: (signal: AbortSignal) => Promise<T>,
  tentativa: number,
  tempoLimiteMs: number,
): [Carga<T>, () => void] {
  const [carga, setCarga] = useState<Carga<T>>({ situacao: 'carregando' });
  const carregou = carga.situacao === 'ok';

  useEffect(() => {
    if (carregou) return;
    let ativo = true;
    const controle = new AbortController();
    comTempoLimite(buscar, controle, tempoLimiteMs).then(
      (dados) => {
        if (ativo) setCarga({ situacao: 'ok', dados });
      },
      () => {
        if (ativo) setCarga({ situacao: 'erro' });
      },
    );
    return () => {
      ativo = false;
      controle.abort();
    };
  }, [buscar, tentativa, carregou, tempoLimiteMs]);

  const reiniciar = () =>
    setCarga((atual) => (atual.situacao === 'erro' ? { situacao: 'carregando' } : atual));
  return [carga, reiniciar];
}

/** Mantém o Tab dentro do painel: do último elemento volta ao primeiro, e vice-versa. */
function prenderFoco(evento: KeyboardEvent<HTMLElement>): void {
  const focaveis = evento.currentTarget.querySelectorAll<HTMLElement>(
    'input:not(:disabled), button:not(:disabled)',
  );
  if (focaveis.length === 0) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  if (evento.shiftKey && document.activeElement === primeiro) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && document.activeElement === ultimo) {
    evento.preventDefault();
    primeiro.focus();
  }
}

interface PropsPainel extends PropsEscolha {
  tempoLimiteMs?: number;
}

/**
 * Painel para escolher as ações da grade. As marcações são um rascunho até "Salvar":
 * cada clique não dispara uma busca de cotações.
 */
export function EscolhaAcoes({
  aoFechar,
  aoSalvar,
  tempoLimiteMs = TEMPO_LIMITE_ESCOLHA_MS,
}: PropsPainel) {
  const [tentativa, setTentativa] = useState(0);
  const [salvas, reiniciarSalvas] = useCarga(buscarSelecao, tentativa, tempoLimiteMs);
  const [catalogo, reiniciarCatalogo] = useCarga(
    buscarCatalogoPreenchido,
    tentativa,
    tempoLimiteMs,
  );
  /** Rascunho; null até a primeira marcação (vale a seleção salva). */
  const [rascunho, setRascunho] = useState<Ticker[] | null>(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const montado = useRef(true);
  const idTitulo = useId();

  useEffect(() => {
    montado.current = true;
    campoBusca.current?.focus();
    return () => {
      montado.current = false;
    };
  }, []);

  const tickersSalvos = salvas.situacao === 'ok' ? salvas.dados : null;
  const acoesDoCatalogo = catalogo.situacao === 'ok' ? catalogo.dados : null;
  const marcadas = rascunho ?? tickersSalvos ?? [];
  // Enquanto o catálogo não chega, as salvas já aparecem (só com o código).
  const itens = useMemo(
    () => (tickersSalvos ? montarListaEscolha(acoesDoCatalogo ?? [], tickersSalvos, busca) : []),
    [acoesDoCatalogo, tickersSalvos, busca],
  );
  const aSalvar = tickersSalvos && selecaoFinal(tickersSalvos, marcadas);

  function tentarDeNovo(): void {
    reiniciarSalvas();
    reiniciarCatalogo();
    setTentativa((n) => n + 1);
  }

  function alternar(ticker: Ticker): void {
    setRascunho((atual) => alternarAcao(atual ?? tickersSalvos ?? [], ticker));
  }

  async function salvar(): Promise<void> {
    if (!aSalvar) return;
    setSalvando(true);
    setErroAoSalvar(null);
    try {
      await comTempoLimite(
        (signal) => salvarSelecao(aSalvar, signal),
        new AbortController(),
        tempoLimiteMs,
      );
      // Mesmo com o painel já fechado, o servidor gravou: a grade precisa ser atualizada.
      aoSalvar();
    } catch (erro) {
      if (!montado.current) return;
      setErroAoSalvar(
        erro instanceof ErroApi ? erro.message : 'Não foi possível salvar a seleção; tente de novo',
      );
      setSalvando(false);
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLElement>): void {
    if (evento.key === 'Tab') {
      prenderFoco(evento);
      return;
    }
    if (evento.key !== 'Escape' || salvando) return;
    // Com texto na busca, o Esc só limpa a busca; não descarta as marcações.
    if (evento.target === campoBusca.current && busca !== '') {
      evento.preventDefault();
      setBusca('');
      return;
    }
    aoFechar();
  }

  const cheio = marcadas.length >= LIMITE_ACOES_SELECIONADAS;
  const marcadasSet = new Set(marcadas);
  const houveMudanca =
    aSalvar !== null && tickersSalvos !== null && !iguais(aSalvar, tickersSalvos);

  let aviso: string | null = null;
  if (salvas.situacao === 'erro') aviso = 'Não foi possível carregar as ações selecionadas.';
  else if (catalogo.situacao === 'erro') {
    aviso =
      'Não foi possível carregar a lista de ações da B3; por enquanto só as selecionadas aparecem.';
  }

  let lista;
  if (salvas.situacao === 'carregando') {
    lista = <p role="status">Carregando ações…</p>;
  } else if (!tickersSalvos) {
    lista = null;
  } else if (itens.length === 0) {
    lista =
      catalogo.situacao === 'carregando' ? null : <p className="vazio">Nenhuma ação encontrada.</p>;
  } else {
    lista = (
      <ul className="escolha-lista" aria-label="Ações disponíveis">
        {itens.map(({ ticker, nome, foraDoCatalogo }) => {
          const marcada = marcadasSet.has(ticker);
          let descricao = nome;
          if (foraDoCatalogo && acoesDoCatalogo) descricao = 'fora da lista atual da B3';
          else if (foraDoCatalogo && catalogo.situacao === 'erro') descricao = 'nome indisponível';
          return (
            <li key={ticker}>
              <label className="escolha-item">
                <input
                  type="checkbox"
                  checked={marcada}
                  disabled={salvando || (!marcada && cheio)}
                  onChange={() => alternar(ticker)}
                />
                <span className="ticker">{ticker}</span>{' '}
                <span className="escolha-nome">{descricao}</span>
              </label>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      {/* Fundo que bloqueia a grade enquanto o painel está aberto. */}
      <div className="escolha-fundo" aria-hidden="true" />
      <section
        className="escolha"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={aoTeclar}
      >
        <h2 id={idTitulo}>Escolher ações</h2>

        <input
          ref={campoBusca}
          className="escolha-busca"
          type="search"
          placeholder="Buscar por código ou nome"
          aria-label="Buscar ação"
          value={busca}
          readOnly={salvando}
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

        <div className="escolha-rolagem">
          {lista}
          {tickersSalvos && catalogo.situacao === 'carregando' && (
            <p role="status">Carregando a lista de ações da B3…</p>
          )}
        </div>

        {erroAoSalvar && (
          <p role="alert" className="erro">
            {erroAoSalvar}
          </p>
        )}

        <div className="escolha-botoes">
          <button type="button" onClick={aoFechar} disabled={salvando}>
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
    </>
  );
}
