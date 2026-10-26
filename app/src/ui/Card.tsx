import React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  action,
  children,
  className = '',
  footer,
}) => {
  return (
    <div
      className={cn(
        'bg-surface text-card-foreground rounded-[14px] shadow-[var(--shadow-tint-md)] hover:shadow-[var(--shadow-tint-lg)] transition-shadow duration-200 border-0',
        className
      )}
    >
      {(title || subtitle || action) && (
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between gap-4">
          <div>
            {title && <h3 className="text-sm font-semibold tracking-tight text-foreground font-heading">{title}</h3>}
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-border/40 bg-muted/20 rounded-b-[14px]">{footer}</div>}
    </div>
  );
};
