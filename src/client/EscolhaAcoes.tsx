import { useEffect, useMemo, useRef, useState } from 'react';
import { LIMITE_ACOES_SELECIONADAS, type AcaoCatalogo } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';
import { buscarCatalogo, buscarSelecao, ErroApi, salvarSelecao } from './api';
import { alternarAcao, montarListaEscolha, selecaoFinal } from './escolha';
import { Painel } from './Painel';
import { comTempoLimite, TEMPO_LIMITE_PAINEL_MS, useCarga } from './useCarga';

interface PropsEscolha {
  aoFechar: () => void;
  /** Chamado depois que o servidor confirmou a nova seleção. */
  aoSalvar: () => void;
  /** O salvamento expirou: o servidor pode ter gravado mesmo assim, então a grade deve conferir. */
  aoTalvezSalvo?: () => void;
  tempoLimiteMs?: number;
}

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

/**
 * Painel para escolher as ações da grade. As marcações são um rascunho até "Salvar":
 * cada clique não dispara uma busca de cotações.
 */
export function EscolhaAcoes({
  aoFechar,
  aoSalvar,
  aoTalvezSalvo,
  tempoLimiteMs = TEMPO_LIMITE_PAINEL_MS,
}: PropsEscolha) {
  const [salvas, recarregarSalvas] = useCarga(buscarSelecao, tempoLimiteMs);
  const [catalogo, recarregarCatalogo] = useCarga(buscarCatalogoPreenchido, tempoLimiteMs);
  /** Rascunho; null até a primeira marcação (vale a seleção salva). */
  const [rascunho, setRascunho] = useState<Ticker[] | null>(null);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
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
    // O botão some durante a nova carga; o foco não pode cair fora do painel.
    campoBusca.current?.focus();
    recarregarSalvas();
    recarregarCatalogo();
  }

  function alternar(ticker: Ticker): void {
    setRascunho((atual) => alternarAcao(atual ?? tickersSalvos ?? [], ticker));
  }

  async function salvar(): Promise<void> {
    if (!aSalvar) return;
    // O botão Salvar fica desabilitado; o foco vai para a busca para continuar dentro do painel.
    campoBusca.current?.focus();
    setSalvando(true);
    setErroAoSalvar(null);
    const controle = new AbortController();
    try {
      await comTempoLimite((signal) => salvarSelecao(aSalvar, signal), controle, tempoLimiteMs);
      // Mesmo com o painel já fechado, o servidor gravou: a grade precisa ser atualizada.
      aoSalvar();
    } catch (erro) {
      const expirou = controle.signal.aborted;
      if (expirou) aoTalvezSalvo?.();
      if (!montado.current) return;
      let mensagem = 'Não foi possível salvar a seleção; tente de novo';
      if (expirou) {
        mensagem =
          'O servidor demorou para responder; a seleção pode ter sido salva. Confira a grade ou tente de novo';
      } else if (erro instanceof ErroApi) {
        mensagem = erro.message;
      }
      setErroAoSalvar(mensagem);
      setSalvando(false);
    }
  }

  const cheio = marcadas.length >= LIMITE_ACOES_SELECIONADAS;
  const marcadasSet = new Set(marcadas);
  const houveMudanca =
    aSalvar !== null && tickersSalvos !== null && !iguais(aSalvar, tickersSalvos);

  let aviso: string | null = null;
  if (salvas.situacao === 'erro') aviso = 'Não foi possível carregar as ações selecionadas.';
  else if (catalogo.situacao === 'erro') {
    aviso =
      'Não foi possível carregar a lista de ações da B3; por enquanto só as selecionadas aparecem. ' +
      'A lista é baixada da brapi no máximo a cada 15 minutos: se a falha continuar, tente mais tarde.';
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
    <Painel titulo="Escolher ações" aoFechar={aoFechar} focoInicial={campoBusca} travado={salvando}>
      <input
        ref={campoBusca}
        className="escolha-busca"
        type="search"
        placeholder="Buscar por código ou nome"
        aria-label="Buscar ação"
        value={busca}
        readOnly={salvando}
        onChange={(evento) => setBusca(evento.target.value)}
        onKeyDown={(evento) => {
          // Com texto na busca, o Esc só limpa a busca; não descarta as marcações.
          if (evento.key === 'Escape' && busca !== '' && !salvando) {
            evento.preventDefault();
            setBusca('');
          }
        }}
      />

      {tickersSalvos && (
        <p className="escolha-contador" aria-live="polite">
          {marcadas.length} de {LIMITE_ACOES_SELECIONADAS} selecionadas
          {cheio && ' · limite atingido'}
        </p>
      )}

      {aviso && (
        <div role="alert" className="erro painel-aviso">
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

      <div className="painel-botoes">
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
    </Painel>
  );
}
