import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../utils';

export type ProgressBarProps = {
  /** 0..1. Omit (or pass `undefined`) for indeterminate mode. */
  value?: number;
  /** Accessible name — there is no visible label element. */
  label?: string;
} & Omit<ComponentPropsWithoutRef<'div'>, 'role' | 'aria-valuenow' | 'aria-valuemin' | 'aria-valuemax'>;

export function ProgressBar({ value, label, className, ...props }: ProgressBarProps) {
  const determinate = typeof value === 'number';
  const clamped = determinate ? Math.min(1, Math.max(0, value)) : undefined;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round((clamped as number) * 100) : undefined}
      className={cn('ra-progress', !determinate && 'ra-progress--indeterminate', className)}
      {...props}>
      <div className="ra-progress__fill" style={determinate ? { width: `${(clamped as number) * 100}%` } : undefined} />
    </div>
  );
}
