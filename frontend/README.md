# FireCal — frontend global

React, TypeScript, Vite, Three.js e Recharts. A interface oferece PT-BR/EN, informação expansível, busca de países, filtros históricos, quatro modos de mapa, comparação temporal, multisseleção e CSV. Consulte [LOCAL.md](../LOCAL.md) para preparar os índices e iniciar frontend/API juntos.

```bash
npm ci
npm run dev
npm run build
```

O proxy `/api` do Vite encaminha para `http://127.0.0.1:8000`. Para hospedagem independente, configure `VITE_API_URL` no build e `CORS_ORIGINS` na API. Os dados vêm exclusivamente do backend; os mocks sintéticos legados permanecem preservados e não são usados pelo dashboard.

O teste opcional `node scripts/verificar_interface.cjs`, executado da raiz Web com Playwright/Chromium disponíveis, verifica idiomas, informação, países, datas, zoom, comparação, Shift, exportação, 3D e móvel. `PLAYWRIGHT_MODULE` e `CHROME_BIN` permitem usar instalações existentes no ambiente.

A cartografia, licença e reprodução estão em [public/geo/README.md](public/geo/README.md). O método F₂ e suas limitações estão em [docs/F2_REFERENCIA_COMUM.md](../docs/F2_REFERENCIA_COMUM.md).
