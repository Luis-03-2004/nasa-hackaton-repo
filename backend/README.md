# API local do FireCal

Python **3.12.2**, FastAPI e PyArrow. O modo padrão consulta os artefatos
locais em somente leitura, sem importar 295 milhões de linhas no PostgreSQL.
Não há download nem modificação das fontes durante a inicialização.

Na raiz `hackaton-nasa/`, instale com:

```bash
uv pip install --python .venv/bin/python -r nasa-hackaton-repo/backend/requirements.txt
```

Inicie a partir de `nasa-hackaton-repo/backend/`:

```bash
../../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Acesse <http://localhost:8000/docs>. `FIRE_DATA_DIR` substitui a pasta padrão
`hackaton-nasa/data/global_1km_2000_2025/`. `PARQUET_DATA_DIR` substitui somente
`parquet_1km/`. `CORS_ORIGINS` recebe origens separadas por vírgula; por padrão
aceita `http://localhost:5173` e `http://127.0.0.1:5173`.

## Contrato dos dados

- `GET /health`: modo de armazenamento, cobertura e quantidade de pontos.
- `GET /catalog`: sete escopos com 312 meses por escopo, 2000–2025. A série é
  **mensal**, não semanal: `iso_week=0` é um marcador legado, e
  `temporal_resolution="monthly"` informa a resolução. Os campos por sensor
  são nulos porque não existem neste artefato. `forecast=null` porque o JSON
  agregado contém métricas do F2, não uma previsão agregada operacional.
- `GET /world-points`: `{points:[...]}` preserva todos os campos do catálogo
  Parquet de 16.525 pontos; datas de referência variam por localidade.
- `GET /forecast/location?lat=-12&lon=-46`: snapshot F2 do ponto terrestre
  mais próximo, sua distância em km, horizontes 1–4 e anomalias. Não há série
  histórica local neste catálogo; `historical_series=[]`. Não há intervalos
  de previsão exportados; `band_p10_p90=null`.
- `POST /forecast/infer`: executa os pesos F2 reais sobre seis variáveis
  extraídas de observações explicitamente fornecidas pelo chamador. Requer
  `scope`, `horizon`, `mu_target`, `mu_t`, `mu_tm1`, `obs_t` e `obs_tm1`.
  Cada observação exige `h_cells`, `merged_count`, `frp_sum`, `bright_max`,
  `bright_bg_mean` e `night_count`. Esta rota não verifica a origem das entradas.

O snapshot foi produzido em 2026 com referência em semanas de **2025** e não
representa previsão atual. O script de treinamento possui fallback de valores
físicos quando uma semana está ausente e não grava a máscara de imputação.
Por isso a API informa essa limitação na procedência; os drivers do catálogo
não podem ser anunciados como medições verificadas em todos os pontos.
Métricas por zona validam séries agregadas da zona, não cada célula do mapa.
Zeros da série de origem foram preservados, inclusive a cobertura inicial
parcial. Ausência de registro não comprova ausência de fogo; uma célula não
representa um incêndio independente nem área queimada.

## Observações detalhadas

`GET /hotspots` retorna até `limit=1000` registros (máximo 10.000), por padrão
no ano de 2025. O cabeçalho `X-Result-Limit` informa o teto da resposta local.
O retorno é uma seleção limitada e não equivale a todos os dados do mundo.

`GET /observations/area` exige `top_left_lat`, `top_left_lon`,
`bottom_right_lat` e `bottom_right_lon`. Aceita `start_date`, `end_date` e
`limit`. Retorna pontos, `truncated`, `limit` e features calculadas sobre a
consulta completa, não apenas sobre os pontos retornados.
`GET /observations/area/features` retorna somente os totais completos.
No modo local, consultas detalhadas aceitam no máximo **366 dias** e caixas
com até **25 graus quadrados**. Use `/catalog` e `/world-points` para a visão
global. O leitor trabalha em lotes, preservando `source_row_index` de cada
arquivo e o nome do satélite. O `id` local é determinístico e pode diferir do
identificador sequencial de uma futura importação SQL.

As coordenadas vêm de `lat_1km / 100` e `lon_1km / 100`; os agregados usam
uma grade angular de 0,01°, cuja dimensão física varia com a latitude.
`period_start` é a segunda-feira aproximada da semana ISO. Como as fontes
guardam ano calendário e mês, janeiro/52–53 usa o ano ISO anterior e
 dezembro/1 usa o seguinte. Semanas 53 válidas são preservadas, sem fundi-las
na semana 52. F2 e o calendário exportados seguem o filtro de 52 semanas do
pipeline; a API não altera esse método.

`GET /observations/region-series?region=brazil&year=2025` retorna 12 meses
com células-semana de cada sensor a partir dos Parquets de 0,25° (que somam
as células de 0,01°). Aceita `region=global` ou `region=brazil`, anos 2000–2025.
O envelope contém `region`, `year`, `temporal_resolution`, `series` e
`provenance`; cada mês contém `month`, `week_start`, `n_modis`,
`n_viirs_snpp`, `n_viirs_jpss1`. Sensor sem arquivo no ano é nulo, não zero.
As contagens não são harmonizadas ou deduplicadas entre sensores e semanas.
A API guarda em cache até 52 combinações região/ano durante o processo.

## PostgreSQL e próxima migração

`FIRE_STORAGE=sql` habilita as consultas SQL existentes e a criação de tabela;
`DATABASE_URL` configura o destino. O modo padrão `parquet` não abre conexão
com PostgreSQL. A ingestão continua disponível via `python -m app.ingest`, com
`FIRE_DATA_YEARS` (padrão 2025) e `PARQUET_DATA_DIR` explícitos. Não há migração
para RDS nesta entrega.

O Compose existente mantém o fluxo PostgreSQL: `docker compose up --build`.
Ele usa `FIRE_STORAGE=sql`, importa a pasta `backend/data/` e monta os derivados
em `/derived`. Não remova o volume persistente do banco. O fluxo SQL não foi
executado nesta integração local; as consultas existentes foram preservadas.

## Verificação

Na raiz `hackaton-nasa/`, instale também as dependências de teste:

```bash
uv pip install --python .venv/bin/python -r nasa-hackaton-repo/backend/requirements-dev.txt
PYTHONPATH=nasa-hackaton-repo/backend .venv/bin/python -m unittest discover -s nasa-hackaton-repo/backend/tests -v
```

Os testes distinguem fixtures sintéticas dos artefatos reais: validam viradas
ISO, identidade da linha fonte, filtro espacial, agregação, paridade matemática
com o script de treinamento, contrato dos 16.525 pontos e CORS.
