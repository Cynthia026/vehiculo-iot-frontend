// assets/js/app.js
import { api } from './api.js';
import { wsManager } from './websocket.js';
import { ui, normalizar } from './ui.js';
import { Joystick } from './joystick.js';
import { CONFIG } from './config.js'; // Importado para acceder a la URL base

let catalogoComandos = [];
let catalogoDemos = [];
let idComandoDetener = null;

let reintentoTimer = null;
let primerFallo = true;

// Control de visualización de movimientos durante una DEMO
let demoTimer = null;
let demoInicioDelay = null;
let recibioEventoWss = false;
let demoActiva = false;

function inicializar() {
    // 1. Mostrar toda la interfaz de inmediato, deshabilitada hasta que AWS responda
    ui.renderComandosPlaceholder();
    ui.setOffline(true);
    configurarControles();

    // 2. Conexiones
    wsManager.setOnMessage(manejarEventoWssDemo);
    wsManager.connect();
    verificarRDS();
    cargarDatos();
}

// Los eventos se enlazan una sola vez, aunque AWS esté apagado
function configurarControles() {
    // Bloquear desplazamiento de la pantalla al arrastrar en móviles (vertical u horizontal)
    document.addEventListener('touchmove', (e) => {
        if (!e.target.closest('select')) {
            e.preventDefault();
        }
    }, { passive: false });

    document.getElementById('btn-stop').addEventListener('click', () => {
        detenerVisualizacionDemo();
        ui.playSound('stop');
        ui.vibrar(25);
        detenerVehiculo();
    });

    document.getElementById('demo-select').addEventListener('change', () => {
        ui.playSound('tap');
    });

    document.getElementById('btn-demo-start').addEventListener('click', async () => {
        const select = document.getElementById('demo-select');
        if (!select.value) {
            ui.playSound('cancel');
            return;
        }
        try {
            detenerVisualizacionDemo();
            demoActiva = true;
            recibioEventoWss = false;

            ui.playSound('start');
            ui.vibrar(15);
            ui.showFeedback('Iniciando DEMO...', 'success', 1200);

            // Si el WebSocket no envía cada paso en los primeros 700 ms, mostrar los movimientos de la secuencia
            demoInicioDelay = setTimeout(() => {
                if (demoActiva && !recibioEventoWss) {
                    iniciarSecuenciaPasosDemo(select.value);
                }
            }, 700);

            const respuesta = await api.ejecutarDemo(select.value);

            // Si la respuesta HTTP devuelve los pasos ejecutados y no hubo eventos WSS ni secuencia activa
            if (demoActiva && !recibioEventoWss && !demoTimer && respuesta) {
                iniciarSecuenciaPasosDemo(select.value, respuesta);
            }
        } catch (error) {
            detenerVisualizacionDemo();
            ui.showFeedback('No se pudo iniciar la DEMO', 'danger');
        }
    });

    document.getElementById('btn-demo-cancel').addEventListener('click', async () => {
        detenerVisualizacionDemo();
        try {
            ui.playSound('cancel');
            ui.vibrar(15);
            ui.showFeedback('Cancelando DEMO...', 'warning');
            await api.cancelarDemo();
        } catch (error) {
            ui.showFeedback('No se pudo cancelar la DEMO', 'danger');
        }
    });

    new Joystick('joystick-zone', 'joystick-knob', (dir) => {
        detenerVisualizacionDemo();
        ui.playSound('joy');
        manejarMovimientoJoystick(dir);
    }, detenerVehiculo);
    new Joystick('joystick-zone-arm', 'joystick-knob-arm', (dir) => {
        detenerVisualizacionDemo();
        ui.playSound('joy');
        manejarMovimientoBrazo(dir);
    }, detenerVehiculo);
}

// Muestra en pantalla y en los joysticks el movimiento que está ejecutando la DEMO
function mostrarPasoDemo(nombreMovimiento) {
    if (!nombreMovimiento) return;
    const limpio = String(nombreMovimiento).trim();
    if (!limpio) return;

    const norm = normalizar(limpio);
    if (norm === 'DETENER' || norm === 'STOP') {
        ui.playSound('stop');
        ui.limpiarResaltadoDemo();
        ui.showFeedback(`Enviando: ${limpio}`, 'info', 2000);
    } else {
        ui.playSound('joy');
        ui.resaltarMovimientoDemo(limpio);
        ui.showFeedback(`Enviando: ${limpio}`, 'info', 3000);
    }
}

function detenerVisualizacionDemo() {
    demoActiva = false;
    clearTimeout(demoInicioDelay);
    clearInterval(demoTimer);
    demoInicioDelay = null;
    demoTimer = null;
    ui.limpiarResaltadoDemo();
}

// Procesa eventos en tiempo real enviados por el WebSocket (/api/demos/ws/1)
function manejarEventoWssDemo(data) {
    if (!data) return;

    // 1. Verificar si es fin o cancelación de la demo
    const estadoTexto = String(data.estado || data.status || data.evento || data.tipo || '').toLowerCase();
    const msgTexto = String(data.mensaje || data.message || data.detalle || data.rawText || '');

    if (/cancel/i.test(estadoTexto) || /cancelad/i.test(msgTexto)) {
        detenerVisualizacionDemo();
        ui.showFeedback('DEMO cancelada', 'warning', 2000);
        return;
    }

    // 2. Intentar extraer el comando/movimiento directamente del evento WSS
    let nombreMov = null;

    const idCmd = data.id_comando ?? data.paso?.id_comando ?? data.comando?.id_comando ?? data.movimiento?.id_comando;
    if (idCmd != null && catalogoComandos.length > 0) {
        const encontrado = catalogoComandos.find(c => String(c.id_comando) === String(idCmd));
        if (encontrado) nombreMov = encontrado.nombre || encontrado.comando;
    }

    if (!nombreMov) {
        const candidatos = [
            data.nombre_comando,
            data.nombreComando,
            typeof data.comando === 'string' ? data.comando : (data.comando?.nombre || data.comando?.comando),
            typeof data.movimiento === 'string' ? data.movimiento : (data.movimiento?.nombre || data.movimiento?.comando),
            data.nombre_movimiento,
            data.accion,
            data.instruccion,
            typeof data.paso === 'string' ? data.paso : (data.paso?.nombre_comando || data.paso?.comando || data.paso?.movimiento || data.paso?.nombre),
            typeof data.paso_actual === 'string' ? data.paso_actual : (data.paso_actual?.comando || data.paso_actual?.movimiento || data.paso_actual?.nombre),
            data.datos?.comando,
            data.data?.comando,
            data.payload?.comando
        ];
        nombreMov = candidatos.find(c => typeof c === 'string' && c.trim().length > 0) || null;
    }

    // Si data.nombre coincide con algún comando del catálogo
    if (!nombreMov && typeof data.nombre === 'string') {
        const normNombre = normalizar(data.nombre);
        const esComando = catalogoComandos.some(c => normalizar(c.nombre || c.comando || '') === normNombre);
        if (esComando) nombreMov = data.nombre;
    }

    // Si viene dentro de un texto como "Ejecutando: AVANZAR" o "Movimiento AVANZAR"
    if (!nombreMov && msgTexto) {
        for (const cmd of catalogoComandos) {
            const n = cmd.nombre || cmd.comando;
            if (n && normalizar(msgTexto).includes(normalizar(n))) {
                nombreMov = n;
                break;
            }
        }
        if (!nombreMov) {
            const match = msgTexto.match(/(?:ejecutando|movimiento|comando|paso\s*\d*)\s*[:\-]\s*([A-Za-zÁÉÍÓÚáéíóúÑñ0-9_ ]+)/i);
            if (match && match[1]) nombreMov = match[1].trim();
        }
    }

    if (nombreMov) {
        recibioEventoWss = true;
        clearTimeout(demoInicioDelay);
        clearInterval(demoTimer);
        demoTimer = null;
        mostrarPasoDemo(nombreMov);
        return;
    }

    if (/finaliz|complet|terminad|fin_demo|done|ended/i.test(estadoTexto) || /finaliz|complet|terminad/i.test(msgTexto)) {
        detenerVisualizacionDemo();
        mostrarPasoDemo('Detener');
        return;
    }

    if (msgTexto && !/conectad|iniciando/i.test(msgTexto)) {
        recibioEventoWss = true;
        ui.showFeedback(msgTexto, 'info', 2500);
    }
}

// Obtiene la lista de movimientos de la demo seleccionada (del catálogo, respuesta API o rutina asociada)
function obtenerPasosParaDemo(idDemo, respuestaApi = null) {
    const demoObj = catalogoDemos.find(d => String(d.id_demo) === String(idDemo)) || {};
    const fuentes = [respuestaApi, demoObj].filter(Boolean);

    for (const f of fuentes) {
        const lista = f.pasos || f.movimientos || f.comandos || f.secuencia || f.detalles || f.instrucciones || f.steps;
        if (Array.isArray(lista) && lista.length > 0) {
            const pasosExtraidos = lista.map(item => {
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object') {
                    if (item.id_comando != null && catalogoComandos.length > 0) {
                        const cmd = catalogoComandos.find(c => String(c.id_comando) === String(item.id_comando));
                        if (cmd) return cmd.nombre || cmd.comando;
                    }
                    return item.nombre_comando || item.comando || item.movimiento || item.nombre || item.accion;
                }
                return null;
            }).filter(Boolean);

            if (pasosExtraidos.length > 0) return pasosExtraidos;
        }
    }

    // Si la descripción o nombre menciona comandos del catálogo en orden
    const textoDemo = normalizar(`${demoObj.nombre || ''} ${demoObj.descripcion || ''}`);
    if (/CUADRAD/.test(textoDemo)) {
        return ['AVANZAR', 'GIRAR_DERECHA', 'AVANZAR', 'GIRAR_DERECHA', 'AVANZAR', 'GIRAR_DERECHA', 'AVANZAR', 'Detener'];
    }
    if (/ZIG/.test(textoDemo)) {
        return ['AVANZAR', 'GIRAR_DERECHA', 'AVANZAR', 'GIRAR_IZQUIERDA', 'AVANZAR', 'GIRAR_DERECHA', 'Detener'];
    }
    if (/360|GIRO|VUELTA|CIRCUL/.test(textoDemo)) {
        return ['GIRAR_DERECHA', 'GIRAR_IZQUIERDA', 'AVANZAR', 'GIRAR_DERECHA', 'Detener'];
    }
    if (/BRAZO|GRUA|EXCAV/.test(textoDemo)) {
        return ['SUBIR_BRAZO', 'MOTOR_DERECHA', 'BAJAR_BRAZO', 'MOTOR_IZQUIERDA', 'Detener'];
    }
    if (/PATRULL|EXPLOR|RUTINA|RECORR/.test(textoDemo)) {
        return ['AVANZAR', 'GIRAR_DERECHA', 'AVANZAR', 'GIRAR_IZQUIERDA', 'RETROCEDER', 'Detener'];
    }

    // Secuencia general con los comandos de movimiento disponibles
    return ['AVANZAR', 'GIRAR_DERECHA', 'AVANZAR', 'GIRAR_IZQUIERDA', 'RETROCEDER', 'Detener'];
}

function iniciarSecuenciaPasosDemo(idDemo, respuestaApi = null) {
    clearInterval(demoTimer);
    const pasos = obtenerPasosParaDemo(idDemo, respuestaApi);
    if (!pasos || pasos.length === 0) return;

    let idx = 0;
    mostrarPasoDemo(pasos[idx]);
    idx++;

    demoTimer = setInterval(() => {
        if (!demoActiva || recibioEventoWss || idx >= pasos.length) {
            clearInterval(demoTimer);
            demoTimer = null;
            if (idx >= pasos.length) {
                demoActiva = false;
                setTimeout(() => ui.limpiarResaltadoDemo(), 600);
            }
            return;
        }
        mostrarPasoDemo(pasos[idx]);
        idx++;
    }, 1600);
}

// Carga los catálogos; si AWS no responde, reintenta cada 8 s
async function cargarDatos() {
    clearTimeout(reintentoTimer);
    ui.updateAwsStatus('Comprobando...');
    try {
        const comandos = await api.obtenerComandos();
        const demos = await api.obtenerDemos();
        catalogoComandos = comandos;
        catalogoDemos = Array.isArray(demos) ? demos : [];

        const cmdDetener = catalogoComandos.find(c => c.nombre === 'Detener');
        if (cmdDetener) idComandoDetener = cmdDetener.id_comando;

        ui.renderComandos(catalogoComandos, ejecutarComando);
        ui.renderDemos(demos);
        ui.setOffline(false);

        primerFallo = true;
        document.getElementById('action-feedback').classList.add('d-none');
    } catch (error) {
        console.error('Error cargando datos:', error);
        if (primerFallo) {
            ui.showFeedback('Sin conexión con AWS. Reintentando...', 'danger');
            primerFallo = false;
        }
        reintentoTimer = setTimeout(cargarDatos, 8000);
    }
}

// Consulta el endpoint de salud
async function verificarRDS() {
    const rdsBadge = document.getElementById('status-rds');
    rdsBadge.innerHTML = `<i class="bi bi-arrow-repeat"></i> RDS: Consultando...`;
    
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/health`);
        if (response.ok) {
            const data = await response.json();
            if (data.rds === 'Disponible') {
                rdsBadge.className = 'badge bg-success status-badge';
                rdsBadge.innerHTML = `<i class="bi bi-database-check"></i> RDS: Disponible`;
            } else {
                rdsBadge.className = 'badge bg-danger status-badge';
                rdsBadge.innerHTML = `<i class="bi bi-database-x"></i> RDS: No disponible`;
            }
        } else {
            throw new Error("Respuesta no OK de /api/health");
        }
    } catch (error) {
        console.error("Error al consultar RDS:", error);
        rdsBadge.className = 'badge bg-secondary status-badge';
        rdsBadge.innerHTML = `<i class="bi bi-database-dash"></i> RDS: Sin verificar`;
    }
}

async function manejarMovimientoJoystick(direccion) {
    // Mapeamos la salida del joystick a los nombres reales de la API
    const mapDirecciones = {
        'ADELANTE': 'AVANZAR',
        'ATRAS': 'RETROCEDER',
        'IZQUIERDA': 'GIRAR_IZQUIERDA',
        'DERECHA': 'GIRAR_DERECHA'
    };
    
    const nombreApi = mapDirecciones[direccion];
    const comando = catalogoComandos.find(c => c.nombre === nombreApi);
    
    if (comando) {
        ejecutarComando(comando.id_comando, comando.nombre);
    }
}

// Segundo joystick: brazo (arriba/abajo) y motores (izquierda/derecha)
async function manejarMovimientoBrazo(direccion) {
    const mapa = {
        'ADELANTE': 'SUBIR_BRAZO',
        'ATRAS': 'BAJAR_BRAZO',
        'IZQUIERDA': 'MOTOR_IZQUIERDA',
        'DERECHA': 'MOTOR_DERECHA'
    };
    const comando = catalogoComandos.find(c => normalizar(c.nombre || c.comando || '') === mapa[direccion]);
    if (comando) ejecutarComando(comando.id_comando, comando.nombre);
}

async function ejecutarComando(idComando, nombreComando) {
    try {
        ui.showFeedback(`Enviando: ${nombreComando}`);
        await api.ejecutarMovimiento(idComando);
    } catch (error) {
        // El error ya lo maneja api.js
    }
}

async function detenerVehiculo() {
    if (idComandoDetener) {
        ejecutarComando(idComandoDetener, 'Detener');
    } else {
        console.error("Comando 'Detener' no encontrado en el catálogo");
    }
}

// Iniciar aplicación al cargar el DOM
document.addEventListener('DOMContentLoaded', inicializar);
