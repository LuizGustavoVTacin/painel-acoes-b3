# Dashboard B3

Painel pessoal para acompanhar ações da B3 e o desempenho das suas compras. Roda só neste
computador (Windows), sem hospedagem, sem login e sem nenhuma API paga.

- Grade de quadrados com logo, código (ex.: BBAS3) e preço atual de cada ação escolhida.
- Atualiza sozinho a cada 5 minutos com o mercado aberto; fechado, mostra o último fechamento.
- Seta verde ou vermelha com o ganho ou a perda sobre o seu preço médio.
- Menu no canto superior direito: escolher as ações (até 50) e registrar, editar ou excluir
  compras.

A documentação completa, com regras de negócio e detalhes técnicos, está em
[`docs/index.html`](docs/index.html). Abra o arquivo no navegador.

## O que você precisa

- **Node.js 24 ou mais novo**: baixe em <https://nodejs.org> (versão LTS).
- Nada mais. O banco SQLite já vem dentro do Node, e nenhuma fonte de cotação pede chave ou
  cadastro.

## Abrir o dashboard

Dê dois cliques em **`iniciar.bat`**, na pasta do projeto.

1. Na primeira vez ele instala as dependências e prepara o app. Isso leva alguns minutos e
   precisa de internet.
2. Depois sobe o servidor e abre <http://localhost:3000> no navegador.
3. Uma janela preta fica aberta enquanto o dashboard roda. **Feche essa janela para encerrar.**

Nas próximas vezes abre em poucos segundos. Ele só prepara o app de novo quando o código muda.
Se o dashboard já estiver aberto, os dois cliques só abrem o navegador de novo.

### Atalho na área de trabalho

Clique com o botão direito em `iniciar.bat` → **Mostrar mais opções** → **Enviar para** →
**Área de trabalho (criar atalho)**. Use o atalho, não uma cópia do arquivo, porque o
`iniciar.bat` precisa ficar na pasta do projeto.

## Usar

1. **Escolher ações:** Menu → **Escolher ações**. Busque pelo código ou nome, filtre por setor
   e marque as ações. Clique em **Salvar**.
2. **Registrar compras:** Menu → **Registrar compras**. Informe o código, a data (dd/mm/aaaa),
   a quantidade, o preço unitário, as taxas e a plataforma (ex.: Itaú Íon, BTG). Na mesma tela
   você edita ou exclui uma compra.
3. **Ler a grade:** passe o mouse sobre um quadrado para destacá-lo, junto com os vizinhos. A
   seta mostra a diferença para o seu preço médio; passe o mouse sobre ela para ver o preço
   médio e a quantidade.
4. **Rodapé:** mostra qual fonte de cotação está em uso e avisa se alguma está fora do ar.

O preço médio é calculado assim:

```
preço médio = (soma de quantidade × preço unitário + soma das taxas) ÷ quantidade total
```

## Seus dados

- Tudo fica no arquivo **`dados.db`**, na pasta do projeto: as ações escolhidas, as compras e
  as últimas cotações.
- **Cópia de segurança:** feche o dashboard e copie o `dados.db` para outro lugar, como um pen
  drive ou a nuvem. Para restaurar, feche o dashboard e coloque a cópia de volta com o mesmo
  nome.
- Quando uma atualização muda a estrutura do banco, o app guarda antes uma cópia automática
  (`dados.db.bak-v…`) na mesma pasta.
- O `dados.db` nunca vai para o git.

## Problemas comuns

| O que aparece                                                     | O que fazer                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| "O Node.js não foi encontrado" ou "precisa do Node.js 24"         | Instale o Node.js 24 ou mais novo em <https://nodejs.org> e abra de novo.                                                                   |
| "A porta 3000 está ocupada por outro programa"                    | Feche o outro programa, ou copie `.env.example` para `.env` e mude `PORT` (ex.: `PORT=3005`).                                               |
| Preço com o selo "desatualizado"                                  | A fonte de cotação não respondeu. O último preço conhecido continua na tela e o app tenta de novo sozinho.                                  |
| Rodapé avisa que uma fonte está "bloqueada" ou "mudou de formato" | A fonte passou a pedir pagamento ou mudou. O app para de chamá-la por 24 h e segue com os dados salvos. Nenhuma chave ou pagamento é usado. |
| "Não foi possível ler suas compras"                               | A grade continua com os preços. Clique em **Tentar de novo** ou espere a nova tentativa automática, a cada minuto.                          |
| A janela preta fechou sozinha com uma mensagem                    | Leia a mensagem: o `iniciar.bat` espera uma tecla antes de fechar quando algo dá errado.                                                    |

## Para quem mexe no código

| Comando         | O que faz                                                                   |
| --------------- | --------------------------------------------------------------------------- |
| `npm run dev`   | Desenvolvimento: tela (Vite) e servidor recarregam sozinhos ao salvar.      |
| `npm test`      | Todos os testes, incluindo o teste ponta a ponta (`src/ponta-a-ponta/`).    |
| `npm run lint`  | ESLint e Prettier.                                                          |
| `npm run build` | Confere os tipos e gera a versão final em `dist/`.                          |
| `npm start`     | Serve a versão final em <http://localhost:3000> (o `iniciar.bat` faz isso). |

Configuração opcional: copie `.env.example` para `.env`.

- `PORT`: porta do servidor (padrão 3000).
- `DB_ARQUIVO`: arquivo do banco (padrão `dados.db`).
- `SEM_NAVEGADOR=1`: faz o `iniciar.bat` não abrir o navegador.

Estrutura: `src/client` (tela React), `src/server` (Express, banco e fontes de cotação),
`src/shared` (regras comuns), `src/ponta-a-ponta` (teste do fluxo completo), `scripts`
(o `iniciar.bat` chama `scripts/iniciar.mjs`) e `docs` (documentação).
