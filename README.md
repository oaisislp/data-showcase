# Data Visualization Workbench

A Vite + React + Plotly workbench for loading CSV/API data and producing interactive charts with light/dark mode, watermarking, and exports.

## Getting Started

```bash
npm install
npm run dev
```

## Data Sources

### CSV Upload
Use **CSV Upload** to select a local CSV file. The app auto-detects the timestamp column and numeric series, which you can refine in the normalization panel.

### CSV URL
Use **CSV URL** to fetch a CSV file directly from a public URL. Click **Fetch CSV URL** to load it into the workbench.

### Dune CSV
Use **Dune CSV** to load Dune query results via CSV.

1. Enter your **Query ID**.
2. Paste your **API Key** (masked by default with a show/hide toggle).
3. (Optional) Provide a **Dataset Name** for chart defaults.
4. Click **Run Dune CSV**.

**API key persistence**: By default the API key is only kept in memory for the current session. If you enable **Remember API key on this device**, the key is stored in `localStorage` for that query ID. Use **Forget stored API key** to remove it.

> **Security note:** Dune CSV uses an API key in the URL. Avoid enabling “Remember API key on this device” on shared machines.

### HTTP API
Use **HTTP API Adapter** for JSON responses. Provide a JSONPath expression to map results into rows. Optional pagination settings support page/cursor styles.

## Chart Controls

- **Chart title / axis labels** can be customized in **Chart Settings** and are saved per source.
- **Chart type** supports line, area, bar, scatter, and treemap with type-specific style controls.
- **Watermark** images are rendered into the Plotly chart and included in PNG exports.
- **Export PNG** hides the time range slider before rendering the image.
- **Download CSV** outputs only the filtered time range and visible series.

## Manual QA Checklist

- Load the sample CSV via **Load sample/sample.csv**.
- Switch chart types (line, area, bar, scatter, treemap).
- Toggle between light/dark themes (System/Light/Dark).
- Add a watermark and export PNG (confirm the rangeslider is not visible).
- Add a Dune CSV source and chart it.
- Confirm API keys are not persisted unless **Remember API key on this device** is enabled.

## Dark Mode QA Note

To verify dark mode stability:
1. Load a dataset.
2. Switch theme between System, Light, and Dark.
3. Confirm the chart renders without crashing or blanking the UI.
