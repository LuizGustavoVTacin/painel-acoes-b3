import { useEffect, useId, useRef, useState } from 'react';
import { EscolhaAcoes } from './EscolhaAcoes';
import { RegistroCompras } from './RegistroCompras';

interface PropsMenu {
  /** Chamado depois que a seleção de ações da grade mudou (ou pode ter mudado). */
  aoSalvarSelecao: () => void;
}

/** Menu do canto superior direito: escolher as ações da grade e registrar compras. */
export function MenuPrincipal({ aoSalvarSelecao }: PropsMenu) {
  const [aberto, setAberto] = useState(false);
  /** Painel aberto pelo menu, se houver. */
  const [painel, setPainel] = useState<'escolha' | 'compras' | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const idOpcoes = useId();
  /** O foco volta ao botão só depois que o painel sai da tela (ele prende o foco enquanto existe). */
  const devolverFoco = useRef(false);

  useEffect(() => {
    if (painel || !devolverFoco.current) return;
    devolverFoco.current = false;
    botao.current?.focus();
  }, [painel]);

  // Clique fora do menu fecha a lista de opções.
  useEffect(() => {
    if (!aberto) return;
    function aoApertar(evento: PointerEvent): void {
      if (!raiz.current?.contains(evento.target as Node)) setAberto(false);
    }
    document.addEventListener('pointerdown', aoApertar);
    return () => document.removeEventListener('pointerdown', aoApertar);
  }, [aberto]);

  function fecharOpcoes(): void {
    setAberto(false);
    botao.current?.focus();
  }

  function abrir(qual: 'escolha' | 'compras'): void {
    setAberto(false);
    setPainel(qual);
  }

  function fecharPainel(): void {
    devolverFoco.current = true;
    setPainel(null);
  }

  return (
    <div
      className="menu"
      ref={raiz}
      onKeyDown={(evento) => {
        if (evento.key === 'Escape' && aberto) fecharOpcoes();
      }}
    >
      <button
        ref={botao}
        type="button"
        className="menu-botao"
        aria-expanded={aberto}
        aria-controls={idOpcoes}
        onClick={() => setAberto((valor) => !valor)}
      >
        <span aria-hidden="true">☰</span> Menu
      </button>
      {aberto && (
        <ul id={idOpcoes} className="menu-opcoes">
          <li>
            <button type="button" onClick={() => abrir('escolha')}>
              Escolher ações
            </button>
          </li>
          <li>
            <button type="button" onClick={() => abrir('compras')}>
              Registrar compras
            </button>
          </li>
        </ul>
      )}
      {painel === 'escolha' && (
        <EscolhaAcoes
          aoFechar={fecharPainel}
          aoSalvar={() => {
            fecharPainel();
            aoSalvarSelecao();
          }}
          aoTalvezSalvo={aoSalvarSelecao}
        />
      )}
      {painel === 'compras' && (
        <RegistroCompras aoFechar={fecharPainel} aoMudarGrade={aoSalvarSelecao} />
      )}
    </div>
  );
}
