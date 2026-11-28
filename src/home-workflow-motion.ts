import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function enableHomeWorkflow(stage: HTMLElement, motion: MediaQueryList) {
  gsap.registerPlugin(ScrollTrigger);
  const viewport = stage.querySelector<HTMLElement>('.workflow-window')!;
  const track = stage.querySelector<HTMLOListElement>('.workflow-track')!;
  const progress = stage.querySelector<HTMLElement>('.progress-track')!;
  const cards = [...track.children];
  const dots = [...progress.querySelectorAll('.progress-dot')];
  const step = stage.querySelector('[data-workflow-step]')!;
  const travel = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
  let animation: gsap.Context | undefined;
  let active = -1;

  function select(index: number) {
    if (active === index) return;
    active = index;
    cards.forEach((card, position) => {
      if (position === index) card.setAttribute('aria-current', 'step');
      else card.removeAttribute('aria-current');
      dots[position].toggleAttribute('data-current', position === index);
    });
    step.textContent = String(index + 1).padStart(2, '0');
  }

  function update() {
    animation?.revert();
    stage.removeAttribute('data-scroll-workflow');
    cards.forEach((card) => card.removeAttribute('aria-current'));
    if (!motion.matches) return;

    stage.setAttribute('data-scroll-workflow', '');
    const available = parseFloat(getComputedStyle(stage).minHeight);
    if (stage.scrollHeight > Math.ceil(available)) {
      stage.removeAttribute('data-scroll-workflow');
      return;
    }

    active = -1;
    select(0);
    animation = gsap.context(() => {
      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: stage, start: 'top top', end: () => '+=' + Math.max(1200, travel()),
          pin: true, scrub: 0.75, invalidateOnRefresh: true,
        },
      });
      timeline.to(track, { x: () => -travel(), duration: 4 }, 0)
        .fromTo('.progress-fill', { scaleX: 0 }, { scaleX: 1, duration: 4 }, 0)
        .fromTo('.progress-light', { x: 0 }, { x: () => progress.clientWidth, duration: 4 }, 0)
        .to('.ready', { opacity: 1, duration: 0.3 }, 3.5)
        .eventCallback('onUpdate', () => select(Math.round(timeline.progress() * (cards.length - 1))));
    }, stage);
    ScrollTrigger.refresh();
  }

  const viewportSize = () => `${document.documentElement.clientWidth}/${getComputedStyle(stage).minHeight}`;
  let size = viewportSize();
  const refreshLayout = gsap.delayedCall(0.2, update).pause();
  window.addEventListener('resize', () => {
    const next = viewportSize();
    if (next === size) return;
    size = next;
    refreshLayout.restart(true);
  }, { passive: true });
  motion.addEventListener('change', update);
  void document.fonts.ready.then(update);
}
