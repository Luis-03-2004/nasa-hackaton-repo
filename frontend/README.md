# Interface local do FireCal

React, TypeScript, Vite, Three.js e Recharts. Consulte [LOCAL.md](../LOCAL.md) para iniciar frontend, API e dados juntos.

```bash
npm ci
npm run dev
```

A interface fica em http://localhost:5173 e encaminha `/api` para http://127.0.0.1:8000. Para uma API em outro endereço, configure `VITE_API_URL` e autorize a origem em `CORS_ORIGINS` do backend.

Os mapas usam o catálogo de 16.525 pontos; o histórico mensal e o calendário usam os sete escopos reais de 2000–2025. A seleção de coordenadas atualiza a previsão do ponto mais próximo, preservando o escopo explícito do histórico. O mês selecionado destaca a série e determina o recorte da consulta de observações. O F₂ usa um snapshot referenciado em 2025, com procedência e limitações visíveis.

Não há fallback para os mocks sintéticos legados. A API é necessária e eventuais falhas aparecem na interface.

Para verificar tipos e gerar o build:

```bash
npm run build
```

Com Playwright e Chromium já disponíveis, o teste de navegador opcional pode ser executado na raiz Web:

```bash
node scripts/verificar_interface.cjs
```

`PLAYWRIGHT_MODULE` permite indicar um pacote Playwright já instalado fora do projeto; `CHROME_BIN` permite escolher o executável Chrome. O teste usa os dados locais reais, valida seleção de coordenadas e mapa, troca de escopo, calendário, CSV de 312 meses, comparação por sensor, consulta espacial e layout móvel. Os screenshots de QA ficam em `/tmp/firecal-desktop.png` e `/tmp/firecal-mobile.png`. `FIRECAL_URL` substitui a URL padrão.

O build gera arquivos estáticos em `dist/`; uma hospedagem futura precisa encaminhar `/api` ao backend ou definir `VITE_API_URL` no build. O proxy Vite vale para o servidor de desenvolvimento.
