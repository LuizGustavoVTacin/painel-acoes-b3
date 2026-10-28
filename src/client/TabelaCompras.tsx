import { useState } from 'react';
import { formatarData } from '../shared/datas';
import { formatarBRL } from '../shared/dinheiro';
import { totalDaCompra, type Transacao } from '../shared/transacao';
import { ErroApi } from './api';
import type { ResumoAcao } from './regrasCompra';

const quantidade = (n: number) => n.toLocaleString('pt-BR');

interface PropsTabela {
  compras: readonly Transacao[];
  /** Compra carregada no formulário agora (a linha fica destacada). */
  idEditando: number | null;
  /** Algo está sendo salvo no painel: editar e excluir esperam. */
  travado: boolean;
  aoEditar: (compra: Transacao) => void;
  aoExcluir: (id: number) => Promise<void>;
  aoMudarExclusao: (excluindo: boolean) => void;
  /** Recebe o foco quando a linha excluída some, para o foco não sair do painel. */
  aoPerderFoco: () => void;
}

/** Lista de compras; em telas estreitas cada linha vira um cartão (rótulos via data-rotulo). */
export function TabelaCompras({
  compras,
  idEditando,
  travado,
  aoEditar,
  aoExcluir,
  aoMudarExclusao,
  aoPerderFoco,
}: PropsTabela) {
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [excluindo, setExcluindo] = useState<number | null>(null);
  const [erro, setErro] = useState<{ id: number; mensagem: string } | null>(null);

  /** Desiste da exclusão; o foco vai para o formulário (os botões da pergunta somem). */
  function desistir(): void {
    setConfirmando(null);
    aoPerderFoco();
  }

  async function excluir(id: number): Promise<void> {
    aoPerderFoco();
    setExcluindo(id);
    setErro(null);
    aoMudarExclusao(true);
    try {
      await aoExcluir(id);
      setConfirmando(null);
    } catch (falha) {
      setErro({
        id,
        mensagem: falha instanceof ErroApi ? falha.message : 'Não foi possível excluir a compra',
      });
    } finally {
      setExcluindo(null);
      aoMudarExclusao(false);
    }
  }

  return (
    <div className="tabela-rolagem">
      <table className="tabela-compras" role="table">
        <caption className="apenas-leitor">Compras registradas</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              Data
            </th>
            <th scope="col" role="columnheader">
              Código
            </th>
            <th scope="col" role="columnheader">
              Quantidade
            </th>
            <th scope="col" role="columnheader">
              Preço unitário
            </th>
            <th scope="col" role="columnheader">
              Taxas
            </th>
            <th scope="col" role="columnheader">
              Total
            </th>
            <th scope="col" role="columnheader">
              Plataforma
            </th>
            <th scope="col" role="columnheader">
              <span className="apenas-leitor">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {compras.map((compra) => {
            const { id } = compra;
            const descricao = `${compra.ticker} de ${formatarData(compra.data)}`;
            return (
              <tr role="row" key={id} className={id === idEditando ? 'compra-editando' : undefined}>
                <td role="cell" data-rotulo="Data">
                  {formatarData(compra.data)}
                </td>
                <td role="cell" data-rotulo="Código" className="ticker">
                  {compra.ticker}
                </td>
                <td role="cell" data-rotulo="Quantidade">
                  {quantidade(compra.quantidade)}
                </td>
                <td role="cell" data-rotulo="Preço unitário">
                  {formatarBRL(compra.precoUnitario)}
                </td>
                <td role="cell" data-rotulo="Taxas">
                  {formatarBRL(compra.taxas)}
                </td>
                <td role="cell" data-rotulo="Total">
                  {formatarBRL(totalDaCompra(compra))}
                </td>
                <td role="cell" data-rotulo="Plataforma">
                  {compra.plataforma}
                </td>
                <td role="cell" className="compra-acoes">
                  {confirmando === id ? (
                    <span
                      role="group"
                      aria-label={`Confirmar exclusão da compra de ${descricao}`}
                      onKeyDown={(evento) => {
                        // Esc desiste só da exclusão; não fecha o painel.
                        if (evento.key === 'Escape' && excluindo === null) {
                          evento.preventDefault();
                          desistir();
                        }
                      }}
                    >
                      <span>Excluir esta compra?</span>{' '}
                      <button
                        type="button"
                        className="botao-perigo"
                        disabled={excluindo !== null}
                        onClick={() => void excluir(id)}
                      >
                        {excluindo === id ? 'Excluindo…' : 'Sim, excluir'}
                      </button>{' '}
                      <button
                        type="button"
                        // O botão "Excluir" sumiu; o foco vai para a opção segura.
                        autoFocus
                        disabled={excluindo !== null}
                        onClick={desistir}
                      >
                        Não
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={`Editar a compra de ${descricao}`}
                        disabled={travado}
                        onClick={() => aoEditar(compra)}
                      >
                        Editar
                      </button>{' '}
                      <button
                        type="button"
                        aria-label={`Excluir a compra de ${descricao}`}
                        disabled={travado}
                        onClick={() => setConfirmando(id)}
                      >
                        Excluir
                      </button>
                    </>
                  )}
                  {erro?.id === id && (
                    <p role="alert" className="campo-erro">
                      {erro.mensagem}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Quantidade total e preço médio de cada ação comprada. */
export function ResumoCompras({ resumo }: { resumo: readonly ResumoAcao[] }) {
  return (
    <div className="tabela-rolagem">
      <table className="tabela-compras tabela-resumo" role="table">
        <caption>Resumo por ação</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              Código
            </th>
            <th scope="col" role="columnheader">
              Quantidade
            </th>
            <th scope="col" role="columnheader">
              Preço médio
            </th>
            <th scope="col" role="columnheader">
              Total investido
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {resumo.map(({ ticker, quantidadeTotal, precoMedio, custoTotal }) => (
            <tr role="row" key={ticker}>
              <td role="cell" data-rotulo="Código" className="ticker">
                {ticker}
              </td>
              <td role="cell" data-rotulo="Quantidade">
                {quantidade(quantidadeTotal)}
              </td>
              <td role="cell" data-rotulo="Preço médio">
                {formatarBRL(precoMedio)}
              </td>
              <td role="cell" data-rotulo="Total investido">
                {formatarBRL(custoTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
