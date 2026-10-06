import React, { forwardRef, useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, id, className = '', ...props }, ref) => {
    const generatedId = useId();
    const selectId = id || `select-${generatedId.replace(/:/g, '')}`;

    return (
      <div className={`form-group ${error ? 'has-error' : ''}`}>
        {label && (
          <label htmlFor={selectId} className="form-label">
            {label}
            {props.required && <span className="required-mark" aria-hidden="true">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`form-select ${className}`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {hint && !error && (
          <p id={`${selectId}-hint`} className="form-hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${selectId}-error`} className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
