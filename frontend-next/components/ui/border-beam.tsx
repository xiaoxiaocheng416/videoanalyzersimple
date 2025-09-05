'use client';

import { cn } from '@/lib/utils';

interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
}

export const BorderBeam = ({
  className,
  size = 200,
  delay = 0,
  duration = 15,
  colorFrom = '#ffaa40',
  colorTo = '#9c40ff',
}: BorderBeamProps) => {
  return (
    <div
      style={
        {
          '--size': size,
          '--duration': duration,
          '--delay': -delay,
          '--color-from': colorFrom,
          '--color-to': colorTo,
        } as React.CSSProperties
      }
      className={cn(
        'absolute inset-0 overflow-hidden rounded-[inherit] [mask-composite:exclude] [mask:linear-gradient(white,white)_padding-box,linear-gradient(white,white)]',
        'before:absolute before:aspect-square before:w-[var(--size)] before:animate-border-beam before:[animation-delay:var(--delay)] before:[background:conic-gradient(from_0deg,transparent,var(--color-from),var(--color-to),transparent_20%)] before:[offset-anchor:calc(var(--size)*0.5)_center] before:[offset-path:rect(0_auto_auto_0_round_200px)]',
        className
      )}
    />
  );
};