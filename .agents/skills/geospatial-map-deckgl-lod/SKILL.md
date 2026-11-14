---
name: geospatial-map-deckgl-lod
description: >-
  Use this skill when building or updating the interactive World Map / Globe component,
  Level-of-Detail (LOD) zoom layers (1deg catalog -> 0.25deg regional -> 1km active cells),
  Bounding Box selection tool, GPS locator, or map tooltips for NASA FireCal Global.
---

# Geospatial Map, Deck.gl & Multi-Resolution LOD Skill

This skill defines how to implement **Panel 1 (Interactive World Heatmap / Globe)** of the NASA FireCal Global dashboard, inspired by `NASA-IMPACT/us-fire-events-tool`, `visgl/deck.gl`, and `keplergl/kepler.gl`.

## 1. Multi-Resolution Level-of-Detail (LOD) Zoom Architecture

To render **26 years (`2000–2025`) of global data (`295.7M` merged `1 km` cells)** smoothly at 60 FPS without overloading the browser or database, switch layers automatically based on `viewState.zoom`:

| Map Zoom Level | Spatial Resolution | Source Dataset / Table | Visual Layer (`deck.gl` / MapLibre) |
| :--- | :--- | :--- | :--- |
| **Zoom `1.0 – 4.5` (World / Continents)** | **$1^\circ \times 1^\circ$ Global Points (`16,525` points in `203` countries)** | `01_catalogo_16527_pontos_mapa_mundi_previsao.parquet` (`forecast_world_points_1deg`) | `ScatterplotLayer` or `ColumnLayer` colored by `obs_t_1km_cells`, `pred_h1_anom_pct`, or `risk_level`. |
| **Zoom `4.5 – 8.0` (Country / Biome — e.g., Brazil)** | **$0.25^\circ \times 0.25^\circ$ Regional Grid (~25 km)** | `parquet_025deg/` (`fire_cells_025deg_weekly`) | `GridCellLayer` or `HeatmapLayer` displaying `active_1km_cells` and `frp_sum`. |
| **Zoom `8.0+` (Local / Municipality / BBox)** | **`1 km × 1 km` (`0.01°`) Physical Merged Cells** | `parquet_1km/` (`fire_cells_1km_weekly`) | High-precision `GridCellLayer` (`cellSize: 1000`) showing exact `1 km` burned cells, `merged_count`, and thermal contrast $\Delta T$. |

## 2. Interactive Selection Modes (Required by `docs/system-design.md`)

Provide 4 ways for the user to select a locality and immediately update Panels 2, 3, and 4:
1. **Click on any $1^\circ \times 1^\circ$ Point or Cell on the Map:** Selects `point_id` (e.g. `pt_-10_-052`), highlights the cell border in `#F97316`, and loads its 4-week forecast ($F_2$) and historical series.
2. **Deep-Dive Preset Chips (Above the Map):**
   - `🌎 Mundo Inteiro`: `{ longitude: 0, latitude: 15, zoom: 1.8 }`
   - `🇧🇷 Brasil (Calibração Completa)`: `{ longitude: -52.0, latitude: -12.0, zoom: 4.2 }`
   - `🔥 Cerrado POC [-48, -14, -44, -10]`: `{ longitude: -46.0, latitude: -12.0, zoom: 6.5 }`
   - `🌲 Arco Amazônico`: `{ longitude: -55.5, latitude: -7.5, zoom: 5.5 }`
   - `🐊 Pantanal`: `{ longitude: -56.8, latitude: -18.5, zoom: 6.5 }`
3. **Bounding Box Drawing Tool (`📐 Desenhar Área / BBox`):** Allows Shift+Drag (or clicking two corners) to filter by `[west, south, east, north]`.
4. **GPS & Coordinate Input (`📍 Meu GPS` / `Lat, Lon`):** Uses `navigator.geolocation.getCurrentPosition` to fly to the user's nearest active $1^\circ \times 1^\circ$ cell in the `16,525`-point catalog.

## 3. Scientific Tooltip Specification (On Hover / Click)

When hovering or clicking a cell/point on the map, render a compact HUD tooltip (`font-mono tabular-nums`) containing:
- **Location:** `country`, `zone` (`trop_sul`, `boreal`, etc.), and center coordinates `(lat_center, lon_center)`.
- **Harmonized Activity (`1 km`):** `obs_t_1km_cells` active `1 km` cells vs. seasonal peak `peak_clim_1km_cells`.
- **Physical 1 km Merge Telemetry:**
  - `obs_t_merged_count` (exact sub-pixel hotspots merged into the `1 km` grid)
  - `obs_t_frp_sum_mw` (total radiative power in `MW`, plus mean FRP per hotspot `frp_sum / merged_count`)
  - `obs_t_bright_max_k` (~4 µm flame peak in `K`) & `obs_t_delta_t_k` ($\Delta T = T_{4\mu\text{m}} - T_{11\mu\text{m}}$ in `K`)
- **Short-Term Forecast ($F_2$, `t+1 sem.`):** `pred_h1_1km_cells` (`pred_h1_anom_pct%`) and `risk_level` badge (`NORMAL`, `ATENCAO`, `CRITICO`).
