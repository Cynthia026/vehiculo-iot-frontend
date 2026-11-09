// assets/js/app.js
import { api } from './api.js?v=8';
import { wsManager } from './websocket.js?v=8';
import { ui, normalizar } from './ui.js?v=8';
import { Joystick } from './joystick.js?v=8';
import { CONFIG } from './config.js?v=8'; // Importado para acceder a la URL base

let catalogoComandos = [];
let catalogoDemos = [];
let idComandoDetener = null;

let reintentoTimer = null;
let primerFallo = true;

// Mapa de respaldo por ID de comando en caso de que aún no esté en catálogo
const MAPA_COMANDOS_ID = {
    1: 'AVANZAR',
    2: 'RETROCEDER',
    3: 'GIRAR_IZQUIERDA',
    4: 'GIRAR_DERECHA',
    5: 'SUBIR_BRAZO',
    6: 'BAJAR_BRAZO',
    7: 'MOTOR_IZQUIERDA',
    8: 'MOTOR_DERECHA',
    9: 'VELOCIDAD',
    10: 'SONIDO',
    11: 'LUZ',
    12: 'Detener'
};

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
        ui.limpiarResaltadoDemo();
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
            ui.limpiarResaltadoDemo();
            ui.playSound('start');
            ui.vibrar(15);
            ui.showFeedback('Iniciando DEMO...', 'success', 2500);
            await api.ejecutarDemo(select.value);
        } catch (error) {
            ui.limpiarResaltadoDemo();
            ui.showFeedback('No se pudo iniciar la DEMO', 'danger');
        }
    });

    document.getElementById('btn-demo-cancel').addEventListener('click', async () => {
        ui.limpiarResaltadoDemo();
        try {
            ui.playSound('cancel');
            ui.vibrar(15);
            ui.showFeedback('Cancelando DEMO...', 'warning', 2000);
            await api.cancelarDemo();
        } catch (error) {
            ui.showFeedback('No se pudo cancelar la DEMO', 'danger');
        }
    });

    new Joystick('joystick-zone', 'joystick-knob', (dir) => {
        ui.playSound('joy');
        manejarMovimientoJoystick(dir);
    }, detenerVehiculo);
    new Joystick('joystick-zone-arm', 'joystick-knob-arm', (dir) => {
        ui.playSound('joy');
        manejarMovimientoBrazo(dir);
    }, detenerVehiculo);
}

// Resuelve el nombre del comando a partir de su ID o texto
function obtenerNombreComando(valor) {
    if (valor == null) return null;

    // Buscar primero por id_comando en el catálogo cargado desde AWS
    const porId = catalogoComandos.find(c => String(c.id_comando) === String(valor));
    if (porId) return porId.nombre || porId.comando;

    // Buscar en el mapa de respaldo si es numérico
    if (MAPA_COMANDOS_ID[valor]) return MAPA_COMANDOS_ID[valor];

    // Si ya viene como texto (ej. "AVANZAR")
    if (typeof valor === 'string' && valor.trim().length > 0 && valor !== 'ejecutando_paso') {
        return valor.trim();
    }
    return null;
}

// Muestra en el aviso inferior y en los joysticks el movimiento en ejecución
function mostrarPasoDemo(nombreMovimiento) {
    if (!nombreMovimiento) return;
    const limpio = String(nombreMovimiento).trim();
    if (!limpio) return;

    const norm = normalizar(limpio);
    if (norm === 'DETENER' || norm === 'STOP') {
        ui.playSound('stop');
        ui.limpiarResaltadoDemo();
        ui.showFeedback(`Enviando: ${limpio}`, 'info', 2500);
    } else {
        ui.playSound('joy');
        ui.resaltarMovimientoDemo(limpio);
        ui.showFeedback(`Enviando: ${limpio}`, 'info', 4000);
    }
}

// Procesa los eventos en tiempo real enviados por el WebSocket (/api/demos/ws/1)
function manejarEventoWssDemo(data) {
    if (!data) return;

    const tipoEvento = String(data.tipo_evento || data.evento || data.tipo || '').toLowerCase();

    // 1. Inicio de DEMO
    if (tipoEvento === 'inicio_demo') {
        ui.showFeedback('Iniciando DEMO...', 'success', 2500);
        return;
    }

    // 2. Movimiento de DEMO: { tipo_evento: 'movimiento_demo', vehiculo: 1, comando_en_ejecucion: 1, accion: 'ejecutando_paso', orden: 1 }
    if (tipoEvento === 'movimiento_demo' || data.comando_en_ejecucion != null) {
        const idONombre = data.comando_en_ejecucion ?? data.id_comando ?? data.datos?.id_comando ?? data.datos?.comando;
        const nombreMov = obtenerNombreComando(idONombre) || `Paso ${data.orden || ''}`.trim();
        mostrarPasoDemo(nombreMov);
        return;
    }

    // 3. Cancelación de DEMO: { tipo_evento: 'cancelacion_demo', vehiculo: 1 }
    if (tipoEvento === 'cancelacion_demo' || /cancel/i.test(tipoEvento)) {
        ui.limpiarResaltadoDemo();
        ui.showFeedback('DEMO cancelada', 'warning', 2500);
        return;
    }

    // 4. Fin de DEMO: { tipo_evento: 'fin_demo', ... }
    if (/fin_demo|finaliz|complet|terminad/i.test(tipoEvento)) {
        ui.limpiarResaltadoDemo();
        ui.showFeedback('DEMO finalizada', 'success', 2500);
        return;
    }

    // 5. Movimiento individual: { tipo_evento: 'movimiento_individual', datos: { id_comando: 5, comando: 'SUBIR_BRAZO' } }
    if (tipoEvento === 'movimiento_individual' && data.datos) {
        const nombreMov = data.datos.comando || obtenerNombreComando(data.datos.id_comando);
        if (nombreMov) {
            ui.showFeedback(`Enviando: ${nombreMov}`, 'info', 2000);
        }
        return;
    }

    // 6. Cualquier otro formato que traiga id_comando o comando
    const otroComando = obtenerNombreComando(data.id_comando ?? data.datos?.comando ?? data.datos?.id_comando ?? data.comando ?? data.movimiento);
    if (otroComando) {
        mostrarPasoDemo(otroComando);
    }
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
