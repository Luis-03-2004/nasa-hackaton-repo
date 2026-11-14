# Executar o FireCal localmente

Pré-requisitos: Python **3.12.2**, Node 20.19+ e os derivados do pipeline já existentes no repositório principal. Não há download NASA, ingestão de 295 milhões de linhas ou PostgreSQL obrigatórios para esta execução.

Na raiz `hackaton-nasa`, instale:

```bash
uv pip install --python .venv/bin/python -r nasa-hackaton-repo/backend/requirements.txt
cd nasa-hackaton-repo/frontend
npm ci
```

Depois, na raiz do repositório Web:

```bash
./iniciar_local.sh
```

- Interface: http://localhost:5173
- API: http://localhost:8000
- Contratos e consultas interativas: http://localhost:8000/docs
- Saúde e contagem do catálogo: http://localhost:8000/health

O comando mantém os serviços em primeiro plano. `Ctrl+C` encerra API e frontend. Para manter o sistema em segundo plano:

```bash
./iniciar_local.sh --detach
./iniciar_local.sh --status
# Para encerrar os processos iniciados por --detach:
./iniciar_local.sh --stop
```

Os logs ficam em `../data/global_1km_2000_2025/web_local/firecal.log`; nenhum arquivo de dados original é alterado. Portas ocupadas causam erro; o inicializador não encerra processos alheios. Não lê arquivos `.env`.

O caminho padrão dos dados é `../data/global_1km_2000_2025`. Para outro checkout, configure `FIRE_DATA_DIR=/caminho/absoluto/global_1km_2000_2025` e `PYTHON_BIN=/caminho/python3.12.2`. O frontend encaminha `/api` para a API via proxy Vite; para servidor separado configure `VITE_API_URL` e as origens `CORS_ORIGINS` do backend. A execução exige ambos os serviços; falhas da API aparecem na interface e não acionam dados sintéticos.

## Fluxos disponíveis

1. O catálogo de **16.525 pontos de 1°** alimenta os mapas 2D/3D. Clique no mapa ou informe latitude/longitude; a API devolve o ponto de catálogo mais próximo e sua distância, inclusive para consultas oceânicas. Os atalhos Brasil, Cerrado, Amazônia e Pantanal escolhem coordenadas; não são recortes por polígonos oficiais de biomas.
2. A previsão F₂ mostra quatro horizontes, valores em células e anomalias, drivers e validação da zona climática. A referência é a última semana ativa de **2025** de cada ponto, não a data atual. O gerador legado usa imputações físicas em semanas ausentes sem exportar uma máscara por ponto: os drivers não são apresentados como medições verificadas. Intervalos preditivos não foram exportados e não são inventados.
3. O histórico harmonizado e o calendário são **mensais**, 2000–2025, nos sete escopos realmente exportados: Mundo, Brasil e cinco zonas latitudinais. Uma seleção pontual não transforma esse histórico em histórico local. O calendário mostra intensidade, anomalia ou z-score, com climatologia 2003–2023. Selecionar um mês destaca a série sem apagar os outros anos. CSV exporta o histórico completo do escopo.
4. A comparação por sensor consulta os Parquet 0,25° para Mundo/Brasil no ano do mês selecionado (2025 se o mês estiver vazio). Valores são somas mensais de **células-semana por sensor**, antes da harmonização, não focos únicos ou área queimada. Sensores ausentes aparecem como nulos.
5. A consulta de área lê os Parquet de 1 km reais no mês selecionado. Coordenadas são `oeste, sul, leste, norte`. O resumo conta todos os registros do recorte, mas a tabela exibe até 100. O backend limita área a 25 graus² e janela a 366 dias; não aceita caixa cruzando o antimeridiano. Datas representam segundas-feiras de semanas ISO, não a data exata da detecção. Selecionar um mês não recalcula o snapshot F₂ de 2025.

## Verificação

```bash
# Alternativa uv, a partir da raiz principal:
uv pip install --python .venv/bin/python -r nasa-hackaton-repo/backend/requirements-dev.txt
# Na pasta backend:
../../.venv/bin/python -m unittest discover -s tests -v
# Na pasta frontend:
npm run build
```

Os arquivos de demonstração legados permanecem preservados em `frontend/src/mocks` e `frontend/public/mocks`; o dashboard integrado usa exclusivamente a API. Os dados originais e derivados em `../data` permanecem fora do Git.

## Próximas etapas de infraestrutura

O modo SQL existente continua selecionável com `FIRE_STORAGE=sql` e `DATABASE_URL`, com ingestão por `app.ingest`; o Compose explicita esse modo. A migração ao RDS, credenciais, provisionamento, índices e validação de carga serão feitos na próxima etapa. As rotas de catálogo/modelo ainda leem os artefatos locais nesse modo. Não foram implementadas camadas de zoom automáticas 0,25°/1 km nem séries históricas por ponto; a consulta de observações por área já funciona localmente.
