import { useEffect, useId, useRef, useState } from 'react';
import { EscolhaAcoes } from './EscolhaAcoes';

interface PropsMenu {
  /** Chamado depois que uma nova seleção de ações foi salva. */
  aoSalvarSelecao: () => void;
}

/** Menu do canto superior direito: escolher as ações e (na próxima etapa) registrar compras. */
export function MenuPrincipal({ aoSalvarSelecao }: PropsMenu) {
  const [aberto, setAberto] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const idOpcoes = useId();

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

  function abrirEscolha(): void {
    setAberto(false);
    setEscolhendo(true);
  }

  function fecharEscolha(): void {
    setEscolhendo(false);
    botao.current?.focus();
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
            <button type="button" onClick={abrirEscolha}>
              Escolher ações
            </button>
          </li>
          <li>
            <button type="button" disabled>
              Registrar compras <span className="menu-em-breve">(em breve)</span>
            </button>
          </li>
        </ul>
      )}
      {escolhendo && (
        <EscolhaAcoes
          aoFechar={fecharEscolha}
          aoSalvar={() => {
            fecharEscolha();
            aoSalvarSelecao();
          }}
        />
      )}
    </div>
  );
}
