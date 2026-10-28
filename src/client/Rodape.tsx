import type { RespostaCotacoes } from '../shared/painel';
import { avisosDoRodape, textoFontesEmUso } from './apresentacao';

/** Fonte das cotações em uso e avisos de APIs indisponíveis, bloqueadas ou alteradas. */
export function Rodape({ dados }: { dados: RespostaCotacoes }) {
  const fontes = textoFontesEmUso(dados);
  const avisos = avisosDoRodape(dados);

  return (
    <footer className="rodape">
      {fontes && <p className="rodape-fontes">{fontes}</p>}
      {avisos.length > 0 && (
        <ul className="rodape-avisos" aria-label="Avisos das fontes de dados">
          {avisos.map((aviso) => (
            <li key={aviso.texto} className={`aviso aviso-${aviso.nivel}`}>
              {aviso.texto}
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
