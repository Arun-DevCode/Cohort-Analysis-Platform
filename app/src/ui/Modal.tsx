import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const widthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-[520px]',
    xl: 'max-w-2xl',
    '2xl': 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={cn(
          'w-full bg-card text-card-foreground rounded-[20px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.25)] border border-border/70 overflow-hidden transform transition-all max-h-[90vh] flex flex-col',
          widthClasses[maxWidth]
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between shrink-0 bg-surface/50">
          <div>
            <h2 id="modal-title" className="text-base font-semibold text-foreground font-heading tracking-tight">
              {title}
            </h2>
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground w-8 h-8 rounded-full hover:bg-muted/80 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};
