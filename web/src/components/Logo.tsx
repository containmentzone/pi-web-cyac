// CyberAcme mark: a full circle with its bottom-right quadrant cut out square, and that
// quadrant refilled by a smaller circle whose bottom-right corner is sharp.
export const LOGO_PATH =
  "M50 0A50 50 0 0 0 0 50A50 50 0 0 0 50 100V50H100A50 50 0 0 0 50 0Z" +
  "M75 50A25 25 0 0 1 100 75V100H75A25 25 0 0 1 50 75A25 25 0 0 1 75 50Z";

export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={LOGO_PATH} fill="currentColor" />
    </svg>
  );
}
