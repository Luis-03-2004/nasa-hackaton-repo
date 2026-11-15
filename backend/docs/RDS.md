# Consultas analíticas no PostgreSQL/RDS

Em produção, `FIRE_ANALYTICS_STORAGE=postgres` direciona as consultas SQL de
`/explore` ao PostgreSQL. O padrão local continua sendo `sqlite`.
`ANALYTICS_DATABASE_URL` tem precedência; `DATABASE_URL` é alternativa. O
adaptador aceita URLs `postgresql://`, `postgres://` e `postgresql+psycopg://`.
Solicitar PostgreSQL sem uma URL válida gera erro de configuração, sem montar
outro cubo SQLite automaticamente.

O RDS guarda `monthly`, `country_monthly`, `annual`, `cell_inventory`,
`availability`, `sources` e o manifesto de publicação no schema
`firecal_analytics`. A migração preserva sensor, país, mês, ano, coordenadas da
grade e as quatro métricas existentes. Contagens usam `BIGINT` e medições usam
`DOUBLE PRECISION`. Sua interpretação científica permanece a mesma: registros
célula × mês × semana × sensor não equivalem a incêndios independentes.

As consultas mensais/anuais, mapas, calendário e metadados de seleção usam o
RDS. O processamento semanal ainda lê Parquet 0,25°, o diário usa os arquivos
originais e o F2 mantém seus artefatos/cache na EC2. Esses arquivos devem
permanecer em EBS com cópia no S3. Os 295 milhões de registros de detalhe não
são importados na inicialização da API.

## Preparação e publicação

Execute os comandos no diretório `backend`, usando Python 3.12.2. Em uma
instalação local deste repositório, prefira `../../.venv/bin/python`.

1. Prepare explicitamente o cubo a partir dos arquivos Parquet disponíveis,
   com `FIRE_ANALYTICS_STORAGE=sqlite`. Confira `status()['ready']` e o número
   de fontes esperado antes de migrar. A migração não baixa dados adicionais.

   ```bash
   FIRE_ANALYTICS_STORAGE=sqlite python -c 'from app.exploration import build_cube, status; build_cube(); assert status()["ready"]'
   ```

2. Inspecione o SQLite existente sem acessar o banco remoto:

   ```bash
   python -m app.migrate_analytics --source /data/global_1km_2000_2025/web_v2/exploration.sqlite --dry-run
   ```

3. Injete `ANALYTICS_DATABASE_URL` pelo ambiente privado do serviço. O deploy
   AWS recebe segredos por Secrets Manager e monta o certificado CA em
   `/run/firecal/rds-ca.pem`. A URL de produção usa `sslmode=verify-full` e
   `sslrootcert=/run/firecal/rds-ca.pem`; não coloque senhas em comandos,
   Terraform, Git ou logs. Publique e confira:

   ```bash
   python -m app.migrate_analytics --source /data/global_1km_2000_2025/web_v2/exploration.sqlite
   python -m app.migrate_analytics --check
   ```

O usuário da aplicação precisa de `CONNECT`, `CREATE` e `TEMPORARY` no banco;
ele cria e possui os schemas analíticos. Depois da publicação, leituras e
tabelas temporárias de multisseleção usam esse mesmo papel. A API não recebe a
credencial mestre do RDS.

A migração cria uma cópia SQLite consistente, incluindo WAL confirmado, sem
alterar a origem. Reserve espaço temporário de pelo menos o tamanho do cubo;
em Docker, use `TMPDIR` em um diretório gravável no EBS, pois `/tmp` pode ser
um tmpfs pequeno. O destino recebe `COPY` em lotes de 10.000 linhas, com limite
configurável por `--batch-size` entre 1 e 100.000, sem carregar a tabela toda
em memória. Cada tabela recebe verificação de quantidade, chaves, índices e
estatísticas.

Um lock transacional serializa as migrações. O schema de preparação só vira
`firecal_analytics` depois de todas as tabelas e do manifesto estarem prontos,
na mesma transação. Erros fazem rollback e mantêm a publicação anterior. A
API só declara `ready` quando o manifesto tem a versão esperada. Enquanto o
banco estiver indisponível, não migrado ou incompatível, `/explore` responde
503 e não inicia reconstrução local. `--check` retorna código 1 quando o
manifesto não está pronto.

Repetir a migração com o mesmo SHA-256 do snapshot e a mesma versão retorna
`unchanged`. Para outro conjunto, primeiro revise a saída de `--dry-run`; a
substituição precisa de `--replace` explícito. A versão anterior fica em
`firecal_analytics_previous`. Uma substituição posterior remove somente esse
backup reconhecido pelo manifesto FireCal. Schemas já existentes sem nosso
manifesto e um schema de preparação inesperado bloqueiam a operação para
preservar seus dados. A opção `--replace` não deve ser habilitada implicitamente
em toda inicialização do serviço.

## Verificação

```bash
python -m unittest discover -s tests -p test_analytics_database.py -v
python -m unittest discover -s tests -p test_exploration.py -v
```

Os testes usam fixtures sintéticas identificadas como tal. Para testar COPY,
substituição transacional e equivalência integral das respostas SQLite/Postgres,
defina `FIRE_TEST_ANALYTICS_URL` apontando para uma instância **de testes** com
permissão `CREATEDB`. O teste cria e remove somente um banco próprio com nome
aleatório `firecal_test_*`; não utilize uma URL de produção. Sem essa variável,
os quatro testes de integração são ignorados e os testes unitários continuam
executando.
