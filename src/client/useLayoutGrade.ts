import { useEffect, useState, type RefObject } from 'react';
import { contarColunas } from './vizinhos';

/**
 * Colunas que o CSS realmente montou na grade, relidas quando ela muda de tamanho.
 * null enquanto não se sabe (ou sem ResizeObserver e sem layout): aí não há vizinhos.
 */
export function useColunas(grade: RefObject<HTMLElement | null>): number | null {
  const [colunas, setColunas] = useState<number | null>(null);

  useEffect(() => {
    const elemento = grade.current;
    if (!elemento) return;
    const ler = () => setColunas(contarColunas(getComputedStyle(elemento).gridTemplateColumns));
    ler();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(ler);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [grade]);

  return colunas;
}

const CONSULTA_HOVER = '(hover: hover)';

/** Se o aparelho tem um ponteiro que passa por cima (mouse); só aí o destaque segue o mouse. */
export function usePodePassarPorCima(): boolean {
  const [pode, setPode] = useState(
    () => typeof matchMedia === 'function' && matchMedia(CONSULTA_HOVER).matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const consulta = matchMedia(CONSULTA_HOVER);
    const atualizar = () => setPode(consulta.matches);
    atualizar();
    consulta.addEventListener('change', atualizar);
    return () => consulta.removeEventListener('change', atualizar);
  }, []);

  return pode;
}
