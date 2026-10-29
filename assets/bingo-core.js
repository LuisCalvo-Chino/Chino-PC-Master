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

    function serieTexto(serie) {
        return String(serie).padStart(5, "0");
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
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, G.W, G.H);

        if (opts.arte) {
            ctx.drawImage(opts.arte, 0, 0, G.W, G.H);
        } else {
            ctx.strokeStyle = TINTA;
            ctx.lineWidth = 6;
            ctx.strokeRect(24, 24, G.W - 48, G.H - 48);
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = TINTA;
        if (!opts.arte) {
            const t = G.titulo;
            textoAjustado(ctx, String(opts.titulo || "BINGO"), t.x + t.w / 2, t.y + t.h * 0.42, t.w - 40, 96, 900, familia);
            if (opts.subtitulo) {
                textoAjustado(ctx, String(opts.subtitulo), t.x + t.w / 2, t.y + t.h * 0.78, t.w - 40, 48, 600, familia);
            }
        }
        if (opts.letras !== false) {
            const l = G.letras;
            const w = l.w / 5;
            LETRAS.forEach((letra, i) => {
                ctx.fillStyle = TINTA;
                ctx.font = `900 ${Math.round(l.h * 0.86)}px ${familia}`;
                ctx.fillText(letra, l.x + w * i + w / 2, l.y + l.h / 2 + 4);
            });
        }

        const resaltadas = new Set((opts.resaltar || []).map(([f, c]) => `${f},${c}`));
        for (let f = 0; f < 5; f++) {
            for (let c = 0; c < 5; c++) {
                const r = celdaRect(f, c);
                ctx.fillStyle = resaltadas.has(`${f},${c}`) ? "#fff2b3" : "#ffffff";
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeStyle = TINTA;
                ctx.lineWidth = 3;
                ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
                const n = grid[f][c];
                ctx.fillStyle = TINTA;
                if (n === 0 && opts.centroImg) {
                    ctx.drawImage(opts.centroImg, r.x, r.y, r.w, r.h);
                    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
                } else if (n === 0) {
                    ctx.font = `800 34px ${familia}`;
                    ctx.fillText("LIBRE", r.x + r.w / 2, r.y + r.h / 2);
                } else {
                    ctx.font = `800 92px ${familia}`;
                    ctx.fillText(String(n), r.x + r.w / 2, r.y + r.h / 2 + 4);
                }
                if (opts.marcas && opts.marcas[f][c] && n !== 0) dibujarX(ctx, r);
            }
        }

        [["serie", `Serie ${serieTexto(opts.serie)}`], ["codigo", `Código ${codigo(opts.seed, opts.serie)}`]].forEach(
            ([zona, texto]) => {
                const z = G[zona];
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(z.x, z.y, z.w, z.h);
                ctx.fillStyle = TINTA;
                textoAjustado(ctx, texto, z.x + z.w / 2, z.y + z.h / 2, z.w - 20, 46, 800, familia);
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
        letraDe,
        marcadas,
        faltan,
        casillasGanadoras,
        dibujarCarton,
        dibujarTemplate,
        casillaEn,
        disposicion
    };
})();
