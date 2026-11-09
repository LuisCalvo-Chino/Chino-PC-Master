/**
 * ==========================================================================
 *  OPERACIONES VIVE · Backend en Google Apps Script
 *  Codigo.gs — un solo archivo. Se pega completo en el editor de Apps Script
 *  del Google Sheets de VIVE.
 * ==========================================================================
 *
 *  Qué guarda este spreadsheet:
 *    CONFIG   → la clave de administración y datos generales.
 *    EVENTOS  → un renglón por evento (Introductorio, Avanzado…). La columna
 *               "Configuración" guarda las secciones y roles del evento; se
 *               edita desde el link de Admin, no a mano.
 *    Una hoja por evento → las inscripciones de ese evento (se crea sola al
 *               crear el evento desde el link de Admin).
 *
 *  La página que ve la gente vive en chinopcmaster.com/vive/ y habla con este
 *  script por medio del enlace /exec de la implementación.
 */

/** Vacío si el script está ligado al spreadsheet (Extensiones ▸ Apps Script). */
const ID_HOJA = '';

/** Se muestra en el link de Admin para saber qué versión está publicada. */
const OPV_VERSION = '1.0';

const OPV_HOJAS = { CONFIG: 'CONFIG', EVENTOS: 'EVENTOS' };

const OPV_ENC = {
  CONFIG: ['Ajuste', 'Valor'],
  EVENTOS: ['ID', 'Tipo', 'Nombre', 'Fechas', 'Hoja', 'Estado', 'Creado', 'Configuración'],
  INSCRIPCIONES: ['Marca de tiempo', 'ID Sección', 'Sección', 'Rol', 'Nombre y apellido', 'Contacto', 'Estado', 'Comprobante']
};

const OPV_TIPOS = {
  introductorio: 'Operaciones Introductorio',
  avanzado: 'Operaciones Avanzado',
  otro: 'Otro evento'
};

const OPV_ESTADOS = ['ABIERTO', 'CERRADO', 'ARCHIVADO'];

const OPV_LIMITES = {
  NOMBRE_MIN: 5,
  NOMBRE_MAX: 60,
  CONTACTO_MAX: 60,
  MAX_SECCIONES_POR_ENVIO: 10,
  ESPERA_BLOQUEO_MS: 30000
};

// ==========================================================================
//  MENÚ DEL SPREADSHEET
// ==========================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Operaciones VIVE')
    .addItem('Preparar hojas y ver la clave', 'prepararHojas')
    .addToUi();
}

/**
 * Crea CONFIG y EVENTOS (si no existen) y genera la clave de administración.
 * Correla una vez desde el editor (botón ▶ Ejecutar) para aceptar los permisos.
 */
function prepararHojas() {
  asegurarHojas_();
  const clave = leerConfig_().clave_de_administracion;
  const texto = 'Clave de administración: ' + clave +
    '\n\nLa encuentras siempre en la hoja CONFIG. Pégala en el link de Admin junto con el /exec de la implementación.';
  Logger.log(texto);
  try {
    SpreadsheetApp.getUi().alert('Operaciones VIVE listo', texto, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Desde el editor no hay ventana: la clave queda en el registro de ejecución y en CONFIG.
  }
  return clave;
}

// ==========================================================================
//  ENTRADA WEB
// ==========================================================================

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action) return responder_(despachar_(p));
  return responder_({ ok: true, app: 'Operaciones VIVE', version: OPV_VERSION });
}

function doPost(e) {
  let peticion = {};
  try {
    if (e && e.parameter && e.parameter.payload) {
      peticion = JSON.parse(e.parameter.payload);
    } else if (e && e.postData && e.postData.contents) {
      peticion = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return responder_(error_('La petición no se pudo leer.'));
  }
  return responder_(despachar_(peticion));
}

function responder_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function despachar_(p) {
  try {
    asegurarHojas_();
    switch (texto_(p.action)) {
      case 'ping': return { ok: true, app: 'Operaciones VIVE', version: OPV_VERSION };
      case 'evento': return eventoPublico_(p.id);
      case 'inscribir': return inscribir_(p, false);
      case 'quitarme': return quitarme_(p);

      case 'admin_entrar':
      case 'admin_eventos': return conClave_(p, adminEventos_);
      case 'admin_crear_evento': return conClave_(p, adminCrearEvento_);
      case 'admin_guardar_evento': return conClave_(p, adminGuardarEvento_);
      case 'admin_inscritos': return conClave_(p, adminInscritos_);
      case 'admin_estado_inscripcion': return conClave_(p, adminEstadoInscripcion_);
      case 'admin_inscribir': return conClave_(p, function (q) { return inscribir_(q, true); });
      case 'admin_vista': return conClave_(p, adminVista_);
      default: return error_('Acción desconocida.');
    }
  } catch (err) {
    return error_('Error del servidor: ' + (err && err.message ? err.message : err));
  }
}

function conClave_(p, fn) {
  const clave = texto_(leerConfig_().clave_de_administracion);
  if (!clave || texto_(p.clave) !== clave) {
    return { ok: false, codigo: 'clave', mensaje: 'La clave de administración no coincide con la de la hoja CONFIG.' };
  }
  return fn(p);
}

// ==========================================================================
//  HOJAS
// ==========================================================================

function libro_() {
  return ID_HOJA ? SpreadsheetApp.openById(ID_HOJA) : SpreadsheetApp.getActive();
}

function asegurarHojas_() {
  const libro = libro_();
  [OPV_HOJAS.CONFIG, OPV_HOJAS.EVENTOS].forEach(function (nombre) {
    if (!libro.getSheetByName(nombre)) {
      const hoja = libro.insertSheet(nombre);
      encabezar_(hoja, OPV_ENC[nombre]);
    }
  });
  const config = leerConfig_();
  if (!texto_(config.clave_de_administracion)) {
    const hoja = libro.getSheetByName(OPV_HOJAS.CONFIG);
    hoja.appendRow(['Clave de administración', generarClave_()]);
    hoja.appendRow(['Organización', 'VIVE']);
  }
}

function encabezar_(hoja, cabecera) {
  hoja.getRange(1, 1, 1, cabecera.length)
    .setValues([cabecera])
    .setFontWeight('bold')
    .setBackground('#00C0CF')
    .setFontColor('#ffffff');
  hoja.setFrozenRows(1);
}

function generarClave_() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 8; i++) t += letras.charAt(Math.floor(Math.random() * letras.length));
  return 'VIVE-' + t.slice(0, 4) + '-' + t.slice(4);
}

function leerTabla_(hoja) {
  const valores = hoja.getDataRange().getValues();
  if (valores.length < 2) return [];
  const encabezados = valores.shift().map(clave_);
  return valores.map(function (fila, i) {
    const obj = { _fila: i + 2 };
    encabezados.forEach(function (h, j) { if (h) obj[h] = fila[j]; });
    return obj;
  }).filter(function (obj) {
    return Object.keys(obj).some(function (k) { return k !== '_fila' && texto_(obj[k]) !== ''; });
  });
}

function leerConfig_() {
  const hoja = libro_().getSheetByName(OPV_HOJAS.CONFIG);
  const config = {};
  if (!hoja) return config;
  leerTabla_(hoja).forEach(function (f) { config[clave_(f.ajuste)] = f.valor; });
  return config;
}

function hojaEventos_() {
  return libro_().getSheetByName(OPV_HOJAS.EVENTOS);
}

function leerEventos_() {
  return leerTabla_(hojaEventos_()).filter(function (f) {
    return texto_(f.id) !== '';
  }).map(function (f) {
    let config = {};
    try { config = JSON.parse(texto_(f.configuracion) || '{}'); } catch (e) { config = {}; }
    return {
      _fila: f._fila,
      id: texto_(f.id),
      tipo: clave_(f.tipo) || 'otro',
      nombre: texto_(f.nombre),
      fechas: texto_(f.fechas),
      hoja: texto_(f.hoja),
      estado: texto_(f.estado).toUpperCase() || 'ABIERTO',
      creado: fecha_(f.creado),
      config: normalizarConfig_(config)
    };
  });
}

function buscarEvento_(id) {
  const buscado = clave_(id);
  if (!buscado) return null;
  return leerEventos_().filter(function (ev) { return clave_(ev.id) === buscado; })[0] || null;
}

function hojaInscripciones_(evento) {
  const libro = libro_();
  let hoja = libro.getSheetByName(evento.hoja);
  if (!hoja) {
    hoja = libro.insertSheet(evento.hoja);
    encabezar_(hoja, OPV_ENC.INSCRIPCIONES);
  }
  return hoja;
}

function leerInscripciones_(evento) {
  return leerTabla_(hojaInscripciones_(evento)).map(function (f) {
    return {
      _fila: f._fila,
      marca: fecha_(f.marca_de_tiempo),
      seccion: texto_(f.id_seccion),
      seccionTitulo: texto_(f.seccion),
      rol: texto_(f.rol),
      nombre: texto_(f.nombre_y_apellido),
      contacto: texto_(f.contacto),
      estado: texto_(f.estado).toUpperCase() || 'ACTIVA',
      comprobante: texto_(f.comprobante)
    };
  });
}

function activas_(lista) {
  return lista.filter(function (i) { return i.estado !== 'CANCELADA'; });
}

// ==========================================================================
//  CONFIGURACIÓN DE CADA EVENTO (secciones y roles)
// ==========================================================================

function normalizarConfig_(c) {
  c = c || {};
  const usados = {};
  const secciones = (Array.isArray(c.secciones) ? c.secciones : []).map(function (s, i) {
    s = s || {};
    let id = slug_(s.id || s.titulo) || ('seccion-' + (i + 1));
    while (usados[id]) id = id + '-' + (i + 1);
    usados[id] = true;
    const tipo = String(s.tipo || '').toUpperCase() === 'ROLES' ? 'ROLES' : 'LISTA';
    const rolesVistos = {};
    const roles = (Array.isArray(s.roles) ? s.roles : []).map(function (r) {
      r = r || {};
      return { rol: limpiar_(r.rol, 80), cupos: entero_(r.cupos, 1) || 1, nota: limpiar_(r.nota, 200) };
    }).filter(function (r) {
      const k = clave_(r.rol);
      if (!k || rolesVistos[k]) return false;
      rolesVistos[k] = true;
      return true;
    });
    return {
      id: id,
      activa: s.activa !== false,
      titulo: limpiar_(s.titulo, 120) || id,
      cuando: limpiar_(s.cuando, 160),
      donde: limpiar_(s.donde, 200),
      vestimenta: limpiar_(s.vestimenta, 300),
      instrucciones: limpiarLargo_(s.instrucciones, 1200),
      aviso: limpiar_(s.aviso, 200),
      tipo: tipo,
      cupos: tipo === 'ROLES' ? 0 : entero_(s.cupos, 0),
      grupo: slug_(s.grupo),
      roles: tipo === 'ROLES' ? roles : []
    };
  });
  return {
    presentacion: limpiarLargo_(c.presentacion, 600),
    notas: (Array.isArray(c.notas) ? c.notas : String(c.notas || '').split('\n'))
      .map(function (n) { return limpiar_(n, 300).replace(/^[*•\-\s]+/, ''); })
      .filter(Boolean),
    mensajeCerrado: limpiar_(c.mensajeCerrado, 300),
    permitirQuitarse: c.permitirQuitarse !== false,
    pedirContacto: c.pedirContacto === true,
    etiquetaContacto: limpiar_(c.etiquetaContacto, 60) || 'WhatsApp',
    secciones: secciones
  };
}

/** Plantillas con las que nace cada evento. Todo se puede editar después. */
function plantilla_(tipo) {
  if (tipo === 'avanzado') {
    return normalizarConfig_({
      presentacion: 'Elige dónde quieres apoyar en este Avanzado. Cada lugar cuenta.',
      notas: [
        'Horas sujetas a cambio según el progreso del entrenamiento.',
        'Si tienes familiares o seres cercanos en el entrenamiento, NO te anotes dentro del salón para sus estiramientos.'
      ],
      secciones: [
        { id: 'armado', titulo: 'Armado de Salón', cuando: '', tipo: 'LISTA', cupos: 9 },
        { id: 'contratos', titulo: 'Contratos', cuando: 'Viernes · 8:00 pm',
          vestimenta: 'Casual, jeans NO rotos, colores vivos.',
          aviso: 'Evento y hora sujetos al avance del equipo.', tipo: 'LISTA', cupos: 30 },
        { id: 'angeles', titulo: 'Ángeles de Cuna y Cena', cuando: 'Sábado · 4:00 pm a 11:00 pm aprox.',
          donde: 'Parqueo / Sótano',
          vestimenta: 'Pantalón, camisa y zapatos negros. Desodorante sí, perfume no.',
          instrucciones: 'No fumar ni tomar antes de ir.', tipo: 'LISTA', cupos: 50, grupo: 'sabado-tarde' },
        { id: 'estiramientos', titulo: 'Equipo de Estiramientos', cuando: 'Sábado · 4:00 pm', donde: 'Salón Principal',
          instrucciones: 'Si tienes familiares o seres cercanos, NO te anotes dentro del salón para sus estiramientos. Tampoco si eres parte del VIVE Anfitrión. Ser graduado del 3er nivel de VIVE ES REQUISITO.',
          tipo: 'ROLES', grupo: 'sabado-tarde',
          roles: [
            { rol: 'Camerino (Mujer)' }, { rol: 'Camerino (Hombre)' }, { rol: 'Puertas' },
            { rol: 'Agua 1' }, { rol: 'Agua 2' }, { rol: 'Escenografía 1' },
            { rol: 'Escenografía 2' }, { rol: 'Luces' }, { rol: 'Música' }
          ] },
        { id: 'upgrade', titulo: 'Upgrade (Inscripción al VIVE)', cuando: 'Domingo · 5:00 pm',
          vestimenta: 'Camisa VIVE, jeans sin huecos.',
          instrucciones: 'Trae computadora o tablet si puedes.', tipo: 'LISTA', cupos: 15 },
        { id: 'graduacion', titulo: 'Graduación', cuando: 'Domingo · entre 7:00 y 7:30 pm aprox.', tipo: 'LISTA', cupos: 60 }
      ]
    });
  }
  if (tipo === 'introductorio') {
    return normalizarConfig_({
      presentacion: 'Elige dónde quieres apoyar en este Introductorio. Cada lugar cuenta.',
      notas: ['Horas sujetas a cambio según el progreso del entrenamiento.'],
      secciones: [
        { id: 'armado', titulo: 'Armado de Salón', tipo: 'LISTA', cupos: 9 },
        { id: 'registro', titulo: 'Registro y bienvenida', tipo: 'LISTA', cupos: 10 },
        { id: 'angeles', titulo: 'Ángeles', vestimenta: 'Pantalón, camisa y zapatos negros.', tipo: 'LISTA', cupos: 30 },
        { id: 'upgrade', titulo: 'Upgrade (Inscripción al Avanzado)', vestimenta: 'Camisa VIVE, jeans sin huecos.',
          instrucciones: 'Trae computadora o tablet si puedes.', tipo: 'LISTA', cupos: 15 },
        { id: 'graduacion', titulo: 'Graduación', tipo: 'LISTA', cupos: 60 }
      ]
    });
  }
  return normalizarConfig_({
    presentacion: 'Elige dónde quieres apoyar.',
    secciones: [{ id: 'lista', titulo: 'Lista general', tipo: 'LISTA', cupos: 20 }]
  });
}

// ==========================================================================
//  VISTA PÚBLICA
// ==========================================================================

function armarEvento_(evento, inscripciones) {
  const activas = activas_(inscripciones);
  let totalCupos = 0;
  let totalTomados = 0;

  const secciones = evento.config.secciones.filter(function (s) { return s.activa; }).map(function (s) {
    const propias = activas.filter(function (i) { return clave_(i.seccion) === clave_(s.id); })
      .sort(function (a, b) { return String(a.marca).localeCompare(String(b.marca)); });
    const out = {
      id: s.id, titulo: s.titulo, cuando: s.cuando, donde: s.donde, vestimenta: s.vestimenta,
      instrucciones: s.instrucciones, aviso: s.aviso, tipo: s.tipo, grupo: s.grupo,
      apuntados: [], roles: [], cupos: 0, tomados: 0
    };
    if (s.tipo === 'ROLES') {
      out.roles = s.roles.map(function (r) {
        const ocupantes = propias.filter(function (i) { return clave_(i.rol) === clave_(r.rol); })
          .map(function (i) { return i.nombre; });
        return { rol: r.rol, nota: r.nota, cupos: r.cupos, ocupantes: ocupantes,
          disponibles: Math.max(0, r.cupos - ocupantes.length) };
      });
      out.roles.forEach(function (r) { out.cupos += r.cupos; out.tomados += r.ocupantes.length; });
    } else {
      out.apuntados = propias.map(function (i) { return i.nombre; });
      out.cupos = s.cupos;
      out.tomados = out.apuntados.length;
    }
    out.disponibles = out.cupos > 0 ? Math.max(0, out.cupos - out.tomados) : null;
    out.lleno = out.cupos > 0 && out.disponibles === 0;
    totalCupos += out.cupos;
    totalTomados += out.tomados;
    return out;
  });

  return {
    ok: true,
    evento: {
      id: evento.id,
      tipo: evento.tipo,
      tipoNombre: OPV_TIPOS[evento.tipo] || OPV_TIPOS.otro,
      nombre: evento.nombre,
      fechas: evento.fechas,
      estado: evento.estado,
      presentacion: evento.config.presentacion,
      notas: evento.config.notas
    },
    abierto: evento.estado === 'ABIERTO',
    mensajeCerrado: evento.config.mensajeCerrado || 'Las inscripciones de este evento están cerradas.',
    permitirQuitarse: evento.config.permitirQuitarse,
    pedirContacto: evento.config.pedirContacto,
    etiquetaContacto: evento.config.etiquetaContacto,
    totales: { cupos: totalCupos, tomados: totalTomados },
    secciones: secciones,
    version: OPV_VERSION,
    actualizado: new Date().toISOString()
  };
}

function eventoPublico_(id) {
  const evento = buscarEvento_(id);
  if (!evento) return { ok: false, codigo: 'no_existe', mensaje: 'Este enlace no corresponde a ningún evento.' };
  if (evento.estado === 'ARCHIVADO') {
    return { ok: false, codigo: 'archivado', mensaje: '"' + evento.nombre + '" ya terminó. Gracias a cada persona que apoyó.' };
  }
  return armarEvento_(evento, leerInscripciones_(evento));
}

// ==========================================================================
//  INSCRIBIRSE Y QUITARSE
// ==========================================================================

/**
 * p = { id, nombre, contacto, selecciones: [{ id, rol }] }
 * Valida todo antes de escribir: o entra completo, o no entra nada.
 * Con esAdmin = true se permite anotar aunque el evento esté cerrado.
 */
function inscribir_(p, esAdmin) {
  const bloqueo = LockService.getScriptLock();
  if (!bloqueo.tryLock(OPV_LIMITES.ESPERA_BLOQUEO_MS)) {
    return error_('Varias personas se están anotando al mismo tiempo. Espera unos segundos e intenta de nuevo.');
  }
  try {
    const evento = buscarEvento_(p.id);
    if (!evento || evento.estado === 'ARCHIVADO') return error_('Este evento ya no está disponible.');
    if (!esAdmin && evento.estado !== 'ABIERTO') {
      return error_(evento.config.mensajeCerrado || 'Las inscripciones de este evento están cerradas.');
    }

    const nombre = limpiar_(p.nombre, OPV_LIMITES.NOMBRE_MAX);
    if (nombre.length < OPV_LIMITES.NOMBRE_MIN || nombre.split(' ').length < 2) {
      return error_('Escribe tu nombre y tu apellido para identificarte en la lista.');
    }
    const contacto = limpiar_(p.contacto, OPV_LIMITES.CONTACTO_MAX);

    const selecciones = (Array.isArray(p.selecciones) ? p.selecciones : []).filter(function (s) {
      return s && texto_(s.id) !== '';
    });
    if (!selecciones.length) return error_('Elige al menos un lugar donde quieres apoyar.');
    if (selecciones.length > OPV_LIMITES.MAX_SECCIONES_POR_ENVIO) return error_('Son demasiadas secciones en un solo envío.');

    const inscripciones = leerInscripciones_(evento);
    const datos = armarEvento_(evento, inscripciones);
    const porId = {};
    datos.secciones.forEach(function (s) { porId[clave_(s.id)] = s; });

    const mia = clave_(nombre);
    const yaAnotado = activas_(inscripciones).filter(function (i) { return clave_(i.nombre) === mia; });
    const grupos = {};
    yaAnotado.forEach(function (i) {
      const s = porId[clave_(i.seccion)];
      if (s && s.grupo) grupos[s.grupo] = s.titulo;
    });

    const filas = [];
    const resumen = [];
    const vistas = {};
    for (let k = 0; k < selecciones.length; k++) {
      const s = porId[clave_(selecciones[k].id)];
      if (!s) return error_('Una de las secciones ya no está disponible. Actualiza la página.');
      if (vistas[s.id]) continue;
      vistas[s.id] = true;

      if (yaAnotado.some(function (i) { return clave_(i.seccion) === clave_(s.id); })) {
        return error_('"' + nombre + '" ya aparece en "' + s.titulo + '". Si requieres un cambio, avisa a coordinación.');
      }
      if (s.grupo) {
        const ocupada = grupos[s.grupo];
        if (ocupada && ocupada !== s.titulo) {
          return error_('No es posible estar en "' + ocupada + '" y en "' + s.titulo + '" a la vez: ocurren al mismo tiempo. Elige una.');
        }
        grupos[s.grupo] = s.titulo;
      }

      let rol = '';
      if (s.tipo === 'ROLES') {
        rol = limpiar_(selecciones[k].rol, 80);
        const info = s.roles.filter(function (r) { return clave_(r.rol) === clave_(rol); })[0];
        if (!rol || !info) return error_('Elige cuál rol vas a tomar en "' + s.titulo + '".');
        if (info.disponibles <= 0) return error_('Alguien tomó "' + info.rol + '" hace un momento. Actualiza la página y elige otro rol.');
        info.disponibles--;
        rol = info.rol;
      } else if (s.cupos > 0) {
        if (s.disponibles <= 0) return error_('"' + s.titulo + '" acaba de llenarse. Actualiza la página para ver qué queda.');
        s.disponibles--;
      }

      const comprobante = Utilities.getUuid();
      filas.push([new Date(), s.id, s.titulo, rol, nombre, contacto, 'ACTIVA', comprobante]);
      resumen.push({ id: s.id, titulo: s.titulo, rol: rol, cuando: s.cuando, donde: s.donde, vestimenta: s.vestimenta });
    }

    const hoja = hojaInscripciones_(evento);
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);
    SpreadsheetApp.flush();

    return {
      ok: true,
      mensaje: 'Gracias, ' + nombre.split(' ')[0] + '. Ya estás en la lista.',
      resumen: resumen,
      comprobantes: filas.map(function (f) { return { comprobante: f[7], seccion: f[1], titulo: f[2], rol: f[3], nombre: f[4] }; }),
      datos: armarEvento_(evento, leerInscripciones_(evento))
    };
  } finally {
    bloqueo.releaseLock();
  }
}

/** Quita inscripciones hechas desde el mismo dispositivo (el navegador guarda los comprobantes). */
function quitarme_(p) {
  const evento = buscarEvento_(p.id);
  if (!evento) return error_('Este evento ya no está disponible.');
  if (!evento.config.permitirQuitarse) return error_('Para salir de una lista escribe a coordinación.');
  if (evento.estado !== 'ABIERTO') return error_('El evento está cerrado. Para salir de una lista escribe a coordinación.');

  const buscados = {};
  (Array.isArray(p.comprobantes) ? p.comprobantes : []).forEach(function (c) { buscados[texto_(c)] = true; });
  if (!Object.keys(buscados).length) return error_('No hay nada que quitar.');

  const bloqueo = LockService.getScriptLock();
  if (!bloqueo.tryLock(OPV_LIMITES.ESPERA_BLOQUEO_MS)) return error_('El sistema está ocupado. Intenta de nuevo en unos segundos.');
  try {
    const hoja = hojaInscripciones_(evento);
    let quitadas = 0;
    leerInscripciones_(evento).forEach(function (i) {
      if (buscados[i.comprobante] && i.estado !== 'CANCELADA') {
        hoja.getRange(i._fila, 7).setValue('CANCELADA');
        quitadas++;
      }
    });
    SpreadsheetApp.flush();
    return {
      ok: true,
      mensaje: quitadas ? 'Listo, te quitamos de esa lista.' : 'Esa inscripción ya no estaba activa.',
      datos: armarEvento_(evento, leerInscripciones_(evento))
    };
  } finally {
    bloqueo.releaseLock();
  }
}

// ==========================================================================
//  ADMIN
// ==========================================================================

function resumenEvento_(ev) {
  const inscritos = activas_(leerInscripciones_(ev));
  const personas = {};
  inscritos.forEach(function (i) { personas[clave_(i.nombre)] = true; });
  return {
    id: ev.id, tipo: ev.tipo, tipoNombre: OPV_TIPOS[ev.tipo] || OPV_TIPOS.otro,
    nombre: ev.nombre, fechas: ev.fechas, hoja: ev.hoja, estado: ev.estado, creado: ev.creado,
    inscripciones: inscritos.length, personas: Object.keys(personas).length,
    config: ev.config
  };
}

function adminEventos_() {
  const libro = libro_();
  return {
    ok: true,
    version: OPV_VERSION,
    organizacion: texto_(leerConfig_().organizacion) || 'VIVE',
    spreadsheet: { nombre: libro.getName(), url: libro.getUrl() },
    tipos: OPV_TIPOS,
    eventos: leerEventos_().map(resumenEvento_).reverse()
  };
}

function adminCrearEvento_(p) {
  const tipo = OPV_TIPOS[clave_(p.tipo)] ? clave_(p.tipo) : 'otro';
  const nombre = limpiar_(p.nombre, 90);
  if (nombre.length < 3) return error_('Escribe el nombre del evento, por ejemplo "Avanzado 40".');
  const fechas = limpiar_(p.fechas, 120);

  const bloqueo = LockService.getScriptLock();
  if (!bloqueo.tryLock(OPV_LIMITES.ESPERA_BLOQUEO_MS)) return error_('El sistema está ocupado. Intenta de nuevo.');
  try {
    const eventos = leerEventos_();
    const ids = {};
    eventos.forEach(function (e) { ids[clave_(e.id)] = true; });
    let base = slug_(nombre) || 'evento';
    if (['admin', 'demo', 's'].indexOf(base) >= 0) base = 'evento-' + base; // palabras reservadas del enlace
    let id = base;
    for (let n = 2; ids[clave_(id)]; n++) id = base + '-' + n;

    const libro = libro_();
    const baseHoja = nombre.replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 80).trim();
    let hojaNombre = baseHoja;
    for (let n = 2; libro.getSheetByName(hojaNombre); n++) hojaNombre = baseHoja + ' (' + n + ')';

    let config = plantilla_(tipo);
    const base2 = texto_(p.copiarDe) ? buscarEvento_(p.copiarDe) : null;
    if (base2) config = normalizarConfig_(JSON.parse(JSON.stringify(base2.config)));

    const hoja = libro.insertSheet(hojaNombre);
    encabezar_(hoja, OPV_ENC.INSCRIPCIONES);

    hojaEventos_().appendRow([id, tipo, nombre, fechas, hojaNombre, 'ABIERTO', new Date(), JSON.stringify(config)]);
    SpreadsheetApp.flush();

    const r = adminEventos_();
    r.creado = id;
    r.mensaje = '"' + nombre + '" quedó creado con su propia hoja.';
    return r;
  } finally {
    bloqueo.releaseLock();
  }
}

function adminGuardarEvento_(p) {
  const bloqueo = LockService.getScriptLock();
  if (!bloqueo.tryLock(OPV_LIMITES.ESPERA_BLOQUEO_MS)) return error_('El sistema está ocupado. Intenta de nuevo.');
  try {
    const ev = buscarEvento_(p.id);
    if (!ev) return error_('Ese evento no existe.');
    const datos = p.evento || {};
    const nombre = limpiar_(datos.nombre, 90) || ev.nombre;
    const fechas = datos.fechas == null ? ev.fechas : limpiar_(datos.fechas, 120);
    const estado = OPV_ESTADOS.indexOf(String(datos.estado || '').toUpperCase()) >= 0
      ? String(datos.estado).toUpperCase() : ev.estado;
    const config = datos.config ? normalizarConfig_(datos.config) : ev.config;

    // No se borra una sección o un rol que todavía tiene gente anotada.
    const activas = activas_(leerInscripciones_(ev));
    const porSeccion = {};
    config.secciones.forEach(function (s) { porSeccion[clave_(s.id)] = s; });
    for (let i = 0; i < activas.length; i++) {
      const ins = activas[i];
      const s = porSeccion[clave_(ins.seccion)];
      if (!s) {
        return error_('No se puede quitar "' + ins.seccionTitulo + '": todavía tiene personas anotadas. Desactívala o cancela esas inscripciones primero.');
      }
      if (s.tipo === 'ROLES' && ins.rol && !s.roles.some(function (r) { return clave_(r.rol) === clave_(ins.rol); })) {
        return error_('El rol "' + ins.rol + '" de "' + s.titulo + '" tiene a ' + ins.nombre + ' anotado. Déjalo o cancela esa inscripción primero.');
      }
    }

    const hoja = hojaEventos_();
    hoja.getRange(ev._fila, 3, 1, 1).setValue(nombre);
    hoja.getRange(ev._fila, 4, 1, 1).setValue(fechas);
    hoja.getRange(ev._fila, 6, 1, 1).setValue(estado);
    hoja.getRange(ev._fila, 8, 1, 1).setValue(JSON.stringify(config));
    SpreadsheetApp.flush();

    const r = adminEventos_();
    r.mensaje = 'Cambios guardados.';
    return r;
  } finally {
    bloqueo.releaseLock();
  }
}

function adminInscritos_(p) {
  const ev = buscarEvento_(p.id);
  if (!ev) return error_('Ese evento no existe.');
  return {
    ok: true,
    evento: resumenEvento_(ev),
    inscritos: leerInscripciones_(ev).map(function (i) {
      return { marca: i.marca, seccion: i.seccion, seccionTitulo: i.seccionTitulo, rol: i.rol,
        nombre: i.nombre, contacto: i.contacto, estado: i.estado, comprobante: i.comprobante };
    })
  };
}

function adminEstadoInscripcion_(p) {
  const ev = buscarEvento_(p.id);
  if (!ev) return error_('Ese evento no existe.');
  const nuevo = String(p.estado || '').toUpperCase() === 'ACTIVA' ? 'ACTIVA' : 'CANCELADA';
  const bloqueo = LockService.getScriptLock();
  if (!bloqueo.tryLock(OPV_LIMITES.ESPERA_BLOQUEO_MS)) return error_('El sistema está ocupado. Intenta de nuevo.');
  try {
    const ins = leerInscripciones_(ev).filter(function (i) { return i.comprobante === texto_(p.comprobante); })[0];
    if (!ins) return error_('No se encontró esa inscripción.');
    hojaInscripciones_(ev).getRange(ins._fila, 7, 1, 1).setValue(nuevo);
    SpreadsheetApp.flush();
  } finally {
    bloqueo.releaseLock();
  }
  return adminInscritos_(p);
}

/** Arma una hoja "VISTA · <evento>" con las listas ya llenas, para imprimir o compartir. */
function adminVista_(p) {
  const ev = buscarEvento_(p.id);
  if (!ev) return error_('Ese evento no existe.');
  const datos = armarEvento_(ev, leerInscripciones_(ev));
  const libro = libro_();
  const nombre = ('VISTA · ' + ev.hoja).slice(0, 95);
  let hoja = libro.getSheetByName(nombre);
  if (!hoja) hoja = libro.insertSheet(nombre);
  hoja.clear();

  const filas = [[ev.nombre, ''], [ev.fechas, '']];
  datos.evento.notas.forEach(function (n) { filas.push(['* ' + n, '']); });
  filas.push(['', '']);
  datos.secciones.forEach(function (s) {
    filas.push([s.titulo + (s.cuando ? ': ' + s.cuando : ''), '']);
    const detalle = [s.donde, s.vestimenta, s.instrucciones, s.aviso].filter(Boolean).join(' · ');
    if (detalle) filas.push([detalle, '']);
    if (s.tipo === 'ROLES') {
      s.roles.forEach(function (r, i) { filas.push([(i + 1) + '. ' + r.rol, r.ocupantes.join(', ')]); });
    } else {
      const total = Math.max(s.cupos, s.apuntados.length);
      for (let i = 0; i < total; i++) filas.push([String(i + 1), s.apuntados[i] || '']);
    }
    filas.push(['', '']);
  });
  hoja.getRange(1, 1, filas.length, 2).setValues(filas);
  hoja.setColumnWidth(1, 360);
  hoja.setColumnWidth(2, 320);
  hoja.getRange(1, 1, 1, 2).setFontWeight('bold').setFontSize(16);
  SpreadsheetApp.flush();
  return { ok: true, mensaje: 'Hoja "' + nombre + '" actualizada con los datos de este momento.' };
}

// ==========================================================================
//  AUXILIARES
// ==========================================================================

function error_(mensaje) {
  return { ok: false, mensaje: mensaje };
}

function texto_(v) {
  return String(v == null ? '' : v).trim();
}

/** "Ángeles de Cuna" → "angeles_de_cuna" (sin tildes, para comparar). */
function clave_(t) {
  return String(t == null ? '' : t)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** "Avanzado 40" → "avanzado-40" (para los enlaces). */
function slug_(t) {
  return clave_(t).replace(/_/g, '-').slice(0, 48);
}

function entero_(v, porDefecto) {
  const n = Math.floor(Number(v));
  return isNaN(n) || n < 0 ? porDefecto : n;
}

function fecha_(v) {
  if (v instanceof Date) return v.toISOString();
  return texto_(v);
}

/** Limpia lo que escribe la gente: espacios, saltos de línea y lo que Sheets leería como fórmula. */
function limpiar_(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^[=+@\-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 100);
}

/** Como limpiar_, pero conserva los saltos de línea (instrucciones largas). */
function limpiarLargo_(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r/g, '')
    .split('\n')
    .map(function (l) { return l.replace(/[\t ]+/g, ' ').trim(); })
    .join('\n')
    .replace(/^[=+@\-]+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max || 1000);
}
