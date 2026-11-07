// js/app.js
import { api } from './api.js';
import { wsManager } from './websocket.js';
import { ui, normalizar } from './ui.js';
import { Joystick } from './joystick.js';
import { CONFIG } from './config.js'; // Importado para acceder a la URL base

let catalogoComandos = [];
let idComandoDetener = null;

async function inicializar() {
    try {
        // 1. Iniciar WebSocket
        wsManager.connect();

        // 2. Verificar estado de Amazon RDS (Nuevo Endpoint)
        await verificarRDS();

        // 3. Cargar Catálogos
        ui.updateAwsStatus('Comprobando...');
        catalogoComandos = await api.obtenerComandos();
        const demos = await api.obtenerDemos();

        // Buscar el ID del comando Detener (Sensible a mayúsculas/minúsculas)
        const cmdDetener = catalogoComandos.find(c => c.nombre === 'Detener');
        if (cmdDetener) idComandoDetener = cmdDetener.id_comando;

        // 4. Renderizar UI Dinámica
        ui.renderComandos(catalogoComandos, ejecutarComando);
        ui.renderDemos(demos);

        // 5. Configurar Eventos Botones
        document.getElementById('btn-stop').addEventListener('click', detenerVehiculo);
        
        document.getElementById('btn-demo-start').addEventListener('click', async () => {
            const select = document.getElementById('demo-select');
            if (select.value) {
                ui.showFeedback('Iniciando DEMO...', 'success');
                await api.ejecutarDemo(select.value);
            }
        });

        document.getElementById('btn-demo-cancel').addEventListener('click', async () => {
            ui.showFeedback('Cancelando DEMO...', 'warning');
            await api.cancelarDemo();
        });

        // 6. Inicializar Joystick
        new Joystick('joystick-zone', 'joystick-knob', manejarMovimientoJoystick, detenerVehiculo);
        new Joystick('joystick-zone-arm', 'joystick-knob-arm', manejarMovimientoBrazo, detenerVehiculo);

        // Ocultar mensaje de error si todo cargó bien
        document.getElementById('action-feedback').classList.add('d-none');

    } catch (error) {
        console.error("Error inicializando la app:", error);
        ui.showFeedback('Error de red al cargar datos', 'danger');
    }
}

// NUEVA FUNCIÓN: Consulta el endpoint de salud
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
