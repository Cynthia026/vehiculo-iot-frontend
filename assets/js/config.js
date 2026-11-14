// assets/js/config.js
export const CONFIG = {
    API_BASE_URL: 'https://api-vehiculo-iot.duckdns.org',
    WS_BASE_URL: 'wss://api-vehiculo-iot.duckdns.org/api/demos/ws/1',
    API_URL: 'https://api-vehiculo-iot.duckdns.org',
    WS_URL: 'wss://api-vehiculo-iot.duckdns.org/api/demos/ws/1',
    VEHICULO_ID: 1,
    ORIGEN: 'API_POST',
    AUTH_TOKEN: null,
    setVehiculoId(id) {
        const num = Number(id) || 1;
        this.VEHICULO_ID = num;
        const baseWs = 'wss://api-vehiculo-iot.duckdns.org/api/demos/ws/' + num;
        this.WS_BASE_URL = this.AUTH_TOKEN ? `${baseWs}?token=${encodeURIComponent(this.AUTH_TOKEN)}` : baseWs;
        this.WS_URL = this.WS_BASE_URL;
    },
    setAuthToken(token) {
        this.AUTH_TOKEN = token || null;
        this.setVehiculoId(this.VEHICULO_ID);
    }
};
