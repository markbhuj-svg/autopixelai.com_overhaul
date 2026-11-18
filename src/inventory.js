const grid = document.querySelector('[data-grid]');
if (grid) {
  const filters = document.querySelector('[data-filters]');
  const sortLabel = document.querySelector('[data-sort]');
  const search = document.querySelector('#vehicle-search');
  const make = document.querySelector('#vehicle-make');
  const body = document.querySelector('#vehicle-body');
  const sort = document.querySelector('#vehicle-sort');
  const count = document.querySelector('#result-count');
  const cards = [...grid.querySelectorAll('[data-vehicle]')];
  const empty = document.querySelector('[data-empty]');
  function update() {
    const terms = search.value.toLowerCase().trim().split(/\s+/);
    const ordered = [...cards];
    if (sort.value !== 'default') {
      ordered.sort((a,b) => (Number(b.dataset.year) - Number(a.dataset.year)) * (sort.value === 'asc' ? -1 : 1));
    }
    let total = 0;
    for (const card of ordered) {
      card.hidden = Boolean(
        (make.value && card.dataset.make !== make.value) ||
        (body.value && card.dataset.body !== body.value) ||
        !terms.every(term => card.dataset.search.includes(term))
      );
      total += Number(!card.hidden);
    }
    if (ordered.some((card,i) => grid.children[i] !== card)) grid.append(...ordered);
    count.textContent = total + (total === 1 ? ' vehicle' : ' vehicles');
    empty.hidden = total > 0;
  }
  search.addEventListener('input', update);
  for (const control of [make, body, sort]) control.addEventListener('change', update);
  document.querySelector('[data-reset]').addEventListener('click', () => {
    search.value = make.value = body.value = '';
    sort.value = 'default';
    update();
    search.focus();
  });
  const wide = matchMedia('(min-width: 58.01rem)');
  filters.open = wide.matches;
  wide.addEventListener('change', () => { filters.open = wide.matches; });
  filters.hidden = sortLabel.hidden = false;
}

const gallery = document.querySelector('[data-gallery]');
if (gallery) {
  const thumbs = [...gallery.querySelectorAll('[data-photo]')];
  const strip = thumbs[0].parentElement;
  const open = gallery.querySelector('[data-gallery-open]');
  const dialog = gallery.querySelector('.photo-lightbox');
  const lightboxPhoto = dialog.querySelector('[data-lightbox-photo]');
  const lightboxCount = dialog.querySelector('[data-lightbox-count]');
  const count = gallery.querySelector('[data-photo-count]');
  const title = document.querySelector('h1').textContent;
  let index = 0, pending = 0, target = 0;

  function revealSelected() {
    const bounds = strip.getBoundingClientRect(), cell = thumbs[index].getBoundingClientRect();
    if (cell.left < bounds.left) strip.scrollLeft -= bounds.left - cell.left;
    if (cell.right > bounds.right) strip.scrollLeft += cell.right - bounds.right;
  }

  function updateLightbox() {
    const photo = gallery.querySelector('.gallery-frame .gallery-image').cloneNode();
    photo.removeAttribute('class');
    photo.removeAttribute('fetchpriority');
    lightboxPhoto.replaceChildren(photo);
    lightboxCount.textContent = count.textContent;
  }

  async function show(at) {
    target = (at + thumbs.length) % thumbs.length;
    const selected = target;
    const request = ++pending;
    const thumb = thumbs[selected];
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.src = thumb.href;
    image.className = 'gallery-image';
    image.alt = title + ', photo ' + (selected + 1) + ' of ' + thumbs.length;
    image.dataset.selected = '';
    try { await image.decode(); }
    catch {
      if (request === pending) {
        target = index;
        count.textContent = 'Photo unavailable. Try another.';
        if (dialog.open) lightboxCount.textContent = count.textContent;
      }
      return;
    }
    if (request !== pending) return;
    index = selected;
    gallery.querySelector('.gallery-frame .gallery-image').replaceWith(image);
    for (const item of thumbs) item.removeAttribute('aria-current');
    thumb.setAttribute('aria-current','true');
    count.textContent = (index + 1) + ' / ' + thumbs.length;
    if (dialog.open) updateLightbox();
    revealSelected();
  }

  for (const [i, thumb] of thumbs.entries()) thumb.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    show(i);
  });
  for (const button of gallery.querySelectorAll('[data-previous], [data-next]')) {
    button.addEventListener('click', () => show(target + (button.hasAttribute('data-previous') ? -1 : 1)));
    button.hidden = false;
  }
  gallery.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    show(target + (event.key === 'ArrowLeft' ? -1 : 1));
  });

  if (typeof dialog.showModal === 'function') {
    open.addEventListener('click', () => {
      updateLightbox();
      dialog.showModal();
      dialog.querySelector('.lightbox-body').append(strip);
      revealSelected();
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      dialog.before(strip);
      revealSelected();
    });
    open.hidden = false;
  }
}
