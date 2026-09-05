// Run before CSS, including when storage is unavailable in a restricted browser.
try {
  document.documentElement.classList.add('js-loading');
  const saved = localStorage.getItem('hackvault:theme');
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark',dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark ? '#151922' : '#f7f8fa');
} catch {
  document.documentElement.classList.add('js-loading');
  document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);
}
