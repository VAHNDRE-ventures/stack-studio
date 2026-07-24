import { DollarSign, Route, Hammer, ShieldCheck, Palette, type LucideIcon } from 'lucide-react';
import type { Lens } from '../store';

/** The single source of truth for the icon-rail lenses (order = rail order). */
export const LENSES: { id: Lens; label: string; Icon: LucideIcon }[] = [
  { id: 'cost', label: 'Cost foresight', Icon: DollarSign },
  { id: 'flow', label: 'Trace a flow', Icon: Route },
  { id: 'build', label: 'Build progress', Icon: Hammer },
  { id: 'overlay', label: 'Compliance scopes', Icon: ShieldCheck },
  { id: 'legend', label: 'Legend', Icon: Palette },
];
