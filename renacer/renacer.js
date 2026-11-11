/* Renacer 40 · Un gesto sencillo — pantalla de carga y reproductor de Drive */
(function () {
  var body = document.body;
  var id = body.getAttribute('data-video');
  var nombre = body.getAttribute('data-nombre') || '';
  var reducir = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var carga = document.getElementById('carga');
  var escena = document.getElementById('escena');
  var conjuro = document.getElementById('conjuro');

  /* ---- Velas flotantes ---- */
  var cielo = document.getElementById('velas');
  var cuantas = window.innerWidth < 600 ? 9 : 16;
  for (var i = 0; i < cuantas; i++) {
    var v = document.createElement('span');
    var s = 0.5 + Math.random() * 0.65;
    v.className = 'vela';
    v.style.setProperty('--s', s.toFixed(2));
    // a los lados, para no tapar el logo ni el video
    var lado = i % 2 === 0 ? 2 + Math.random() * 20 : 78 + Math.random() * 20;
    v.style.left = lado.toFixed(1) + '%';
    v.style.top = (6 + Math.random() * 62).toFixed(1) + '%';
    v.style.opacity = (0.3 + s * 0.55).toFixed(2);
    v.style.animationDuration = (6 + Math.random() * 6).toFixed(1) + 's';
    v.style.animationDelay = (-Math.random() * 10).toFixed(1) + 's';
    cielo.appendChild(v);
  }

  /* ---- Chispas doradas que suben ---- */
  var lienzo = document.getElementById('chispas');
  var ctx = lienzo.getContext && lienzo.getContext('2d');
  if (ctx && !reducir) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var puntos = [];
    var ajustar = function () {
      lienzo.width = innerWidth * dpr;
      lienzo.height = innerHeight * dpr;
    };
    ajustar();
    addEventListener('resize', ajustar);
    var nueva = function (alAzar) {
      return {
        x: Math.random() * lienzo.width,
        y: alAzar ? Math.random() * lienzo.height : lienzo.height + 10,
        r: (0.6 + Math.random() * 1.6) * dpr,
        vy: (0.15 + Math.random() * 0.45) * dpr,
        fase: Math.random() * Math.PI * 2,
        osc: 0.3 + Math.random() * 0.6
      };
    };
    var total = innerWidth < 600 ? 45 : 80;
    for (var k = 0; k < total; k++) puntos.push(nueva(true));
    var paso = function (t) {
      ctx.clearRect(0, 0, lienzo.width, lienzo.height);
      for (var j = 0; j < puntos.length; j++) {
        var p = puntos[j];
        p.y -= p.vy;
        p.x += Math.sin(t / 1400 + p.fase) * p.osc * 0.4;
        if (p.y < -10) puntos[j] = p = nueva(false);
        var a = 0.35 + 0.65 * Math.abs(Math.sin(t / 700 + p.fase));
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, 'rgba(255,240,200,' + a + ')');
        g.addColorStop(0.35, 'rgba(240,195,100,' + a * 0.5 + ')');
        g.addColorStop(1, 'rgba(240,195,100,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  /* ---- Reproductor de Drive (carga mientras corre la animación) ---- */
  var marco = document.createElement('iframe');
  marco.src = 'https://drive.google.com/file/d/' + id + '/preview';
  marco.title = 'Un gesto sencillo' + (nombre ? ' para ' + nombre : '');
  marco.allow = 'autoplay; fullscreen';
  marco.setAttribute('allowfullscreen', '');
  document.getElementById('pantalla').appendChild(marco);
  document.getElementById('enDrive').href = 'https://drive.google.com/file/d/' + id + '/view';

  /* ---- Frases del conjuro ---- */
  var frases = ['Lumos…', 'Encendiendo las velas del Gran Comedor…', 'Tu mensaje está por aparecer…'];
  var f = 0;
  var rotar = setInterval(function () {
    if (f >= frases.length - 1) { clearInterval(rotar); return; }
    conjuro.classList.add('cambia');
    setTimeout(function () {
      f++;
      conjuro.textContent = frases[f];
      conjuro.classList.remove('cambia');
    }, 500);
  }, 1700);

  /* ---- Secuencia: Lumos → revelar video ---- */
  setTimeout(function () { carga.classList.add('lumos'); }, reducir ? 0 : 450);

  var cargoVideo = false, cumplioTiempo = false, listo = false;
  var terminar = function () {
    if (listo || !cargoVideo || !cumplioTiempo) return;
    listo = true;
    clearInterval(rotar);
    carga.classList.add('salir');
    escena.classList.add('visible');
    setTimeout(function () { carga.parentNode && carga.parentNode.removeChild(carga); }, 1300);
  };
  marco.addEventListener('load', function () { cargoVideo = true; terminar(); });
  setTimeout(function () { cumplioTiempo = true; terminar(); }, reducir ? 1200 : 5000);
  setTimeout(function () { cargoVideo = true; terminar(); }, 12000); // por si Drive tarda
})();
