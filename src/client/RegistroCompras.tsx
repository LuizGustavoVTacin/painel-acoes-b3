import { useMemo, useRef, useState } from 'react';
import { hojeEmBrasilia } from '../shared/datas';
import { LIMITE_ACOES_SELECIONADAS, simplificar } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';
import type { DadosTransacao, Transacao } from '../shared/transacao';
import {
  atualizarTransacao,
  buscarCatalogo,
  buscarSelecao,
  criarTransacao,
  ErroApi,
  excluirTransacao,
  listarTransacoes,
  salvarSelecao,
} from './api';
import { FormularioCompra } from './FormularioCompra';
import {
  compraEmBranco,
  ordenarCompras,
  resumirPorAcao,
  sugerirPlataformas,
  textoDaCompra,
  type TextoCompra,
} from './regrasCompra';
import { Painel } from './Painel';
import { ResumoCompras, TabelaCompras } from './TabelaCompras';
import { comTempoLimite, TEMPO_LIMITE_PAINEL_MS, useCarga } from './useCarga';

interface PropsRegistro {
  aoFechar: () => void;
  /** Uma ação foi acrescentada à grade (ou pode ter sido): as cotações devem ser buscadas. */
  aoMudarGrade: () => void;
  tempoLimiteMs?: number;
}

/** Situação do aviso "não está na grade", mostrado depois de registrar uma compra. */
type AvisoGrade =
  | { situacao: 'fora'; ticker: Ticker }
  | { situacao: 'adicionando'; ticker: Ticker }
  | { situacao: 'adicionada'; ticker: Ticker }
  | { situacao: 'erro'; ticker: Ticker; mensagem: string };

/** Erro de tempo esgotado ao gravar: o servidor pode ter gravado mesmo assim. */
function erroDeEspera(oQue: string): ErroApi {
  return new ErroApi(
    `O servidor demorou para responder; ${oQue} pode ter sido salva. Confira a lista antes de tentar de novo`,
  );
}

/** Painel para registrar, editar e excluir compras. */
export function RegistroCompras({
  aoFechar,
  aoMudarGrade,
  tempoLimiteMs = TEMPO_LIMITE_PAINEL_MS,
}: PropsRegistro) {
  const [carga, tentarDeNovo, recarregar] = useCarga(listarTransacoes, tempoLimiteMs);
  const [catalogo] = useCarga(buscarCatalogo, tempoLimiteMs);
  const [selecaoCarregada] = useCarga(buscarSelecao, tempoLimiteMs);
  /** Lista alterada neste painel; null enquanto vale a que veio do servidor. */
  const [alteradas, setAlteradas] = useState<Transacao[] | null>(null);
  const [selecaoAtual, setSelecaoAtual] = useState<Ticker[] | null>(null);
  const [editando, setEditando] = useState<Transacao | null>(null);
  /** Texto com que o formulário recomeça; a versão força o recomeço (nova `key`). */
  const [inicial, setInicial] = useState<{ texto: TextoCompra; versao: number }>(() => ({
    texto: compraEmBranco(hojeEmBrasilia()),
    versao: 0,
  }));
  const [filtro, setFiltro] = useState('');
  const [aviso, setAviso] = useState<AvisoGrade | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const campoTicker = useRef<HTMLInputElement>(null);

  const compras = alteradas ?? (carga.situacao === 'ok' ? carga.dados : null);
  const selecao =
    selecaoAtual ?? (selecaoCarregada.situacao === 'ok' ? selecaoCarregada.dados : null);
  const acoesDoCatalogo = catalogo.situacao === 'ok' ? catalogo.dados : [];
  const travado = enviando || excluindo || aviso?.situacao === 'adicionando';

  const filtradas = useMemo(() => {
    const termo = simplificar(filtro.trim());
    return (compras ?? []).filter((compra) => simplificar(compra.ticker).includes(termo));
  }, [compras, filtro]);
  const resumo = useMemo(() => resumirPorAcao(filtradas), [filtradas]);
  const plataformas = useMemo(() => sugerirPlataformas(compras ?? []), [compras]);

  function recomecarFormulario(texto: TextoCompra): void {
    setInicial((atual) => ({ texto, versao: atual.versao + 1 }));
  }

  function editar(compra: Transacao): void {
    setEditando(compra);
    setAviso(null);
    recomecarFormulario(textoDaCompra(compra));
  }

  function cancelarEdicao(): void {
    setEditando(null);
    recomecarFormulario(compraEmBranco(hojeEmBrasilia()));
  }

  /** O servidor demorou: a gravação pode ter acontecido, então a lista é buscada de novo. */
  function conferirLista(): void {
    setAlteradas(null);
    recarregar();
  }

  async function gravar(dados: DadosTransacao): Promise<void> {
    const controle = new AbortController();
    let salva: Transacao;
    try {
      salva = await comTempoLimite(
        (signal) =>
          editando ? atualizarTransacao(editando.id, dados, signal) : criarTransacao(dados, signal),
        controle,
        tempoLimiteMs,
      );
    } catch (erro) {
      if (!controle.signal.aborted) throw erro;
      conferirLista();
      throw erroDeEspera(editando ? 'a alteração' : 'a compra');
    }

    const outras = (compras ?? []).filter((compra) => compra.id !== salva.id);
    setAlteradas(ordenarCompras([...outras, salva]));
    if (editando) {
      setEditando(null);
      recomecarFormulario(compraEmBranco(hojeEmBrasilia()));
      return;
    }
    // Várias compras seguidas costumam ser do mesmo dia e da mesma plataforma.
    recomecarFormulario({
      ...compraEmBranco(hojeEmBrasilia()),
      data: textoDaCompra(dados).data,
      plataforma: dados.plataforma,
    });
    setAviso(
      selecao && !selecao.includes(salva.ticker)
        ? { situacao: 'fora', ticker: salva.ticker }
        : null,
    );
  }

  async function excluir(id: number): Promise<void> {
    const controle = new AbortController();
    try {
      await comTempoLimite((signal) => excluirTransacao(id, signal), controle, tempoLimiteMs);
    } catch (erro) {
      if (!controle.signal.aborted) throw erro;
      conferirLista();
      throw erroDeEspera('a exclusão');
    }
    setAlteradas((compras ?? []).filter((compra) => compra.id !== id));
    if (editando?.id === id) cancelarEdicao();
  }

  async function adicionarAGrade(ticker: Ticker): Promise<void> {
    if (!selecao) return;
    campoTicker.current?.focus();
    setAviso({ situacao: 'adicionando', ticker });
    const controle = new AbortController();
    try {
      const nova = await comTempoLimite(
        (signal) => salvarSelecao([...selecao, ticker], signal),
        controle,
        tempoLimiteMs,
      );
      setSelecaoAtual(nova);
      setAviso({ situacao: 'adicionada', ticker });
      aoMudarGrade();
    } catch (erro) {
      if (controle.signal.aborted) aoMudarGrade();
      setAviso({
        situacao: 'erro',
        ticker,
        mensagem: controle.signal.aborted
          ? 'O servidor demorou para responder; confira a grade antes de tentar de novo'
          : erro instanceof ErroApi
            ? erro.message
            : 'Não foi possível adicionar à grade',
      });
    }
  }

  let lista;
  if (carga.situacao === 'carregando') {
    lista = <p role="status">Carregando compras…</p>;
  } else if (!compras) {
    lista = (
      <div role="alert" className="erro painel-aviso">
        Não foi possível carregar as compras registradas.{' '}
        <button type="button" onClick={tentarDeNovo}>
          Tentar de novo
        </button>
      </div>
    );
  } else if (compras.length === 0) {
    lista = <p className="vazio">Nenhuma compra registrada ainda.</p>;
  } else {
    lista = (
      <>
        <input
          className="escolha-busca"
          type="search"
          placeholder="Filtrar por código"
          aria-label="Filtrar compras por código"
          value={filtro}
          onChange={(evento) => setFiltro(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === 'Escape' && filtro !== '') {
              evento.preventDefault();
              setFiltro('');
            }
          }}
        />
        {filtradas.length === 0 ? (
          <p className="vazio">Nenhuma compra deste código.</p>
        ) : (
          <>
            <ResumoCompras resumo={resumo} />
            <TabelaCompras
              compras={filtradas}
              idEditando={editando?.id ?? null}
              travado={travado}
              aoEditar={editar}
              aoExcluir={excluir}
              aoMudarExclusao={setExcluindo}
              aoPerderFoco={() => campoTicker.current?.focus()}
            />
          </>
        )}
      </>
    );
  }

  return (
    <Painel
      titulo={editando ? 'Editar compra' : 'Registrar compras'}
      aoFechar={aoFechar}
      focoInicial={campoTicker}
      travado={travado}
      largo
    >
      <FormularioCompra
        key={inicial.versao}
        inicial={inicial.texto}
        editando={editando !== null}
        campoTicker={campoTicker}
        sugestoesTicker={acoesDoCatalogo}
        sugestoesPlataforma={plataformas}
        aoEnviar={gravar}
        aoCancelarEdicao={cancelarEdicao}
        aoMudarEnvio={setEnviando}
      />

      {aviso && <AvisoDeGrade aviso={aviso} selecao={selecao} aoAdicionar={adicionarAGrade} />}

      <section className="compras-registradas" aria-label="Compras registradas">
        {lista}
      </section>

      <div className="painel-botoes">
        <button type="button" onClick={aoFechar} disabled={travado}>
          Fechar
        </button>
      </div>
    </Painel>
  );
}

interface PropsAviso {
  aviso: AvisoGrade;
  selecao: readonly Ticker[] | null;
  aoAdicionar: (ticker: Ticker) => Promise<void>;
}

/** Depois de registrar a compra de uma ação que não tem quadrado na grade. */
function AvisoDeGrade({ aviso, selecao, aoAdicionar }: PropsAviso) {
  const { ticker } = aviso;
  if (aviso.situacao === 'adicionada') {
    return (
      <p role="status" className="aviso-grade">
        {ticker} foi adicionada à grade.
      </p>
    );
  }
  const cheia = (selecao?.length ?? 0) >= LIMITE_ACOES_SELECIONADAS;
  return (
    <div role="status" className="aviso-grade">
      <span>
        {ticker} não está na grade.
        {cheia &&
          ` A grade já tem ${LIMITE_ACOES_SELECIONADAS} ações; para incluir ${ticker}, tire alguma em Menu → Escolher ações.`}
      </span>{' '}
      {!cheia && (
        <button
          type="button"
          disabled={aviso.situacao === 'adicionando'}
          onClick={() => void aoAdicionar(ticker)}
        >
          {aviso.situacao === 'adicionando' ? 'Adicionando…' : 'Adicionar à grade'}
        </button>
      )}
      {aviso.situacao === 'erro' && <p className="campo-erro">{aviso.mensagem}</p>}
    </div>
  );
}
