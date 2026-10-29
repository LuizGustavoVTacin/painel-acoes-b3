// @ts-check
/**
 * Abre o dashboard com dois cliques (chamado pelo iniciar.bat): confere o Node, lê o .env,
 * reconhece o dashboard já aberto (só abre o navegador), instala as dependências e compila só
 * quando precisa, sobe o servidor e abre o navegador.
 *
 * Variáveis (do ambiente ou do .env; o ambiente vence): PORT, DB_ARQUIVO e SEM_NAVEGADOR=1.
 * As decisões ficam em regras-iniciar.mjs, onde são testadas.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ARQUIVOS_DO_BUILD,
  VERSAO_MINIMA_NODE,
  classificarPorta,
  comandoNavegador,
  entraNoBuild,
  lerPorta,
  precisaCompilar,
  precisaInstalar,
  versaoNodeServe,
} from './regras-iniciar.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const TRAVA = path.join(RAIZ, '.iniciando.lock');
const ESPERA_SERVIDOR_MS = 30_000;
/** Outra janela pode estar instalando as dependências pela primeira vez (alguns minutos). */
const ESPERA_OUTRA_JANELA_MS = 10 * 60_000;

/** @param {string} arquivo */
const dataDe = (arquivo) => (existsSync(arquivo) ? statSync(arquivo).mtimeMs : null);

/** @param {number} ms */
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * @param {string} mensagem
 * @returns {never}
 */
function falhar(mensagem) {
  console.error(`\n${mensagem}`);
  process.exit(1);
}

function lerEnv() {
  try {
    process.loadEnvFile(path.join(RAIZ, '.env'));
  } catch (erro) {
    if (/** @type {NodeJS.ErrnoException} */ (erro).code !== 'ENOENT') throw erro;
  }
}

function situacaoDaInstalacao() {
  return precisaInstalar({
    instaladoEm: dataDe(path.join(RAIZ, 'node_modules', '.package-lock.json')),
    lockEm: dataDe(path.join(RAIZ, 'package-lock.json')),
  });
}

const dataDaCompilacao = () => dataDe(path.join(RAIZ, 'dist', '.compilado'));

function datasDasFontes() {
  const datas = ARQUIVOS_DO_BUILD.map((arquivo) => dataDe(path.join(RAIZ, arquivo)));
  datas.push(dataDe(path.join(RAIZ, 'src')));
  for (const item of readdirSync(path.join(RAIZ, 'src'), {
    recursive: true,
    withFileTypes: true,
  })) {
    const completo = path.join(item.parentPath, item.name);
    const relativo = path.relative(RAIZ, completo) + (item.isDirectory() ? '/' : '');
    if (entraNoBuild(relativo)) datas.push(statSync(completo).mtimeMs);
  }
  return /** @type {number[]} */ (datas.filter((data) => data !== null));
}

const situacaoDaCompilacao = () =>
  precisaCompilar({ compiladoEm: dataDaCompilacao(), fontesEm: datasDasFontes() });

/**
 * Roda um comando do npm mostrando a saída. Devolve se deu certo.
 * @param {string[]} argumentos
 * @param {string} explicacao
 */
function rodarNpm(argumentos, explicacao) {
  console.log(`\n${explicacao}\n`);
  // No Windows o npm é um .cmd, que o Node só executa pelo shell; os argumentos são fixos,
  // então vão numa linha só (passá-los em lista com shell gera aviso de depreciação).
  const comando = ['npm', ...argumentos].join(' ');
  const { status } = spawnSync(comando, { cwd: RAIZ, stdio: 'inherit', shell: true });
  return status === 0;
}

/** @param {number} porta */
async function consultarPorta(porta) {
  try {
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/saude`, {
      signal: AbortSignal.timeout(2000),
    });
    const corpo = await resposta.json().catch(() => null);
    return classificarPorta({ status: resposta.status, corpo });
  } catch (erro) {
    const { cause, name } = /** @type {{ cause?: { code?: string }, name?: string }} */ (erro);
    return classificarPorta({ erro: cause?.code ?? name ?? 'desconhecido' });
  }
}

/**
 * Consulta de novo quando nada responde a tempo: um dashboard ocupado pode demorar.
 * @param {number} porta
 */
async function consultarPortaComPaciencia(porta) {
  let situacao = await consultarPorta(porta);
  for (let tentativa = 1; situacao === 'sem_resposta' && tentativa < 3; tentativa++) {
    situacao = await consultarPorta(porta);
  }
  return situacao;
}

/**
 * Espera o dashboard responder na porta, até o limite.
 * @param {number} porta
 * @param {number} limiteMs
 */
async function esperarDashboard(porta, limiteMs) {
  const limite = Date.now() + limiteMs;
  while (Date.now() < limite) {
    if ((await consultarPorta(porta)) === 'dashboard') return true;
    await esperar(250);
  }
  return false;
}

/** @param {string} endereco */
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

/** @param {number} pid */
function processoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return /** @type {NodeJS.ErrnoException} */ (erro).code === 'EPERM';
  }
}

/**
 * Trava contra dois cliques seguidos: só uma janela instala, compila e sobe o servidor. Uma
 * trava deixada por uma janela que já fechou é ignorada.
 * @returns {boolean}
 */
function pegarTrava(tentativas = 2) {
  try {
    writeFileSync(TRAVA, String(process.pid), { flag: 'wx' });
    process.on('exit', soltarTrava);
    return true;
  } catch (erro) {
    if (/** @type {NodeJS.ErrnoException} */ (erro).code !== 'EEXIST') throw erro;
    const dono = Number(readFileSync(TRAVA, 'utf8'));
    if (processoVivo(dono) || tentativas <= 1) return false;
    rmSync(TRAVA, { force: true });
    return pegarTrava(tentativas - 1);
  }
}

function soltarTrava() {
  try {
    if (readFileSync(TRAVA, 'utf8') === String(process.pid)) rmSync(TRAVA, { force: true });
  } catch {
    // Já não existe.
  }
}

/**
 * Instala e compila quando precisa. Um build que falha com uma versão anterior pronta segue
 * com ela (ex.: um erro de tipo numa edição em andamento).
 */
function prepararApp() {
  if (situacaoDaInstalacao()) {
    const instalou = rodarNpm(
      ['ci'],
      'Instalando as dependências (só na primeira vez ou após atualizar)…',
    );
    if (!instalou) falhar('Não foi possível instalar as dependências. Veja as mensagens acima.');
  }
  if (situacaoDaCompilacao()) {
    const compilou = rodarNpm(
      ['run', 'build'],
      'Preparando o dashboard (só quando o código muda)…',
    );
    if (!compilou) {
      if (dataDaCompilacao() === null) {
        falhar('Não foi possível preparar o dashboard. Veja as mensagens acima.');
      }
      console.log('\nNão foi possível preparar a versão nova; abrindo a versão anterior.');
    }
  }
}

async function iniciar() {
  if (!versaoNodeServe(process.version)) {
    falhar(
      `O dashboard precisa do Node.js ${VERSAO_MINIMA_NODE} ou mais novo (este é o ${process.version}).\n` +
        'Baixe em https://nodejs.org e abra de novo.',
    );
  }

  process.chdir(RAIZ);
  lerEnv();
  const porta = lerPorta(process.env.PORT);
  const endereco = `http://localhost:${porta}`;

  // Antes de instalar ou compilar: com o dashboard aberto, isso apagaria arquivos em uso.
  const naPorta = await consultarPortaComPaciencia(porta);
  if (naPorta === 'dashboard') {
    console.log(`O dashboard já está aberto em ${endereco}. Abrindo o navegador…`);
    if (situacaoDaInstalacao() || situacaoDaCompilacao()) {
      console.log('Há uma versão nova do código: feche a janela do dashboard e abra de novo.');
    }
    abrirNavegador(endereco);
    return;
  }
  if (naPorta === 'sem_resposta') {
    falhar(`Algo na porta ${porta} não responde. Feche-o ou escolha outra porta (PORT no .env).`);
  }
  if (naPorta === 'outro') {
    falhar(
      `A porta ${porta} está ocupada por outro programa. Feche-o ou escolha outra porta ` +
        '(PORT no arquivo .env).',
    );
  }

  if (!pegarTrava()) {
    console.log('O dashboard já está sendo aberto em outra janela. Aguardando…');
    if (!(await esperarDashboard(porta, ESPERA_OUTRA_JANELA_MS))) {
      falhar('A outra janela não terminou de abrir o dashboard. Veja as mensagens dela.');
    }
    abrirNavegador(endereco);
    return;
  }

  prepararApp();

  // O servidor roda neste mesmo processo: fechar a janela o encerra e fecha o banco.
  const servidor = await import(pathToFileURL(path.join(RAIZ, 'dist/server/index.js')).href);
  if (!(await esperarDashboard(porta, ESPERA_SERVIDOR_MS))) {
    console.error('\nO servidor não respondeu a tempo. Veja as mensagens acima.');
    servidor.encerrar(1);
  }
  soltarTrava();
  abrirNavegador(endereco);
  console.log('\nFeche esta janela para encerrar o dashboard.');
}

await iniciar();
