// assets/js/websocket.js
import { CONFIG } from './config.js?v=13';
import { ui } from './ui.js?v=13';

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxAttempts = 5;
        this.onMessage = null; // Permite avisar a app.js cuando llega algo
        this._manualClose = false;
    }

    connect() {
        this._manualClose = false;
        ui.updateWssStatus('Conectando...', 'warning');
        
        try {
            if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
                this._manualClose = true;
                this.ws.close();
            }

            this.ws = new WebSocket(CONFIG.WS_BASE_URL);

            this.ws.onopen = () => {
                console.log('WSS Conectado a unidad #' + CONFIG.VEHICULO_ID);
                ui.updateWssStatus('En línea', 'success');
                this.reconnectAttempts = 0;
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('Evento WSS recibido:', data);
                    
                    // Si app.js está escuchando, le pasamos el JSON
                    if (this.onMessage) {
                        this.onMessage(data);
                    }
                } catch (e) {
                    console.error('Error parseando JSON del WSS', e);
                }
            };

            this.ws.onclose = (ev) => {
                if (this._manualClose) return;
                console.log('WSS Desconectado');
                if (ev && ev.code === 4003) {
                    ui.updateWssStatus('Sin permiso WSS', 'danger');
                    return;
                }
                ui.updateWssStatus('Desconectado', 'danger');
                this.attemptReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WSS Error:', error);
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.close();
                }
            };

        } catch (error) {
            console.error('Error al crear WSS:', error);
            ui.updateWssStatus('Error de red', 'danger');
        }
    }

    reconnectForVehicle(idVehiculo) {
        CONFIG.setVehiculoId(idVehiculo);
        this.reconnectAttempts = 0;
        this.connect();
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxAttempts) {
            this.reconnectAttempts++;
            ui.updateWssStatus(`Reconectando (${this.reconnectAttempts})...`, 'warning');
            setTimeout(() => this.connect(), 3000); 
        }
    }
}

export const wsManager = new WebSocketManager();
