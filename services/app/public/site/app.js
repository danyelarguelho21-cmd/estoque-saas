const menu = document.querySelector('.menu');
const nav = document.querySelector('#nav');
function closeMenu() { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }
menu.addEventListener('click', () => { const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
nav.addEventListener('click', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const clips = [...document.querySelectorAll('video[data-clip]')];
const visibleClips = new Set();
function updateClip(video) {
  if (motion.matches || document.hidden || !visibleClips.has(video)) { video.pause(); return; }
  if (!video.getAttribute('src')) {
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    video.src = `/site/assets/${video.dataset.clip}-lite.mp4`;
    video.load();
  }
  video.play().catch(() => {});
}
const videoObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting && entry.intersectionRatio >= 0.15) visibleClips.add(entry.target); else visibleClips.delete(entry.target); updateClip(entry.target); });
}, { rootMargin: '0px', threshold: 0.15 });
const posterObserver = new IntersectionObserver(entries => { entries.forEach(entry => { if(entry.isIntersecting){ const video=entry.target; if(video.dataset.poster) video.poster=video.dataset.poster; posterObserver.unobserve(video); } }); }, {rootMargin:'200px'});
clips.forEach(video => { posterObserver.observe(video); videoObserver.observe(video); video.addEventListener('canplay', () => updateClip(video)); });
function updateClips() { clips.forEach(updateClip); }
document.addEventListener('visibilitychange', updateClips);
window.addEventListener('pageshow', updateClips);
document.addEventListener('pointerdown', updateClips, { passive: true });
motion.addEventListener('change', updateClips);

