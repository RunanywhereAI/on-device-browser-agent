import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../utils';

export type ButtonProps = {
  theme?: 'light' | 'dark';
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
} & ComponentPropsWithoutRef<'button'>;

export function Button({ theme, variant = 'primary', className, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'py-1 px-4 rounded shadow transition-all',
        {
          // Primary variant
          'bg-blue-500 hover:bg-blue-600 text-white hover:scale-105':
            variant === 'primary' && !disabled && theme !== 'dark',
          'bg-blue-600 hover:bg-blue-700 text-white hover:scale-105':
            variant === 'primary' && !disabled && theme === 'dark',
          'bg-gray-400 text-gray-600 cursor-not-allowed': variant === 'primary' && disabled,

          // Secondary variant
          'bg-gray-300 hover:bg-gray-400 text-gray-800 hover:scale-105': variant === 'secondary' && !disabled,
          'bg-gray-100 text-gray-400 cursor-not-allowed': variant === 'secondary' && disabled,

          // Danger variant
          // Note: bg-red-400 causes the button to appear black (RGB 0,0,0) for unknown reasons
          // Using bg-red-500 with opacity to achieve a softer look
          'bg-red-600 bg-opacity-80 hover:bg-red-700 hover:bg-opacity-90 text-white hover:scale-105':
            variant === 'danger' && !disabled && theme !== 'dark',
          'bg-red-500 bg-opacity-70 hover:bg-red-700 hover:bg-opacity-90 text-white hover:scale-105':
            variant === 'danger' && !disabled && theme === 'dark',
          'bg-red-300 bg-opacity-80 text-red-100 cursor-not-allowed': variant === 'danger' && disabled,
        },
        className,
      )}
      disabled={disabled}
      {...props}>
      {children}
    </button>
  );
}
