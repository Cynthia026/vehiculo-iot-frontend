// js/api.js
import { CONFIG } from './config.js';
import { UI } from './ui.js';

export const API = {
    abortController: null,
    commandsMap: {}, 

    async get(endpoint) {
        try {
            const response = await fetch(`${CONFIG.API_URL}${endpoint}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            UI.updateAws(true);
            return await response.json();
        } catch (error) {
            UI.updateAws(false);
            console.error("[API GET Error]", error);
            throw error;
        }
    },

    async postMovimiento(idComando) {
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();

        const url = `${CONFIG.API_URL}/api/telemetria/movimiento?id_vehiculo=${CONFIG.VEHICULO_ID}&id_comando=${idComando}&origen=${CONFIG.ORIGEN}`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                signal: this.abortController.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error("[API POST Error]", error);
                throw error;
            }
        }
    }
};
