export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`.trim()} aria-hidden="true">
      <img src="/logo.png" alt="" draggable={false} />
    </span>
  );
}
