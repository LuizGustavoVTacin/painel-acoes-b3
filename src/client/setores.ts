/**
 * Nomes em português dos setores que a brapi publica (classificação em inglês).
 * Um setor que não estiver aqui aparece com o nome original.
 */
const NOMES_DOS_SETORES: Readonly<Record<string, string>> = {
  'Commercial Services': 'Serviços comerciais',
  Communications: 'Telecomunicações',
  'Consumer Durables': 'Bens de consumo duráveis',
  'Consumer Non-Durables': 'Bens de consumo não duráveis',
  'Consumer Services': 'Serviços ao consumidor',
  'Distribution Services': 'Distribuição',
  'Electronic Technology': 'Eletrônicos',
  'Energy Minerals': 'Petróleo, gás e carvão',
  Finance: 'Finanças',
  'Health Services': 'Serviços de saúde',
  'Health Technology': 'Farmacêutico e equipamentos médicos',
  'Industrial Services': 'Serviços industriais',
  Miscellaneous: 'Outros',
  'Non-Energy Minerals': 'Mineração e siderurgia',
  'Process Industries': 'Indústria de transformação',
  'Producer Manufacturing': 'Bens industriais',
  'Retail Trade': 'Varejo',
  'Technology Services': 'Tecnologia',
  Transportation: 'Transporte',
  Utilities: 'Energia elétrica e saneamento',
};

export function nomeDoSetor(setor: string): string {
  return Object.hasOwn(NOMES_DOS_SETORES, setor) ? NOMES_DOS_SETORES[setor] : setor;
}
