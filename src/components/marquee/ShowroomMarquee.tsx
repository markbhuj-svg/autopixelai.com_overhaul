import React, { useSyncExternalStore } from 'react';
import { MotionConfig } from 'motion/react';
import { ThreeDMarquee } from './3d-marquee';
import './marquee.css';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const preference = matchMedia(query);
  preference.addEventListener('change', onChange);
  return () => preference.removeEventListener('change', onChange);
}

export default function ShowroomMarquee({ images }: { images: string[] }) {
  const reduced = useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => true);
  const mode = reduced ? 'always' : 'never';
  return (
    <MotionConfig key={mode} reducedMotion={mode}>
      <ThreeDMarquee images={images} className="marquee-frame h-full w-full rounded-none max-sm:h-full" />
    </MotionConfig>
  );
}
