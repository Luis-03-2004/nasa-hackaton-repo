# Correção do histórico e dos ícones — revisão da main

## Diagnóstico

A main foi atualizada por fast-forward de `d755c6a` para `ebd740e`, preservando
os quatro commits da equipe: assistente BAT, calendário Ano–Mês–Dia, projeção F₂
no mapa e otimizações do backend. O site publicado foi inspecionado com
Playwright/Chrome antes das alterações.

A abertura sem filtros compartilhados enviava `2025-10-01` a `2025-12-31`,
retornando apenas três meses. Não houve perda da base na AWS: a API respondeu
com os 48 arquivos preparados e, na consulta mensal de 2000–2025, **312 períodos
e 295.748.529 registros**. Consultas de 2000, 2012, 2024 e 2025 também retornaram
os respectivos históricos. Esses registros são contribuições de célula × mês
× semana × sensor; não representam incêndios únicos.

## Alterações

- Abertura padrão restaurada para `2000-01-01` a `2025-12-31`. Filtros explícitos
  de URLs compartilhadas continuam sendo respeitados.
- Emojis dos controles substituídos por SVG do `lucide-react`, incluindo GPS,
  calendário, alertas, projeção, mapas e fechamento do assistente/informações.
  Cores dos alertas, traduções PT-BR/EN e rampa branco–amarelo–laranja–vermelho
  foram preservadas.
- Selecionar um ano fora do filtro no calendário consulta o ano escolhido,
  preservando país, células e sensores. Meses excluídos pelo filtro são indicados.
- O calendário diário distingue observações originais de estimativas derivadas
  de totais mensais ou semanais. `null` continua significando ausência de dados,
  sem virar zero nos tooltips. Janeiro–outubro de 2000 permanecem ausentes na base.
- Falhas de carregamento diário aparecem na interface; respostas canceladas
  não substituem o período escolhido.
- A preparação das tabelas rápidas F₂ passou a usar locks de thread e arquivo,
  com nova verificação após adquirir o lock. Isso evita construções concorrentes
  sobre o mesmo SQLite. Na EC2, `FIRE_REQUIRE_PREPARED_CACHE=1` exige índices
  completos e retorna 503 se estiverem indisponíveis, sem reconstruí-los na micro.
  As fórmulas, pesos e cálculos do modelo da equipe foram preservados.

Durante o teste local, a versão anterior permitiu reconstruções concorrentes
das tabelas rápidas e danificou somente o cache derivado. A cópia problemática
foi preservada em `data/global_1km_2000_2025/web_v2/diagnostico_cache/`; um novo
cache foi gerado a partir dos Parquet existentes. Nenhum original foi alterado.
A produção tinha snapshot preparado e continuou saudável durante essa etapa.

## Validação e reprodução

A partir de `nasa-hackaton-repo`:

```bash
cd backend
../../.venv/bin/python -m unittest discover -s tests -q
cd ../frontend
npm run build
npm run lint
cd ..
```

A suíte Python contém **57 testes**: 53 passaram e quatro foram pulados por
pré-requisitos externos. Os testes novos verificam ausência versus zero,
metadados de estimativa e preparação simultânea com seis threads e três
processos. O build e o lint passaram; permanecem avisos de lint em componentes
existentes e o aviso de tamanho do bundle WebGL.

Com API e frontend disponíveis, execute os testes do navegador. Playwright e
Chrome podem ser fornecidos pelo ambiente, sem instalação no projeto:

```bash
FIRECAL_URL=http://127.0.0.1:5173 \
PLAYWRIGHT_MODULE=/caminho/para/node_modules/playwright \
CHROME_BIN=/usr/bin/google-chrome \
node scripts/verificar_historico_icones.cjs

FIRECAL_URL=http://127.0.0.1:5173 \
PLAYWRIGHT_MODULE=/caminho/para/node_modules/playwright \
CHROME_BIN=/usr/bin/google-chrome \
node scripts/verificar_interface.cjs
```

A primeira suíte cobre abertura com 26 anos/312 meses, CSV, seleção de 2024
partindo de 2025, dias ausentes/estimados, ícones, PT-BR/EN, filtros
compartilhados, projeção no mapa e abertura do assistente. A segunda cobre
país, mapa 2D/3D, zoom, comparação de anos, seleção Shift de múltiplas células,
CSV e tela móvel. A seleção Shift inclui as células visíveis na câmera;
`processed_count` deve corresponder a `selected_count`.

As duas suítes passaram no build local, sem erros JavaScript ou HTTP. No teste
Shift, as 107 células selecionadas foram processadas, com total de 3.047
registros no recorte de teste.

## Publicação

A atualização utiliza `infra/scripts/deploy.py --skip-data`, snapshots
preparados localmente, imagens AMD64, S3 e SSM. Mantém a EC2 micro, SQLite,
volumes e demais recursos atuais; não cria RDS nem amplia a infraestrutura.
O runtime instalado na EC2 foi alinhado ao `host_runtime.py` da main, com
verificação SHA-256 e cópia anterior preservada, para conservar as configurações
privadas do novo assistente durante a publicação.

Para validar o endereço publicado, substitua `FIRECAL_URL` por
`https://firecalglobal.duckdns.org`. Os detalhes de operação e retorno à versão
anterior continuam em [OPERACAO.md](../../infra/OPERACAO.md).
