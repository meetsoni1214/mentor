import { brand } from './brand';
import styles from './brand.module.css';

export function BrandLogo({
  size = 'sm',
  decorative = false,
}: {
  size?: 'sm' | 'lg';
  decorative?: boolean;
}) {
  return (
    <span
      className={`${styles.logo} ${size === 'lg' ? styles.large : ''}`.trim()}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `${brand.name} logo`}
      aria-hidden={decorative || undefined}
    >
      {brand.monogram}
    </span>
  );
}

export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`${styles.lockup} ${className}`.trim()}>
      <BrandLogo decorative />
      <span>{brand.name}</span>
    </span>
  );
}
