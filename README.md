# Oikon

O dinheiro da casa, claro e simples. App web instalável (PWA) para lançar gastos pelo celular e acompanhar orçamento e saldo. Os dados ficam numa planilha Google no Drive de quem usa; o app não tem servidor próprio.

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
| `js/google.js` | Login, Sheets, Drive e seletor de arquivos do Google |
| `js/mock.js` | Modo demonstração |
| `js/schema.js` | Abas e colunas da planilha |
| `js/config.js` | Identificadores públicos do projeto no Google Cloud |
| `sw.js`, `manifest.webmanifest` | Funcionamento offline e instalação |

Não há etapa de build: os arquivos são publicados como estão.
