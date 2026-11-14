# Resumo da Sessão, Catálogo de Arquivos Base e Plano de Integração Web (`nasa-hackaton-repo`)

Este documento consolida **tudo o que foi construído, auditado e validado** na base global de `1 km` (`2000–2025`), lista **todos os arquivos base (dados, pesos do modelo e scripts)** e detalha o **plano técnico passo a passo** para conectar esses dados e o Modelo Multivariado $F_2$ ao **Backend (FastAPI)** e ao **Frontend (React + Three.js + Recharts)** do repositório [nasa-hackaton-repo](file:///home/marcosviniciusdealmeida/Documentos/hackaton-nasa/nasa-hackaton-repo).

---

## 1. Resumo Executivo do que foi Construído e Validado na Sessão

| Pilar Técnico | Escopo Processado | Resultado Alcançado e Auditado | Script Fonte |
| :--- | :--- | :--- | :--- |
| **1. Merge Físico Global em `1 km` (`0,01°`)** | **48 arquivos `all_countries.zip` (`2000–2025`, 26 anos, 203 países)**<br>• `MODIS` (`2000–2025`)<br>• `VIIRS S-NPP` (`2012–2025`)<br>• `VIIRS JPSS-1` (`2018–2025`) | • **Linhas brutas:** `548.501.203`<br>• **Linhas válidas (vegetação/confiança):** `461.501.234`<br>• **Células-semana únicas de `1 km`:** **`295.748.529`** (**`-46,08%` de redução global**; **`-53,2%` no VIIRS**)<br>• Preserva `merged_count`, `pass_count`, `frp_sum`, `frp_max`, `bright_max`, `bright_mean`, `bright_bg_mean`, `bright_bg_min`, `day_count`, `night_count`, `high_conf_count`. | `scripts/merge_global_1km.py` |
| **2. Harmonização Multissensor (`M2`) e Calendário Plurianual (`2000–2025`)** | Mundo inteiro, Brasil e 5 Zonas Climáticas Latitudinais (`trop_sul`, `trop_norte`, `temp_sul`, `temp_norte`, `boreal`) | • Calibração sazonal $\alpha_{z, m}$ em `2012–2023`, validação em `2024` e *holdout* cego em `2025`.<br>• **Redução de MAE entre VIIRS e MODIS (Holdout 2025):** **`-97,87%` no Mundo** (`223.950,6` $\rightarrow$ `4.763,3`) e **`-95,88%` no Brasil** (`19.266,3` $\rightarrow$ `793,5`).<br>• Linha de base climatológica em `2003–2023` (era completa MODIS Terra + Aqua). | `scripts/harmonizar_e_prever_global.py` |
| **3. Modelo Multivariado Físico de Previsão ($F_2$ — Ridge $L_2$) e Mapa-Múndi** | **16.525 pontos terrestres de $1^\circ \times 1^\circ$ em 203 países** para horizontes de `t+1` a `t+4` semanas | • Regressão Ridge $L_2$ com restrição física *active-set* ($w_{3..6} \ge 0$) sobre **6 variáveis físicas do Merge de `1 km`** (`anom_t`, `anom_tm1`, `frp_intensity_anom`, `thermal_contrast_anom` $\Delta T$, `night_ratio_anom`, `subpixel_density_anom`).<br>• **Skill Score vs. Climatologia $F_0$ (`t+1 sem.`, 2024–2025):** **`+29,47%` no Brasil** ($r = 0,9349$, $\text{MAE} = 1.303,9$) e **`+25,71%` no Mundo** ($r = 0,9123$, $\text{MAE} = 7.780,4$). | `scripts/treinar_previsao_multivariada_global.py` |
| **4. Revisão Científica e Conformidade NASA** | Auditoria linha a linha pelo agente Cientista de Dados + Verificador NASA | • Filtragem da semana bissexta ISO 53 nas séries de 52 semanas.<br>• Consistência 100% entre climatologia local (`2012–2023`) e inferência (`2024–2025`) nos `16.525` pontos.<br>• Parecer oficial de permissão de uso de IA/ML e texto de *AI Disclosure* pronto para submissão. | `docs/relatorios/metricas-validacao-e-resultados-modelo.md` e `docs/relatorios/verificacao-regras-ia-space-apps.md` |

---

## 2. Catálogo Completo dos Arquivos Base para a Integração Web

Todos os arquivos derivados estão prontos em `../data/global_1km_2000_2025/`:

| Arquivo Base | Caminho Relativo à Raiz do Projeto | Tamanho | O que contém e onde entra na Integração Web |
| :--- | :--- | :---: | :--- |
| **1. Base Global `1 km` (48 Parquets)** | `data/global_1km_2000_2025/parquet_1km/{sensor}/{sensor}_{year}_1km.parquet` | `4,09 GB` | `295.748.529` células-semana de `1 km` (`2000–2025`). **O script `backend/app/ingest.py` já possui exatamente as mesmas 19 colunas (`SOURCE_COLUMNS`) para ingerir esses Parquets no PostgreSQL!** |
| **2. Base Regional `0,25°` (48 Parquets)** | `data/global_1km_2000_2025/parquet_025deg/{sensor}/{sensor}_{year}_025deg.parquet` | `678 MB` | `44.398.077` blocos regionais de $0,25^\circ$ (~25 km) com `active_1km_cells` e `frp_sum`. |
| **3. Catálogo de 16.525 Pontos do Mapa-Múndi (Parquet e CSV)** | `data/global_1km_2000_2025/previsao_mapa_mundi/catalogo_pontos_globais_previsao.parquet`<br>`data/global_1km_2000_2025/entrega_drive_equipe/01_catalogo_16527_pontos_mapa_mundi_previsao.csv` | `434 KB`<br>`1,7 MB` | Os **16.525 pontos terrestres de $1^\circ \times 1^\circ$ em 203 países** com coordenadas, país, zona, `obs_t_1km_cells`, `obs_t_frp_sum_mw`, `obs_t_delta_t_k`, previsões `pred_h1..h4_1km_cells`, `pred_h1..h4_anom_pct` e `risk_level`. |
| **4. Pesos e Métricas do Modelo Multivariado $F_2$ (JSON)** | `data/global_1km_2000_2025/previsao_mapa_mundi/modelo_multivariado_global_f2.json` | `110 KB` | Pesos aprendidos $w_1..w_6$ por zona climática (`global`, `brazil`, `trop_sul`, `trop_norte`, `temp_sul`, `temp_norte`, `boreal`), métricas de *backtest* e Top Hotspots. |
| **5. Séries Históricas e Fatores de Harmonização `2000–2025` (JSON)** | `data/global_1km_2000_2025/experimento_2000_2025/resultado_global_2000_2025.json` | `212 KB` | Fatores sazonais $\alpha_{z, m}$, séries anuais e mensais harmonizadas de `2000 a 2025` e métricas de harmonização ($M_1, M_2$). |
| **6. Calendário Mensal Harmonizado `2000–2025` (CSV)** | `data/global_1km_2000_2025/entrega_drive_equipe/02_calendario_harmonizado_mensal_2000_2025.csv` | `102 KB` | `2.184` linhas (`26 anos × 12 meses × 7 escopos`) com `harmonized_1km_cells`, `clim_mean_2003_2023`, `anomaly_pct` e `anomaly_zscore`. |

---

## 3. Plano de Integração Backend + Frontend no `nasa-hackaton-repo`

1. **Backend (`backend/app/`):**
   * Proteger `date.fromisocalendar(year, min(52, iso_week), 1)` em `backend/app/ingest.py` para registros da semana ISO 53.
   * Adicionar `CORSMiddleware` em `backend/app/main.py`.
   * Expor endpoints `/catalog`, `/world-points` e `/forecast/location` servindo o catálogo de `16.525` pontos, as séries `2000–2025` e a inferência dinâmica do Modelo $F_2$.
2. **Frontend (`frontend/src/`):**
   * Montar o componente `ForecastChart.tsx` em `screens/Dashboard.tsx` (atualmente criado mas não importado no Dashboard).
   * Ligar o botão de exportação CSV (`utils/csv.ts`) no `Header.tsx`.
   * Substituir os dados mockados em `public/mocks/fire-data.json` e `hooks/useGlobeHotspots.ts` pelas séries reais `2000–2025` e pelos pontos reais do modelo $F_2$, mantendo sincronia ao clicar em qualquer país ou ponto do Globo 3D / Mapa 2D.

---

## Integração local implementada — 14/11/2026

O plano acima foi usado como ponto de partida. A implementação e os comandos de execução estão em [LOCAL.md](LOCAL.md) e [backend/README.md](backend/README.md). Inicie com `./iniciar_local.sh` na raiz Web.

A inspeção direta corrigiu premissas do plano: os históricos exportados são mensais, o snapshot F₂ usa semanas de referência variáveis de 2025 e o gerador legado usa imputações físicas sem máscara por ponto. Não há histórico local nem intervalos exportados no catálogo. Essas condições são explícitas nos contratos e na interface; não foram inventadas séries semanais, previsões atuais ou bandas de incerteza.

O modo local lê os Parquet sem PostgreSQL; o SQL continua configurável para a próxima migração. Mapas, seleção de pontos/coordenadas, calendário, histórico, CSV e consultas reais por área e sensor foram conectados à API. O tratamento de datas usa ano calendário e mês para resolver as viradas ISO, preservando semanas 53 válidas.
