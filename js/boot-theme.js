// PIC-ASS-O — a mentett téma és sötét mód AZONNAL, még az első kirajzolás előtt
// (v4.10; v4.33: külön fájlban, hogy a CSP ne engedjen soron belüli szkriptet).
// Különben egy pillanatra az alapszín villanna fel.
(function(){ try{
  // v4.29: a new player starts on the grey (Grafit) theme
  var d = document.documentElement, t = localStorage.getItem('picasso-theme') || 'graphite';
  if(t !== 'forest') d.setAttribute('data-theme', t);
  if(localStorage.getItem('picasso-dark-mode') === '1') d.classList.add('dark-mode');
}catch(e){ document.documentElement.setAttribute('data-theme', 'graphite'); } })();
