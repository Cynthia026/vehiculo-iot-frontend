// js/app.js
import { api } from './api.js?v=3';
import { wsManager } from './websocket.js?v=2';
import { ui } from './ui.js?v=2';
import { Joystick } from './joystick.js?v=2';

let catalogoComandos = [];
let idComandoDetener = null;

async function inicializar() {
    try {
        // 1. Iniciar WebSocket
        wsManager.connect();

        // 2. Cargar Catálogos
        ui.updateAwsStatus('Comprobando...');
        catalogoComandos = await api.obtenerComandos();
        const demos = await api.obtenerDemos();

        // Buscar el ID del comando Detener
        const cmdDetener = catalogoComandos.find(c => {
            const nombre = (c.nombre || c.comando || '').toUpperCase();
            return nombre === 'DETENER' || nombre === 'STOP';
        });
        if (cmdDetener) idComandoDetener = cmdDetener.id_comando;

        // 3. Renderizar UI Dinámica
        ui.renderComandos(catalogoComandos, ejecutarComando);
        ui.renderDemos(demos);

        // 4. Configurar Eventos Botones
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

        // 5. Inicializar Joystick
        new Joystick('joystick-zone', 'joystick-knob', manejarMovimientoJoystick, detenerVehiculo);

        // Ocultar mensaje de error si todo cargó bien
        document.getElementById('action-feedback').classList.add('d-none');

    } catch (error) {
        console.error("Error inicializando la app:", error);
        ui.showFeedback('Error de red al cargar datos', 'danger');
    }
}

async function manejarMovimientoJoystick(direccion) {
    // Mapeamos la salida del joystick a los nombres reales de tu API
    const mapDirecciones = {
        'ADELANTE': 'AVANZAR',
        'ATRAS': 'RETROCEDER',
        'IZQUIERDA': 'GIRAR_IZQUIERDA',
        'DERECHA': 'GIRAR_DERECHA'
    };
    
    const nombreApi = mapDirecciones[direccion];
    const comando = catalogoComandos.find(c => {
        const nombre = (c.nombre || c.comando || '').toUpperCase();
        return nombre === nombreApi || nombre === direccion;
    });
    
    if (comando) {
        ejecutarComando(comando.id_comando, comando.nombre || comando.comando);
    }
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
