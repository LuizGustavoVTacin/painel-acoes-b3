import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

interface PropsPainel {
  titulo: string;
  aoFechar: () => void;
  /** Elemento que recebe o foco ao abrir e sempre que o foco tentar sair do painel. */
  focoInicial: RefObject<HTMLElement | null>;
  /** Enquanto algo está sendo salvo, o Esc não fecha o painel. */
  travado?: boolean;
  /** Painel mais largo, para tabelas. */
  largo?: boolean;
  children: ReactNode;
}

const FOCAVEIS = 'input:not(:disabled), select:not(:disabled), button:not(:disabled)';

/**
 * Mantém o Tab dentro do painel: do último elemento volta ao primeiro, e vice-versa.
 * Com o foco no próprio painel (clique numa área sem botão), o Tab vai para o primeiro.
 */
function prenderFoco(evento: KeyboardEvent<HTMLElement>): void {
  const focaveis = [...evento.currentTarget.querySelectorAll<HTMLElement>(FOCAVEIS)];
  if (focaveis.length === 0) return;
  const posicao = focaveis.indexOf(document.activeElement as HTMLElement);
  const ultima = focaveis.length - 1;
  if (evento.shiftKey && posicao <= 0) {
    evento.preventDefault();
    focaveis[ultima].focus();
  } else if (!evento.shiftKey && (posicao === -1 || posicao === ultima)) {
    evento.preventDefault();
    focaveis[0].focus();
  }
}

/**
 * Painel lateral sobre o dashboard (a tela toda no celular): fundo que bloqueia a grade,
 * foco preso dentro dele e Esc para fechar. Um filho pode tratar o Esc antes (ex.: limpar
 * uma busca) chamando preventDefault no evento.
 */
export function Painel({
  titulo,
  aoFechar,
  focoInicial,
  travado = false,
  largo = false,
  children,
}: PropsPainel) {
  const painel = useRef<HTMLElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    focoInicial.current?.focus();
    // O foco que escapa do painel (ex.: Tab vindo da barra do navegador) volta para dentro.
    function aoFocar(evento: FocusEvent): void {
      if (!painel.current?.contains(evento.target as Node)) focoInicial.current?.focus();
    }
    document.addEventListener('focusin', aoFocar);
    return () => document.removeEventListener('focusin', aoFocar);
  }, [focoInicial]);

  function aoTeclar(evento: KeyboardEvent<HTMLElement>): void {
    if (evento.key === 'Tab') prenderFoco(evento);
    else if (evento.key === 'Escape' && !travado && !evento.defaultPrevented) aoFechar();
  }

  return (
    <>
      <div
        className="painel-fundo"
        aria-hidden="true"
        onMouseDown={(evento) => evento.preventDefault()}
      />
      <section
        ref={painel}
        tabIndex={-1}
        className={largo ? 'painel painel-largo' : 'painel'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={aoTeclar}
      >
        <h2 id={idTitulo}>{titulo}</h2>
        {children}
      </section>
    </>
  );
}
