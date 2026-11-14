---
name: nasa-firecal-ui-design
description: >-
  Use this skill when designing, building, styling, or refactoring UI/UX components,
  layouts, themes, typography, or color palettes for the NASA FireCal Global (2000-2025)
  frontend in React, Next.js, or Vite + Tailwind CSS. Combines docs/system-design.md
  with NASA-IMPACT/veda-ui and anthropics/skills frontend-design principles.
---

# NASA FireCal Global — Scientific UI/UX & Frontend Design Skill

This skill enforces the visual architecture, layout hierarchy, color science, and NASA compliance rules for **NASA FireCal Global — Harmonized Burning Activity Calendar & Local Forecast (MODIS + VIIRS 2000–2025)**.

## 1. Open-Source Reference Repositories to Emulate

Always align component patterns with these benchmark repositories (detailed in [references/design-tokens-and-repos.md](./references/design-tokens-and-repos.md)):
1. **`NASA-IMPACT/veda-ui`** (`https://github.com/NASA-IMPACT/veda-ui`): NASA's official Earth observation dashboard UI patterns, temporal scrubbers, scientific metadata cards, and layer switchers.
2. **`NASA-IMPACT/us-fire-events-tool`** (`https://github.com/NASA-IMPACT/us-fire-events-tool`): NASA's React + TypeScript + `deck.gl` + Recharts active fire monitoring interface.
3. **`anthropics/skills` (`frontend-design`)**: Intentional typography, high-contrast obsidian scientific surfaces, disciplined color tokens, and zero generic "AI slop" (no random purple gradients, no unstyled tables, no generic marketing hero sections).

## 2. Mapping to the Existing Codebase (`frontend/src/`) & Gaps to Fix

The current `frontend/` uses **React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + `@react-three/fiber` (`Three.js`) + `Recharts` + `lucide-react`**. When improving the UI, target these exact files:

| Component / File in `frontend/src/` | Current State on `main` | Required Upgrade per `docs/system-design.md` |
| :--- | :--- | :--- |
| `screens/Dashboard.tsx` | 3-column layout (`lg:grid-cols-3`) with Globe/Map on the left (2/3) and only `Header` + `SeriesChart` in the right sidebar. **`ForecastChart` and `downloadSeriesCsv` exist in `src/` but are NOT rendered!** | Render `ForecastChart` in the right sidebar (or Bento grid), wire up the CSV export button (`utils/csv.ts`), and allow viewing the Multi-Year `Heatmap` (`2000–2025`) without losing the Globe view. |
| `components/layout/Header.tsx` | Has `3D map / 2D map / Heat map` toggle, a single `date` input (`2020–2025`), and a dummy `Future forecast` text input (`onForecastSubmit={() => undefined}`). | Replace dummy text input with **Deep-Dive Region/Biome Chips** (`Global`, `Brazil`, `Cerrado`, `Amazonia`, `Pantanal`), `Lat, Lon` / `BBox` selector, **`📍 My GPS`** button, **`2000–2025` range**, and **`⬇ Export CSV`** button. |
| `components/charts/ForecastChart.tsx` | Built with Recharts `ComposedChart` (`Observed`, `Forecast`, `Climatology`, `P10–P90`), but not mounted in `Dashboard.tsx` and has hardcoded `-68.2%` Backtest MAE. | Mount in `Dashboard.tsx`, display both **predicted `1 km` cells (`pred_h1..h4_1km_cells`)** and **predicted `%` (`pred_h1..h4_anom_pct`)**, physical drivers (`FRP`, $\Delta T$, `merged_count`), and verified Model $F_2$ metrics (`+29.47%` skill in Brazil, `-97.87%` harmonization MAE reduction). |
| `services/fireApi.ts` & `hooks/useGlobeHotspots.ts` | Reads static `/mocks/fire-data.json` (2020–2025) and 5 hardcoded hotspots in `GLOBE_HOTSPOTS`. | Connect to the real `2000–2025` harmonized dataset (`16,525` global $1^\circ \times 1^\circ$ points from `catalogo_pontos_globais_previsao` and `/observations/area` from FastAPI backend). |

## 3. Layout Architecture: 5-Panel Geospatial Bento Grid (`docs/system-design.md`)

Structure the application as a **full-viewport Scientific Command HUD** (`min-h-screen bg-[#070B12] text-[#F1F5F9]`):

1. **Global Navigation & Filter Header (Top Bar):**
   - **Global Region Selector:** Country search (`203` countries), `Lat, Lon` / `Bounding Box` (`West, South, East, North`) inputs, **`📍 Meu GPS`** button, and instant **Deep-Dive Chips**:
     - `🌎 Mundo Inteiro (Global 2000–2025)`
     - `🇧🇷 Brasil (Calibração Alta Resolução)`
     - `🔥 Cerrado POC [-48, -14, -44, -10]`
     - `🌲 Arco Amazônico`
     - `🐊 Pantanal`
   - **Temporal & Regime Controls:** Year range (`2000–2025`), Day (`D`) / Night (`N`) filter, and primary mode switch: **`Índice Harmonizado 1 km`** vs. **`Comparar Sensores (MODIS vs. S-NPP vs. JPSS-1)`**.
   - **Action CTA:** **`⬇ Baixar CSV Harmonizado (.csv)`**.
2. **Panel 1 (Top-Left, 60% width on desktop) — Interactive World Heatmap / Globe:**
   - Multi-resolution zoom (`1° × 1°` 16,525 forecast points $\rightarrow$ `0.25°` regional blocks $\rightarrow$ `1 km` active cells) with Bounding Box drawing tool and accessible legend.
3. **Panel 2 (Top-Right, 40% width) — Differential: Local 1-to-4-Week Forecast ($F_2$):**
   - Selected locality header + Alert Badge (`🟢 NORMAL`, `🟡 ATENÇÃO`, `🔴 CRÍTICO`), `t-6..t` observed vs. `t+1..t+4` Ridge $L_2$ projection with `[P10, P90]` band, and physical feature drivers (`FRP`, $\Delta T$, `night_ratio`, `merged_count`).
4. **Panel 3 (Bottom-Left, 50% width) — Multi-Year Burning Calendar Heatmap (`2000–2025`):**
   - `26 years × 12 months` (and `52 ISO weeks`) matrix + `Média Climatológica (2003–2023)` baseline row, toggling between **Harmonized Intensity** and **Anomaly (`%` / `Z-score`)**.
5. **Panel 4 (Bottom-Right, 50% width) — 26-Year Harmonized Time Series & Sensor Audit:**
   - Continuous `2000–2025` curve showing how seasonal calibration ($M_2$) eliminates the artificial jump when VIIRS S-NPP (`2012`) and JPSS-1 (`2018`) enter orbit (**-97.87% MAE reduction globally**, **-95.88% in Brazil**).

## 3. Typography & Color Guardrails

- **Typography:**
  - **Headings / HUD Titles:** `Space Grotesk` or `Plus Jakarta Sans` (`tracking-tight`, `font-semibold`).
  - **All Numbers, Coordinates, Dates, Metrics (`MAE`, `FRP`, `Kelvin`, `%`):** MUST use a monospace font (`JetBrains Mono` or `IBM Plex Mono`) with `font-variant-numeric: tabular-nums` (`tabular-nums` in Tailwind) so tables and tooltips never jitter when scrubbing time or hovering the map.
- **Color System (Colorblind-Safe Scientific Ramps):**
  - **Canvas & Surfaces:** Deep Obsidian `#070B12`, Panel `#0F1623/90` with `backdrop-blur-md` and `border-slate-800/80`.
  - **Intensity Ramp (YlOrRd / Inferno Accessible):** `#1E293B` (0) $\rightarrow$ `#FEF08A` $\rightarrow$ `#FDBA74` $\rightarrow$ `#FB923C` $\rightarrow$ `#EF4444` $\rightarrow$ `#991B1B` (Extreme).
  - **Diverging Anomaly Ramp (`anomaly_pct` / `zscore`):** `#0284C7` (Below normal) $\rightarrow$ `#334155` (Normal `0%`) $\rightarrow$ `#F59E0B` (`+25%`) $\rightarrow$ `#DC2626` (`>+50%`).
  - **Sensor Identity Colors:** MODIS = `#38BDF8` (Sky Cyan), VIIRS S-NPP = `#F97316` (Amber Orange), VIIRS JPSS-1 = `#A855F7` (Violet), Harmonized Index = `#10B981` (Emerald) or `#F43F5E` (Crimson).

## 4. Mandatory NASA & Scientific Transparency Rules

Every view must respect these verified rules:
1. **Zero vs. No Data:** Explicitly state in calendar/map legends: *"0 = sem detecção registrada nos arquivos FIRMS (não comprova ausência de fogo ou céu sem nuvens); 1 pixel ≠ 1 incêndio único."*
2. **Forecast Attribution:** Never label $F_2$ predictions as *"Official NASA Forecast"*. Always display: *"Projeção experimental do Modelo Estatístico Multivariado $F_2$ da equipe sobre dados históricos NASA FIRMS (2000–2025)."*
3. **Credits:** Include data credit to **NASA FIRMS / EOSDIS** (`MODIS C6.1`, `VIIRS 375m`) and challenge photo credit to **CONAE (Argentina)**. Never place the official NASA Meatball/Worm logo on AI/model outputs.
