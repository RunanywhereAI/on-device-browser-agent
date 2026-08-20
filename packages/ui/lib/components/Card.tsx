import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../utils';

export type CardProps = {
  /** Uses --ra-elevation-floating + --ra-surface-floating instead of the resting card tokens. */
  floating?: boolean;
} & ComponentPropsWithoutRef<'div'>;

export function Card({ floating = false, className, children, ...props }: CardProps) {
  return (
    <div className={cn('ra-card', floating && 'ra-card--floating', className)} {...props}>
      {children}
    </div>
  );
}
