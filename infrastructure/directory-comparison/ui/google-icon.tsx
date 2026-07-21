import type { SVGProps } from 'react';

/** Google's standard 4-color "G" mark, sized/styled like a lucide-react icon
 * (which has no brand logos of its own) — used in place of the plain file
 * icon for entries logged in the unreliable-size registry (spec: user
 * request), i.e. files known to have been touched by Google's office suite
 * and therefore may show false differences in Compare. */
export function GoogleIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fill="#4285F4"
        d="M23.64 12.2c0-.85-.08-1.66-.22-2.45H12v4.63h6.52c-.28 1.5-1.15 2.77-2.45 3.62v3h3.96c2.32-2.14 3.66-5.29 3.66-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.96-3c-1.1.74-2.5 1.18-3.98 1.18-3.06 0-5.65-2.07-6.58-4.85H1.35v3.05C3.33 21.5 7.35 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.42 14.43a7.16 7.16 0 0 1 0-4.86V6.52H1.35a12 12 0 0 0 0 10.96l4.07-3.05z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.33 2.5 1.35 6.52l4.07 3.05C6.35 6.8 8.94 4.75 12 4.75z"
      />
    </svg>
  );
}
