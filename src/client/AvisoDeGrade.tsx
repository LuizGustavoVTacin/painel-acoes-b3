import { LIMITE_ACOES_SELECIONADAS } from '../shared/selecao';
import type { Ticker } from '../shared/ticker';

/** Situação do aviso "não está na grade", mostrado depois de registrar uma compra. */
export type AvisoGrade =
  | { situacao: 'fora'; ticker: Ticker }
  /** O código não está na lista da B3 (provável erro de digitação): não é oferecido à grade. */
  | { situacao: 'desconhecida'; ticker: Ticker }
  | { situacao: 'adicionando'; ticker: Ticker }
  | { situacao: 'adicionada'; ticker: Ticker }
  | { situacao: 'erro'; ticker: Ticker; mensagem: string };

interface PropsAviso {
  aviso: AvisoGrade;
  selecao: readonly Ticker[] | null;
  aoAdicionar: (ticker: Ticker) => Promise<void>;
}

/** Depois de registrar a compra de uma ação que não tem quadrado na grade. */
export function AvisoDeGrade({ aviso, selecao, aoAdicionar }: PropsAviso) {
  const { ticker } = aviso;
  if (aviso.situacao === 'desconhecida') {
    return (
      <p role="status" className="aviso-grade">
        {ticker} foi registrada, mas não está na lista de ações da B3. Confira o código: se estiver
        errado, edite a compra abaixo.
      </p>
    );
  }
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
