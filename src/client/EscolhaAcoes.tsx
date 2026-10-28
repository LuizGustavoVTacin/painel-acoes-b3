import { useEffect, useMemo, useRef, useState } from 'react';
import { formatarHorario } from '../shared/datas';
import { formatarPercentual } from '../shared/posicao';
import { LIMITE_ACOES_SELECIONADAS } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';
import {
  buscarCatalogo,
  buscarSelecao,
  ErroApi,
  listarTransacoes,
  salvarSelecao,
  type Catalogo,
} from './api';
import {
  alternarAcao,
  contarSetores,
  montarListaEscolha,
  selecaoFinal,
  type ModoEscolha,
} from './escolha';
import { Painel } from './Painel';
import { comTempoLimite, ErroTempoEsgotado, TEMPO_LIMITE_PAINEL_MS, useCarga } from './useCarga';

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
async function buscarCatalogoPreenchido(signal: AbortSignal): Promise<Catalogo> {
  const catalogo = await buscarCatalogo(signal);
  if (catalogo.acoes.length === 0) throw new ErroApi('Catálogo vazio');
  return catalogo;
}

/** Variação do dia com seta e sinal: "▲ +2,35%", "▼ -1,10%", "0,00%". */
function VariacaoDoDia({ centesimos }: { centesimos: number }) {
  const direcao = centesimos > 0 ? 'alta' : centesimos < 0 ? 'baixa' : 'neutra';
  const seta = { alta: '▲ ', baixa: '▼ ', neutra: '' }[direcao];
  return (
    <span className={`escolha-variacao variacao-${direcao}`}>
      <span aria-hidden="true">{seta}</span>
      {formatarPercentual(centesimos)}
    </span>
  );
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
  const [compras, recarregarCompras] = useCarga(listarTransacoes, tempoLimiteMs);
  /** Rascunho; null até a primeira marcação (vale a seleção salva). */
  const [rascunho, setRascunho] = useState<Ticker[] | null>(null);
  const [busca, setBusca] = useState('');
  /** Setor escolhido no filtro; '' = todos. */
  const [setor, setSetor] = useState('');
  const [modo, setModo] = useState<ModoEscolha>('todas');
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
  const acoesDoCatalogo = catalogo.situacao === 'ok' ? catalogo.dados.acoes : null;
  const listaDe = catalogo.situacao === 'ok' ? catalogo.dados.atualizadoEm : null;
  const compradas = useMemo(
    () => (compras.situacao === 'ok' ? new Set(compras.dados.map(({ ticker }) => ticker)) : null),
    [compras],
  );
  const setores = useMemo(() => contarSetores(acoesDoCatalogo ?? []), [acoesDoCatalogo]);
  const marcadas = rascunho ?? tickersSalvos ?? [];
  // Enquanto o catálogo não chega, as salvas já aparecem (só com o código).
  const itens = useMemo(
    () =>
      tickersSalvos
        ? montarListaEscolha(acoesDoCatalogo ?? [], tickersSalvos, {
            busca,
            setor: setor || null,
            modo,
            compradas: compradas ?? undefined,
          })
        : [],
    [acoesDoCatalogo, tickersSalvos, busca, setor, modo, compradas],
  );
  const aSalvar = tickersSalvos && selecaoFinal(tickersSalvos, marcadas);

  function tentarDeNovo(): void {
    // O botão some durante a nova carga; o foco não pode cair fora do painel.
    campoBusca.current?.focus();
    recarregarSalvas();
    recarregarCatalogo();
    recarregarCompras();
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
    try {
      await comTempoLimite((signal) => salvarSelecao(aSalvar, signal), tempoLimiteMs);
      // Mesmo com o painel já fechado, o servidor gravou: a grade precisa ser atualizada.
      aoSalvar();
    } catch (erro) {
      const expirou = erro instanceof ErroTempoEsgotado;
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
  } else if (compras.situacao === 'erro') {
    aviso = 'Não foi possível carregar suas compras; o filtro “Que comprei” fica indisponível.';
  }

  let lista;
  if (salvas.situacao === 'carregando') {
    lista = <p role="status">Carregando ações…</p>;
  } else if (!tickersSalvos) {
    lista = null;
  } else if (itens.length === 0) {
    lista =
      catalogo.situacao === 'carregando' ? null : (
        <p className="vazio">Nenhuma ação encontrada com estes filtros.</p>
      );
  } else {
    lista = (
      <ul className="escolha-lista" aria-label="Ações disponíveis">
        {itens.map(({ ticker, nome, variacaoDoDia, foraDoCatalogo }) => {
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
                {variacaoDoDia !== null && (
                  <>
                    {' '}
                    <VariacaoDoDia centesimos={variacaoDoDia} />
                  </>
                )}
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

      <div className="escolha-filtros">
        <label>
          Setor
          <select
            value={setor}
            disabled={salvando || !acoesDoCatalogo}
            onChange={(evento) => setSetor(evento.target.value)}
          >
            <option value="">Todos{acoesDoCatalogo && ` (${acoesDoCatalogo.length})`}</option>
            {setores.map((opcao) => (
              <option key={opcao.setor} value={opcao.setor}>
                {opcao.nome} ({opcao.quantidade})
              </option>
            ))}
          </select>
        </label>
        <label>
          Mostrar
          <select
            value={modo}
            disabled={salvando}
            onChange={(evento) => setModo(evento.target.value as ModoEscolha)}
          >
            <option value="todas">Todas</option>
            <option value="alta">Em alta hoje</option>
            <option value="baixa">Em baixa hoje</option>
            <option value="compradas" disabled={!compradas}>
              Que comprei
            </option>
          </select>
        </label>
      </div>

      {tickersSalvos && (
        <p className="escolha-nota">
          Mostrando {itens.length} {itens.length === 1 ? 'ação' : 'ações'}.
          {listaDe && ` Variação do dia segundo a brapi (lista de ${formatarHorario(listaDe)}).`}
        </p>
      )}

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
