import { Line } from '@react-three/drei';
import type { Edge } from '@model/types';
import { EDGE_COLOR } from './visuals';
import type { Vec3 } from './layout';
import { heatColor } from '../model/load';

const ASYNC_KINDS = new Set(['async_event', 'webhook_callback', 'pub_sub', 'stream']);

export function Road({
  edge,
  points,
  dim = false,
  heat,
  onSelect,
}: {
  edge: Edge;
  points: Vec3[];
  dim?: boolean;
  heat?: number;
  onSelect?: () => void;
}) {
  if (points.length < 2) return null;
  const hot = !dim && heat !== undefined ? heatColor(heat) : undefined;
  const color = hot ?? EDGE_COLOR[edge.kind];
  const dashed = ASYNC_KINDS.has(edge.kind);
  const base = edge.zoneCrossing ? 0.95 : 0.6;

  return (
    <Line
      points={points}
      color={color}
      lineWidth={dim ? 1 : hot ? 3 : edge.zoneCrossing ? 2.4 : 1.3}
      dashed={dashed}
      dashSize={0.5}
      gapSize={0.3}
      transparent
      opacity={dim ? base * 0.15 : base}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
    />
  );
}
