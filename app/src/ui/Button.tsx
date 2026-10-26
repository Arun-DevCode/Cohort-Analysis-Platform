import React from 'react';
import { Button as ShadcnButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'xs';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}) => {
  const variantMap: Record<string, 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'> = {
    primary: 'default',
    secondary: 'secondary',
    outline: 'outline',
    danger: 'destructive',
    ghost: 'ghost',
  };

  const sizeMap: Record<string, 'default' | 'sm' | 'lg' | 'xs'> = {
    sm: 'sm',
    md: 'default',
    lg: 'lg',
    xs: 'xs',
  };

  return (
    <ShadcnButton
      variant={variantMap[variant] || 'default'}
      size={sizeMap[size] || 'default'}
      className={cn('cursor-pointer font-medium', className)}
      {...props}
    >
      {children}
    </ShadcnButton>
  );
};
