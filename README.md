# NASA FireCal Global

Exploração global de observações MODIS/VIIRS de 2000 a 2025, com mapas 2D/3D,
calendário histórico, comparação entre anos, filtros, multisseleção, CSV,
PT-BR/EN e projeções experimentais F₂ com referência histórica.

**Sistema publicado:** https://firecalglobal.duckdns.org

O ambiente AWS econômico usa EC2 `t3.micro`, SQLite no EBS e S3 privado, com
frontend estático e HTTPS no Caddy. RDS é opcional e está desativado. O custo
recorrente estimado é aproximadamente US$ 15/mês antes de tráfego, impostos,
créditos e variação do armazenamento.

- [Provisionar a infraestrutura e publicar o sistema](infra/README.md).
- [Operar, atualizar, recuperar e encerrar o ambiente](infra/OPERACAO.md).
- [Custos, limites e alternativas de banco](infra/CUSTOS.md).
- [Registro da implantação e verificações realizadas](docs/relatorios/implantacao-aws-economica.md).
- [Executar localmente](LOCAL.md).
- [API e dados](backend/README.md).
- [Método e limitações do F₂](docs/F2_REFERENCIA_COMUM.md).

Os dados científicos, credenciais e estado Terraform não ficam no Git. O
repositório contém código, infraestrutura, exemplos de configuração e guias.
Enviar um commit para `main` e publicar uma release na EC2 são operações
separadas; o procedimento de publicação está no guia AWS.
