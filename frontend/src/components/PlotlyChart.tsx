import { useEffect, useRef, useState } from 'react';

const baseLayout = {
  paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: '#d9dee8', family: 'Inter, system-ui, sans-serif', size: 12 },
  margin: { l: 64, r: 16, t: 24, b: 48 }, legend: { orientation: 'h', y: -0.25 },
  xaxis: { gridcolor: '#26324a' }, yaxis: { gridcolor: '#26324a' }, hovermode: 'x unified',
};

export default function PlotlyChart({ data, layout, label }: { data: unknown[]; layout?: Record<string, unknown>; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    let alive = true;
    setChartError(null);
    import('plotly.js-basic-dist-min').then((mod) => {
      if (!alive || !el) return;
      return mod.default.react(el, data, { ...baseLayout, ...layout }, { responsive: true, displaylogo: false, scrollZoom: false });
    }).catch((error: unknown) => {
      if (alive) setChartError(error instanceof Error ? error.message : 'Chart library failed to load.');
    });
    return () => {
      alive = false;
      if (el) {
        import('plotly.js-basic-dist-min')
          .then((mod) => mod.default.purge(el))
          .catch((error: unknown) => console.error('Could not clean up the chart.', error));
      }
    };
  }, [data, layout]);
  return chartError
    ? <div className="plot-error" role="status">Interactive chart unavailable: {chartError}</div>
    : <div ref={ref} className="plot" role="img" aria-label={label} />;
}
