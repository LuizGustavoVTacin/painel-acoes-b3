import { formatarHorario } from '../shared/datas';
import { textoMercado, ultimaAtualizacao } from './apresentacao';
import { GradeAcoes } from './GradeAcoes';
import { MenuPrincipal } from './MenuPrincipal';
import { Rodape } from './Rodape';
import { useCotacoes } from './useCotacoes';

interface PropsApp {
  /** Tempo máximo de espera pela resposta de /api/cotacoes. */
  tempoLimiteMs?: number;
}

export function App({ tempoLimiteMs }: PropsApp) {
  const { dados, erro, carregando, recebimentos, recarregar } = useCotacoes(tempoLimiteMs);
  const atualizadoEm = dados && ultimaAtualizacao(dados.cotacoes);

  let conteudo = null;
  if (dados && dados.cotacoes.length === 0) {
    conteudo = (
      <p className="vazio">
        Nenhuma ação selecionada. Abra o menu no canto superior direito e escolha as ações.
      </p>
    );
  } else if (dados) {
    conteudo = <GradeAcoes cotacoes={dados.cotacoes} rodada={recebimentos} />;
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
        <MenuPrincipal aoSalvarSelecao={recarregar} />
      </header>
      {erro && (
        <p role="alert" className="erro">
          {erro}.{dados ? ' Mostrando os últimos dados recebidos.' : ' Nova tentativa em 1 minuto.'}
        </p>
      )}
      <main className="principal">{conteudo}</main>
      {dados && <Rodape dados={dados} />}
    </div>
  );
}
