import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORTA_PADRAO = 3000;

/** Converte o valor de PORT em porta válida (1–65535); senão usa a porta padrão. */
export function lerPorta(valor: string | undefined): number {
  const texto = valor?.trim() ?? '';
  const porta = /^\d+$/.test(texto) ? Number(texto) : NaN;
  return porta >= 1 && porta <= 65535 ? porta : PORTA_PADRAO;
}

export const ARQUIVO_BANCO_PADRAO = 'dados.db';

/**
 * Caminho do banco SQLite. DB_ARQUIVO pode ser absoluto ou relativo à raiz do projeto
 * (a pasta acima de src/ ou dist/), para não depender da pasta de onde o app foi iniciado.
 */
export function caminhoBanco(valor: string | undefined, urlDoModulo: string): string {
  const raizDoProjeto = fileURLToPath(new URL('../../', urlDoModulo));
  return path.resolve(raizDoProjeto, valor?.trim() || ARQUIVO_BANCO_PADRAO);
}

/**
 * Pasta do frontend compilado, apenas quando o servidor roda a partir de dist/
 * (produção). Em desenvolvimento quem serve o frontend é o Vite.
 */
export function pastaClienteCompilado(urlDoModulo: string): string | undefined {
  // Só o avô do módulo importa (dist/server/index.js); pastas "dist" acima do projeto não contam.
  const pastaAvo = path.dirname(path.dirname(fileURLToPath(urlDoModulo)));
  const emDist = path.basename(pastaAvo) === 'dist';
  return emDist ? fileURLToPath(new URL('../client', urlDoModulo)) : undefined;
}
