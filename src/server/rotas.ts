import { Router } from 'express';
import { hojeEmBrasilia } from '../shared/datas.js';
import { calcularPosicao, type Posicao } from '../shared/posicao.js';
import { normalizarTicker, type Ticker } from '../shared/ticker.js';
import { LIMITE_ACOES_SELECIONADAS } from './banco/migracoes.js';
import type { RepositorioSelecao } from './banco/selecao.js';
import type { RepositorioTransacoes } from './banco/transacoes.js';
import { ErroNaoEncontrado, ErroValidacao } from './erros.js';
import { lerId, validarDadosTransacao, validarSelecao } from './validacao.js';

export interface DependenciasRotas {
  transacoes: RepositorioTransacoes;
  selecao: RepositorioSelecao;
  agora: () => Date;
}

export function criarRotasTransacoes({ transacoes, agora }: DependenciasRotas): Router {
  const rotas = Router();
  const naoEncontrada = () => new ErroNaoEncontrado('Transação não encontrada');

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
    const dados = validarDadosTransacao(req.body, hojeEmBrasilia(agora()));
    res.status(201).json({ transacao: transacoes.criar(dados) });
  });

  rotas.put('/:id', (req, res) => {
    const id = lerId(req.params.id);
    const dados = validarDadosTransacao(req.body, hojeEmBrasilia(agora()));
    const transacao = transacoes.atualizar(id, dados);
    if (!transacao) throw naoEncontrada();
    res.json({ transacao });
  });

  rotas.delete('/:id', (req, res) => {
    if (!transacoes.excluir(lerId(req.params.id))) throw naoEncontrada();
    res.status(204).end();
  });

  return rotas;
}

export function criarRotasSelecao({ selecao }: DependenciasRotas): Router {
  const rotas = Router();
  const responder = (res: { json: (corpo: unknown) => void }) =>
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
