import type { ModoEscolha, OpcaoSetor } from './escolha';

interface PropsFiltros {
  setores: readonly OpcaoSetor[];
  /** Total de ações do catálogo; null enquanto ele não carregou (o filtro de setor fica parado). */
  totalDoCatalogo: number | null;
  /** Setor escolhido; '' = todos. */
  setor: string;
  aoMudarSetor: (setor: string) => void;
  modo: ModoEscolha;
  aoMudarModo: (modo: ModoEscolha) => void;
  /** Complemento de "Em alta": "hoje", "no pregão de 30/10/2026" ou "na última lista". */
  quando: string;
  /** Situação das compras, que liberam a opção "Que comprei". */
  compras: 'carregando' | 'ok' | 'erro';
  desabilitado: boolean;
}

const TEXTO_COMPRADAS = {
  ok: 'Que comprei',
  carregando: 'Que comprei (carregando…)',
  erro: 'Que comprei (indisponível)',
};

/** Filtros da lista do menu de escolha: setor e o que mostrar. */
export function FiltrosDaLista({
  setores,
  totalDoCatalogo,
  setor,
  aoMudarSetor,
  modo,
  aoMudarModo,
  quando,
  compras,
  desabilitado,
}: PropsFiltros) {
  return (
    <div className="escolha-filtros">
      <label>
        Setor
        <select
          value={setor}
          disabled={desabilitado || totalDoCatalogo === null}
          onChange={(evento) => aoMudarSetor(evento.target.value)}
        >
          <option value="">Todos{totalDoCatalogo !== null && ` (${totalDoCatalogo})`}</option>
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
          disabled={desabilitado}
          onChange={(evento) => aoMudarModo(evento.target.value as ModoEscolha)}
        >
          <option value="todas">Todas</option>
          <option value="alta">Em alta {quando}</option>
          <option value="baixa">Em baixa {quando}</option>
          <option value="compradas" disabled={compras !== 'ok'}>
            {TEXTO_COMPRADAS[compras]}
          </option>
        </select>
      </label>
    </div>
  );
}
