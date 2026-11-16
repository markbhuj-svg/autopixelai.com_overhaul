import type { ImageMetadata } from 'astro';

const brandImages = import.meta.glob<ImageMetadata>('./assets/brand-marks/*.webp', { eager: true, import: 'default' });

export function brandMark(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return brandImages[`./assets/brand-marks/${slug}.webp`];
}
