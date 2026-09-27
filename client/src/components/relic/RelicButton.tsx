import type { ButtonHTMLAttributes } from 'react';
import { audioEngine } from '../../audio/audioEngine.js';

type RelicButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string | null;
  hot?: boolean;
  size?: 'md' | 'sm';
  tone?: 'default' | 'danger';
};

export function RelicButton({
  icon, hot = false, size = 'md', tone = 'default', className = '', type = 'button', children, onPointerDown, ...rest
}: RelicButtonProps) {
  const cls = `relic-btn relic-btn--${size}${hot ? ' relic-btn--hot' : ''}${tone === 'danger' ? ' relic-btn--danger' : ''} ${className}`;
  return (
    <button type={type} className={cls} onPointerDown={(e) => { audioEngine.playUi('click'); onPointerDown?.(e); }} {...rest}>
      {icon && (
        <img
          className="relic-btn__icon"
          src={icon}
          alt=""
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <span className="relic-btn__label">{children}</span>
    </button>
  );
}
