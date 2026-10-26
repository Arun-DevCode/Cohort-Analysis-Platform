import React from 'react';
import type { SegmentType, MovementType } from '@/types';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className = '' }) => {
  const styles: Record<string, string> = {
    default: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400',
    danger: 'bg-destructive/10 text-destructive border-destructive/20',
    info: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-400',
    neutral: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        styles[variant] || styles.default,
        className
      )}
    >
      {children}
    </span>
  );
};

export const SegmentBadge: React.FC<{ segment: SegmentType }> = ({ segment }) => {
  if (segment === 'High') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-good bg-good-subtle border border-good">
        High (≥80%)
      </span>
    );
  }
  if (segment === 'Medium') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-warn bg-warn-subtle border border-warn">
        Medium (50-79%)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-bad bg-bad-subtle border border-bad">
      Low (&lt;50%)
    </span>
  );
};

export const MovementBadge: React.FC<{ movement: MovementType }> = ({ movement }) => {
  if (movement === 'IMPROVED') {
    return (
      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold text-good bg-good-subtle border border-good">
        <ArrowUpRight className="w-3.5 h-3.5" /> Improved
      </span>
    );
  }
  if (movement === 'DECLINED') {
    return (
      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold text-bad bg-bad-subtle border border-bad">
        <ArrowDownRight className="w-3.5 h-3.5" /> Declined
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold text-muted-foreground bg-secondary border border-border">
      <Minus className="w-3.5 h-3.5" /> Same
    </span>
  );
};

export const DeltaBadge: React.FC<{ delta: number | null }> = ({ delta }) => {
  if (delta === null) {
    return (
      <span className="inline-flex items-center text-xs font-medium text-muted-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded-full">
        Baseline
      </span>
    );
  }
  const formatted = Math.abs(delta).toFixed(1);
  if (delta > 0) {
    return (
      <span className="inline-flex items-center text-xs font-semibold text-good bg-good-subtle border border-good px-2 py-0.5 rounded-full num">
        ▲ +{formatted} pts
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center text-xs font-semibold text-bad bg-bad-subtle border border-bad px-2 py-0.5 rounded-full num">
        ▼ -{formatted} pts
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-xs font-semibold text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded-full num">
      – 0.0 pts
    </span>
  );
};
