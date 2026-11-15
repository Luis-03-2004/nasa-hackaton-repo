# Operação e recuperação do FireCal na AWS

Este guia complementa [o provisionamento completo](README.md). Os comandos
locais partem da raiz `nasa-hackaton-repo`. Os blocos identificados como
**na EC2** devem ser executados dentro de uma sessão Systems Manager.

O ambiente atual está em `us-east-1`, com `t3.micro`, SQLite, S3 privado e
HTTPS em `firecalglobal.duckdns.org`. Não há RDS nesse perfil. Veja
[custos](CUSTOS.md) e [registro da implantação](../docs/relatorios/implantacao-aws-economica.md).

## 1. Retomar o ambiente existente em outra máquina

Não comece criando outro bucket ou aplicando um plano vazio. O código está no
Git; os estados, dados e artefatos estão fora dele.

1. Clone a `main`, prepare Python 3.12.2/Docker e faça o login descrito em
   `README.md`, usando `firecal` e `firecal-terraform`.
2. Confira a conta com `aws sts get-caller-identity --profile firecal-terraform`.
3. Instale o Terraform local com `infra/scripts/install_terraform.py`.
4. Copie os exemplos `terraform.tfvars.example` e `backend.hcl.example` para
   seus nomes reais e preencha a conta e o bucket **já existentes**.
5. Conecte ao estado remoto antes de planejar:

```bash
infra/tf -chdir=infra/terraform init -reconfigure -backend-config=backend.hcl
infra/tf -chdir=infra/terraform output
infra/tf -chdir=infra/terraform plan
```

O plano deve reconhecer a instância, o EIP e o volume existentes. Não aplique
uma criação duplicada caso a conta, o backend ou as variáveis estejam errados.
Não importe recursos às cegas e não remova o estado para resolver erros.

Para os comandos locais deste guia, carregue identificadores a partir do estado:

```bash
export AWS_PROFILE=firecal-terraform
export AWS_REGION=us-east-1
FIRECAL_INSTANCE=$(infra/tf -chdir=infra/terraform output -raw instance_id)
FIRECAL_BUCKET=$(infra/tf -chdir=infra/terraform output -json deployment_config | \
  ../.venv/bin/python -c 'import json,sys; print(json.load(sys.stdin)["artifact_bucket"])')
```

O bootstrap do bucket usa estado **local** separado. Se ele ainda não existir
na nova máquina, restaure a cópia privada criada na implantação:

```bash
if [ ! -e infra/bootstrap/terraform.tfstate ]; then
  aws s3 cp "s3://$FIRECAL_BUCKET/state/bootstrap/local-backup.tfstate" \
    infra/bootstrap/terraform.tfstate --only-show-errors
  chmod 600 infra/bootstrap/terraform.tfstate
fi
```

Crie `infra/bootstrap/terraform.tfvars` com os mesmos valores de conta, região,
perfil e projeto do ambiente. Execute `init` e `plan` nesse módulo; não aplique
um plano de criação do bucket já existente. Se o backup não estiver disponível,
recupere o estado original ou revise uma importação dos recursos com os IDs
corretos. O backup privado não deve ir para o Git.

Para recuperar os dados científicos localmente, sem apagar nada:

```bash
mkdir -p ../data
aws s3 sync "s3://$FIRECAL_BUCKET/data/" ../data --only-show-errors
../.venv/bin/python infra/scripts/deploy.py --prepare-only
```

Esse download pode transferir cerca de 13,74 GiB e depende de espaço local.
`--prepare-only` verifica fontes e empacota o código sem publicar. A preparação
completa dos índices será feita no computador local pelo comando de deploy.

## 2. Atualizar o sistema

Atualizar o Git e atualizar a aplicação são etapas distintas. A publicação usa
os arquivos atuais do workspace, inclusive modificações ainda não comitadas.
Revise `git status` e os arquivos que serão publicados.

```bash
# Apenas código; fontes já estão no S3. A base local ainda é necessária.
../.venv/bin/python infra/scripts/deploy.py --skip-data

# Código e sincronização de fontes, se os dados foram atualizados.
../.venv/bin/python infra/scripts/deploy.py
```

Não use `--build-on-host` na micro: os builds e índices devem ser preparados
localmente. O publicador calcula hashes, envia imagens/snapshots e publica
`releases/current.json`. O host baixa as fontes, valida o manifesto e os
índices, troca os snapshots, inicia os containers e verifica HTTPS.

O resultado local informa um CommandId. Acompanhe, substituindo o identificador:

```bash
aws ssm get-command-invocation --command-id ID_DO_COMANDO \
  --instance-id "$FIRECAL_INSTANCE" \
  --query '{Status:Status,Saida:StandardOutputContent,Erro:StandardErrorContent}'
curl -fsS https://firecalglobal.duckdns.org/api/explore/status
```

`Status = Success`, `ready = true` e os testes públicos são os critérios de
conclusão. O comando local ter enviado a tarefa não basta. Se houver falha,
consulte o journal; o link `/opt/firecal/current` só muda depois do sucesso.
O sistema pode ficar temporariamente indisponível durante uma atualização.

Se apenas precisar repetir a release já publicada, **na EC2**:

```bash
sudo systemctl start firecal-deploy.service
sudo journalctl -u firecal-deploy.service -n 100 --no-pager
```

Não dispare publicações concorrentes nem troque `current.json` enquanto outra
tarefa estiver instalando uma release.

## 3. Entrar na EC2 e diagnosticar

Pelo console: Systems Manager → Fleet Manager → instância → Session Manager.
Pelo CLI, com Session Manager Plugin instalado:

```bash
aws ssm start-session --target "$FIRECAL_INSTANCE"
```

**Na EC2**:

```bash
sudo test -f /etc/firecal/bootstrap-ready && echo bootstrap-pronto
sudo systemctl is-active docker containerd
sudo findmnt /opt/firecal
free -m
df -h / /opt/firecal
sudo journalctl -u firecal-deploy.service -n 100 --no-pager
sudo docker compose --env-file /opt/firecal/current/release.env \
  -f /opt/firecal/current/deploy/aws/compose.yml ps
sudo docker compose --env-file /opt/firecal/current/release.env \
  -f /opt/firecal/current/deploy/aws/compose.yml logs --tail=100 api web
```

Antes do primeiro sucesso, use `/opt/firecal/releases/ID_DA_RELEASE/` em vez de
`/opt/firecal/current/`. O ID aparece no journal e no manifesto.

Não publique `backend.env`, saída completa de `docker inspect`, estado
Terraform ou respostas de Secrets Manager. Os logs normais de publicação não
precisam desses conteúdos. O modo atual não usa token DuckDNS nem senha RDS.

| Sintoma | Conferir |
| --- | --- |
| SSM não conecta | estado EC2, IAM instance profile, agente e saída HTTPS/443 |
| Sem volume ou swap | attachment do EBS, identificador, montagem, `/etc/fstab` |
| Histórico responde 503 | snapshots preparados, hash/mtime das fontes e readiness no journal |
| HTTPS não funciona | DNS A aponta ao EIP; AAAA antigo; portas 80/443; logs Caddy |
| Demora em consulta pesada | fila de trabalho, saldo CPU Standard, RAM/swap e I/O |
| Pouco espaço | imagens/releases antigas, temporários e caches; conferir versão ativa antes de remover |

Não reconstrua automaticamente o cubo ou cache F2 na micro para contornar 503.
Republique os índices preparados no computador local. O host verifica hashes
e preserva as assinaturas com os mtimes das cópias regionais.

## 4. Corrigir um bootstrap existente

O cloud-init executa o script uma vez por instância. Atualizar o user-data no
Terraform reinicia a EC2, mas não garante reexecução do bootstrap. Na primeira
implantação, a imagem Ubuntu não tinha `awscli` no apt; o script atual usa o
instalador oficial e foi reaplicado via SSM.

Para reaplicar **apenas o bootstrap atual** sem depender de AWS CLI na EC2,
prepare um JSON de comando local. Ele contém o script, sem credenciais:

```bash
../.venv/bin/python - <<'PY'
import base64, json, subprocess
from pathlib import Path

instance = subprocess.check_output([
    'infra/tf', '-chdir=infra/terraform', 'output', '-raw', 'instance_id'
], text=True).strip()
encoded = base64.b64encode(Path('deploy/aws/host-bootstrap.sh').read_bytes()).decode()
request = {
    'InstanceIds': [instance],
    'DocumentName': 'AWS-RunShellScript',
    'Comment': 'FireCal reaplicar bootstrap revisado',
    'Parameters': {
        'commands': [
            "printf %s '" + encoded + "' | base64 --decode > /usr/local/lib/firecal/host-bootstrap.sh",
            'chmod 0700 /usr/local/lib/firecal/host-bootstrap.sh',
            'bash /usr/local/lib/firecal/host-bootstrap.sh > /var/log/firecal-bootstrap-repair.log 2>&1',
        ],
        'executionTimeout': ['1800'],
    },
}
target = Path('infra/.release/repair-bootstrap.json')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(request))
PY
aws ssm send-command --cli-input-json file://infra/.release/repair-bootstrap.json \
  --query 'Command.CommandId' --output text
```

Faça isso em janela de manutenção: o bootstrap reinicia Docker/containerd.
Confira o CommandId, `/var/log/firecal-bootstrap-repair.log`, o marcador
`bootstrap-ready`, o volume, a swap e os serviços. O erro inicial pode continuar
registrado no status histórico do cloud-init mesmo após a recuperação.

Esse comando não atualiza `config.json` nem `host_runtime.py`. Alterações
nesses arquivos de user-data exigem uma atualização controlada dos arquivos
ou substituição explícita da EC2, conforme a próxima seção.

## 5. Trocar a EC2 ou mudar o perfil de infraestrutura

Antes da troca, confira backup, estado, EIP, AZ e volume. O EBS de dados tem
`prevent_destroy`; não remova essa proteção para substituir apenas a instância.
Mantenha a AZ do volume e o mesmo projeto/backend.

Se for necessário reaplicar todos os arquivos de user-data em uma nova EC2:

```bash
infra/tf -chdir=infra/terraform plan -replace=aws_instance.app -out=replace.tfplan
# Confira: substituição da EC2 e attachment; preservação do EBS e Elastic IP.
infra/tf -chdir=infra/terraform apply replace.tfplan
infra/tf -chdir=infra/terraform output
```

Há indisponibilidade e o identificador da instância pode mudar. Recarregue
`FIRECAL_INSTANCE`, espere o SSM/bootstrap e repita a publicação. O domínio
continua no mesmo EIP se o plano o preservar. Docker, dados e certificados no
EBS são reutilizados; a rotina valida a release antes de declarar sucesso.

Para habilitar RDS no futuro, revise o acréscimo de custo, altere
`enable_rds = true` e siga [o contrato PostgreSQL](../backend/docs/RDS.md).
Uma nova EC2 como acima recebe os endpoints/ARNs e modo PostgreSQL no
`config.json`. Habilitar a flag sem atualizar a configuração do host existente
não basta para conectar a API ao novo banco. A migração real só deve ser
considerada pronta após status `storage = postgres` e testes dos endpoints.

## 6. Backup e recuperação

O layout privado do bucket é:

```text
state/prod/terraform.tfstate        estado remoto da infraestrutura
state/bootstrap/local-backup.tfstate cópia do estado local do bucket
data/                              Parquet, ZIPs e artefatos científicos
releases/<release-id>/              fonte, imagens, índices e manifesto
releases/current.json               release que o host deve instalar
backups/exploration.sqlite          snapshot consistente do cubo SQLite
```

O deploy cria o snapshot pela API SQLite, incluindo WAL confirmado, e envia
`backups/exploration.sqlite` ao S3. Fontes e release permitem reconstruir os
derivados. Não há dados de contas de usuários nesse banco. Caches diários e
respostas F2 são derivados; o cache semanal preparado está na release.

Depois de mudanças no bootstrap Terraform, copie o estado local para o bucket:

```bash
aws s3 cp infra/bootstrap/terraform.tfstate \
  "s3://$FIRECAL_BUCKET/state/bootstrap/local-backup.tfstate" --only-show-errors
aws s3api head-object --bucket "$FIRECAL_BUCKET" --key backups/exploration.sqlite \
  --query '{Bytes:ContentLength,Criptografia:ServerSideEncryption}'
```

O versionamento preserva versões anteriores desses objetos e aumenta o consumo
com o tempo. Não é uma política automática de retenção ilimitada gratuita.
Não faça backup copiando apenas um SQLite aberto e ignorando arquivos WAL.

### Recuperar a aplicação com a release íntegra

Com a EC2/EBS saudáveis, repetir `firecal-deploy.service` reinstala os índices
preparados, fontes, imagens e código da release corrente. Essa é a recuperação
mais simples de cache ausente/corrompido. A API é parada durante a troca do
snapshot. Sem o EBS original, provisione um novo volume/host de forma revisada
e republique usando os objetos S3; o primeiro deploy já testa esse caminho.

### Baixar uma cópia para inspeção sem alterar o servidor

```bash
mkdir -p infra/.release/recovery
aws s3 cp "s3://$FIRECAL_BUCKET/backups/exploration.sqlite" \
  infra/.release/recovery/exploration.sqlite --only-show-errors
../.venv/bin/python - <<'PY'
from pathlib import Path
import sqlite3

path = Path('infra/.release/recovery/exploration.sqlite').resolve()
with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
    assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    print('Fontes no backup:', db.execute('SELECT count(*) FROM sources').fetchone()[0])
PY
```

Para restaurar uma versão antiga, confira sua versão de esquema e fontes
antes de trocar arquivos no host. Prefira restaurar a release correspondente,
que inclui o snapshot, seus hashes e o inventário de fontes. Não misture um
cubo antigo com modelos/fontes diferentes sem revisar a compatibilidade.

## 7. Voltar para uma release anterior

Escolha um manifesto já publicado e confirme seu conteúdo. Em terminal local:

```bash
FIRECAL_RELEASE=ID_DA_RELEASE_ESCOLHIDA
aws s3 cp "s3://$FIRECAL_BUCKET/releases/$FIRECAL_RELEASE/manifest.json" \
  infra/.release/rollback-manifest.json --only-show-errors
# Confira release_id, source_key, images, prepared e hashes antes de continuar.
aws s3 cp infra/.release/rollback-manifest.json \
  "s3://$FIRECAL_BUCKET/releases/current.json" --only-show-errors
aws ssm start-session --target "$FIRECAL_INSTANCE"
```

**Na EC2**, execute `sudo systemctl start firecal-deploy.service` e verifique
o journal e os endpoints públicos. O host instala o snapshot da release
escolhida e confere o inventário. Se as fontes foram alteradas no prefixo
`data/`, a compatibilidade pode falhar; recupere as versões correspondentes
antes. Isso é distinto de um rollback de schema PostgreSQL na variante RDS.

## 8. Pausar e encerrar custos

Parar a EC2 interrompe o custo de computação, mas EBS, IPv4 reservado e S3
continuam cobrando. O site fica fora do ar. Iniciar a mesma EC2 mantém o EIP
e Docker reinicia os containers, desde que o volume esteja montado.

```bash
# Executar somente quando quiser interromper/retomar o site.
aws ec2 stop-instances --instance-ids "$FIRECAL_INSTANCE"
aws ec2 start-instances --instance-ids "$FIRECAL_INSTANCE"
```

Encerrar definitivamente exige decisão separada e backup conferido. O volume
e bucket têm `prevent_destroy`; RDS, se habilitado, tem proteção de exclusão
e snapshot final. Não execute `destroy` nem remova essas proteções como etapa
de teste. Manter o bucket e EBS após desligar a EC2 preserva dados e também
mantém custo. Para zerar esses itens, planeje explicitamente retenção dos
dados/estado, liberação do EIP e exclusão revisada das versões de objetos.

O token SSM DuckDNS só existe se o modo automático foi cadastrado. Nesse caso,
ele é gerenciado fora do Terraform. O modo manual atual não depende dele.
