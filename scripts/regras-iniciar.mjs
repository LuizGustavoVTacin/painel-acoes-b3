// @ts-check
/**
 * Decisões do iniciador (iniciar.mjs) como funções puras, para serem testadas sem instalar,
 * compilar ou subir nada.
 */

export const VERSAO_MINIMA_NODE = 24;
export const PORTA_PADRAO = 3000;

/** Arquivos fora de src/ que também mudam o resultado do build. */
export const ARQUIVOS_DO_BUILD = [
  'index.html',
  'vite.config.ts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.server.json',
  'tsconfig.server.build.json',
];

/**
 * A mesma regra de PORT do servidor (src/server/config.ts): o iniciador precisa saber a porta
 * antes de compilar. O teste confere que as duas dão o mesmo resultado.
 * @param {string | undefined} valor
 */
export function lerPorta(valor) {
  const texto = valor?.trim() ?? '';
  const porta = /^\d+$/.test(texto) ? Number(texto) : NaN;
  return porta >= 1 && porta <= 65535 ? porta : PORTA_PADRAO;
}

/**
 * A versão do Node (ex.: "v24.3.0") serve para o app?
 * @param {string} versao
 */
export function versaoNodeServe(versao) {
  const principal = Number(/^v?(\d+)\./.exec(versao)?.[1]);
  return principal >= VERSAO_MINIMA_NODE;
}

/**
 * Precisa rodar `npm ci`? Sim se não há node_modules ou se o package-lock.json mudou depois da
 * última instalação (o npm grava node_modules/.package-lock.json ao instalar).
 * @param {{ instaladoEm: number | null, lockEm: number | null }} datas
 */
export function precisaInstalar({ instaladoEm, lockEm }) {
  return instaladoEm === null || (lockEm !== null && lockEm > instaladoEm);
}

/**
 * Arquivo ou pasta de src/ que entra no build (testes e simulações não entram). Pastas terminam
 * em "/": a data delas muda quando um arquivo é apagado, o que também pede um build novo.
 * @param {string} caminhoRelativo
 */
export function entraNoBuild(caminhoRelativo) {
  const caminho = caminhoRelativo.replaceAll('\\', '/');
  return (
    !/\.test\.[cm]?[jt]sx?$/.test(caminho) &&
    !caminho.includes('/testes/') &&
    !caminho.startsWith('src/ponta-a-ponta/')
  );
}

/**
 * Precisa compilar? Sim se não há compilação completa (o marcador dist/.compilado só é gravado
 * no fim do build) ou se alguma fonte é mais nova que ela.
 * @param {{ compiladoEm: number | null, fontesEm: number[] }} datas
 */
export function precisaCompilar({ compiladoEm, fontesEm }) {
  return compiladoEm === null || fontesEm.some((data) => data > compiladoEm);
}

/**
 * O que há na porta, pela tentativa de ler /api/saude: o próprio dashboard, nada (porta livre),
 * algo que não responde a tempo, ou outro programa.
 * @param {{ erro: string } | { status: number, corpo: unknown }} resultado
 * @returns {'dashboard' | 'livre' | 'sem_resposta' | 'outro'}
 */
export function classificarPorta(resultado) {
  if ('erro' in resultado) {
    if (resultado.erro === 'ECONNREFUSED') return 'livre';
    return resultado.erro === 'TimeoutError' ? 'sem_resposta' : 'outro';
  }
  const { status, corpo } = resultado;
  const ehDashboard =
    status === 200 &&
    corpo !== null &&
    typeof corpo === 'object' &&
    /** @type {{ status?: unknown }} */ (corpo).status === 'ok';
  return ehDashboard ? 'dashboard' : 'outro';
}

/**
 * Comando que abre o endereço no navegador padrão.
 * @param {string} endereco
 * @param {string} plataforma
 */
export function comandoNavegador(endereco, plataforma) {
  if (plataforma === 'win32') {
    // `start` é comando interno do cmd; o "" é o título da janela, exigido antes do endereço.
    return { programa: 'cmd.exe', argumentos: ['/c', 'start', '""', endereco], literal: true };
  }
  const programa = plataforma === 'darwin' ? 'open' : 'xdg-open';
  return { programa, argumentos: [endereco], literal: false };
}
