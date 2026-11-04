/**
 * Bingo Digital — motor de cartones (sin dependencias del sitio).
 *
 * - Cartón americano de 75 bolas, 5×5. B 1–15 · I 16–30 · N 31–45 · G 46–60 · O 61–75.
 *   El centro es libre (0) o, si el bingo lo elige, lleva el quinto número de la columna N.
 * - Cada cartón se calcula de la semilla del bingo y su serie (1–10 000): nunca se guarda como imagen.
 * - El template (1200 × 1680 px = 10 × 14 cm a 304,8 ppp) fija dónde van título, BINGO, casillas,
 *   serie, QR y código. El arte del cliente se pinta debajo y el sistema dibuja encima.
 */
(function () {
    const MAX_CARTONES = 10000;
    const LETRAS = ["B", "I", "N", "G", "O"];

    /* ---------- Geometría del template (px) ---------- */
    const G = {
        W: 1200,
        H: 1680,
        titulo: { x: 60, y: 50, w: 1080, h: 330 },
        letras: { x: 125, y: 395, w: 950, h: 110 },
        casillas: { x: 125, y: 515, celda: 190 },
        serie: { x: 125, y: 1515, w: 360, h: 110 },
        qr: { x: 530, y: 1495, w: 140, h: 140 },
        codigo: { x: 715, y: 1515, w: 360, h: 110 }
    };

    /* ---------- Azar determinista ---------- */
    function hashStr(str) {
        let h1 = 0xdeadbeef ^ 0;
        let h2 = 0x41c6ce57 ^ 0;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }

    function mulberry32(a) {
        let t = a >>> 0;
        return function () {
            t = (t + 0x6d2b79f5) >>> 0;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** grid[fila][columna]; el centro es 0 (libre) y su número queda aparte para los bingos sin espacio libre. */
    function generarIntento(seed, serie, intento) {
        const rnd = mulberry32(hashStr(`${seed}|${serie}|${intento}`) >>> 0);
        const cols = [];
        for (let c = 0; c < 5; c++) {
            const pool = [];
            for (let n = c * 15 + 1; n <= c * 15 + 15; n++) pool.push(n);
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(rnd() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            cols.push(pool.slice(0, 5).sort((a, b) => a - b));
        }
        const grid = [];
        for (let f = 0; f < 5; f++) grid.push(cols.map((col) => col[f]));
        const centro = grid[2][2];
        grid[2][2] = 0;
        return { grid, centro };
    }

    /* Cartones únicos: se generan en orden 1..N; si una combinación repite, la serie toma el siguiente intento. */
    const cache = new Map();
    function libreta(seed) {
        let lib = cache.get(seed);
        if (!lib) {
            lib = { cartones: [null], centros: [0], vistos: new Set() };
            cache.set(seed, lib);
        }
        return lib;
    }

    /** centroNumero = true: el centro lleva su número en lugar del espacio libre (copia; la libreta no cambia). */
    function carton(seed, serie, centroNumero) {
        const n = Math.floor(Number(serie));
        if (!(n >= 1 && n <= MAX_CARTONES)) throw new Error(`La serie ${serie} no existe (1 a ${MAX_CARTONES}).`);
        const lib = libreta(seed);
        while (lib.cartones.length <= n) {
            const s = lib.cartones.length;
            let intento = 0;
            let gen;
            let clave;
            do {
                gen = generarIntento(seed, s, intento++);
                clave = gen.grid.flat().join(",");
            } while (lib.vistos.has(clave));
            lib.vistos.add(clave);
            lib.cartones.push(gen.grid);
            lib.centros.push(gen.centro);
        }
        if (!centroNumero) return lib.cartones[n];
        const copia = lib.cartones[n].map((row) => row.slice());
        copia[2][2] = lib.centros[n];
        return copia;
    }

    const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    function codigo(seed, serie) {
        let h = hashStr(`${seed}#${serie}#verif`);
        let out = "";
        for (let i = 0; i < 4; i++) {
            out += ALFABETO[h % 32];
            h = Math.floor(h / 32);
        }
        return out;
    }

    /* Dígitos con que se muestra la serie (Ajustes del bingo): 3, 4 o 5. Nunca recorta una serie más larga. */
    let DIGITOS = 5;
    function setDigitos(n) {
        DIGITOS = [3, 4, 5].includes(Number(n)) ? Number(n) : 5;
    }

    function serieTexto(serie) {
        return String(serie).padStart(DIGITOS, "0");
    }

    function letraDe(bola) {
        return LETRAS[Math.min(4, Math.floor((Number(bola) - 1) / 15))];
    }

    /* ---------- Figuras ---------- */
    const filas = [0, 1, 2, 3, 4];
    const fila = (f) => filas.map((c) => [f, c]);
    const columna = (c) => filas.map((f) => [f, c]);
    const diag1 = filas.map((i) => [i, i]);
    const diag2 = filas.map((i) => [i, 4 - i]);
    const unir = (...listas) => listas.flat();

    const FIGURAS = {
        linea: { nombre: "Línea (cualquiera)", alternativas: [...filas.map(fila), ...filas.map(columna), diag1, diag2] },
        horizontal: { nombre: "Línea horizontal", alternativas: filas.map(fila) },
        vertical: { nombre: "Línea vertical", alternativas: filas.map(columna) },
        diagonal: { nombre: "Diagonal", alternativas: [diag1, diag2] },
        esquinas: { nombre: "4 esquinas", alternativas: [[[0, 0], [0, 4], [4, 0], [4, 4]]] },
        x: { nombre: "Letra X", alternativas: [unir(diag1, diag2)] },
        l: { nombre: "Letra L", alternativas: [unir(columna(0), fila(4))] },
        t: { nombre: "Letra T", alternativas: [unir(fila(0), columna(2))] },
        marco: { nombre: "Marco", alternativas: [unir(fila(0), fila(4), columna(0), columna(4))] },
        lleno: { nombre: "Cartón lleno", alternativas: [filas.flatMap((f) => fila(f))] },
        col_b: { nombre: "Vertical de la B", alternativas: [columna(0)] },
        col_i: { nombre: "Vertical de la I", alternativas: [columna(1)] },
        col_n: { nombre: "Vertical de la N", alternativas: [columna(2)] },
        col_g: { nombre: "Vertical de la G", alternativas: [columna(3)] },
        col_o: { nombre: "Vertical de la O", alternativas: [columna(4)] },
        fila_1: { nombre: "Horizontal de arriba (fila 1)", alternativas: [fila(0)] },
        fila_2: { nombre: "Horizontal fila 2", alternativas: [fila(1)] },
        fila_3: { nombre: "Horizontal del centro (fila 3)", alternativas: [fila(2)] },
        fila_4: { nombre: "Horizontal fila 4", alternativas: [fila(3)] },
        fila_5: { nombre: "Horizontal de abajo (fila 5)", alternativas: [fila(4)] },
        diag_1: { nombre: "Diagonal ↘ (de B arriba a O abajo)", alternativas: [diag1] },
        diag_2: { nombre: "Diagonal ↙ (de O arriba a B abajo)", alternativas: [diag2] },
        custom: { nombre: "Figura personalizada", alternativas: [] }
    };

    /** Orden para los selectores: primero las de cualquier posición, luego las fijas. */
    const ORDEN_FIGURAS = ["linea", "horizontal", "vertical", "diagonal", "esquinas", "x", "l", "t", "marco", "lleno",
        "col_b", "col_i", "col_n", "col_g", "col_o", "fila_1", "fila_2", "fila_3", "fila_4", "fila_5", "diag_1", "diag_2", "custom"];

    /** Casillas «f,c;f,c» de una figura personalizada → [[f, c], …]. */
    function celdasDe(texto) {
        return String(texto || "").split(";").map((p) => p.split(",").map(Number)).filter((x) => x.length === 2 && x.every((v) => v >= 0 && v <= 4));
    }

    function alternativasDe(figura, celdas) {
        if (figura === "custom") {
            const c = celdasDe(celdas);
            return c.length ? [c] : [];
        }
        return (FIGURAS[figura] || FIGURAS.linea).alternativas;
    }

    function nombreFigura(figura, celdas) {
        if (figura === "custom") return `Figura personalizada (${celdasDe(celdas).length} casillas)`;
        if (figura === "salado") return "El cartón más salado";
        if (figura === "eliminacion") return "Eliminación";
        return (FIGURAS[figura] || FIGURAS.linea).nombre;
    }

    function marcadas(grid, bolas) {
        const set = bolas instanceof Set ? bolas : new Set(bolas || []);
        return grid.map((row) => row.map((n) => n === 0 || set.has(n)));
    }

    /** Casillas que faltan para completar la figura (0 = ¡BINGO!). */
    function faltan(grid, bolas, figura, celdas) {
        const m = marcadas(grid, bolas);
        let min = 25;
        alternativasDe(figura, celdas).forEach((alt) => {
            const f = alt.filter(([r, c]) => !m[r][c]).length;
            if (f < min) min = f;
        });
        return min;
    }

    /** Casillas de la alternativa ganadora (para resaltarla al verificar). */
    function casillasGanadoras(grid, bolas, figura, celdas) {
        const m = marcadas(grid, bolas);
        const alt = alternativasDe(figura, celdas).find((a) => a.every(([r, c]) => m[r][c]));
        return alt || null;
    }

    /** «El cartón más salado»: casillas con número que siguen sin marcar. */
    function blancos(grid, bolas) {
        const set = bolas instanceof Set ? bolas : new Set(bolas || []);
        let n = 0;
        grid.forEach((row) => row.forEach((v) => { if (v !== 0 && !set.has(v)) n++; }));
        return n;
    }

    /** Eliminación: la primera bola cantada que el cartón tiene (0 = sigue en pie). */
    function eliminadoPor(grid, bolas) {
        const nums = new Set(grid.flat());
        return (bolas || []).find((b) => nums.has(b)) || 0;
    }

    /* ---------- Dibujo ---------- */
    const TINTA = "#16182a";
    const ROJO = "#e01e1e";

    function celdaRect(f, c) {
        const { x, y, celda } = G.casillas;
        return { x: x + c * celda, y: y + f * celda, w: celda, h: celda };
    }

    function textoAjustado(ctx, texto, x, y, maxW, size, peso, familia) {
        let s = size;
        ctx.font = `${peso} ${s}px ${familia}`;
        while (s > 12 && ctx.measureText(texto).width > maxW) {
            s -= 2;
            ctx.font = `${peso} ${s}px ${familia}`;
        }
        ctx.fillText(texto, x, y);
        return s;
    }

    /* ---------- Diseños prediseñados: tipografías ---------- */

    /** Tipografías que se pueden elegir para cada texto del cartón (todas de Google Fonts). */
    const FUENTES = {
        montserrat: { n: "Montserrat", css: "'Montserrat', Arial, sans-serif", w: 700 },
        poppins: { n: "Poppins", css: "'Poppins', Arial, sans-serif", w: 700 },
        roboto: { n: "Roboto", css: "'Roboto', Arial, sans-serif", w: 700 },
        inter: { n: "Inter", css: "'Inter', Arial, sans-serif", w: 700 },
        lato: { n: "Lato", css: "'Lato', Arial, sans-serif", w: 700 },
        nunito: { n: "Nunito", css: "'Nunito', Arial, sans-serif", w: 700 },
        raleway: { n: "Raleway", css: "'Raleway', Arial, sans-serif", w: 700 },
        oswald: { n: "Oswald", css: "'Oswald', Arial, sans-serif", w: 700 },
        anton: { n: "Anton", css: "'Anton', Impact, sans-serif", w: 400 },
        bebas: { n: "Bebas Neue", css: "'Bebas Neue', Impact, sans-serif", w: 400 },
        bungee: { n: "Bungee", css: "'Bungee', Impact, sans-serif", w: 400 },
        luckiest: { n: "Luckiest Guy", css: "'Luckiest Guy', Impact, sans-serif", w: 400 },
        righteous: { n: "Righteous", css: "'Righteous', Arial, sans-serif", w: 400 },
        fredoka: { n: "Fredoka", css: "'Fredoka', Arial, sans-serif", w: 700 },
        orbitron: { n: "Orbitron", css: "'Orbitron', Arial, sans-serif", w: 700 },
        robotomono: { n: "Roboto Mono", css: "'Roboto Mono', monospace", w: 700 },
        merriweather: { n: "Merriweather", css: "'Merriweather', Georgia, serif", w: 700 },
        playfair: { n: "Playfair Display", css: "'Playfair Display', Georgia, serif", w: 700 },
        cinzel: { n: "Cinzel", css: "'Cinzel', Georgia, serif", w: 700 },
        lobster: { n: "Lobster", css: "'Lobster', cursive", w: 400 },
        pacifico: { n: "Pacifico", css: "'Pacifico', cursive", w: 400 },
        dancing: { n: "Dancing Script", css: "'Dancing Script', cursive", w: 700 },
        navidad: { n: "Mountains of Christmas", css: "'Mountains of Christmas', cursive", w: 700 },
        creepster: { n: "Creepster", css: "'Creepster', cursive", w: 400 }
    };

    /** Hoja de Google Fonts con todas las tipografías de FUENTES (la app la agrega solo cuando hace falta). */
    const FUENTES_URL = "https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Bungee&family=Cinzel:wght@400;700" +
        "&family=Creepster&family=Dancing+Script:wght@400;700&family=Fredoka:wght@400;700&family=Inter:wght@400;700&family=Lato:wght@400;700" +
        "&family=Lobster&family=Luckiest+Guy&family=Merriweather:wght@400;700&family=Montserrat:wght@400;700&family=Mountains+of+Christmas:wght@400;700" +
        "&family=Nunito:wght@400;700&family=Orbitron:wght@700&family=Oswald:wght@400;700&family=Pacifico&family=Playfair+Display:wght@400;700" +
        "&family=Poppins:wght@400;700&family=Raleway:wght@400;700&family=Righteous&family=Roboto+Mono:wght@400;700&family=Roboto:wght@400;700&display=swap";

    const fuente = (id) => FUENTES[id] || FUENTES.montserrat;

    /* ---------- Diseños prediseñados: piezas de dibujo ---------- */

    function degradado(ctx, x0, y0, x1, y1, colores) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        colores.forEach((c, i) => g.addColorStop(i / (colores.length - 1), c));
        return g;
    }

    function fondoLiso(ctx, colores) {
        ctx.fillStyle = degradado(ctx, 0, 0, 0, G.H, colores);
        ctx.fillRect(0, 0, G.W, G.H);
    }

    function circulo(ctx, x, y, r, relleno, borde, grosor) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (relleno) {
            ctx.fillStyle = relleno;
            ctx.fill();
        }
        if (borde) {
            ctx.strokeStyle = borde;
            ctx.lineWidth = grosor || 3;
            ctx.stroke();
        }
    }

    function estrella(ctx, x, y, r1, r2, puntas, relleno) {
        ctx.beginPath();
        for (let i = 0; i < puntas * 2; i++) {
            const r = i % 2 ? r2 : r1;
            const a = -Math.PI / 2 + (i * Math.PI) / puntas;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fillStyle = relleno;
        ctx.fill();
    }

    /** Esfera con brillo (perlas, burbujas, esferas navideñas). */
    function esfera(ctx, x, y, r, claro, oscuro) {
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.25, claro);
        g.addColorStop(1, oscuro);
        circulo(ctx, x, y, r, g);
    }

    function copo(ctx, x, y, r, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, r / 7);
        ctx.lineCap = "round";
        for (let i = 0; i < 6; i++) {
            ctx.rotate(Math.PI / 3);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -r);
            ctx.moveTo(0, -r * 0.55);
            ctx.lineTo(-r * 0.25, -r * 0.8);
            ctx.moveTo(0, -r * 0.55);
            ctx.lineTo(r * 0.25, -r * 0.8);
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Puntos de azar fijos (la decoración sale igual en todos los cartones). */
    function azarFijo(n) {
        const r = mulberry32(n);
        return (a, b) => a + r() * (b - a);
    }

    /** Lugares libres de casillas y textos: orillas a los lados de la cuadrícula y esquinas. */
    const LADOS = { izq: 62, der: G.W - 62 };

    function caminoHuevo(ctx, x, y, w, h) {
        const rx = w / 2;
        const y0 = y - h / 2 + h * 0.58;
        ctx.beginPath();
        ctx.ellipse(x, y0, rx, h * 0.58, 0, Math.PI, Math.PI * 2);
        ctx.ellipse(x, y0, rx, h * 0.42, 0, 0, Math.PI);
        ctx.closePath();
    }

    const PASTELES = [["#ffb3c7", "#ff6f9a"], ["#b5e3ff", "#4fb0ea"], ["#c9f2c0", "#5cbf55"], ["#ffe59e", "#f2b705"], ["#dcc6ff", "#9a6be0"]];

    function huevo(ctx, x, y, w, h, k, angulo) {
        const [base, linea] = PASTELES[k % PASTELES.length];
        ctx.save();
        ctx.translate(x, y);
        if (angulo) ctx.rotate(angulo);
        caminoHuevo(ctx, 0, 0, w, h);
        ctx.fillStyle = base;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = linea;
        ctx.fillStyle = "#ffffff";
        ctx.lineWidth = Math.max(3, w / 14);
        const tipo = k % 3;
        if (tipo === 0) {
            /* zigzag al centro y bandas */
            ctx.beginPath();
            const paso = w / 6;
            for (let i = 0; i <= 6; i++) ctx.lineTo(-w / 2 + i * paso, (i % 2 ? -1 : 1) * h * 0.06);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-w, -h * 0.22);
            ctx.lineTo(w, -h * 0.22);
            ctx.moveTo(-w, h * 0.24);
            ctx.lineTo(w, h * 0.24);
            ctx.stroke();
        } else if (tipo === 1) {
            /* lunares */
            for (let f = -2; f <= 2; f++) {
                for (let c = -2; c <= 2; c++) circulo(ctx, c * w * 0.26 + (f % 2 ? w * 0.13 : 0), f * h * 0.2, w * 0.07, "#ffffff");
            }
        } else {
            /* rayas onduladas */
            for (let f = -2; f <= 2; f++) {
                ctx.beginPath();
                for (let i = 0; i <= 12; i++) ctx.lineTo(-w / 2 + (i * w) / 12, f * h * 0.18 + Math.sin(i) * h * 0.025);
                ctx.strokeStyle = f % 2 ? "#ffffff" : linea;
                ctx.stroke();
            }
        }
        ctx.restore();
        caminoHuevo(ctx, 0, 0, w, h);
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = 2;
        ctx.stroke();
        /* brillo */
        ctx.beginPath();
        ctx.ellipse(-w * 0.18, -h * 0.2, w * 0.08, h * 0.14, -0.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fill();
        ctx.restore();
    }

    function conejo(ctx, x, y, s, espejo) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(espejo ? -s : s, s);
        const blanco = "#ffffff";
        const rosa = "#ffc2d6";
        const linea = "#d9c7ea";
        ctx.lineWidth = 3;
        ctx.strokeStyle = linea;
        /* orejas */
        [[-22, -0.18], [22, 0.22]].forEach(([dx, a]) => {
            ctx.save();
            ctx.translate(dx, -70);
            ctx.rotate(a);
            ctx.beginPath();
            ctx.ellipse(0, -40, 19, 52, 0, 0, Math.PI * 2);
            ctx.fillStyle = blanco;
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(0, -38, 9, 38, 0, 0, Math.PI * 2);
            ctx.fillStyle = rosa;
            ctx.fill();
            ctx.restore();
        });
        /* cabeza */
        ctx.beginPath();
        ctx.ellipse(0, -30, 56, 50, 0, 0, Math.PI * 2);
        ctx.fillStyle = blanco;
        ctx.fill();
        ctx.stroke();
        /* cara */
        circulo(ctx, -20, -38, 7, "#3b2a5a");
        circulo(ctx, 20, -38, 7, "#3b2a5a");
        circulo(ctx, -18, -41, 2.4, "#ffffff");
        circulo(ctx, 22, -41, 2.4, "#ffffff");
        circulo(ctx, -34, -18, 10, "rgba(255,150,190,0.45)");
        circulo(ctx, 34, -18, 10, "rgba(255,150,190,0.45)");
        ctx.beginPath();
        ctx.moveTo(-7, -24);
        ctx.lineTo(7, -24);
        ctx.lineTo(0, -16);
        ctx.closePath();
        ctx.fillStyle = "#ff8fb1";
        ctx.fill();
        ctx.strokeStyle = "#b9a3cf";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -16);
        ctx.quadraticCurveTo(-8, -6, -14, -12);
        ctx.moveTo(0, -16);
        ctx.quadraticCurveTo(8, -6, 14, -12);
        [-1, 1].forEach((l) => {
            ctx.moveTo(l * 18, -20);
            ctx.lineTo(l * 50, -26);
            ctx.moveTo(l * 18, -16);
            ctx.lineTo(l * 50, -12);
        });
        ctx.stroke();
        ctx.restore();
    }

    function calabaza(ctx, x, y, w, h, cara) {
        ctx.save();
        ctx.translate(x, y);
        /* tallo */
        ctx.fillStyle = "#4f7a28";
        ctx.beginPath();
        ctx.moveTo(-w * 0.05, -h * 0.4);
        ctx.quadraticCurveTo(-w * 0.02, -h * 0.62, w * 0.12, -h * 0.66);
        ctx.lineTo(w * 0.1, -h * 0.58);
        ctx.quadraticCurveTo(w * 0.05, -h * 0.52, w * 0.07, -h * 0.4);
        ctx.closePath();
        ctx.fill();
        /* gajos */
        const gajos = [[-0.3, 0.24], [0.3, 0.24], [-0.16, 0.3], [0.16, 0.3], [0, 0.3]];
        gajos.forEach(([dx, rx]) => {
            ctx.beginPath();
            ctx.ellipse(dx * w, 0, rx * w, h * 0.45, 0, 0, Math.PI * 2);
            const g = ctx.createRadialGradient(dx * w - w * 0.05, -h * 0.15, 4, dx * w, 0, h * 0.5);
            g.addColorStop(0, "#ffad42");
            g.addColorStop(1, "#e2620c");
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = "#b44a06";
            ctx.lineWidth = 2;
            ctx.stroke();
        });
        if (cara) {
            ctx.fillStyle = "#ffd54a";
            ctx.shadowColor = "#ffcc33";
            ctx.shadowBlur = 12;
            [-1, 1].forEach((l) => {
                ctx.beginPath();
                ctx.moveTo(l * w * 0.08, -h * 0.02);
                ctx.lineTo(l * w * 0.3, -h * 0.02);
                ctx.lineTo(l * w * 0.19, -h * 0.2);
                ctx.closePath();
                ctx.fill();
            });
            ctx.beginPath();
            const pasos = 7;
            ctx.moveTo(-w * 0.3, h * 0.1);
            for (let i = 1; i <= pasos; i++) ctx.lineTo(-w * 0.3 + (i * w * 0.6) / pasos, h * 0.1 + (i % 2 ? h * 0.07 : 0));
            ctx.quadraticCurveTo(0, h * 0.34, -w * 0.3, h * 0.1);
            ctx.fill();
        }
        ctx.restore();
    }

    function murcielago(ctx, x, y, s, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.quadraticCurveTo(10, -14, 22, -10);
        ctx.quadraticCurveTo(34, -12, 44, -4);
        ctx.quadraticCurveTo(36, -2, 34, 6);
        ctx.quadraticCurveTo(28, 0, 22, 6);
        ctx.quadraticCurveTo(16, 0, 10, 6);
        ctx.quadraticCurveTo(6, 2, 0, 10);
        ctx.quadraticCurveTo(-6, 2, -10, 6);
        ctx.quadraticCurveTo(-16, 0, -22, 6);
        ctx.quadraticCurveTo(-28, 0, -34, 6);
        ctx.quadraticCurveTo(-36, -2, -44, -4);
        ctx.quadraticCurveTo(-34, -12, -22, -10);
        ctx.quadraticCurveTo(-10, -14, 0, -6);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-6, -2);
        ctx.lineTo(-7, -14);
        ctx.lineTo(-2, -9);
        ctx.lineTo(2, -9);
        ctx.lineTo(7, -14);
        ctx.lineTo(6, -2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function telarana(ctx, x, y, r, dirX, dirY, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const rayos = 6;
        const angulo = (i) => (Math.PI / 2) * (i / (rayos - 1));
        const punto = (i, rr) => [x + dirX * Math.cos(angulo(i)) * rr, y + dirY * Math.sin(angulo(i)) * rr];
        for (let i = 0; i < rayos; i++) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(...punto(i, r));
            ctx.stroke();
        }
        for (let k = 1; k <= 5; k++) {
            const rr = (r * k) / 5.2;
            ctx.beginPath();
            ctx.moveTo(...punto(0, rr));
            for (let i = 1; i < rayos; i++) {
                const [ax, ay] = punto(i - 0.5, rr * 0.84);
                ctx.quadraticCurveTo(ax, ay, ...punto(i, rr));
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    function arbolNavidad(ctx, x, y, w, h) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "#6b3e1f";
        ctx.fillRect(-w * 0.08, h * 0.38, w * 0.16, h * 0.14);
        const pisos = [[-0.5, -0.08, 0.5], [-0.24, 0.16, 0.42], [0.02, 0.4, 0.5]];
        pisos.forEach(([arriba, abajo, ancho], i) => {
            ctx.beginPath();
            ctx.moveTo(0, arriba * h);
            ctx.lineTo(ancho * w, abajo * h);
            ctx.lineTo(-ancho * w, abajo * h);
            ctx.closePath();
            ctx.fillStyle = i % 2 ? "#2f9e55" : "#3cb563";
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(-ancho * w + 4, abajo * h - 2);
            ctx.lineTo(ancho * w - 4, abajo * h - 2);
            ctx.stroke();
        });
        [["#ff4d4d", -0.18, 0.08], ["#ffd23f", 0.16, 0.02], ["#4dc3ff", 0.05, 0.3], ["#ff4d4d", -0.3, 0.34], ["#ffffff", 0.3, 0.32], ["#ffd23f", -0.08, -0.16]].forEach(([c, dx, dy]) =>
            circulo(ctx, dx * w, dy * h, w * 0.055, c));
        estrella(ctx, 0, -h * 0.52, w * 0.16, w * 0.07, 5, "#ffd23f");
        ctx.restore();
    }

    function esferaColgante(ctx, x, largo, r, claro, oscuro) {
        ctx.strokeStyle = "rgba(255,230,160,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, largo - r);
        ctx.stroke();
        ctx.fillStyle = "#d4af37";
        ctx.fillRect(x - r * 0.3, largo - r - r * 0.32, r * 0.6, r * 0.36);
        esfera(ctx, x, largo, r, claro, oscuro);
    }

    function ancla(ctx, x, y, s, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);
        ctx.strokeStyle = color;
        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, -46, 9, 0, Math.PI * 2);
        ctx.moveTo(0, -37);
        ctx.lineTo(0, 44);
        ctx.moveTo(-22, -24);
        ctx.lineTo(22, -24);
        ctx.moveTo(-40, 12);
        ctx.quadraticCurveTo(-34, 46, 0, 46);
        ctx.quadraticCurveTo(34, 46, 40, 12);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-48, 20);
        ctx.lineTo(-40, 6);
        ctx.lineTo(-30, 20);
        ctx.moveTo(48, 20);
        ctx.lineTo(40, 6);
        ctx.lineTo(30, 20);
        ctx.stroke();
        ctx.restore();
    }

    function timon(ctx, x, y, r, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.lineWidth = r * 0.1;
        for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
            ctx.lineTo(Math.cos(a) * r * 1.22, Math.sin(a) * r * 1.22);
            ctx.stroke();
            circulo(ctx, Math.cos(a) * r * 1.26, Math.sin(a) * r * 1.26, r * 0.1, color);
        }
        circulo(ctx, 0, 0, r * 0.82, null, color, r * 0.14);
        circulo(ctx, 0, 0, r * 0.22, color);
        ctx.restore();
    }

    function concha(ctx, x, y, r, espejo) {
        ctx.save();
        ctx.translate(x, y);
        if (espejo) ctx.scale(-1, 1);
        const n = 7;
        const puntas = [];
        for (let i = 0; i <= n; i++) {
            const a = Math.PI + (i / n) * Math.PI;
            puntas.push([Math.cos(a) * r, Math.sin(a) * r * 0.9]);
        }
        ctx.beginPath();
        ctx.moveTo(0, r * 0.3);
        ctx.lineTo(...puntas[0]);
        for (let i = 1; i <= n; i++) {
            const [ax, ay] = puntas[i - 1];
            const [bx, by] = puntas[i];
            const mx = (ax + bx) / 2;
            const my = (ay + by) / 2;
            ctx.quadraticCurveTo(mx * 1.12, my * 1.12, bx, by);
        }
        ctx.closePath();
        ctx.fillStyle = degradado(ctx, 0, -r, 0, r * 0.3, ["#fff1ea", "#f7c9b6"]);
        ctx.fill();
        ctx.strokeStyle = "#d99a85";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
            ctx.moveTo(0, r * 0.3);
            ctx.lineTo(puntas[i][0] * 0.92, puntas[i][1] * 0.92);
        }
        ctx.stroke();
        ctx.fillStyle = "#f3b9a3";
        ctx.fillRect(-r * 0.18, r * 0.22, r * 0.36, r * 0.18);
        esfera(ctx, 0, r * 0.22, r * 0.24, "#f6f3ff", "#b9c4d6");
        ctx.restore();
    }

    /** Collar de perlas que cuelga entre dos puntos (catenaria aproximada). */
    function collarPerlas(ctx, x0, y0, x1, y1, caida, r) {
        const largo = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(2, Math.round(largo / (r * 2.3)));
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * caida;
            esfera(ctx, x, y, r, "#fbf8ff", "#aeb9cc");
        }
    }

    function circuito(ctx, x0, y0, dir, largo, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        const x1 = x0 + dir * 30;
        const x2 = x1 + dir * 26;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y0);
        ctx.lineTo(x2, y0 + 26);
        ctx.lineTo(x2, y0 + 26 + largo);
        ctx.stroke();
        circulo(ctx, x2, y0 + 26 + largo + 8, 8, null, color, 4);
        circulo(ctx, x0, y0, 5, color);
    }

    function esquinaHud(ctx, x, y, dx, dy, largo, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.lineCap = "square";
        ctx.beginPath();
        ctx.moveTo(x, y + dy * largo);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * largo, y);
        ctx.stroke();
    }

    function abanicoDeco(ctx, x, y, dx, dy, r, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        for (let k = 1; k <= 3; k++) {
            ctx.beginPath();
            ctx.arc(x, y, (r * k) / 3, dx > 0 ? (dy > 0 ? 0 : -Math.PI / 2) : dy > 0 ? Math.PI / 2 : Math.PI, dx > 0 ? (dy > 0 ? Math.PI / 2 : 0) : dy > 0 ? Math.PI : Math.PI * 1.5);
            ctx.stroke();
        }
        for (let i = 0; i <= 6; i++) {
            const a = (i / 6) * (Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + dx * Math.cos(a) * r, y + dy * Math.sin(a) * r);
            ctx.stroke();
        }
        ctx.restore();
    }

    const oro = (ctx, y0, y1) => degradado(ctx, 0, y0, 0, y1, ["#8a6417", "#f7e08a", "#d4a73a", "#fff3c2", "#9c7420"]);

    /* ---------- Diseños prediseñados ---------- */

    /**
     * Cada diseño trae su fondo y su estilo de textos y casillas. El organizador puede cambiar cualquier texto,
     * color o tipografía encima del diseño. «sencillo» es el cartón blanco de siempre y «arte» usa la imagen subida.
     */
    const ESTILO_BASE = {
        titulo: { fuente: "montserrat", color: TINTA, tam: 1 },
        subtitulo: { fuente: "montserrat", color: TINTA, tam: 1 },
        letras: { fuente: "montserrat", color: TINTA, tam: 1 },
        numeros: { fuente: "montserrat", color: TINTA, tam: 1 },
        casillas: { fondo: "#ffffff", borde: TINTA },
        pie: { fuente: "montserrat", color: TINTA }
    };

    const TEMAS = {
        sencillo: {
            nombre: "Sencillo",
            detalle: "Blanco con borde",
            fondo(ctx) {
                ctx.strokeStyle = TINTA;
                ctx.lineWidth = 6;
                ctx.strokeRect(24, 24, G.W - 48, G.H - 48);
            }
        },
        clasico: {
            nombre: "Clásico",
            detalle: "Rojo con BINGO en blanco",
            estilo: {
                titulo: { fuente: "anton", color: "#ffffff", tam: 1.3 },
                subtitulo: { fuente: "montserrat", color: "#ffe1e1" },
                letras: { fuente: "anton", color: "#ffffff" },
                numeros: { fuente: "montserrat", color: "#16182a" },
                casillas: { fondo: "#ffffff", borde: "#8c0b17" },
                pie: { fuente: "montserrat", color: "#16182a" }
            },
            sombra: { color: "rgba(0,0,0,0.3)", blur: 6, dy: 4 },
            fondo(ctx) {
                fondoLiso(ctx, ["#e3242f", "#c8102e", "#a10c1e"]);
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 10;
                ctx.strokeRect(26, 26, G.W - 52, G.H - 52);
                ctx.lineWidth = 3;
                ctx.strokeRect(46, 46, G.W - 92, G.H - 92);
                /* focos de marquesina alrededor */
                const paso = 56;
                for (let x = 60; x <= G.W - 60; x += paso) {
                    circulo(ctx, x, 36, 6, "#fff6c9");
                    circulo(ctx, x, G.H - 36, 6, "#fff6c9");
                }
                for (let y = 92; y <= G.H - 92; y += paso) {
                    circulo(ctx, 36, y, 6, "#fff6c9");
                    circulo(ctx, G.W - 36, y, 6, "#fff6c9");
                }
                /* franja oscura detrás de las letras */
                const l = G.letras;
                ctx.fillStyle = "rgba(0,0,0,0.18)";
                ctx.fillRect(l.x, l.y, l.w, l.h);
            }
        },
        chinopc: {
            nombre: "ChinoPCMaster",
            detalle: "Negro y cian, estilo tecnológico",
            estilo: {
                titulo: { fuente: "orbitron", color: "#00e5ff", tam: 1.3 },
                subtitulo: { fuente: "inter", color: "#cfd8e3" },
                letras: { fuente: "orbitron", color: "#ffffff" },
                numeros: { fuente: "orbitron", color: "#0b0f17" },
                casillas: { fondo: "#f2fdff", borde: "#00a9bd" },
                pie: { fuente: "orbitron", color: "#0b0f17" }
            },
            sombra: { color: "rgba(0,229,255,0.75)", blur: 22, dy: 0 },
            margenTitulo: 70,
            fondo(ctx) {
                fondoLiso(ctx, ["#0d1118", "#101722", "#0a0d13"]);
                ctx.strokeStyle = "rgba(0,229,255,0.06)";
                ctx.lineWidth = 1;
                for (let x = 0; x <= G.W; x += 40) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, G.H);
                    ctx.stroke();
                }
                for (let y = 0; y <= G.H; y += 40) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(G.W, y);
                    ctx.stroke();
                }
                ctx.save();
                ctx.shadowColor = "#00e5ff";
                ctx.shadowBlur = 14;
                const az = azarFijo(2024);
                for (let y = 540; y < 1400; y += 150) {
                    circuito(ctx, 10, y + az(0, 30), 1, az(40, 80), "rgba(0,229,255,0.75)");
                    circuito(ctx, G.W - 10, y + 70 + az(0, 30), -1, az(40, 80), "rgba(0,229,255,0.75)");
                }
                const c = "#00e5ff";
                esquinaHud(ctx, 34, 34, 1, 1, 90, c);
                esquinaHud(ctx, G.W - 34, 34, -1, 1, 90, c);
                esquinaHud(ctx, 34, G.H - 34, 1, -1, 90, c);
                esquinaHud(ctx, G.W - 34, G.H - 34, -1, -1, 90, c);
                ctx.restore();
                /* línea bajo el título */
                ctx.fillStyle = degradado(ctx, 200, 0, G.W - 200, 0, ["rgba(0,229,255,0)", "#00e5ff", "rgba(0,229,255,0)"]);
                ctx.fillRect(200, 372, G.W - 400, 4);
            },
            letraFondo(ctx, cx, cy) {
                ctx.save();
                ctx.strokeStyle = "#00e5ff";
                ctx.fillStyle = "rgba(0,229,255,0.12)";
                ctx.lineWidth = 4;
                ctx.shadowColor = "#00e5ff";
                ctx.shadowBlur = 12;
                const w = 150;
                const h = 96;
                ctx.beginPath();
                ctx.moveTo(cx - w / 2 + 18, cy - h / 2);
                ctx.lineTo(cx + w / 2, cy - h / 2);
                ctx.lineTo(cx + w / 2, cy + h / 2 - 18);
                ctx.lineTo(cx + w / 2 - 18, cy + h / 2);
                ctx.lineTo(cx - w / 2, cy + h / 2);
                ctx.lineTo(cx - w / 2, cy - h / 2 + 18);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        },
        ocean: {
            nombre: "Ocean",
            detalle: "Turquesa con perlas, ancla y timón",
            estilo: {
                titulo: { fuente: "righteous", color: "#ffffff", tam: 1.3 },
                subtitulo: { fuente: "nunito", color: "#e3fbff" },
                letras: { fuente: "righteous", color: "#ffffff" },
                numeros: { fuente: "nunito", color: "#063848" },
                casillas: { fondo: "#ffffff", borde: "#0a6e8a" },
                pie: { fuente: "nunito", color: "#063848" }
            },
            sombra: { color: "rgba(0,40,60,0.35)", blur: 8, dy: 4 },
            margenTitulo: 170,
            fondo(ctx) {
                fondoLiso(ctx, ["#2fd3d0", "#13b0bd", "#0b86a0", "#095c79"]);
                /* rayos de luz */
                ctx.save();
                ctx.globalAlpha = 0.1;
                ctx.fillStyle = "#ffffff";
                [[180, 300], [520, 260], [880, 320]].forEach(([x, w]) => {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x + w * 0.4, 0);
                    ctx.lineTo(x + w * 1.4, G.H);
                    ctx.lineTo(x + w * 0.6, G.H);
                    ctx.closePath();
                    ctx.fill();
                });
                ctx.restore();
                /* burbujas */
                const az = azarFijo(77);
                for (let i = 0; i < 26; i++) {
                    const lado = i % 2 ? LADOS.izq : LADOS.der;
                    circulo(ctx, lado + az(-40, 40), az(520, 1460), az(5, 16), "rgba(255,255,255,0.12)", "rgba(255,255,255,0.55)", 2);
                }
                /* perlas: collar arriba y hilos a los lados */
                collarPerlas(ctx, 20, 26, G.W - 20, 26, 46, 11);
                collarPerlas(ctx, LADOS.izq, 520, LADOS.izq + 6, 1440, 0, 9);
                collarPerlas(ctx, LADOS.der, 520, LADOS.der - 6, 1440, 0, 9);
                concha(ctx, 120, 230, 78);
                concha(ctx, G.W - 120, 230, 78, true);
                ancla(ctx, 62, 1570, 0.95, "rgba(255,255,255,0.9)");
                timon(ctx, G.W - 64, 1568, 40, "rgba(255,255,255,0.9)");
                /* olas al pie */
                ctx.fillStyle = "rgba(255,255,255,0.18)";
                ctx.beginPath();
                ctx.moveTo(0, G.H);
                for (let x = 0; x <= G.W; x += 20) ctx.lineTo(x, G.H - 28 + Math.sin(x / 40) * 8);
                ctx.lineTo(G.W, G.H);
                ctx.closePath();
                ctx.fill();
            },
            letraFondo(ctx, cx, cy) {
                circulo(ctx, cx, cy, 52, "rgba(6,56,72,0.35)", "rgba(255,255,255,0.85)", 4);
            }
        },
        gold: {
            nombre: "Gold",
            detalle: "Negro elegante con dorado",
            estilo: {
                titulo: { fuente: "cinzel", color: "#e6c463", tam: 1.3 },
                subtitulo: { fuente: "cinzel", color: "#e9dcae" },
                letras: { fuente: "cinzel", color: "#e6c463" },
                numeros: { fuente: "cinzel", color: "#2b2210" },
                casillas: { fondo: "#fffaf0", borde: "#b8902f" },
                pie: { fuente: "cinzel", color: "#2b2210" }
            },
            oro: true,
            sombra: { color: "rgba(0,0,0,0.6)", blur: 8, dy: 3 },
            margenTitulo: 110,
            fondo(ctx) {
                const g = ctx.createRadialGradient(G.W / 2, G.H * 0.35, 80, G.W / 2, G.H / 2, G.H * 0.75);
                g.addColorStop(0, "#2a2216");
                g.addColorStop(1, "#0b0906");
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, G.W, G.H);
                /* rayos art déco detrás del título */
                ctx.save();
                ctx.globalAlpha = 0.09;
                ctx.fillStyle = "#e6c463";
                for (let i = 0; i < 18; i++) {
                    const a = Math.PI + (i / 17) * Math.PI;
                    ctx.beginPath();
                    ctx.moveTo(G.W / 2, 400);
                    ctx.lineTo(G.W / 2 + Math.cos(a - 0.03) * 900, 400 + Math.sin(a - 0.03) * 900);
                    ctx.lineTo(G.W / 2 + Math.cos(a + 0.03) * 900, 400 + Math.sin(a + 0.03) * 900);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
                ctx.strokeStyle = oro(ctx, 0, G.H);
                ctx.lineWidth = 12;
                ctx.strokeRect(28, 28, G.W - 56, G.H - 56);
                ctx.lineWidth = 3;
                ctx.strokeRect(50, 50, G.W - 100, G.H - 100);
                const c = "#d4a73a";
                abanicoDeco(ctx, 50, 50, 1, 1, 90, c);
                abanicoDeco(ctx, G.W - 50, 50, -1, 1, 90, c);
                abanicoDeco(ctx, 50, G.H - 50, 1, -1, 90, c);
                abanicoDeco(ctx, G.W - 50, G.H - 50, -1, -1, 90, c);
                /* rombos y filetes */
                ctx.fillStyle = oro(ctx, 360, 390);
                [[G.W / 2, 376]].forEach(([x, y]) => {
                    ctx.beginPath();
                    ctx.moveTo(x, y - 12);
                    ctx.lineTo(x + 12, y);
                    ctx.lineTo(x, y + 12);
                    ctx.lineTo(x - 12, y);
                    ctx.closePath();
                    ctx.fill();
                });
                ctx.fillRect(250, 374, 320, 3);
                ctx.fillRect(G.W - 570, 374, 320, 3);
                const cz = G.casillas;
                ctx.strokeStyle = oro(ctx, cz.y, cz.y + cz.celda * 5);
                ctx.lineWidth = 6;
                ctx.strokeRect(cz.x - 12, cz.y - 12, cz.celda * 5 + 24, cz.celda * 5 + 24);
            }
        },
        navidad: {
            nombre: "Navidad",
            detalle: "Árboles, esferas y nieve",
            estilo: {
                titulo: { fuente: "navidad", color: "#ffffff", tam: 1.3 },
                subtitulo: { fuente: "montserrat", color: "#ffe9a8" },
                letras: { fuente: "navidad", color: "#ffffff" },
                numeros: { fuente: "montserrat", color: "#0f3d26" },
                casillas: { fondo: "#ffffff", borde: "#b3121f" },
                pie: { fuente: "montserrat", color: "#0f3d26" }
            },
            sombra: { color: "rgba(0,0,0,0.4)", blur: 8, dy: 4 },
            margenTitulo: 190,
            fondo(ctx) {
                fondoLiso(ctx, ["#14603b", "#0f4d30", "#0a3a24"]);
                /* borde de bastón de caramelo */
                ctx.lineWidth = 16;
                ctx.strokeStyle = "#ffffff";
                ctx.strokeRect(16, 16, G.W - 32, G.H - 32);
                ctx.setLineDash([28, 28]);
                ctx.strokeStyle = "#d61f2c";
                ctx.strokeRect(16, 16, G.W - 32, G.H - 32);
                ctx.setLineDash([]);
                const az = azarFijo(1225);
                for (let i = 0; i < 40; i++) {
                    const x = i < 14 ? az(40, G.W - 40) : i % 2 ? az(30, 110) : az(G.W - 110, G.W - 30);
                    const y = i < 14 ? az(40, 380) : az(520, 1640);
                    copo(ctx, x, y, az(7, 16), "rgba(255,255,255,0.55)");
                }
                [[70, 150, 30, "#ff6b6b", "#a1101c"], [150, 230, 26, "#ffe27a", "#c48a00"], [G.W - 150, 230, 26, "#8fd3ff", "#1d6fb8"], [G.W - 70, 150, 30, "#ff6b6b", "#a1101c"]].forEach(
                    ([x, largo, r, a, b]) => esferaColgante(ctx, x, largo, r, a, b));
                arbolNavidad(ctx, LADOS.izq, 700, 104, 170);
                arbolNavidad(ctx, LADOS.der, 960, 104, 170);
                arbolNavidad(ctx, LADOS.izq, 1220, 104, 170);
                /* nieve al pie */
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.moveTo(0, G.H);
                ctx.lineTo(0, G.H - 40);
                for (let x = 0; x <= G.W; x += 60) ctx.quadraticCurveTo(x + 30, G.H - 58, x + 60, G.H - 40);
                ctx.lineTo(G.W, G.H);
                ctx.closePath();
                ctx.fill();
            },
            letraFondo(ctx, cx, cy, i) {
                const colores = [["#ff6b6b", "#a1101c"], ["#6fc3ff", "#1b5aa6"], ["#ff6b6b", "#a1101c"], ["#6fc3ff", "#1b5aa6"], ["#ff6b6b", "#a1101c"]][i];
                ctx.fillStyle = "#d4af37";
                ctx.fillRect(cx - 13, cy - 64, 26, 14);
                esfera(ctx, cx, cy, 54, colores[0], colores[1]);
            }
        },
        halloween: {
            nombre: "Halloween",
            detalle: "Calabazas, murciélagos y luna",
            estilo: {
                titulo: { fuente: "creepster", color: "#ff7a1a", tam: 1.3 },
                subtitulo: { fuente: "montserrat", color: "#e8d6ff" },
                letras: { fuente: "creepster", color: "#2b0d00" },
                numeros: { fuente: "montserrat", color: "#1c0b2e" },
                casillas: { fondo: "#fff6ea", borde: "#ff7a1a" },
                pie: { fuente: "montserrat", color: "#1c0b2e" }
            },
            sombra: { color: "rgba(0,0,0,0.7)", blur: 10, dy: 4 },
            margenTitulo: 200,
            fondo(ctx) {
                fondoLiso(ctx, ["#2b0f4a", "#1f0b35", "#120720"]);
                /* luna */
                ctx.save();
                ctx.shadowColor = "#ffcf6b";
                ctx.shadowBlur = 60;
                circulo(ctx, G.W - 130, 150, 82, "#ffd98a");
                ctx.restore();
                circulo(ctx, G.W - 150, 130, 14, "rgba(200,150,60,0.35)");
                circulo(ctx, G.W - 105, 175, 10, "rgba(200,150,60,0.35)");
                murcielago(ctx, G.W - 250, 90, 1.4, "#0a0410");
                murcielago(ctx, G.W - 60, 290, 1, "#0a0410");
                murcielago(ctx, 270, 70, 1.1, "#0a0410");
                telarana(ctx, 0, 0, 220, 1, 1, "rgba(255,255,255,0.4)");
                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(120, 60);
                ctx.lineTo(120, 260);
                ctx.stroke();
                circulo(ctx, 120, 270, 13, "#0a0410");
                const az = azarFijo(1031);
                for (let i = 0; i < 18; i++) circulo(ctx, az(20, G.W - 20), az(20, 380), az(1.5, 3), "rgba(255,255,255,0.6)");
                calabaza(ctx, LADOS.izq, 720, 104, 92, true);
                calabaza(ctx, LADOS.der, 1000, 104, 92, true);
                calabaza(ctx, LADOS.izq, 1280, 104, 92, true);
                murcielago(ctx, LADOS.der, 640, 1, "#0a0410");
                murcielago(ctx, LADOS.izq, 980, 0.9, "#0a0410");
                murcielago(ctx, LADOS.der, 1320, 1, "#0a0410");
                calabaza(ctx, 62, 1585, 100, 88, true);
                calabaza(ctx, G.W - 62, 1585, 100, 88, true);
            },
            letraFondo(ctx, cx, cy) {
                calabaza(ctx, cx, cy + 6, 150, 104, false);
            }
        },
        pascua: {
            nombre: "Pascua",
            detalle: "Conejos y huevos de pascua",
            estilo: {
                titulo: { fuente: "fredoka", color: "#7a46b8", tam: 1.3 },
                subtitulo: { fuente: "fredoka", color: "#5d74a3" },
                letras: { fuente: "fredoka", color: "#4a2f73" },
                numeros: { fuente: "fredoka", color: "#4a2f73" },
                casillas: { fondo: "#ffffff", borde: "#b493e0" },
                pie: { fuente: "fredoka", color: "#4a2f73" }
            },
            sombra: { color: "rgba(122,70,184,0.25)", blur: 6, dy: 3 },
            margenTitulo: 200,
            fondo(ctx) {
                fondoLiso(ctx, ["#fdeeff", "#eaf5ff", "#eafff1"]);
                const az = azarFijo(4040);
                for (let i = 0; i < 70; i++) {
                    const [c] = PASTELES[i % PASTELES.length];
                    circulo(ctx, az(10, G.W - 10), az(10, G.H - 10), az(4, 10), c);
                }
                ctx.strokeStyle = "#d6c2f2";
                ctx.lineWidth = 8;
                ctx.setLineDash([2, 18]);
                ctx.lineCap = "round";
                ctx.strokeRect(24, 24, G.W - 48, G.H - 48);
                ctx.setLineDash([]);
                conejo(ctx, 125, 300, 1.35);
                conejo(ctx, G.W - 125, 300, 1.35, true);
                [620, 830, 1040, 1250].forEach((y, k) => {
                    huevo(ctx, LADOS.izq, y, 74, 98, k, -0.15);
                    huevo(ctx, LADOS.der, y + 100, 74, 98, k + 2, 0.15);
                });
                /* pasto con huevos al pie */
                ctx.fillStyle = "#8fd694";
                ctx.beginPath();
                ctx.moveTo(0, G.H);
                for (let x = 0; x <= G.W; x += 16) ctx.lineTo(x, G.H - (x % 32 ? 26 : 44));
                ctx.lineTo(G.W, G.H);
                ctx.closePath();
                ctx.fill();
                huevo(ctx, 50, 1600, 64, 84, 0, -0.3);
                huevo(ctx, 92, 1620, 56, 72, 3, 0.25);
                huevo(ctx, G.W - 50, 1600, 64, 84, 1, 0.3);
                huevo(ctx, G.W - 92, 1620, 56, 72, 4, -0.25);
            },
            letraFondo(ctx, cx, cy, i) {
                huevo(ctx, cx, cy, 96, 112, i + 1, 0);
                caminoHuevo(ctx, cx, cy - 2, 62, 74);
                ctx.fillStyle = "rgba(255,255,255,0.82)";
                ctx.fill();
            }
        }
    };

    const ORDEN_TEMAS = ["sencillo", "clasico", "chinopc", "ocean", "gold", "navidad", "halloween", "pascua"];

    const colorValido = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

    /**
     * Diseño guardado (JSON o texto) → estilo completo listo para dibujar.
     * d = { tema, titulo: { texto, mostrar, fuente, color, tam }, subtitulo: {…}, letras: { fuente, color, tam },
     *       numeros: {…}, casillas: { fondo, borde }, pie: { fuente, color } }; lo vacío toma lo del diseño.
     */
    function resolverDiseno(entrada, hayArte) {
        let d = entrada;
        if (typeof d === "string") {
            try {
                d = d ? JSON.parse(d) : {};
            } catch (e) {
                d = {};
            }
        }
        if (!d || typeof d !== "object") d = {};
        let tema = d.tema;
        if (tema !== "arte" && !TEMAS[tema]) tema = hayArte ? "arte" : "sencillo";
        if (tema === "arte" && !hayArte) tema = "sencillo";
        const def = TEMAS[tema] || {};
        const base = def.estilo || ESTILO_BASE;
        const r = { tema, def };
        Object.keys(ESTILO_BASE).forEach((k) => {
            const b = { ...ESTILO_BASE[k], ...(base[k] || {}) };
            const o = d[k] && typeof d[k] === "object" ? d[k] : {};
            const x = { ...b, defecto: { ...b } };
            if (o.fuente && FUENTES[o.fuente]) x.fuente = o.fuente;
            ["color", "fondo", "borde"].forEach((c) => {
                if (colorValido(o[c])) x[c] = o[c];
            });
            if (o.tam !== undefined && Number(o.tam) > 0) x.tam = Math.min(1.6, Math.max(0.5, Number(o.tam)));
            if (k === "titulo" || k === "subtitulo") {
                x.texto = typeof o.texto === "string" ? o.texto.slice(0, 80) : "";
                /* Con arte propio el título viene en la imagen: solo se escribe si el organizador lo pide. */
                x.mostrar = o.mostrar === undefined ? tema !== "arte" : o.mostrar !== false;
            }
            r[k] = x;
        });
        return r;
    }

    /** Tipografías que usa un diseño, en el formato de document.fonts.load(). */
    function fuentesDiseno(entrada, hayArte) {
        const d = resolverDiseno(entrada, hayArte);
        const set = new Set(["titulo", "subtitulo", "letras", "numeros", "pie"].map((k) => {
            const f = fuente(d[k].fuente);
            return `${f.w} 40px ${f.css.split(",")[0]}`;
        }));
        return [...set];
    }

    /** Relleno del texto: el dorado del diseño Gold es un degradado mientras el color sea el del diseño. */
    function rellenoTexto(ctx, D, x, y, size) {
        if (D.def.oro && x.color.toLowerCase() === x.defecto.color.toLowerCase()) return oro(ctx, y - size / 2, y + size / 2);
        return x.color;
    }

    function dibujarX(ctx, r, grosor) {
        const p = r.w * 0.14;
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.strokeStyle = ROJO;
        ctx.lineWidth = grosor || r.w * 0.07;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(r.x + p, r.y + p);
        ctx.lineTo(r.x + r.w - p, r.y + r.h - p);
        ctx.moveTo(r.x + r.w - p, r.y + p);
        ctx.lineTo(r.x + p, r.y + r.h - p);
        ctx.stroke();
        ctx.restore();
    }

    function dibujarQR(ctx, texto, r) {
        if (typeof window === "undefined" || typeof window.qrcode !== "function") {
            ctx.strokeStyle = TINTA;
            ctx.lineWidth = 3;
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            return;
        }
        const qr = window.qrcode(0, "M");
        qr.addData(texto);
        qr.make();
        const n = qr.getModuleCount();
        const cell = r.w / (n + 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = TINTA;
        for (let f = 0; f < n; f++) {
            for (let c = 0; c < n; c++) {
                if (qr.isDark(f, c)) {
                    ctx.fillRect(r.x + (c + 1) * cell, r.y + (f + 1) * cell, Math.ceil(cell), Math.ceil(cell));
                }
            }
        }
    }

    /**
     * Dibuja un cartón completo en un canvas de 1200 × 1680.
     * opts: { seed, serie, arte (Image|null), titulo, subtitulo, letras (bool), marcas (grid bool|null),
     *         resaltar ([[f,c]]|null), qrTexto, familia, centroNumero (bool), centroImg (Image|null), sello (texto) }
     */
    function dibujarCarton(canvas, opts) {
        const ctx = canvas.getContext("2d");
        canvas.width = G.W;
        canvas.height = G.H;
        const familia = opts.familia || "'Montserrat', Arial, sans-serif";
        const grid = carton(opts.seed, opts.serie, opts.centroNumero);
        const D = resolverDiseno(opts.diseno, Boolean(opts.arte));
        const conTema = D.tema !== "arte" && D.tema !== "sencillo";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, G.W, G.H);

        ctx.save();
        if (D.tema === "arte" && opts.arte) ctx.drawImage(opts.arte, 0, 0, G.W, G.H);
        else if (D.tema === "arte") TEMAS.sencillo.fondo(ctx);
        else D.def.fondo(ctx);
        ctx.restore();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const conSombra = (fn) => {
            ctx.save();
            const s = D.def.sombra;
            if (s) {
                ctx.shadowColor = s.color;
                ctx.shadowBlur = s.blur;
                ctx.shadowOffsetY = s.dy || 0;
            }
            fn();
            ctx.restore();
        };
        /** Escribe un texto con su tipografía, color y tamaño; se achica si no cabe a lo ancho. */
        const escribir = (x, texto, cx, cy, maxW, size, peso) => {
            const f = fuente(x.fuente);
            const s0 = Math.round(size * (x.tam || 1));
            ctx.font = `${peso || f.w} ${s0}px ${f.css}`;
            ctx.fillStyle = rellenoTexto(ctx, D, x, cy, s0);
            return textoAjustado(ctx, texto, cx, cy, maxW, s0, peso || f.w, f.css);
        };

        const t = G.titulo;
        const margen = D.def.margenTitulo || 20;
        const titulo = D.titulo.texto || String(opts.titulo || "BINGO");
        const subtitulo = D.subtitulo.texto || String(opts.subtitulo || "");
        const haySub = D.subtitulo.mostrar && subtitulo;
        if (D.titulo.mostrar) {
            conSombra(() => escribir(D.titulo, titulo, t.x + t.w / 2, t.y + t.h * (haySub ? 0.42 : 0.5), t.w - margen * 2, 96));
        }
        if (haySub) {
            conSombra(() => escribir(D.subtitulo, subtitulo, t.x + t.w / 2, t.y + t.h * (D.titulo.mostrar ? 0.78 : 0.5), t.w - margen * 2, 48, D.subtitulo.fuente === "montserrat" ? 600 : null));
        }
        /* Las letras B I N G O: con arte propio o en el cartón sencillo se pueden apagar; los diseños siempre las traen. */
        if (conTema || opts.letras !== false) {
            const l = G.letras;
            const w = l.w / 5;
            LETRAS.forEach((letra, i) => {
                const cx = l.x + w * i + w / 2;
                const cy = l.y + l.h / 2;
                if (D.def.letraFondo) {
                    ctx.save();
                    D.def.letraFondo(ctx, cx, cy, i);
                    ctx.restore();
                }
                const fondoPropio = Boolean(D.def.letraFondo);
                const dibujar = () => escribir(D.letras, letra, cx, cy + 4, w - 20, Math.round(l.h * (fondoPropio ? 0.72 : 0.86)));
                if (fondoPropio) dibujar();
                else conSombra(dibujar);
            });
        }

        const resaltadas = new Set((opts.resaltar || []).map(([f, c]) => `${f},${c}`));
        const fNum = fuente(D.numeros.fuente);
        for (let f = 0; f < 5; f++) {
            for (let c = 0; c < 5; c++) {
                const r = celdaRect(f, c);
                const resaltada = resaltadas.has(`${f},${c}`);
                ctx.fillStyle = resaltada ? "#fff2b3" : D.casillas.fondo;
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeStyle = D.casillas.borde;
                ctx.lineWidth = 3;
                ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
                const n = grid[f][c];
                ctx.fillStyle = resaltada ? TINTA : D.numeros.color;
                if (n === 0 && opts.centroImg) {
                    ctx.drawImage(opts.centroImg, r.x, r.y, r.w, r.h);
                    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
                } else if (n === 0) {
                    textoAjustado(ctx, "LIBRE", r.x + r.w / 2, r.y + r.h / 2, r.w - 24, Math.round(34 * Math.min(1.3, D.numeros.tam || 1)), fNum.w, fNum.css);
                } else {
                    textoAjustado(ctx, String(n), r.x + r.w / 2, r.y + r.h / 2 + 4, r.w - 24, Math.round(92 * (D.numeros.tam || 1)), fNum.w, fNum.css);
                }
                if (opts.marcas && opts.marcas[f][c] && n !== 0) dibujarX(ctx, r);
            }
        }

        const fPie = fuente(D.pie.fuente);
        [["serie", `Serie ${serieTexto(opts.serie)}`], ["codigo", `Código ${codigo(opts.seed, opts.serie)}`]].forEach(
            ([zona, texto]) => {
                const z = G[zona];
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(z.x, z.y, z.w, z.h);
                if (conTema) {
                    ctx.strokeStyle = D.casillas.borde;
                    ctx.lineWidth = 3;
                    ctx.strokeRect(z.x + 1.5, z.y + 1.5, z.w - 3, z.h - 3);
                }
                ctx.fillStyle = D.pie.color;
                textoAjustado(ctx, texto, z.x + z.w / 2, z.y + z.h / 2, z.w - 20, 46, fPie.w, fPie.css);
            }
        );
        if (opts.qrTexto) dibujarQR(ctx, opts.qrTexto, G.qr);
        if (opts.sello) {
            const cz = G.casillas;
            ctx.save();
            ctx.translate(cz.x + cz.celda * 2.5, cz.y + cz.celda * 2.5);
            ctx.rotate(-Math.PI / 9);
            ctx.font = `900 130px ${familia}`;
            const w = ctx.measureText(opts.sello).width + 60;
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(-w / 2, -95, w, 190);
            ctx.strokeStyle = ROJO;
            ctx.lineWidth = 12;
            ctx.strokeRect(-w / 2, -95, w, 190);
            ctx.fillStyle = ROJO;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(opts.sello, 0, 8);
            ctx.restore();
        }
        return canvas;
    }

    /** Template vacío: solo zonas delimitadas y medidas, sin imagen. */
    function dibujarTemplate(canvas, opciones) {
        const transparente = Boolean(opciones && opciones.transparente);
        const ctx = canvas.getContext("2d");
        canvas.width = G.W;
        canvas.height = G.H;
        ctx.clearRect(0, 0, G.W, G.H);
        if (!transparente) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, G.W, G.H);
        }
        const familia = "Arial, sans-serif";
        const zona = (r, etiqueta, detalle, color) => {
            ctx.save();
            ctx.setLineDash([18, 12]);
            ctx.lineWidth = 4;
            ctx.strokeStyle = color;
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.restore();
            ctx.fillStyle = color;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `700 34px ${familia}`;
            ctx.fillText(etiqueta, r.x + r.w / 2, r.y + r.h / 2 - (detalle ? 18 : 0));
            if (detalle) {
                ctx.font = `400 24px ${familia}`;
                ctx.fillText(detalle, r.x + r.w / 2, r.y + r.h / 2 + 22);
            }
        };
        const azul = "#2563c9";
        const gris = "#7a8098";
        const rojo = "#d23a3a";
        const t = G.titulo;
        zona(t, "ESPACIO PARA TÍTULO", `Arte libre · ${t.w} × ${t.h} px · desde y = ${t.y}`, azul);
        const l = G.letras;
        zona(l, "B   I   N   G   O", `Letras del sistema (o tu propio diseño) · ${l.w} × ${l.h} px`, azul);
        for (let f = 0; f < 5; f++) {
            for (let c = 0; c < 5; c++) {
                const r = celdaRect(f, c);
                ctx.save();
                ctx.setLineDash([10, 8]);
                ctx.lineWidth = 3;
                ctx.strokeStyle = rojo;
                ctx.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
                ctx.restore();
                ctx.fillStyle = rojo;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = `700 26px ${familia}`;
                const centro = f === 2 && c === 2;
                ctx.fillText(centro ? "LIBRE o N" : LETRAS[c], r.x + r.w / 2, r.y + r.h / 2 - 12);
                ctx.font = `400 18px ${familia}`;
                ctx.fillText(centro ? `imagen ${r.w} × ${r.h} px` : "casilla blanca", r.x + r.w / 2, r.y + r.h / 2 + 20);
            }
        }
        const cz = G.casillas;
        ctx.fillStyle = rojo;
        ctx.font = `400 22px ${familia}`;
        ctx.textAlign = "left";
        ctx.fillText(`Casillas: ${cz.celda * 5} × ${cz.celda * 5} px desde (${cz.x}, ${cz.y}) · el sistema las pinta de blanco`, cz.x, cz.y - 2 + cz.celda * 5 + 14);
        zona(G.serie, "SERIE", `${G.serie.w} × ${G.serie.h} px`, gris);
        zona(G.qr, "QR", `${G.qr.w} px`, gris);
        zona(G.codigo, "CÓDIGO", `${G.codigo.w} × ${G.codigo.h} px`, gris);
        ctx.fillStyle = gris;
        ctx.textAlign = "center";
        ctx.font = `400 22px ${familia}`;
        ctx.fillText(`Template Bingo Digital · ${G.W} × ${G.H} px · 10 × 14 cm`, G.W / 2, G.H - 16);
        return canvas;
    }

    /** Coordenadas (en px del canvas) → casilla [f, c] o null. */
    function casillaEn(x, y) {
        const { x: cx, y: cy, celda } = G.casillas;
        const c = Math.floor((x - cx) / celda);
        const f = Math.floor((y - cy) / celda);
        if (c < 0 || c > 4 || f < 0 || f > 4) return null;
        return [f, c];
    }

    /** Medidas en mm para colocar N cartones por hoja carta. */
    const DISPOSICIONES = {
        1: { orient: "portrait", cols: 1, rows: 1 },
        2: { orient: "landscape", cols: 2, rows: 1 },
        4: { orient: "portrait", cols: 2, rows: 2 },
        6: { orient: "landscape", cols: 3, rows: 2 }
    };

    function disposicion(porHoja) {
        const d = DISPOSICIONES[porHoja] || DISPOSICIONES[4];
        const pw = d.orient === "portrait" ? 215.9 : 279.4;
        const ph = d.orient === "portrait" ? 279.4 : 215.9;
        const margen = 6;
        const gap = 4;
        const maxW = (pw - margen * 2 - gap * (d.cols - 1)) / d.cols;
        const maxH = (ph - margen * 2 - gap * (d.rows - 1)) / d.rows;
        const w = Math.min(maxW, maxH * (G.W / G.H));
        const h = w * (G.H / G.W);
        const ox = (pw - (w * d.cols + gap * (d.cols - 1))) / 2;
        const oy = (ph - (h * d.rows + gap * (d.rows - 1))) / 2;
        const posiciones = [];
        for (let r = 0; r < d.rows; r++) {
            for (let c = 0; c < d.cols; c++) posiciones.push({ x: ox + c * (w + gap), y: oy + r * (h + gap), w, h });
        }
        return { ...d, pw, ph, posiciones };
    }

    window.BingoCore = {
        MAX_CARTONES,
        LETRAS,
        GEOMETRIA: G,
        FIGURAS,
        ORDEN_FIGURAS,
        alternativasDe,
        nombreFigura,
        blancos,
        eliminadoPor,
        carton,
        codigo,
        serieTexto,
        setDigitos,
        letraDe,
        marcadas,
        faltan,
        casillasGanadoras,
        dibujarCarton,
        dibujarTemplate,
        FUENTES,
        FUENTES_URL,
        TEMAS: Object.fromEntries(ORDEN_TEMAS.map((k) => [k, { nombre: TEMAS[k].nombre, detalle: TEMAS[k].detalle }])),
        ORDEN_TEMAS,
        resolverDiseno,
        fuentesDiseno,
        casillaEn,
        disposicion
    };
})();
