# Implantação AWS econômica — 15/11/2026

Sistema publicado e verificado em **https://firecalglobal.duckdns.org**.

| Componente | Configuração aplicada |
| --- | --- |
| Região | us-east-1, Norte da Virgínia |
| EC2 | t3.micro, Ubuntu 24.04 AMD64, 1 GiB RAM, créditos CPU Standard |
| Instância | i-07eff646e915fc13c |
| Elastic IP | 3.229.193.229; DuckDNS configurado manualmente pelo usuário |
| Discos | raiz 10 GiB + dados 30 GiB, criptografados; swap de 3 GiB |
| Backend | Python 3.12.2, FastAPI, um worker, uma consulta pesada por vez |
| Banco | SQLite analítico no EBS, sem RDS e sem Secrets Manager |
| S3 | privado/versionado: fontes, releases, imagens, índices e backup SQLite |
| Frontend | build estático servido pelo Caddy, sem processo Node |
| HTTPS | certificado público validado pelo navegador e por cliente HTTP externo |
| Release | 20261115152748-9f44f7562fe8 |

Estimativa recorrente: **aproximadamente US$ 15/mês**, antes de tráfego,
requisições, impostos, crescimento e créditos. Detalhamento e alternativas:
[infra/CUSTOS.md](../../infra/CUSTOS.md). A opção RDS permanece no Terraform,
desativada com `enable_rds = false`.

## Dados e comunicação verificados

- 148 arquivos de origem, aproximadamente 13,74 GiB, conferidos por chave e
  tamanho no S3 antes de publicar. A validação identificou e reenviou um ZIP
  MODIS 2020 ausente; não se alterou o original local.
- Frontend → Caddy `/api` → FastAPI → SQLite/Parquet/cache F2, na mesma origem.
- Estado público `ready`, 48 fontes; catálogo com 16.525 pontos.
- Histórico global mensal com 312 períodos e total de 295.748.529 registros.
  A unidade é a dos arquivos científicos; esse total não é uma contagem de
  incêndios independentes.
- F2 com quatro horizontes e referência histórica 22/12/2025. Continua sendo
  projeção experimental histórica, não previsão atual nem oficial da NASA.
- Snapshot SQLite consistente, incluindo WAL confirmado, publicado no S3 em
  `backups/exploration.sqlite`; fontes e índices podem ser recuperados do S3.

## Testes e limitações

O navegador externo passou nos testes de PT-BR/EN, informação expansível,
busca de país, datas, zoom, comparação de anos, multisseleção Shift, CSV, 3D
e viewport móvel, sem erros JavaScript/HTTP. Capturas temporárias:
`/tmp/firecal-v2-desktop.png` e `/tmp/firecal-v2-mobile.png`.

Após o teste público, os dois contêineres continuaram em execução, sem reinícios
e sem OOM. A amostra em repouso registrou API com 121,9 MiB e Caddy com 20,1 MiB;
o volume de dados tinha 8,5 GiB livres. O backup S3 foi confirmado com
568.254.464 bytes e criptografia AES256.

A suíte do backend executou 44 testes, com 40 aprovados e quatro testes
opcionais PostgreSQL ignorados nessa execução; o módulo PostgreSQL foi validado
separadamente em instância local descartável. Os cinco testes de publicação e
os dois cenários Terraform com provider simulado passaram. O plano real final
retornou sem alterações pendentes.

O teste local com dados reais limitou a API a 700 MiB e permitiu swap, cobrindo
consultas globais/multianuais e diárias, inclusive com requests concorrentes
serializados. Não houve OOM; houve recuperação de memória pelo cgroup. Isso
não garante latência da EC2 sob carga sustentada ou sem créditos de CPU.

Build e preparação de índices são feitos localmente, preservando assinaturas
por SHA-256 e mtime das cópias regionais no servidor. A API de produção não
reconstrói índices ausentes automaticamente. A instalação inicial da AMI falhou
por ausência do pacote apt `awscli`; foi corrigida com instalador oficial e
reexecução segura via SSM. O marcador `bootstrap-ready` e os serviços confirmam
o estado atual, preservando o registro do erro inicial no cloud-init.

Operação e nova publicação: [infra/README.md](../../infra/README.md).
Arquivos de credenciais, tfvars, planos, estado e artefatos não foram incluídos
no Git. Nenhuma senha, token DuckDNS ou chave AWS foi colocada no código.
