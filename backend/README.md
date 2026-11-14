# API de observacoes de fogo

API FastAPI com armazenamento PostgreSQL e filtros espaciais por retangulo.
O endpoint `/docs` publica a documentacao interativa Swagger.

## Subir API, banco e dados

Os tres arquivos MODIS, VIIRS-NOAA-20 (JPSS-1) e VIIRS-SNPP estao em
`data/`. Cada linha e um registro agregado por celula de aproximadamente 1 km
e semana ISO, nao uma deteccao individual com horario exato. A API preserva
todos os campos dos Parquets; `latitude` e `longitude` sao calculadas como
`lat_1km / 100` e `lon_1km / 100`, e `period_start` e a segunda-feira da semana
ISO (uma data aproximada para o agregado).

Na raiz deste diretorio, suba tudo com um unico comando:

```bash
docker compose up --build
```

O Compose inicia o Postgres e, quando ele estiver pronto, a API importa os anos
configurados antes de aceitar requisicoes. O Postgres fica na porta `5433` do
host e a API na porta `8000`. Abra <http://localhost:8000/docs> para usar o
Swagger.

### Configurar os anos importados

Por padrao, `FIRE_DATA_YEARS` e `2025`. Para escolher outros anos, copie
`.env.example` para `.env` e ajuste a lista:

```bash
FIRE_DATA_YEARS=2025,2024
```

Tambem e possivel definir `FIRE_DATA_YEARS` no ambiente antes de executar
`docker compose up`. Para cada ano selecionado, a pasta `data/` precisa conter
um ou mais arquivos Parquet com o ano no nome (por exemplo,
`modis_2025_1km.parquet`). Se faltar algum ano configurado, a inicializacao
falha explicitamente em vez de iniciar a API sem esses dados.

A importacao e idempotente: na inicializacao, arquivos que ja estao completos
no banco sao ignorados; cargas parciais sao retomadas. Cada linha original e
identificada pela combinacao de satelite, ano e numero da linha no arquivo,
preservando inclusive registros com coordenada e semana repetidas.

Os dados do banco permanecem no volume nomeado `nasa-fire-api_postgres_data`
quando os containers param ou sao recriados. Os arquivos Parquet sao montados
como somente leitura em `/data`; a importacao nao altera os originais. Nao use
`docker compose down -v`, pois a opcao `-v` remove o volume e os dados
persistidos.

Para mudar os anos depois da primeira subida, altere `.env` e execute
`docker compose up --build` novamente. Os anos novos serao adicionados ao
mesmo banco; os registros existentes nao sao apagados.

## Consultas de hotspots

`GET /hotspots` retorna os pontos de fogo importados de todos os satelites.
Quando os limites geograficos sao omitidos, a busca cobre o mundo inteiro:

```text
/hotspots
```

Opcionalmente, filtre por retangulo informando os quatro limites:

- `top_left_lat` e `top_left_lon`: latitude superior e longitude esquerda.
- `bottom_right_lat` e `bottom_right_lon`: latitude inferior e longitude direita.
- `start_date` e `end_date` sao opcionais; sem datas, a consulta cobre os
  ultimos cinco anos ate hoje. Datas anteriores ao limite ou futuras sao
  rejeitadas.

Os pontos sao enviados como um array JSON em streaming, sem paginação. Isso
permite consultar o mundo todo sem carregar todos os registros na memoria da
API. Exemplo com area e periodo:

```text
/hotspots?top_left_lat=-22&top_left_lon=-46&bottom_right_lat=-24&bottom_right_lon=-44&start_date=2025-01-01&end_date=2025-12-31
```

`GET /observations/area` retorna os pontos e os recursos calculados para uma
area. `GET /observations/area/features` retorna somente os recursos da mesma
consulta:

```text
/observations/area/features?top_left_lat=-22&top_left_lon=-46&bottom_right_lat=-24&bottom_right_lon=-44
```

Os recursos incluem a semana mais recente observada (`last_fire`, aproximada),
registros e deteccoes representadas por ano (`fires_per_year`) e totais por
satélite. `observations` conta linhas agregadas; `detections` soma
`merged_count`. As contagens entre satelites nao sao deduplicadas.

A API e somente leitura para hotspots: nao ha endpoint para cadastrar ou
remover pontos manualmente. Os registros consultados sao os importados dos
Parquets. A restricao de cinco anos limita as consultas, mas nao cria historico
ausente: os arquivos atualmente disponiveis cobrem 2025.

## Respostas de erro

Coordenadas fora dos limites, retangulos invertidos e datas fora da janela
permitida retornam `422`. A API cria as tabelas quando inicia.
