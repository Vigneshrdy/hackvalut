// Minimal navigation for collection directories and true 404 pages.
document.documentElement.classList.remove('js-loading');
const search = document.querySelector('#search');
search?.addEventListener('keydown',event=>{if(event.key==='Enter') location.href='/browse?q='+encodeURIComponent(search.value);});
document.querySelector('#filter-button')?.setAttribute('hidden','');
for (const id of ['join-group-button','nav-shortlist','nav-board']) document.getElementById(id)?.addEventListener('click',()=>{location.href='/browse';});
document.querySelector('#theme-toggle')?.addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');try{localStorage.setItem('hackvault:theme',dark?'dark':'light');}catch{}});
