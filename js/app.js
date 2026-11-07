// js/app.js
import { CONFIG } from './config.js';
import { UI } from './ui.js';
import { API } from './api.js';
import { JoystickControl } from './joystick.js';

// Convertir las funciones a globales solo si queremos llamarlas desde un 'onclick' en el HTML generado dinámicamente
window.ejecutarMovimiento = async function(nombreComando) {
    const idComando = API.commandsMap[nombreComando];
    if (!idComando) return;
    try {
        UI.showFeedback(`<i class="bi bi-send"></i> Comando: <b>${nombreComando}</b>`);
        await API.postMovimiento(idComando);
    } catch (error) {
        UI.showFeedback(`Error enviando ${nombreComando}`, 'danger');
    }
};

window.ejecutarDetener = async function() {
    const stopId = API.commandsMap['DETENER'] || API.commandsMap['STOP'];
    if (stopId) {
        try {
            UI.showFeedback(`<i class="bi bi-sign-stop-fill text-danger"></i> <b>VEHÍCULO DETENIDO</b>`);
            await API.postMovimiento(stopId);
        } catch (e) {
            UI.showFeedback('Error al detener', 'danger');
        }
    }
};

async function cargarCatalogos() {
    try {
        const comandos = await API.get(`/api/comandos/vehiculo/${CONFIG.VEHICULO_ID}`);
        UI.cmdsContainer.innerHTML = ''; 
        UI.btnStop.disabled = false;
        
        comandos.forEach(cmd => {
            const nombre = cmd.comando.toUpperCase();
            API.commandsMap[nombre] = cmd.id_comando;

            const ignorados = ['ADELANTE', 'ATRAS', 'IZQUIERDA', 'DERECHA', 'DETENER', 'STOP'];
            if (!ignorados.includes(nombre)) {
                const btnDiv = document.createElement('div');
                btnDiv.className = 'col-6';
                btnDiv.innerHTML = `<button class="btn btn-outline-primary w-100 py-2 shadow-sm" onclick="window.ejecutarMovimiento('${nombre}')">${nombre}</button>`;
                UI.cmdsContainer.appendChild(btnDiv);
            }
        });

        if(UI.cmdsContainer.innerHTML === '') {
            UI.cmdsContainer.innerHTML = '<div class="col-12 text-center text-muted small">Sin comandos adicionales</div>';
        }

        const demos = await API.get(`/api/demos/vehiculo/${CONFIG.VEHICULO_ID}`);
        UI.demoSelect.innerHTML = '<option value="">Seleccione una secuencia...</option>';
        demos.forEach(demo => {
            UI.demoSelect.innerHTML += `<option value="${demo.id_demo}">${demo.nombre}</option>`;
        });

        UI.demoSelect.addEventListener('change', (e) => {
            UI.btnDemoStart.disabled = e.target.value === "";
        });

        UI.showFeedback('<i class="bi bi-check2-circle"></i> AWS: Datos cargados correctamente.', 'success');

    } catch (error) {
        UI.cmdsContainer.innerHTML = '<div class="col-12 text-center text-danger small">Fallo al cargar comandos AWS</div>';
        UI.showFeedback('Error de conexión REST con AWS', 'danger', false);
    }
}

function iniciarWebSocket() {
    UI.updateWss('Conectando...', 'warning');
    const ws = new WebSocket(CONFIG.WS_URL);

    ws.onopen = () => UI.updateWss('En línea', 'success');
    ws.onmessage = (event) => console.log("WebSocket Event:", JSON.parse(event.data));
    ws.onclose = () => {
        UI.updateWss('Desconectado', 'danger');
        setTimeout(iniciarWebSocket, 4000); 
    };
    ws.onerror = () => ws.close(); 
}

function configurarEventosEstaticos() {
    UI.btnStop.addEventListener('click', window.ejecutarDetener);

    UI.btnDemoStart.addEventListener('click', async () => {
        const idDemo = UI.demoSelect.value;
        if (!idDemo) return;
        
        try {
            UI.btnDemoStart.disabled = true;
            UI.btnDemoCancel.disabled = false;
            UI.showFeedback('<i class="bi bi-play-circle"></i> Ejecutando secuencia DEMO...', 'info', false);
            
            const response = await fetch(`${CONFIG.API_URL}/api/demos/${idDemo}/ejecutar`, { method: 'POST' });
            if (!response.ok) throw new Error("Error en DEMO");
            
        } catch (e) {
            UI.showFeedback('Fallo al iniciar DEMO', 'danger');
            UI.btnDemoStart.disabled = false;
            UI.btnDemoCancel.disabled = true;
        }
    });

    UI.btnDemoCancel.addEventListener('click', async () => {
        try {
            UI.showFeedback('<i class="bi bi-x-circle"></i> Cancelando DEMO...', 'warning');
            await fetch(`${CONFIG.API_URL}/api/demos/vehiculo/${CONFIG.VEHICULO_ID}/cancelar`, { method: 'POST' });
            setTimeout(window.ejecutarDetener, 300);
            
        } catch (e) {
            UI.showFeedback('Error al cancelar', 'danger');
        } finally {
            UI.btnDemoCancel.disabled = true;
            UI.btnDemoStart.disabled = false;
        }
    });
}

// Iniciar aplicación
document.addEventListener('DOMContentLoaded', () => {
    JoystickControl.init(window.ejecutarMovimiento, window.ejecutarDetener);
    configurarEventosEstaticos();
    cargarCatalogos();
    iniciarWebSocket();
});
