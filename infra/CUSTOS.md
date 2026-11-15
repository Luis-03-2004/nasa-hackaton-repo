# Perfil econômico e alternativas de banco

A configuração padrão usa **t3.micro (1 GiB), SQLite local e S3 privado**.
RDS foi desativado com `enable_rds = false`. O histórico global completo não é
reduzido: muda o serviço de armazenamento/consulta, não o recorte científico.

| Item | Cálculo de referência | US$/mês |
| --- | --- | ---: |
| EC2 t3.micro Linux | 0,0104 × 730 horas | 7,59 |
| IPv4 público | 0,005 × 730 horas | 3,65 |
| EBS gp3 | 40 GiB × 0,08 | 3,20 |
| S3 | fontes, índices, imagens e backup; depende das versões retidas | aproximadamente 0,40–0,60 |
| RDS / Secrets Manager | desativados | 0 |
| **Base estimada** | antes de tráfego, requests e impostos | **aproximadamente 15** |

Não é um teto de faturamento: tráfego, versões antigas e backups adicionais
podem aumentar a cobrança. CPU usa créditos **Standard**, evitando excedentes
Unlimited; sem saldo de créditos a EC2 perde desempenho. A comparação mensal
usa 730 h; meses de 31 dias usam até 744 h. Créditos promocionais da conta não
foram subtraídos da estimativa recorrente.

Fontes primárias: [catálogo EC2 us-east-1](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(N.%20Virginia)/Linux/index.json),
[EBS](https://aws.amazon.com/ebs/general-purpose/),
[IPv4](https://aws.amazon.com/vpc/pricing/),
[S3](https://aws.amazon.com/s3/pricing/).

## O que fica no S3 e o que fica na EC2

O S3 guarda os Parquet/ZIPs/modelos de origem, releases, imagens Docker, índices
preparados e snapshot consistente do SQLite. A publicação baixa cópias para o
EBS. SQLite consulta arquivos locais: não é adequado abrir um banco SQLite
diretamente sobre objetos S3 ou baixar o banco inteiro a cada requisição.

O frontend já é um build estático no Caddy, sem processo Node em produção.
Movê-lo para S3/CloudFront não elimina o custo da EC2 necessária à API. Manter
essa primeira versão na mesma origem economiza complexidade e mantém HTTPS
DuckDNS. S3 privado + CloudFront continua sendo uma opção futura para distribuir
os arquivos estáticos; não se presume franquia disponível nem elegibilidade a
um plano gratuito da conta.

## SQLite, Neon e Supabase

SQLite não tem cobrança de serviço de banco: ocupa o EBS já contratado.
O cubo atual tem **568.254.464 bytes (541,93 MiB)**. O cache F2 é outro derivado
local, de aproximadamente 1,5 GiB, e não precisa ser migrado a PostgreSQL.

Uma importação completa do cubo em PostgreSQL 17 mediu:

- Banco completo, incluindo catálogo: **866.277.043 bytes (826,15 MiB)**.
- Dados analíticos: 440.442.880 bytes; índices: 418.004.992 bytes.
- 48 fontes, 3.965.731 registros mensais e 618.889 anuais, sem alterar a origem.
- A carga inicial cabe em 1 GiB com 197,85 MiB livres. A migração `--replace`
  mantém o schema anterior e exige cerca de **1,606 GiB**, ultrapassando 1 GiB.

[Neon Free](https://neon.com/pricing) oferece atualmente 1 GB por projeto,
100 CU-h e 5 GB de saída por mês. A primeira carga pode caber, mas atualização,
histórico e consumo precisam de controle. Healthchecks SQL constantes podem
impedir a escala a zero e esgotar a quota. Não se adotou esse serviço externo
como requisito da implantação.

[Supabase Free](https://supabase.com/pricing) oferece 500 MB de banco; esse
cubo completo não cabe. Também é possível haver pausa por inatividade.

RDS micro com 20 GiB adicionaria aproximadamente US$ 14,78/mês, incluindo dois
segredos, além dos custos da EC2. Armazenar menos tabelas não elimina o custo
fixo da instância nem permite reduzir esse disco abaixo de 20 GiB.

## Evidência de memória e limites

Testes com dados reais em contêiner limitado a **700 MiB**, um CPU e swap
permitido executaram histórico mensal global 2000–2025, semanal global 2025,
diário frio Brasil/DRC e F2 global. Não houve OOM ou reinício. O cgroup atingiu
seu limite e recuperou memória: isso não demonstra folga de capacidade nem
latência de uma EC2 sem créditos. A rota de saúde respondeu durante as consultas.

A versão econômica serializa consultas pesadas, limita PyArrow a dois threads
e solicita liberação do allocator após cada consulta. Build de imagens e dos
índices ocorre localmente. Em produção, caches ausentes/incompatíveis geram
503 em vez de reconstrução pesada automática. A swap de 3 GiB é proteção para
picos, com custo de latência. O dimensionamento é para demonstração e pouco
tráfego; concorrência sustentada pode exigir uma instância maior.
