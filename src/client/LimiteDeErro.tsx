import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/** Última proteção: um erro inesperado ao desenhar a tela vira uma mensagem, não uma página em branco. */
export class LimiteDeErro extends Component<Props, { falhou: boolean }> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(erro: unknown) {
    console.error('Erro ao mostrar o painel:', erro);
  }

  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <div className="app">
        <p role="alert" className="erro">
          Algo deu errado ao mostrar o painel. Recarregue a página; seus dados continuam salvos.
        </p>
      </div>
    );
  }
}
