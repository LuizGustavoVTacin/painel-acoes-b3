import { useEffect } from 'react';
import { formatarHorario } from '../shared/datas';
import { buscarPosicoes } from './api';
import { textoMercado, ultimaAtualizacao } from './apresentacao';
import { GradeAcoes } from './GradeAcoes';
import { MenuPrincipal } from './MenuPrincipal';
import { Rodape } from './Rodape';
import { TEMPO_LIMITE_PAINEL_MS, useCarga } from './useCarga';
import { useCotacoes } from './useCotacoes';

interface PropsApp {
  /** Tempo máximo de espera pela resposta de /api/cotacoes. */
  tempoLimiteMs?: number;
}

export function App({ tempoLimiteMs }: PropsApp) {
  const { dados, erro, carregando, recebimentos, recarregar } = useCotacoes(tempoLimiteMs);
  const [posicoes, , recarregarPosicoes] = useCarga(buscarPosicoes, TEMPO_LIMITE_PAINEL_MS);
  const atualizadoEm = dados && ultimaAtualizacao(dados.cotacoes);
  // A cada nova rodada de cotações as posições também são relidas (é só o banco local): assim
  // uma falha se recupera sozinha e compras feitas em outra aba aparecem.
  useEffect(() => {
    if (recebimentos > 1) recarregarPosicoes();
  }, [recebimentos, recarregarPosicoes]);
  const semPosicoes =
    posicoes.situacao === 'erro' || (posicoes.situacao === 'ok' && posicoes.desatualizada);

  let conteudo = null;
  if (dados && dados.cotacoes.length === 0) {
    conteudo = (
      <p className="vazio">
        Nenhuma ação selecionada. Abra o menu no canto superior direito e escolha as ações.
      </p>
    );
  } else if (dados) {
    conteudo = (
      <GradeAcoes
        cotacoes={dados.cotacoes}
        rodada={recebimentos}
        posicoes={posicoes.situacao === 'ok' ? posicoes.dados : undefined}
      />
    );
  } else if (carregando) {
    conteudo = <p role="status">Carregando cotações…</p>;
  }

  return (
    <div className="app">
      <header className="cabecalho">
        <h1>Dashboard B3</h1>
        {dados && (
          <p className="situacao">
            <span>{textoMercado(dados.mercadoAberto)}</span>
            {atualizadoEm && <span>Atualizado em {formatarHorario(atualizadoEm)}</span>}
          </p>
        )}
        <MenuPrincipal aoSalvarSelecao={recarregar} aoMudarCompras={recarregarPosicoes} />
      </header>
      {erro && (
        <p role="alert" className="erro">
          {erro}.{dados ? ' Mostrando os últimos dados recebidos.' : ' Nova tentativa em 1 minuto.'}
        </p>
      )}
      {semPosicoes && (
        <p role="status" className="aviso-compras">
          Não foi possível ler suas compras;{' '}
          {posicoes.situacao === 'ok'
            ? 'as setas de ganho e perda podem estar desatualizadas.'
            : 'as setas de ganho e perda não aparecem.'}{' '}
          Nova tentativa na próxima atualização.
        </p>
      )}
      <main className="principal">{conteudo}</main>
      {dados && <Rodape dados={dados} />}
    </div>
  );
}
