import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORTA_PADRAO = 3000;

/** Converte o valor de PORT em porta válida (1–65535); senão usa a porta padrão. */
export function lerPorta(valor: string | undefined): number {
  const texto = valor?.trim() ?? '';
  const porta = /^\d+$/.test(texto) ? Number(texto) : NaN;
  return porta >= 1 && porta <= 65535 ? porta : PORTA_PADRAO;
}

/**
 * Pasta do frontend compilado, apenas quando o servidor roda a partir de dist/
 * (produção). Em desenvolvimento quem serve o frontend é o Vite.
 */
export function pastaClienteCompilado(urlDoModulo: string): string | undefined {
  const arquivo = fileURLToPath(urlDoModulo);
  const emDist = arquivo.split(path.sep).includes('dist');
  return emDist ? fileURLToPath(new URL('../client', urlDoModulo)) : undefined;
}
