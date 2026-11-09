// PIC-ASS-O — indulásfigyelő (v2.89; v4.33: külön fájlban, a CSP miatt).
// Ha a játék motorja 20 mp alatt sem indul el (blokkolt hálózat, reklámblokkoló,
// elérhetetlen fájl), megmondja, mi a teendő, ahelyett hogy félkész oldal maradna.
// v4.33: a kezdőképernyő már a betöltés alatt is látszik, ezért csak a
// window.__picassoBooted jelzés számít, és hiba esetén a kezdőképernyő eltűnik.
(function(){
  var started = Date.now();
  function check(){
    if(window.__picassoBooted) return;
    if(Date.now() - started < 20000){ setTimeout(check, 1000); return; }
    var box = document.getElementById('screen-error');
    var det = document.getElementById('error-detail');
    var home = document.getElementById('screen-home');
    if(det){
      det.innerHTML = 'A játék motorja nem töltődött be (a böngésző nem érte el a szükséges fájlokat).<br><br>Próbáld újratölteni az oldalt, vagy válts másik hálózatra (pl. wifi helyett mobilnetre). Ha reklámblokkolót használsz, kapcsold ki erre az oldalra.<br><br><button type="button" id="watchdog-reload" style="margin-top:6px;">Újratöltés 🔄</button>';
      var b = document.getElementById('watchdog-reload');
      if(b) b.addEventListener('click', function(){ location.reload(); });
    }
    if(home) home.classList.add('hidden');
    document.body.classList.remove('booting');
    if(box) box.classList.remove('hidden');
  }
  window.addEventListener('DOMContentLoaded', function(){ setTimeout(check, 1000); });
})();

// v4.33: these forms exist only so that password managers / mobile keyboards
// behave (they were onsubmit="return false" — inline handlers are not allowed
// by the CSP any more). Enter must never submit them: that would reload the
// page and throw the player out of the game.
document.addEventListener('submit', function(e){
  if(e.target && e.target.hasAttribute && e.target.hasAttribute('data-nosubmit')) e.preventDefault();
}, true);

// v4.35: a böngésző telepítési ajánlatát már itt elkapjuk (a játék motorja
// később tölt be, addigra az esemény elveszne); a főmenü „Telepítés" gombja használja.
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  window.__pcInstallPrompt = e;
  try{ window.dispatchEvent(new Event('pc-install-ready')); }catch(err){}
});
