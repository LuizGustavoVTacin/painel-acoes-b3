import { useEffect, useId, useState, type FormEvent, type RefObject } from 'react';
import { hojeEmBrasilia } from '../shared/datas';
import { formatarBRL } from '../shared/dinheiro';
import type { AcaoCatalogo } from '../shared/selecao';
import { normalizarTicker } from '../shared/ticker';
import type { CampoTransacao, DadosTransacao, ErrosDeCampo } from '../shared/transacao';
import { ErroApi } from './api';
import { lerCompra, totalDigitado, type TextoCompra } from './regrasCompra';

interface PropsFormulario {
  /** Texto com que o formulário começa; para recomeçar, o painel troca a `key`. */
  inicial: TextoCompra;
  /** Editando uma compra já salva (muda os botões). */
  editando: boolean;
  /** Primeiro campo; recebe o foco ao abrir e ao recomeçar o formulário. */
  campoTicker: RefObject<HTMLInputElement | null>;
  sugestoesTicker: readonly AcaoCatalogo[];
  /** Códigos da lista da B3, para avisar de um provável erro de digitação; null se indisponível. */
  codigosConhecidos: ReadonlySet<string> | null;
  sugestoesPlataforma: readonly string[];
  /** Grava a compra; um ErroApi com campos marca cada campo recusado pelo servidor. */
  aoEnviar: (dados: DadosTransacao) => Promise<void>;
  aoCancelarEdicao: () => void;
  aoMudarEnvio: (enviando: boolean) => void;
}

const ORDEM_DOS_CAMPOS: CampoTransacao[] = [
  'ticker',
  'data',
  'quantidade',
  'precoUnitario',
  'taxas',
  'plataforma',
];

interface PropsCampo {
  nome: CampoTransacao;
  rotulo: string;
  valor: string;
  erro?: string;
  /** Observação que não impede o envio (ex.: código fora da lista da B3). */
  nota?: string;
  idBase: string;
  aoMudar: (valor: string) => void;
  travado: boolean;
  dica?: string;
  modoTeclado?: 'numeric' | 'decimal';
  lista?: string;
  campoRef?: RefObject<HTMLInputElement | null>;
}

function Campo({
  nome,
  rotulo,
  valor,
  erro,
  nota,
  idBase,
  aoMudar,
  travado,
  dica,
  modoTeclado,
  lista,
  campoRef,
}: PropsCampo) {
  const id = `${idBase}-${nome}`;
  const descricoes = [erro && `${id}-erro`, nota && `${id}-nota`].filter(Boolean).join(' ');
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input
        ref={campoRef}
        id={id}
        name={nome}
        value={valor}
        placeholder={dica}
        inputMode={modoTeclado}
        list={lista}
        autoComplete="off"
        readOnly={travado}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricoes || undefined}
        onChange={(evento) => aoMudar(evento.target.value)}
      />
      {erro && (
        <p id={`${id}-erro`} className="campo-erro">
          {erro}
        </p>
      )}
      {nota && (
        <p id={`${id}-nota`} className="campo-nota">
          {nota}
        </p>
      )}
    </div>
  );
}

/** Formulário para registrar uma compra nova ou editar uma já salva. */
export function FormularioCompra({
  inicial,
  editando,
  campoTicker,
  sugestoesTicker,
  codigosConhecidos,
  sugestoesPlataforma,
  aoEnviar,
  aoCancelarEdicao,
  aoMudarEnvio,
}: PropsFormulario) {
  const [texto, setTexto] = useState(inicial);
  const [erros, setErros] = useState<ErrosDeCampo>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const idBase = useId();

  useEffect(() => {
    campoTicker.current?.focus();
  }, [campoTicker]);

  function mudar(campo: CampoTransacao, valor: string): void {
    setTexto((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Leva o foco ao primeiro campo com erro, para quem usa teclado ou leitor de tela. */
  function focarPrimeiroErro(campos: ErrosDeCampo): void {
    const primeiro = ORDEM_DOS_CAMPOS.find((campo) => campos[campo]);
    if (primeiro) document.getElementById(`${idBase}-${primeiro}`)?.focus();
  }

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    if (enviando) return;
    const lida = lerCompra(texto, hojeEmBrasilia());
    if (!lida.valida) {
      setErros(lida.campos);
      setMensagem('Verifique os campos destacados');
      focarPrimeiroErro(lida.campos);
      return;
    }
    setErros({});
    setMensagem(null);
    // O botão fica desabilitado; o foco vai para o primeiro campo para não sair do painel.
    campoTicker.current?.focus();
    setEnviando(true);
    aoMudarEnvio(true);
    try {
      await aoEnviar(lida.dados);
      // Deu certo: o painel recomeça o formulário (nova `key`), então não há o que limpar aqui.
    } catch (erro) {
      const campos = erro instanceof ErroApi ? erro.campos : {};
      setErros(campos);
      setMensagem(erro instanceof ErroApi ? erro.message : 'Não foi possível salvar a compra');
      focarPrimeiroErro(campos);
    } finally {
      setEnviando(false);
      aoMudarEnvio(false);
    }
  }

  const total = totalDigitado(texto);
  const codigo = normalizarTicker(texto.ticker);
  const codigoDesconhecido = codigo !== null && codigosConhecidos?.has(codigo) === false;
  const idTickers = `${idBase}-tickers`;
  const idPlataformas = `${idBase}-plataformas`;
  const comum = { idBase, travado: enviando };

  return (
    <form
      className="formulario-compra"
      aria-label={editando ? 'Editar compra' : 'Nova compra'}
      noValidate
      onSubmit={(evento) => void enviar(evento)}
    >
      <div className="campos">
        <Campo
          {...comum}
          nome="ticker"
          rotulo="Código"
          dica="BBAS3"
          valor={texto.ticker}
          erro={erros.ticker}
          nota={
            codigoDesconhecido && !erros.ticker
              ? 'Este código não está na lista de ações da B3; confira antes de registrar'
              : undefined
          }
          lista={idTickers}
          campoRef={campoTicker}
          aoMudar={(valor) => mudar('ticker', valor.toUpperCase())}
        />
        <Campo
          {...comum}
          nome="data"
          rotulo="Data"
          dica="dd/mm/aaaa"
          valor={texto.data}
          erro={erros.data}
          modoTeclado="numeric"
          aoMudar={(valor) => mudar('data', valor)}
        />
        <Campo
          {...comum}
          nome="quantidade"
          rotulo="Quantidade"
          dica="100"
          valor={texto.quantidade}
          erro={erros.quantidade}
          modoTeclado="numeric"
          aoMudar={(valor) => mudar('quantidade', valor)}
        />
        <Campo
          {...comum}
          nome="precoUnitario"
          rotulo="Preço unitário (R$)"
          dica="17,38"
          valor={texto.precoUnitario}
          erro={erros.precoUnitario}
          modoTeclado="decimal"
          aoMudar={(valor) => mudar('precoUnitario', valor)}
        />
        <Campo
          {...comum}
          nome="taxas"
          rotulo="Taxas (R$)"
          dica="0,00"
          valor={texto.taxas}
          erro={erros.taxas}
          modoTeclado="decimal"
          aoMudar={(valor) => mudar('taxas', valor)}
        />
        <Campo
          {...comum}
          nome="plataforma"
          rotulo="Plataforma"
          dica="Itaú Íon"
          valor={texto.plataforma}
          erro={erros.plataforma}
          lista={idPlataformas}
          aoMudar={(valor) => mudar('plataforma', valor)}
        />
      </div>

      <datalist id={idTickers}>
        {sugestoesTicker.map(({ ticker, nome }) => (
          <option key={ticker} value={ticker}>
            {nome}
          </option>
        ))}
      </datalist>
      <datalist id={idPlataformas}>
        {sugestoesPlataforma.map((plataforma) => (
          <option key={plataforma} value={plataforma} />
        ))}
      </datalist>

      <p className="formulario-total">
        Total da compra: <strong>{total === null ? '—' : formatarBRL(total)}</strong>
      </p>

      {mensagem && (
        <p role="alert" className="erro">
          {mensagem}
        </p>
      )}

      <div className="painel-botoes">
        {editando && (
          <button type="button" onClick={aoCancelarEdicao} disabled={enviando}>
            Cancelar edição
          </button>
        )}
        <button type="submit" className="botao-principal" disabled={enviando}>
          {enviando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Registrar compra'}
        </button>
      </div>
    </form>
  );
}
