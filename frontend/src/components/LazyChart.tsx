import { lazy, Suspense } from 'react';
import { Skeleton } from './ui';
const Plot = lazy(() => import('./PlotlyChart'));
export default function LazyChart(props: { data: unknown[]; layout?: Record<string, unknown>; label: string }) {
  return <Suspense fallback={<Skeleton lines={5} />}><Plot {...props} /></Suspense>;
}
