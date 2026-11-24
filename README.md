# Oikon

O dinheiro da casa, claro e simples. App web instalável (PWA) para lançar gastos pelo celular e acompanhar orçamento e saldo. Os dados ficam numa planilha Google no Drive de quem usa. Um servidor pequeno no Cloudflare cuida só do login e de quem pode usar; ele não vê dados financeiros.

- **Usar:** abra o endereço publicado pelo GitHub Pages e entre com Google.
- **Testar sem Google:** acrescente `?demo=1` ao endereço. Os dados ficam só naquele navegador.

## Estrutura

| Arquivo | O que faz |
| --- | --- |
| `index.html`, `css/app.css` | Página e visual (design system do Oikon: tokens no topo do CSS) |
| `js/icones.js` | Ícones de linha (Lucide, licença ISC) |
| `fonts/` | Mulish e Outfit (licença SIL OFL), hospedadas para funcionar sem internet |
| `tools/versao.py` | Marca uma versão nova em todos os arquivos antes de publicar |
| `js/app.js` | Telas e navegação |
| `js/model.js` | Regras: saldo, faturas, orçamento, recorrências, fechamento do mês |
| `js/parser.js` | Campo único de lançamento (interpretação sem IA) |
| `js/store.js` | Cache no aparelho e fila de envio para a planilha |
| `js/google.js` | Login (com o servidor de login), Sheets, Drive e seletor de arquivos do Google |
| `js/mock.js` | Modo demonstração |
| `js/schema.js` | Abas e colunas da planilha |
| `js/config.js` | Identificadores públicos do projeto no Google Cloud |
| `sw.js`, `manifest.webmanifest` | Funcionamento offline e instalação |
| `privacidade.html` | Política de privacidade (exigida pelo Google) |
| `tools/worker/oikon-auth.js` | Servidor de login (Cloudflare Worker): renova a conexão e controla quem pode usar. Atualizado à mão no Cloudflare, não pela publicação do app |

Não há etapa de build: os arquivos são publicados como estão.

## Licença

Todos os direitos reservados. O código está visível só para consulta; ver [LICENSE](LICENSE). Fontes e ícones de terceiros mantêm as próprias licenças.
