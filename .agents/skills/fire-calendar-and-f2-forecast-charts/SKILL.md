---
name: fire-calendar-and-f2-forecast-charts
description: >-
  Use this skill when implementing or improving the 3 analytical chart panels of NASA FireCal Global:
  (1) Local 1-to-4-week Multivariate Forecast F2 chart (Panel 2),
  (2) Multi-Year 2000-2025 Burning Calendar Heatmap Matrix (Panel 3), and
  (3) 26-Year Harmonized Time Series & Sensor Comparison MODIS vs VIIRS (Panel 4).
---

# Fire Calendar Heatmap, Sensor Harmonization & $F_2$ Forecast Charts Skill

This skill specifies the exact data bindings, mathematical formulas, and interactive behaviors for **Panels 2, 3, and 4** of the NASA FireCal Global frontend, backed by our verified `2000–2025` pipeline outputs in `data/global_1km_2000_2025/entrega_drive_equipe/`.

## 1. Panel 2 — Differential: Short-Term Local Forecast (`t+1` to `t+4` Weeks, Model $F_2$)

Backed by `01_catalogo_16527_pontos_mapa_mundi_previsao.csv` / `.parquet` and `04_pesos_e_metricas_modelo_multivariado_f2.json`:

1. **Header & Operational Alert Badge:**
   - Display selected locality (`point_id`, `country`, `lat_center`, `lon_center`, climate `zone`).
   - Render `risk_level` badge:
     - `NORMAL` $\rightarrow$ Emerald badge (`🟢 Dentro da Climatologia Sazonal`)
     - `ATENCAO` $\rightarrow$ Amber badge (`🟡 Atenção: Acima do P75 Sazonal ou +10%`)
     - `CRITICO` $\rightarrow$ Red pulsing badge (`🔴 Alerta Crítico: Acima do P90 Sazonal e +15%`)
2. **Dual-Quantity Forecast Display (Absolute `1 km` Cells + Percentage `%`):**
   - For each horizon `h = 1, 2, 3, 4` weeks (`t+1 sem.` to `t+4 sem.`), display BOTH:
     - **Predicted active `1 km` cells:** `pred_h1_1km_cells` .. `pred_h4_1km_cells`
     - **Predicted seasonal anomaly percentage:** `pred_h1_anom_pct` .. `pred_h4_anom_pct` (e.g., `+24.5% vs. média histórica da semana`)
3. **Physical Feature Drivers Bar (Why is $F_2$ predicting this?):**
   - Show the 4 physical modifiers extracted from the `1 km` merge at week $t$:
     - **Potência Radiativa (`FRP`):** `obs_t_frp_sum_mw` MW
     - **Contraste Térmico da Chama ($\Delta T$):** `obs_t_delta_t_k` K (`obs_t_bright_max_k` vs. `obs_t_bright_bg_k`)
     - **Densidade Sub-pixel:** `obs_t_merged_count / obs_t_1km_cells` focos de 375 m por célula de 1 km
   - Show the verified out-of-sample validation badge:
     - **Brasil (`t+1 sem.`):** `Skill Score +29,47% vs. Climatologia F0 | r = 0,9349 | MAE = 1.303,9 células 1km`
     - **Global (`t+1 sem.`):** `Skill Score +25,71% vs. Climatologia F0 | r = 0,9123 | MAE = 7.780,4 células 1km`

## 2. Panel 3 — Multi-Year Burning Calendar Heatmap (`2000–2025`, 26 Years)

Backed by `02_calendario_harmonizado_mensal_2000_2025.csv` (`2,184` rows across `global`, `brazil`, `trop_sul`, `trop_norte`, `temp_sul`, `temp_norte`, `boreal`):

1. **Matrix Layout:**
   - **Rows:** Years `2000` through `2025` (26 rows) + a pinned bottom summary row **`Média Climatológica (2003–2023)`** (`clim_mean_2003_2023`).
   - **Columns:** 12 Months (`Jan` to `Dez`).
2. **Three Metric Modes (Toggle Switch):**
   - **Modo 1 — Intensidade Harmonizada (`harmonized_1km_cells`):** Sequential accessible YlOrRd ramp.
   - **Modo 2 — Anomalia Percentual (`anomaly_pct`):** Diverging Blue $\rightarrow$ Slate $\rightarrow$ Amber $\rightarrow$ Red ramp showing `%` above/below the `2003–2023` monthly baseline.
   - **Modo 3 — Anomalia Padronizada (`anomaly_zscore`):** Shows standard deviations ($Z = \frac{H - \mu}{\sigma}$), immediately highlighting extreme drought/fire years like `2024`.
3. **Interactive Cross-Filtering:**
   - Clicking any `(year, month)` cell in the calendar filters the World Map and highlights that period on the 26-year time series.

## 3. Panel 4 — 26-Year Harmonized Time Series & Multi-Sensor Audit (`2000–2025`)

Backed by `resultado_global_2000_2025.json` and `05_resumo_auditoria_global_2000_2025.json`:

1. **View Mode A — Unified Harmonized Series (`2000–2025`):**
   - Plots the continuous 26-year harmonized `1 km` curve alongside the `2003–2023` climatological band.
   - Includes vertical milestone annotations:
     - `Jul/2002`: Entrada do **MODIS Aqua** (início da linha de base climatológica `2003–2023`).
     - `Jan/2012`: Entrada do **VIIRS S-NPP (375 m)** — harmonizado por fusão física em `1 km` + calibração sazonal $\alpha_{z,m}$.
     - `Jan/2018`: Entrada do **VIIRS JPSS-1 / NOAA-20 (375 m)**.
2. **View Mode B — Sensor Audit (Raw Unmerged vs. `1 km` Merged vs. Calibrated $M_2$):**
   - Demonstrates why naive summation fails and how our two-stage pipeline solves it:
     - **Stage 1 (Physical `1 km` Merge):** Reduces `548,501,203` raw detections to `295,748,529` active `1 km` cells (**`-46.08%` global reduction**, **`-53.2%` on VIIRS**).
     - **Stage 2 (Seasonal Calibration $M_2$):** Reduces VIIRS vs. MODIS MAE in the `2025` holdout by **`-97.87%` globally** (`223,950.6` $\rightarrow$ `4,763.3`) and **`-95.88%` in Brazil** (`19,266.3` $\rightarrow$ `793.5`).
