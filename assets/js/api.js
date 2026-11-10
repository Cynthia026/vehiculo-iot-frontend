// assets/js/api.js
import { CONFIG } from './config.js?v=12';
import { ui } from './ui.js?v=12';

class ApiClient {
    constructor() {
        this.abortController = null;
    }

    async get(endpoint) {
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            ui.updateAwsStatus('Disponible');
            return await response.json();
        } catch (error) {
            console.error('Error GET:', error);
            ui.updateAwsStatus('No disponible');
            throw error;
        }
    }

    async postQuery(endpoint, params) {
        // Cancela la petición anterior si hay una en vuelo (evita saturación)
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();

        try {
            // Construye los query parameters requeridos por Swagger (sin body JSON)
            const queryString = new URLSearchParams(params).toString();
            const url = `${CONFIG.API_BASE_URL}${endpoint}?${queryString}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                signal: this.abortController.signal
            });
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Petición POST abortada (nueva orden en camino)');
            } else {
                console.error('Error POST:', error);
                ui.showFeedback('Error al enviar comando', 'danger');
            }
            throw error;
        }
    }

    // --- MÉTODOS DE CONTROL ---

    async obtenerComandos() {
        return this.get(`/api/comandos/vehiculo/${CONFIG.VEHICULO_ID}`);
    }

    async obtenerDemos() {
        return this.get(`/api/demos/vehiculo/${CONFIG.VEHICULO_ID}`);
    }

    async ejecutarMovimiento(idComando) {
        return this.postQuery('/api/telemetria/movimiento', {
            id_vehiculo: CONFIG.VEHICULO_ID,
            id_comando: idComando,
            origen: 'API_POST'
        });
    }

    async ejecutarDemo(idDemo) {
        const url = `${CONFIG.API_BASE_URL}/api/demos/${idDemo}/ejecutar?id_vehiculo=${CONFIG.VEHICULO_ID}`;
        const response = await fetch(url, { 
            method: 'POST',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }

    async cancelarDemo() {
        return await fetch(`${CONFIG.API_BASE_URL}/api/demos/vehiculo/${CONFIG.VEHICULO_ID}/cancelar`, { method: 'POST' });
    }

    // --- MÉTODOS DE MONITOREO (Práctica 4.2) ---

    async obtenerUltimoEstado() {
        // Usa el GET real documentado en Swagger
        return this.get(`/api/telemetria/estado/${CONFIG.VEHICULO_ID}`);
    }

    async obtenerHistorial() {
        // Usa el GET real documentado, trae los últimos registros
        const historial = await this.get(`/api/telemetria/historial/${CONFIG.VEHICULO_ID}`);
        const lista = Array.isArray(historial)
            ? historial
            : (historial?.historial || historial?.datos || historial?.data || []);
        // Retornamos máximo 10 según la regla de negocio
        return Array.isArray(lista) ? lista.slice(0, 10) : [];
    }
}

// EXPORTACIÓN EXACTA: app.js espera 'api'
export const api = new ApiClient();
export const API = api;
