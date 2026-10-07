// A problem the person must not walk past: shown where the content starts, not in a footer, with a
// border, a colour and (optionally) the one button that fixes it. `role="alert"` also makes a screen
// reader announce it the moment it appears.
import type { ReactNode } from 'react';
import { Icon } from './icons';

interface Props {
  /** The short line that says what went wrong. */
  title: string;
  /** The detail: the server's reason, a code, what to try. */
  children?: ReactNode;
  kind?: 'error' | 'warning';
  /** One action at the right-hand side, usually "Try again". */
  action?: { label: string; onClick: () => void };
}

export function Alert({ title, children, kind = 'error', action }: Props) {
  return (
    <div className={`alert${kind === 'warning' ? ' warn' : ''}`} role="alert">
      <span className="alert-icon">
        <Icon name="warning" size={16} />
      </span>
      <span className="grow col">
        <span className="alert-title">{title}</span>
        {children ? <span className="alert-body">{children}</span> : null}
      </span>
      {action && (
        <span className="alert-actions">
          <button className="btn compact" onClick={action.onClick}>
            {action.label}
          </button>
        </span>
      )}
    </div>
  );
}
