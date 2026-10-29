import { describe, expect, it } from 'vitest';
import { lerPorta as lerPortaDoServidor } from '../src/server/config.ts';
import {
  classificarPorta,
  comandoNavegador,
  entraNoBuild,
  lerPorta,
  precisaCompilar,
  IDADE_MAXIMA_TRAVA_MS,
  precisaInstalar,
  travaAbandonada,
  variaveisDoEnv,
  versaoNodeServe,
} from './regras-iniciar.mjs';

describe('lerPorta', () => {
  it.each([undefined, '', ' 3005 ', '3001', '0', '65535', '65536', '-1', '30a', '3.5', 'abc'])(
    'lê %j como o servidor',
    (valor) => {
      expect(lerPorta(valor)).toBe(lerPortaDoServidor(valor));
    },
  );
});

describe('versaoNodeServe', () => {
  it.each([
    ['v24.0.0', true],
    ['v24.11.1', true],
    ['v26.1.0', true],
    ['v22.12.0', false],
    ['v8.0.0', false],
    ['', false],
    ['lixo', false],
  ])('%s → %s', (versao, serve) => {
    expect(versaoNodeServe(versao)).toBe(serve);
  });
});

describe('precisaInstalar', () => {
  it('sem node_modules instala', () => {
    expect(precisaInstalar({ instaladoEm: null, lockEm: 100 })).toBe(true);
  });

  it('package-lock.json mais novo que a instalação instala de novo', () => {
    expect(precisaInstalar({ instaladoEm: 100, lockEm: 200 })).toBe(true);
  });

  it('instalação em dia não instala', () => {
    expect(precisaInstalar({ instaladoEm: 200, lockEm: 100 })).toBe(false);
    expect(precisaInstalar({ instaladoEm: 200, lockEm: 200 })).toBe(false);
  });
});

describe('entraNoBuild', () => {
  it.each([
    ['src/client/App.tsx', true],
    ['src\\server\\app.ts', true],
    ['src/client/estilo.css', true],
    ['src/client/App.test.tsx', false],
    ['src/server/app.test.ts', false],
    ['src/server/testes/fetchFalso.ts', false],
    ['src\\server\\testes\\yahooFalso.ts', false],
    ['src/ponta-a-ponta/fluxo.test.tsx', false],
    ['src/client/', true],
    ['src/server/testes/', false],
    ['src/ponta-a-ponta/', false],
  ])('%s → %s', (caminho, entra) => {
    expect(entraNoBuild(caminho)).toBe(entra);
  });
});

describe('precisaCompilar', () => {
  it('sem compilação completa (sem o marcador) compila', () => {
    expect(precisaCompilar({ compiladoEm: null, saidasProntas: true, fontesEm: [1, 2] })).toBe(
      true,
    );
  });

  it('uma fonte mais nova que a compilação compila', () => {
    expect(precisaCompilar({ compiladoEm: 100, saidasProntas: true, fontesEm: [50, 150] })).toBe(
      true,
    );
  });

  it('marcador presente mas faltando arquivo de saída (dist apagado à mão) compila', () => {
    expect(precisaCompilar({ compiladoEm: 100, saidasProntas: false, fontesEm: [50] })).toBe(true);
  });

  it('tudo mais velho que a compilação: abre direto', () => {
    expect(precisaCompilar({ compiladoEm: 100, saidasProntas: true, fontesEm: [50, 100] })).toBe(
      false,
    );
  });
});

describe('classificarPorta', () => {
  it('conexão recusada: porta livre', () => {
    expect(classificarPorta({ erro: 'ECONNREFUSED' })).toBe('livre');
  });

  it('o próprio dashboard responde', () => {
    expect(
      classificarPorta({ status: 200, corpo: { status: 'ok', horario: '2026-10-28T12:00:00Z' } }),
    ).toBe('dashboard');
  });

  it('nada responde a tempo: sem resposta (pode ser o dashboard ocupado)', () => {
    expect(classificarPorta({ erro: 'TimeoutError' })).toBe('sem_resposta');
  });

  it('resposta que começou mas não terminou a tempo: sem resposta', () => {
    expect(classificarPorta({ semResposta: true })).toBe('sem_resposta');
  });

  it.each([
    ['outro erro de rede', { erro: 'ECONNRESET' }],
    ['página que não é o dashboard', { status: 404, corpo: null }],
    ['JSON de outro programa', { status: 200, corpo: { nome: 'outro' } }],
    ['texto em vez de JSON', { status: 200, corpo: null }],
  ])('%s: outro programa', (_caso, resultado) => {
    expect(classificarPorta(resultado)).toBe('outro');
  });
});

describe('comandoNavegador', () => {
  it('no Windows usa o start do cmd, com título vazio antes do endereço', () => {
    expect(comandoNavegador('http://localhost:3000', 'win32')).toEqual({
      programa: 'cmd.exe',
      argumentos: ['/c', 'start', '""', 'http://localhost:3000'],
      literal: true,
    });
  });

  it('no macOS usa open e no Linux xdg-open', () => {
    expect(comandoNavegador('http://localhost:3000', 'darwin').programa).toBe('open');
    expect(comandoNavegador('http://localhost:3000', 'linux').programa).toBe('xdg-open');
  });
});

describe('variaveisDoEnv', () => {
  it('lê o .env e o ambiente vence', () => {
    expect(variaveisDoEnv('PORT=3005\nDB_ARQUIVO=outro.db\n', { PORT: '3001' })).toEqual({
      DB_ARQUIVO: 'outro.db',
    });
  });

  it('ignora o BOM do início (Bloco de Notas, PowerShell 5.1)', () => {
    expect(variaveisDoEnv('\uFEFFPORT=3005\r\n', {})).toEqual({ PORT: '3005' });
  });

  it('comentários, aspas e valor vazio como no dotenv', () => {
    const texto = '# porta\nPORT=3005 # comentário\nDB_ARQUIVO="C:/a#1/d.db"\nSEM_NAVEGADOR=\n';
    expect(variaveisDoEnv(texto, {})).toEqual({
      PORT: '3005',
      DB_ARQUIVO: 'C:/a#1/d.db',
      SEM_NAVEGADOR: '',
    });
  });
});

describe('travaAbandonada', () => {
  const vivo = () => true;
  const morto = () => false;

  it('de uma janela aberta: vale', () => {
    expect(travaAbandonada({ conteudo: '1234', idadeMs: 1000, pidVivo: vivo })).toBe(false);
  });

  it('de uma janela que fechou: abandonada', () => {
    expect(travaAbandonada({ conteudo: '1234', idadeMs: 1000, pidVivo: morto })).toBe(true);
  });

  it('velha demais: abandonada mesmo com o PID em uso (reaproveitado)', () => {
    expect(
      travaAbandonada({ conteudo: '1234', idadeMs: IDADE_MAXIMA_TRAVA_MS + 1, pidVivo: vivo }),
    ).toBe(true);
  });

  it.each(['', '  ', 'lixo', '0'])('conteúdo %j recente: sendo gravada, vale', (conteudo) => {
    expect(travaAbandonada({ conteudo, idadeMs: 10, pidVivo: morto })).toBe(false);
  });
});
