import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../utils';

export type ChipTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export type ChipProps = {
  tone?: ChipTone;
} & ComponentPropsWithoutRef<'span'>;

export function Chip({ tone = 'neutral', className, children, ...props }: ChipProps) {
  return (
    <span className={cn('ra-chip', `ra-chip--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}
