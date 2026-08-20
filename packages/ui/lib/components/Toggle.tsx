import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../utils';

export type ToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
} & Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'checked' | 'onChange' | 'value'>;

/**
 * An accessible switch built on a real `<input type="checkbox">` — keyboard
 * operable (native Tab + Space) and correctly exposes `aria-checked` — so it
 * can replace the hand-rolled div-based toggle currently copy-pasted across
 * the options pages.
 */
export function Toggle({ checked, onCheckedChange, label, disabled, className, id, ...props }: ToggleProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label htmlFor={inputId} className={cn('ra-toggle', disabled && 'ra-toggle--disabled', className)}>
      <span className="ra-toggle__control">
        <input
          {...props}
          id={inputId}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-checked={checked}
          disabled={disabled}
          onChange={event => onCheckedChange(event.target.checked)}
          className="ra-toggle__input"
        />
        <span className="ra-toggle__track" aria-hidden="true">
          <span className="ra-toggle__knob" />
        </span>
      </span>
      {label ? <span className="ra-toggle__label">{label}</span> : null}
    </label>
  );
}
