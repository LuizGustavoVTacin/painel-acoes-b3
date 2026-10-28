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
import { AvisoDeGrade, type AvisoGrade } from './AvisoDeGrade';
import { FormularioCompra } from './FormularioCompra';
import {
  compraEmBranco,
  resumirPorAcao,
  sugerirPlataformas,
  textoDaCompra,
  type TextoCompra,
} from './regrasCompra';
import { Painel } from './Painel';
import { ResumoCompras, TabelaCompras } from './TabelaCompras';
import { comTempoLimite, ErroTempoEsgotado, TEMPO_LIMITE_PAINEL_MS, useCarga } from './useCarga';

interface PropsRegistro {
  aoFechar: () => void;
  /** Uma ação foi acrescentada à grade (ou pode ter sido): as cotações devem ser buscadas. */
  aoMudarGrade: () => void;
  tempoLimiteMs?: number;
}

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
  const [selecaoAtual, setSelecaoAtual] = useState<Ticker[] | null>(null);
  const [editando, setEditando] = useState<Transacao | null>(null);
  /** Texto com que o formulário recomeça; a versão força o recomeço (nova `key`). */
  const [inicial, setInicial] = useState<{ texto: TextoCompra; versao: number }>(() => ({
    texto: compraEmBranco(hojeEmBrasilia()),
    versao: 0,
  }));
  const [filtro, setFiltro] = useState('');
  const [aviso, setAviso] = useState<AvisoGrade | null>(null);
  /** Recado sobre a lista (ex.: a compra editada já não existia). */
  const [recado, setRecado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const campoTicker = useRef<HTMLInputElement>(null);

  // A lista vem sempre do servidor: depois de cada gravação ela é buscada de novo.
  const compras = carga.situacao === 'ok' ? carga.dados : null;
  const selecao =
    selecaoAtual ?? (selecaoCarregada.situacao === 'ok' ? selecaoCarregada.dados : null);
  const acoesDoCatalogo = useMemo(
    () => (catalogo.situacao === 'ok' ? catalogo.dados : []),
    [catalogo],
  );
  /** Códigos da lista da B3; null se o catálogo não carregou (aí não há como conferir). */
  const codigosConhecidos = useMemo(
    () => (acoesDoCatalogo.length > 0 ? new Set(acoesDoCatalogo.map((acao) => acao.ticker)) : null),
    [acoesDoCatalogo],
  );
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
    setRecado(null);
    recomecarFormulario(textoDaCompra(compra));
  }

  function cancelarEdicao(): void {
    setEditando(null);
    recomecarFormulario(compraEmBranco(hojeEmBrasilia()));
  }

  async function gravar(dados: DadosTransacao): Promise<void> {
    let salva: Transacao;
    try {
      salva = await comTempoLimite(
        (signal) =>
          editando ? atualizarTransacao(editando.id, dados, signal) : criarTransacao(dados, signal),
        tempoLimiteMs,
      );
    } catch (erro) {
      if (editando && erro instanceof ErroApi && erro.status === 404) {
        // Excluída em outra aba (ou antes): sai da edição e mostra a lista como está.
        recarregar();
        cancelarEdicao();
        setRecado('A compra que você editava não existe mais; a lista foi atualizada.');
        return;
      }
      if (!(erro instanceof ErroTempoEsgotado)) throw erro;
      // O servidor demorou: a gravação pode ter acontecido, então a lista é buscada de novo.
      recarregar();
      throw erroDeEspera(editando ? 'a alteração' : 'a compra');
    }

    recarregar();
    setRecado(null);
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
    if (codigosConhecidos && !codigosConhecidos.has(salva.ticker)) {
      setAviso({ situacao: 'desconhecida', ticker: salva.ticker });
    } else if (selecao && !selecao.includes(salva.ticker)) {
      setAviso({ situacao: 'fora', ticker: salva.ticker });
    } else {
      setAviso(null);
    }
  }

  async function excluir(id: number): Promise<void> {
    try {
      await comTempoLimite((signal) => excluirTransacao(id, signal), tempoLimiteMs);
    } catch (erro) {
      // 404: já tinha sido excluída (outra aba); o resultado é o que o usuário queria.
      const jaExcluida = erro instanceof ErroApi && erro.status === 404;
      if (!jaExcluida) {
        if (!(erro instanceof ErroTempoEsgotado)) throw erro;
        recarregar();
        throw erroDeEspera('a exclusão');
      }
    }
    recarregar();
    if (editando?.id === id) cancelarEdicao();
  }

  async function adicionarAGrade(ticker: Ticker): Promise<void> {
    campoTicker.current?.focus();
    setAviso({ situacao: 'adicionando', ticker });
    try {
      // A seleção é lida de novo na hora: o menu (ou outra aba) pode tê-la mudado.
      const nova = await comTempoLimite(async (signal) => {
        const atual = await buscarSelecao(signal);
        if (atual.includes(ticker)) return atual;
        if (atual.length >= LIMITE_ACOES_SELECIONADAS) {
          throw new ErroApi(
            `A grade já tem ${LIMITE_ACOES_SELECIONADAS} ações; tire alguma em Menu → Escolher ações.`,
          );
        }
        return salvarSelecao([...atual, ticker], signal);
      }, tempoLimiteMs);
      setSelecaoAtual(nova);
      setAviso({ situacao: 'adicionada', ticker });
      aoMudarGrade();
    } catch (erro) {
      const expirou = erro instanceof ErroTempoEsgotado;
      if (expirou) aoMudarGrade();
      setAviso({
        situacao: 'erro',
        ticker,
        mensagem: expirou
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
        <button type="button" onClick={tentarDeNovo} disabled={travado}>
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
        codigosConhecidos={codigosConhecidos}
        sugestoesPlataforma={plataformas}
        aoEnviar={gravar}
        aoCancelarEdicao={cancelarEdicao}
        aoMudarEnvio={setEnviando}
      />

      {aviso && <AvisoDeGrade aviso={aviso} selecao={selecao} aoAdicionar={adicionarAGrade} />}

      <section className="compras-registradas" aria-label="Compras registradas">
        {recado && (
          <p role="status" className="aviso-grade">
            {recado}
          </p>
        )}
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
