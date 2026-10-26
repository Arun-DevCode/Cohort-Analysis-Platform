import * as React from 'react';
import { cn } from '@/lib/utils';

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, size = 'md', ...props }, ref) => {
    const sizeClasses = {
      sm: 'h-8 w-8 text-xs',
      md: 'h-10 w-10 text-sm',
      lg: 'h-12 w-12 text-base',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'relative flex shrink-0 overflow-hidden rounded-full font-semibold items-center justify-center bg-primary/10 text-primary border border-primary/20 select-none shadow-sm',
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);
Avatar.displayName = 'Avatar';

const AvatarFallback = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn('flex h-full w-full items-center justify-center', className)} {...props} />
  )
);
AvatarFallback.displayName = 'AvatarFallback';

export { Avatar, AvatarFallback };
