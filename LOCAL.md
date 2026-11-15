# FireCal local — exploração global, idiomas e F₂

Pré-requisitos: Python **3.12.2**, Node 20.19+ e os dados de pesquisa existentes em `../data/global_1km_2000_2025`. A preparação não baixa dados NASA e mantém os originais intactos. Não exige PostgreSQL/RDS.

Na raiz principal:

```bash
uv pip install --python .venv/bin/python -r nasa-hackaton-repo/backend/requirements-dev.txt
cd nasa-hackaton-repo/frontend
npm ci
```

Na raiz Web, prepare os derivados uma vez e inicie:

```bash
./iniciar_local.sh --prepare
./iniciar_local.sh --detach
./iniciar_local.sh --status
# Encerrar:
./iniciar_local.sh --stop
```

`./iniciar_local.sh` sem opções mantém os serviços em primeiro plano; Ctrl+C encerra ambos. O modo em segundo plano guarda PID e logs em `../data/global_1km_2000_2025/web_local/`. O inicializador não encerra processos alheios nem lê `.env`.

- Interface: http://localhost:5173
- API/documentação interativa: http://localhost:8000/docs
- Saúde: http://localhost:8000/health
- Preparação histórica: http://localhost:8000/explore/status

O frontend usa o proxy Vite `/api` para o backend. Para instalação separada, configurar `VITE_API_URL` no build e `CORS_ORIGINS` no backend. Para outro caminho de dados/interpretador, usar `FIRE_DATA_DIR` e `PYTHON_BIN`. O modo local usa `FIRE_STORAGE=parquet`; SQL/RDS fica para outra etapa.

## Interface implementada

- PT-BR e EN, com idioma persistido; datas, números, controles, ajuda, tooltips e respostas de consultas são localizados.
- Botões **i** expandem/recolhem explicações, com `aria-expanded`, identificação do conteúdo e acesso por teclado/touch.
- Mundo por padrão e busca de país/território. O histórico completo tem **235 rótulos territoriais**; a cartografia Natural Earth Map Units tem **265 feições**. São inventários de fontes diferentes, não listas equivalentes de países soberanos.
- Observações 3D/2D e Calor 3D/2D, bordas e destaque do território ao passar o mouse. Contornos são estáticos; não representam fronteiras históricas.
- Zoom/pan/restaurar Mundo/ajustar seleção no 2D; controles de navegação no globo. `Shift+clique` alterna pontos, `Shift+arraste` seleciona conjuntos; “Selecionar área” funciona sem Shift. No 3D a seleção ignora a superfície oculta.
- País e conjunto de pontos alimentam a mesma análise. O cálculo usa todos os IDs da união, sem depender da paginação ou do detalhe desenhado. Células selecionadas são de **1°**, com extensão espacial explícita; não são medições pontuais de 1 km.
- Datas inicial/final, meses recorrentes, sensores, métrica e agrupamentos mensal/anual/semanal/diário. O mapa tem ano A/B e mês próprios; o gráfico usa o intervalo do cabeçalho. Escolher uma célula do calendário destaca a série e muda o período do mapa sem apagar os outros anos.
- Comparação lado a lado, inclusive 3D, com escala comum, anos independentes e câmeras sincronizáveis. Calor branco→amarelo→laranja→vermelho com opacidade; valores ausentes e zero têm interpretações distintas.
- Exportação CSV com filtros, IDs, método, unidade e cobertura. Compartilhamento dos filtros da análise no fragmento da URL (não enviado como cabeçalho HTTP, inclusive para seleções grandes). Câmera, modo visual e anos A/B não são serializados na URL nesta versão.

## Dados e precisão temporal

O índice em `web_v2/exploration.sqlite` agrega os 48 Parquet 0,25° por país/sensor/célula/mês. Os totais preservam a unidade legada **célula × mês × semana × sensor**. Não são incêndios, células únicas no mês/ano ou área queimada. A soma temporal de FRP não é energia nem potência simultânea.

Consultas mensais são ampliadas a meses completos e informam as datas efetivas. Consultas semanais usam semanas ISO completas derivadas das fontes, preservando repetições entre meses com aviso. O agrupamento diário lê o dia real nos CSV/ZIP originais e agrega ocupações diárias da grade 0,01° por sensor. **Diário requer um país e um único ano**, com cache separado. Selecionar dia no agrupamento semanal/mensal não cria precisão diária artificial.

Sensores indisponíveis são nulos. Zero significa ausência de registro no arquivo disponível; não comprova ausência de fogo ou observação com céu limpo. 2000 tem apenas novembro/dezembro com registros no artefato inspecionado e é marcado como parcial. A cartografia não é usada para redistribuir silenciosamente a origem territorial dos registros.

O método aditivo M2-V2 é experimental e acessível na API com `metric=harmonized`; a interface principal começa com medidas observacionais por sensor. Ele não herda as métricas do método de harmonização legado. Filtros conjuntos de confiança/dia-noite/temperatura não foram anunciados como disponíveis sem os agregados necessários.

## F₂ com referência comum

`POST /forecast/selection` recalcula a mesma semana para ponto, país ou conjunto. Soma previsões absolutas compatíveis, recalcula a anomalia pelos totais e usa F₀ climatológico quando não há telemetria útil para F₂. A interface identifica quantidades F₂/F₀ e células sem entradas suficientes, sem inserir temperaturas ou FRP sintéticos. Não se somam os snapshots antigos de semanas diferentes.

A referência disponível é **01/01/2024 a 22/12/2025**, independente do período observacional e dos filtros de sensores; o modelo mantém os sensores usados no treinamento. Não é previsão atual de 2026 ou previsão oficial NASA. As métricas antigas por zona não validam automaticamente cada seleção. O apoio F₀ e as previsões usam a unidade harmonizada experimental do merge legado.

A preparação semanal usa 36 Parquet de 2012–2025, com cache de cerca de 1,5 GB. A primeira referência mundial ainda pode levar dezenas de segundos; uma consulta nova medida levou 47,75 s. Respostas por referência/seleção são persistidas e reaproveitadas. Os índices históricos e F₂ somam aproximadamente 2 GB nesta execução.

O relatório de alternativas e avaliação amostral fica no repositório principal em `docs/relatorios/alternativas-f2-referencia-comum.md`. Na amostra fixa, três horizontes melhoraram sobre F₀; duas semanas ficou 1,05% pior. Isso não constitui validação global/local.

## Contratos e verificações

Rotas novas: `GET /explore/countries`, `GET /explore/status`, `POST /explore/query`, `POST /explore/map` e `POST /forecast/selection`. Rotas antigas de catálogo, inferência explícita e consulta detalhada de 1 km continuam disponíveis em `/docs`.

```bash
# Na pasta backend:
../../.venv/bin/python -m unittest discover -s tests -v
# Na pasta frontend:
npm run build
# Na raiz Web, com Playwright/Chromium disponíveis:
node scripts/verificar_interface.cjs
```

Para usar ferramentas de navegador já instaladas em outro local, configurar `PLAYWRIGHT_MODULE` e `CHROME_BIN`. O E2E valida idioma, informação expansível, pesquisa, datas, zoom, comparação, seleção com Shift, CSV, 3D e viewport móvel. Capturas de QA ficam em `/tmp/firecal-v2-desktop.png` e `/tmp/firecal-v2-mobile.png`.

Ainda não há troca automática de camada 1°→0,25°→1 km conforme zoom; os mapas históricos usam 1°. A consulta detalhada legada de 1 km permanece na API. A infraestrutura AWS e a migração dos agregados para PostgreSQL/RDS estão preparadas em `infra/`; o provisionamento na conta AWS depende do login e da aplicação do plano. A validação ampliada do modelo, filtros físicos conjuntos e a otimização da textura/bundle permanecem como próximas etapas.

## Publicação AWS

O ambiente local pode continuar sendo usado com SQLite e Parquet. A publicação
com Terraform, RDS privado, EC2 e HTTPS/DuckDNS está documentada em
[infra/README.md](infra/README.md), incluindo login AWS CLI sem compartilhar
credenciais.
