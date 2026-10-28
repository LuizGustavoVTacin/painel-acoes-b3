import { Router, type Response } from 'express';
import { hojeEmBrasilia } from '../shared/datas.js';
import { calcularPosicao, type Posicao } from '../shared/posicao.js';
import { normalizarTicker, type Ticker } from '../shared/ticker.js';
import { LIMITE_ACOES_SELECIONADAS } from './banco/migracoes.js';
import type { RepositorioSelecao } from './banco/selecao.js';
import type { RepositorioTransacoes } from './banco/transacoes.js';
import type { ServicoCatalogo } from './catalogo.js';
import type { EstadoFontes } from './externo/estadoFontes.js';
import { ErroNaoEncontrado, ErroValidacao } from './erros.js';
import { lerId, validarDadosTransacao, validarSelecao } from './validacao.js';

export interface DependenciasRotas {
  transacoes: RepositorioTransacoes;
  selecao: RepositorioSelecao;
  catalogo: ServicoCatalogo;
  estado: EstadoFontes;
  agora: () => Date;
}

/** Ações disponíveis para seleção, com nome e endereço local do logo. */
export function criarRotasCatalogo({ catalogo }: DependenciasRotas): Router {
  const rotas = Router();

  rotas.get('/', async (req, res) => {
    const { busca = '' } = req.query;
    if (typeof busca !== 'string') throw new ErroValidacao('Busca inválida');
    await catalogo.garantirAtualizado();
    const acoes = catalogo
      .listar(busca)
      .map((acao) => ({ ...acao, logo: `/api/logos/${acao.ticker}` }));
    res.json({ acoes });
  });

  return rotas;
}

// SVG pode conter scripts: a política abaixo impede que rodem mesmo se o arquivo for aberto direto.
const POLITICA_LOGO = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function criarRotasLogos({ catalogo }: DependenciasRotas): Router {
  const rotas = Router();

  rotas.get('/:ticker', async (req, res) => {
    const ticker = normalizarTicker(req.params.ticker);
    const logo = ticker ? await catalogo.logo(ticker) : null;
    if (!logo) throw new ErroNaoEncontrado('Logo não encontrado');
    res
      .set({
        'Content-Type': logo.tipo,
        'Content-Security-Policy': POLITICA_LOGO,
        'X-Content-Type-Options': 'nosniff',
        // O navegador guarda o logo por um dia e não volta a pedir.
        'Cache-Control': 'public, max-age=86400',
      })
      .send(Buffer.from(logo.conteudo));
  });

  return rotas;
}

/** Situação de cada API externa, para o rodapé e os alertas da tela. */
export function criarRotasFontes({ estado }: DependenciasRotas): Router {
  const rotas = Router();
  rotas.get('/', (_req, res) => {
    res.json({ fontes: estado.listar() });
  });
  return rotas;
}

export function criarRotasTransacoes({ transacoes, agora }: DependenciasRotas): Router {
  const rotas = Router();
  const validar = (corpo: unknown) => validarDadosTransacao(corpo, hojeEmBrasilia(agora()));
  const naoEncontrada = () => new ErroNaoEncontrado('Transação não encontrada');
  const idDaRota = (texto: string) => {
    const id = lerId(texto);
    if (id === null) throw naoEncontrada();
    return id;
  };

  rotas.get('/', (req, res) => {
    const { ticker } = req.query;
    if (ticker === undefined) {
      res.json({ transacoes: transacoes.listar() });
      return;
    }
    const normalizado = typeof ticker === 'string' ? normalizarTicker(ticker) : null;
    if (!normalizado) throw new ErroValidacao('Filtro de ticker inválido');
    res.json({ transacoes: transacoes.listar(normalizado) });
  });

  rotas.post('/', (req, res) => {
    const dados = validar(req.body);
    res.status(201).json({ transacao: transacoes.criar(dados) });
  });

  rotas.put('/:id', (req, res) => {
    const transacao = transacoes.atualizar(idDaRota(req.params.id), validar(req.body));
    if (!transacao) throw naoEncontrada();
    res.json({ transacao });
  });

  rotas.delete('/:id', (req, res) => {
    if (!transacoes.excluir(idDaRota(req.params.id))) throw naoEncontrada();
    res.status(204).end();
  });

  return rotas;
}

export function criarRotasSelecao({ selecao }: DependenciasRotas): Router {
  const rotas = Router();
  const responder = (res: Response) =>
    res.json({ tickers: selecao.listar(), limite: LIMITE_ACOES_SELECIONADAS });

  rotas.get('/', (_req, res) => responder(res));

  rotas.put('/', (req, res) => {
    selecao.substituir(validarSelecao(req.body));
    responder(res);
  });

  return rotas;
}

export function criarRotasPosicoes({ transacoes }: DependenciasRotas): Router {
  const rotas = Router();

  rotas.get('/', (_req, res) => {
    const posicoes: Record<Ticker, Posicao> = {};
    const erros: Record<Ticker, string> = {};
    for (const [ticker, compras] of transacoes.comprasPorTicker()) {
      // Uma ação com dados problemáticos não pode derrubar as posições das outras.
      try {
        const posicao = calcularPosicao(compras);
        if (posicao) posicoes[ticker] = posicao;
      } catch (erro) {
        console.error(`Não foi possível calcular a posição de ${ticker}:`, erro);
        erros[ticker] = 'Não foi possível calcular a posição desta ação';
      }
    }
    res.json({ posicoes, erros });
  });

  return rotas;
}
