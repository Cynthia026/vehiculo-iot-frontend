// assets/js/websocket.js
import { CONFIG } from './config.js?v=11';
import { ui } from './ui.js?v=11';

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxAttempts = 5;
        this.onMessage = null; // Permite avisar a app.js cuando llega un evento WSS
    }

    setOnMessage(callback) {
        this.onMessage = callback;
    }

    connect() {
        ui.updateWssStatus('Conectando...', 'warning');
        
        try {
            this.ws = new WebSocket(CONFIG.WS_BASE_URL);

            this.ws.onopen = () => {
                console.log('WSS Conectado');
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

            this.ws.onclose = () => {
                console.log('WSS Desconectado');
                ui.updateWssStatus('Desconectado', 'danger');
                this.attemptReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WSS Error:', error);
                if (this.ws && this.ws.readyState === 1) {
                    this.ws.close();
                }
            };

        } catch (error) {
            console.error('Error al crear WSS:', error);
            ui.updateWssStatus('Error de red', 'danger');
        }
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
