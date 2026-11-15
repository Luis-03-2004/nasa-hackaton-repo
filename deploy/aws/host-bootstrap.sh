#!/bin/bash
# Executado pelo cloud-init; contém referências, nunca valores de segredos.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y ca-certificates curl gnupg unzip python3 nvme-cli
# Ubuntu 24.04 não fornece awscli em todas as revisões da AMI.
if ! command -v aws >/dev/null; then
    cli_staging=$(mktemp -d /var/tmp/firecal-aws-cli.XXXXXX)
    curl -fsSL --retry 3 https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o "$cli_staging/awscliv2.zip"
    unzip -q "$cli_staging/awscliv2.zip" -d "$cli_staging"
    "$cli_staging/aws/install" --update
    rm -rf -- "$cli_staging"
fi

# Identifica somente o volume criado pelo Terraform. Nunca formata um disco por posição.
volume_id=$(python3 -c 'import json; print(json.load(open("/etc/firecal/config.json"))["data_volume_id"].replace("-", ""))')
device=""
for attempt in $(seq 1 180); do
    for candidate in /dev/nvme*n1 /dev/xvdf; do
        [ -b "$candidate" ] || continue
        serial=$(lsblk -dn -o SERIAL "$candidate" | tr -d ' -')
        if [ "$serial" = "$volume_id" ]; then device="$candidate"; break; fi
    done
    [ -z "$device" ] || break
    sleep 5
done
[ -n "$device" ] || { echo 'Volume de dados não encontrado; bootstrap interrompido.' >&2; exit 1; }
filesystem=$(blkid -s TYPE -o value "$device" || true)
if [ -z "$filesystem" ]; then
    # Falha em presença de partições ou assinaturas desconhecidas: não apaga dados existentes.
    [ "$(lsblk -nr -o NAME "$device" | wc -l)" -eq 1 ]
    [ -z "$(wipefs --no-act --noheadings "$device")" ]
    mkfs.ext4 -L firecal-data "$device"
elif [ "$filesystem" != ext4 ]; then
    echo 'Volume existente não é ext4; inspeção manual necessária.' >&2; exit 1
fi
mkdir -p /opt/firecal
uuid=$(blkid -s UUID -o value "$device")
if ! findmnt /opt/firecal >/dev/null; then mount "UUID=$uuid" /opt/firecal; fi
if ! grep -q "UUID=$uuid " /etc/fstab; then
    printf 'UUID=%s /opt/firecal ext4 defaults,nofail 0 2\n' "$uuid" >> /etc/fstab
fi

# Margem para picos analíticos no perfil de 1 GiB, sem consumir créditos Unlimited.
if [ ! -f /opt/firecal/swapfile ]; then
    fallocate -l 3G /opt/firecal/swapfile
    chmod 0600 /opt/firecal/swapfile
    mkswap /opt/firecal/swapfile
fi
if ! swapon --show=NAME --noheadings | grep -Fxq /opt/firecal/swapfile; then
    swapon /opt/firecal/swapfile
fi
if ! grep -q '^/opt/firecal/swapfile ' /etc/fstab; then
    printf '/opt/firecal/swapfile none swap sw,nofail 0 0\n' >> /etc/fstab
fi

# Docker oficial, com imagens/volumes no EBS persistente.
install -m 0755 -d /etc/apt/keyrings /etc/docker /etc/systemd/system/docker.service.d
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
cat > /etc/docker/daemon.json <<'EOF'
{"data-root":"/opt/firecal/docker","log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
EOF
cat > /etc/systemd/system/docker.service.d/firecal.conf <<'EOF'
[Unit]
RequiresMountsFor=/opt/firecal
EOF
apt-get update -q
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Engine 29+ também armazena imagens no containerd; ambos precisam persistir no EBS.
systemctl stop docker.service docker.socket containerd.service
install -d /etc/containerd /etc/systemd/system/containerd.service.d
containerd config default | sed 's|^root = .*|root = "/opt/firecal/containerd"|' > /etc/containerd/config.toml
grep -q '^root = "/opt/firecal/containerd"' /etc/containerd/config.toml
cat > /etc/systemd/system/containerd.service.d/firecal.conf <<'EOF'
[Unit]
RequiresMountsFor=/opt/firecal
EOF
systemctl daemon-reload
systemctl enable --now containerd
systemctl enable --now docker
# A AMI oficial inclui SSM; garante o serviço inclusive em uma AMI customizada compatível.
if systemctl cat amazon-ssm-agent.service >/dev/null 2>&1; then
    systemctl enable --now amazon-ssm-agent.service
else
    if ! command -v snap >/dev/null; then apt-get install -y snapd; fi
    if ! snap list amazon-ssm-agent >/dev/null 2>&1; then snap install amazon-ssm-agent --classic; fi
    snap start --enable amazon-ssm-agent
fi

cat > /etc/systemd/system/firecal-deploy.service <<'EOF'
[Unit]
Description=Publicar release FireCal do S3 e preparar RDS
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service
RequiresMountsFor=/opt/firecal
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/lib/firecal/host_runtime.py deploy
TimeoutStartSec=7200
UMask=0077
EOF
cat > /etc/systemd/system/firecal-duckdns.service <<'EOF'
[Unit]
Description=Atualizar DNS FireCal
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/lib/firecal/host_runtime.py duckdns
UMask=0077
EOF
cat > /etc/systemd/system/firecal-duckdns.timer <<'EOF'
[Unit]
Description=Atualizar DuckDNS a cada cinco minutos
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
if python3 -c 'import json,sys; sys.exit(0 if json.load(open("/etc/firecal/config.json")).get("duckdns_auto_update", False) else 1)'; then
    systemctl enable --now firecal-duckdns.timer
fi
touch /etc/firecal/bootstrap-ready
echo 'Host preparado. Publique os dados e a release usando infra/scripts/deploy.py.'
