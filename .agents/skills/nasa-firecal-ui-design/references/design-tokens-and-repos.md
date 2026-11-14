# Reference: Open-Source Repositories & Design Tokens for NASA FireCal Global

## 1. Benchmark Open-Source Repositories

| Repository | URL | What to Adopt in NASA FireCal Global |
| :--- | :--- | :--- |
| **`NASA-IMPACT/us-fire-events-tool`** | `https://github.com/NASA-IMPACT/us-fire-events-tool` | Floating glassmorphic HUD panels over a dark `deck.gl` + MapLibre canvas, temporal scrubber bar, active fire pixel inspector, and Zustand state synchronization between map and charts. |
| **`NASA-IMPACT/veda-ui`** | `https://github.com/NASA-IMPACT/veda-ui` | Scientific dataset metadata badges, accessible colorblind-safe legend bars, and comparison toggles between baseline climatology and observed anomalies. |
| **`visgl/deck.gl`** | `https://github.com/visgl/deck.gl` | GPU-accelerated `ScatterplotLayer`, `GridCellLayer`, and `HeatmapLayer` for rendering `16,525` global $1^\circ \times 1^\circ$ points and `0.25°` / `1 km` cells at 60 FPS. |
| **`keplergl/kepler.gl`** | `https://github.com/keplergl/kepler.gl` | Level-of-Detail (LOD) viewport zoom transitions, bounding-box selection overlay, and dark cartographic basemap (`Carto Dark Matter`). |
| **`uiwjs/react-heat-map`** | `https://github.com/uiwjs/react-heat-map` | SVG matrix heatmap architecture for the `2000–2025` (`26 years × 12 months` / `52 weeks`) Multi-Year Burning Calendar. |
| **`anthropics/skills` (`frontend-design`)** | `https://github.com/anthropics/skills` | Anti-"AI slop" guardrails: tabular monospace numbers (`JetBrains Mono`), purposeful motion (`prefers-reduced-motion`), and high-density scientific Bento layout. |

## 2. CSS Variables & Tailwind Tokens

```css
:root {
  --bg-canvas: #070B12;
  --bg-panel: rgba(15, 22, 35, 0.88);
  --bg-card: rgba(30, 41, 59, 0.65);
  --border-subtle: rgba(148, 163, 184, 0.16);
  --border-active: rgba(249, 115, 22, 0.55);

  --text-primary: #F8FAFC;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;

  /* Sensor Colors */
  --sensor-modis: #38BDF8;
  --sensor-viirs-snpp: #F97316;
  --sensor-viirs-jpss1: #A855F7;
  --series-harmonized: #10B981;

  /* Alert Levels (Model F2) */
  --risk-normal: #10B981;
  --risk-atencao: #F59E0B;
  --risk-critico: #EF4444;
}
```
