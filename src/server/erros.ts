/** Erro com status HTTP e mensagem que podem ser mostrados ao usuário. */
export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Mensagem por campo do formulário, quando houver. */
    readonly campos?: Record<string, string>,
  ) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class ErroValidacao extends ErroHttp {
  constructor(mensagem: string, campos?: Record<string, string>) {
    super(400, mensagem, campos);
  }
}

export class ErroNaoEncontrado extends ErroHttp {
  constructor(mensagem = 'Registro não encontrado') {
    super(404, mensagem);
  }
}
