// assets/js/app.js
import { api } from './api.js?v=11';
import { wsManager } from './websocket.js?v=11';
import { ui, normalizar } from './ui.js?v=11';
import { Joystick } from './joystick.js?v=11';
import { CONFIG } from './config.js?v=11';

let catalogoComandos = [];
let idComandoDetener = null;
let vistaActual = 'control'; // Estado para saber qué pestaña estamos viendo

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

async function inicializar() {
    try {
        // 1. Mostrar interfaz de inmediato (modo offline hasta que AWS responda) y configurar controles
        ui.renderComandosPlaceholder();
        ui.setOffline(true);
        configurarControles();

        // 2. Conectar WSS y enlazar la escucha de mensajes
        wsManager.onMessage = procesarMensajeWSS;
        wsManager.connect();

        // 3. Verificar estado de Amazon RDS
        await verificarRDS();

        // 4. Cargar Catálogos para Control
        await cargarCatalogos();

    } catch (error) {
        console.error('Error en la inicialización:', error);
        ui.showFeedback('Error de conexión con el servidor AWS', 'danger');
    }
}

// Configura los eventos de botones, pestañas y ambos joysticks una sola vez
function configurarControles() {
    // Bloquear desplazamiento de la pantalla al arrastrar los joysticks en móviles
    document.addEventListener('touchmove', (e) => {
        if (!e.target.closest('select, .monitor-table-container')) {
            e.preventDefault();
        }
    }, { passive: false });

    // Eventos Botones Control
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
            ui.showFeedback('Iniciando DEMO...', 'success');
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
            ui.showFeedback('Cancelando DEMO...', 'warning');
            await api.cancelarDemo();
        } catch (error) {
            ui.showFeedback('No se pudo cancelar la DEMO', 'danger');
        }
    });

    // Configurar Eventos de Pestañas (Navegación SPA)
    document.getElementById('btn-tab-control').addEventListener('click', () => {
        vistaActual = 'control';
        ui.switchView('control');
    });

    document.getElementById('btn-tab-monitoreo').addEventListener('click', () => {
        vistaActual = 'monitoreo';
        ui.switchView('monitoreo');
        cargarDatosMonitoreo(); // Hace los GET iniciales al abrir la pestaña
    });

    // Inicializar Joysticks (Movimiento y Brazo/Motores)
    new Joystick('joystick-zone', 'joystick-knob', (dir) => {
        ui.playSound('joy');
        manejarMovimientoJoystick(dir);
    }, detenerVehiculo);

    new Joystick('joystick-zone-arm', 'joystick-knob-arm', (dir) => {
        ui.playSound('joy');
        manejarMovimientoBrazo(dir);
    }, detenerVehiculo);
}

// Carga los catálogos de comandos y demos (reintenta cada 8 s si AWS no responde)
async function cargarCatalogos() {
    clearTimeout(reintentoTimer);
    ui.updateAwsStatus('Comprobando...');
    try {
        catalogoComandos = await api.obtenerComandos();
        const demos = await api.obtenerDemos();

        const cmdDetener = catalogoComandos.find(c => c.nombre === 'Detener');
        if (cmdDetener) idComandoDetener = cmdDetener.id_comando;

        // Renderizar UI de Control
        ui.renderComandos(catalogoComandos, ejecutarComando);
        ui.renderDemos(demos);
        ui.setOffline(false);

        primerFallo = true;
        document.getElementById('action-feedback').classList.add('d-none');
    } catch (error) {
        console.error('Error cargando catálogos:', error);
        if (primerFallo) {
            ui.showFeedback('Sin conexión con AWS. Reintentando...', 'danger');
            primerFallo = false;
        }
        reintentoTimer = setTimeout(cargarCatalogos, 8000);
    }
}

// --- LÓGICA DE MONITOREO (REST + WSS) ---

async function cargarDatosMonitoreo() {
    try {
        // Obtenemos el estado actual y el historial en paralelo desde RDS
        const [ultimoEstado, historial] = await Promise.all([
            api.obtenerUltimoEstado(),
            api.obtenerHistorial()
        ]);

        ui.renderUltimoEstado(ultimoEstado);
        ui.renderHistorial(historial);
    } catch (error) {
        console.error('Error al cargar datos de monitoreo:', error);
    }
}

async function procesarMensajeWSS(payload) {
    if (!payload) return;

    // 1. Eventos de DEMO: actualizan tanto el aviso/joystick en Control como la tarjeta en Monitoreo
    if (payload.tipo_evento === 'inicio_demo') {
        ui.showFeedback('Iniciando DEMO...', 'success', 2500);
        return;
    }

    if (payload.tipo_evento === 'movimiento_demo') {
        const cmdObj = catalogoComandos.find(c => c.id_comando === payload.comando_en_ejecucion);
        const nombreBase = cmdObj
            ? cmdObj.nombre
            : (MAPA_COMANDOS_ID[payload.comando_en_ejecucion] || `Comando ID: ${payload.comando_en_ejecucion}`);

        // En vista Control: mostrar el movimiento en ejecución y resaltar el joystick
        const norm = normalizar(nombreBase);
        if (norm === 'DETENER' || norm === 'STOP') {
            ui.playSound('stop');
            ui.limpiarResaltadoDemo();
            ui.showFeedback(`Enviando: ${nombreBase}`, 'info', 2500);
        } else {
            ui.playSound('joy');
            ui.resaltarMovimientoDemo(nombreBase);
            ui.showFeedback(`Enviando: ${nombreBase}`, 'info', 4000);
        }

        // En vista Monitoreo: actualizar la tarjeta superior (sin recargar la tabla, pues las demos no se guardan como historial individual)
        ui.renderUltimoEstado({
            comando: `${nombreBase} (DEMO)`,
            fecha_actualizacion: new Date().toISOString()
        });
        return;
    }

    if (payload.tipo_evento === 'cancelacion_demo') {
        ui.limpiarResaltadoDemo();
        ui.showFeedback('DEMO cancelada', 'warning', 2500);
        ui.renderUltimoEstado({
            comando: 'DEMO CANCELADA',
            fecha_actualizacion: new Date().toISOString()
        });
        return;
    }

    // 2. Si no estamos en la pestaña de monitoreo, ignoramos la recarga de tabla para ahorrar recursos
    if (vistaActual !== 'monitoreo') return;

    // 3. Reconciliación para movimientos individuales y estado inicial en Monitoreo
    if (payload.tipo_evento === 'estado_inicial' || payload.tipo_evento === 'movimiento_individual') {
        // Actualizamos la tarjeta grande inmediatamente con el dato del WSS
        if (payload.datos) {
            ui.renderUltimoEstado({
                ...payload.datos,
                fecha_actualizacion: payload.datos.fecha_actualizacion || payload.datos.fecha_hora || new Date().toISOString()
            });
        }

        // Si fue un movimiento nuevo, recargamos la tabla de los últimos 10 desde RDS
        if (payload.tipo_evento === 'movimiento_individual') {
            // Pequeño retraso de 600ms para darle tiempo a AWS de hacer el COMMIT en MySQL
            setTimeout(async () => {
                try {
                    const historial = await api.obtenerHistorial();
                    ui.renderHistorial(historial);
                } catch (e) {
                    console.error('Error actualizando tabla tras WSS:', e);
                }
            }, 600);
        }
    }
}

// --- LÓGICA DE CONTROL Y SALUD ---

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
