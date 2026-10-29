/**
 * Abre o dashboard com dois cliques (chamado pelo iniciar.bat): confere o Node, instala as
 * dependências e compila só quando precisa, sobe o servidor e abre o navegador. Se o dashboard
 * já estiver aberto, só abre o navegador.
 *
 * Variáveis: PORT e DB_ARQUIVO (as mesmas do servidor) e SEM_NAVEGADOR=1 (não abre o navegador).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSAO_MINIMA_NODE = 24;

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

/** A versão do Node (ex.: "v24.3.0") serve para o app? */
export function versaoNodeServe(versao) {
  const principal = Number(/^v?(\d+)\./.exec(versao)?.[1]);
  return principal >= VERSAO_MINIMA_NODE;
}

/**
 * Precisa rodar `npm ci`? Sim se não há node_modules ou se o package-lock.json mudou depois da
 * última instalação (o npm grava node_modules/.package-lock.json ao instalar).
 */
export function precisaInstalar({ instaladoEm, lockEm }) {
  return instaladoEm === null || (lockEm !== null && lockEm > instaladoEm);
}

/** Arquivo de src/ que entra no build (testes e simulações não entram). */
export function entraNoBuild(caminhoRelativo) {
  const caminho = caminhoRelativo.replaceAll('\\', '/');
  return (
    !/\.test\.[cm]?[jt]sx?$/.test(caminho) &&
    !caminho.includes('/testes/') &&
    !caminho.startsWith('src/ponta-a-ponta/')
  );
}

/** Precisa compilar? Sim se não há compilação ou se alguma fonte é mais nova que ela. */
export function precisaCompilar({ compiladoEm, fontesEm }) {
  return compiladoEm === null || fontesEm.some((data) => data > compiladoEm);
}

/**
 * O que há na porta, pela resposta de /api/saude: o próprio dashboard, nada (porta livre) ou
 * outro programa.
 */
export function classificarPorta(resultado) {
  if ('erro' in resultado) return resultado.erro === 'ECONNREFUSED' ? 'livre' : 'outro';
  const { status, corpo } = resultado;
  const ehDashboard =
    status === 200 && corpo !== null && typeof corpo === 'object' && corpo.status === 'ok';
  return ehDashboard ? 'dashboard' : 'outro';
}

/** Comando que abre o endereço no navegador padrão. */
export function comandoNavegador(endereco, plataforma) {
  if (plataforma === 'win32') {
    // `start` é comando interno do cmd; o "" é o título da janela, exigido antes do endereço.
    return { programa: 'cmd.exe', argumentos: ['/c', 'start', '""', endereco], literal: true };
  }
  const programa = plataforma === 'darwin' ? 'open' : 'xdg-open';
  return { programa, argumentos: [endereco], literal: false };
}

// ---------------------------------------------------------------------------------------------

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ESPERA_SERVIDOR_MS = 30_000;

const dataDe = (arquivo) => (existsSync(arquivo) ? statSync(arquivo).mtimeMs : null);

function datasDasFontes() {
  const datas = ARQUIVOS_DO_BUILD.map((arquivo) => dataDe(path.join(RAIZ, arquivo)));
  for (const item of readdirSync(path.join(RAIZ, 'src'), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!item.isFile()) continue;
    const completo = path.join(item.parentPath, item.name);
    if (entraNoBuild(path.relative(RAIZ, completo))) datas.push(statSync(completo).mtimeMs);
  }
  return datas.filter((data) => data !== null);
}

function dataDaCompilacao() {
  const datas = ['dist/client/index.html', 'dist/server/index.js'].map((arquivo) =>
    dataDe(path.join(RAIZ, arquivo)),
  );
  return datas.includes(null) ? null : Math.min(...datas);
}

/** Roda um comando do npm mostrando a saída; encerra com aviso se falhar. */
function rodarNpm(argumentos, explicacao) {
  console.log(`\n${explicacao}\n`);
  // No Windows o npm é um .cmd, que o Node só executa pelo shell; os argumentos são fixos,
  // então vão numa linha só (passá-los em lista com shell gera aviso de depreciação).
  const comando = ['npm', ...argumentos].join(' ');
  const { status } = spawnSync(comando, { cwd: RAIZ, stdio: 'inherit', shell: true });
  if (status !== 0) {
    console.error(`\nNão deu certo (npm ${argumentos.join(' ')}). Veja as mensagens acima.`);
    process.exit(1);
  }
}

async function consultarPorta(porta) {
  try {
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/saude`, {
      signal: AbortSignal.timeout(2000),
    });
    const corpo = await resposta.json().catch(() => null);
    return classificarPorta({ status: resposta.status, corpo });
  } catch (erro) {
    return classificarPorta({ erro: erro?.cause?.code ?? erro?.name ?? 'desconhecido' });
  }
}

function abrirNavegador(endereco) {
  if (process.env.SEM_NAVEGADOR === '1') return;
  const { programa, argumentos, literal } = comandoNavegador(endereco, process.platform);
  const filho = spawn(programa, argumentos, {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: literal,
  });
  filho.on('error', () => console.log(`Abra no navegador: ${endereco}`));
  filho.unref();
}

async function esperarServidor(porta) {
  const limite = Date.now() + ESPERA_SERVIDOR_MS;
  while (Date.now() < limite) {
    if ((await consultarPorta(porta)) === 'dashboard') return true;
    await new Promise((resolver) => setTimeout(resolver, 250));
  }
  return false;
}

async function iniciar() {
  if (!versaoNodeServe(process.version)) {
    console.error(
      `O dashboard precisa do Node.js ${VERSAO_MINIMA_NODE} ou mais novo (este é o ${process.version}).\n` +
        'Baixe em https://nodejs.org e abra de novo.',
    );
    process.exit(1);
  }

  const instalacao = {
    instaladoEm: dataDe(path.join(RAIZ, 'node_modules', '.package-lock.json')),
    lockEm: dataDe(path.join(RAIZ, 'package-lock.json')),
  };
  if (precisaInstalar(instalacao)) {
    rodarNpm(['ci'], 'Instalando as dependências (só na primeira vez ou após atualizar)…');
  }
  if (precisaCompilar({ compiladoEm: dataDaCompilacao(), fontesEm: datasDasFontes() })) {
    rodarNpm(['run', 'build'], 'Preparando o dashboard (só quando o código muda)…');
  }

  // A mesma leitura de PORT que o servidor usa (já compilada em dist/).
  const { lerPorta } = await import(pathToFileURL(path.join(RAIZ, 'dist/server/config.js')).href);
  const porta = lerPorta(process.env.PORT);
  const endereco = `http://localhost:${porta}`;

  const naPorta = await consultarPorta(porta);
  if (naPorta === 'dashboard') {
    console.log(`O dashboard já está aberto em ${endereco}. Abrindo o navegador…`);
    abrirNavegador(endereco);
    return;
  }
  if (naPorta === 'outro') {
    console.error(
      `A porta ${porta} está ocupada por outro programa. Feche-o ou escolha outra porta ` +
        '(PORT no arquivo .env).',
    );
    process.exit(1);
  }

  // O servidor roda neste mesmo processo: fechar a janela o encerra e fecha o banco.
  process.chdir(RAIZ);
  await import(pathToFileURL(path.join(RAIZ, 'dist/server/index.js')).href);
  if (!(await esperarServidor(porta))) {
    console.error('O servidor não respondeu a tempo. Veja as mensagens acima.');
    process.exit(1);
  }
  abrirNavegador(endereco);
  console.log('\nFeche esta janela para encerrar o dashboard.');
}

const chamadoDireto =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (chamadoDireto) await iniciar();
