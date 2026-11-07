// js/ui.js
export const UI = {
    // Usamos getters para asegurar que obtengan el elemento cuando el DOM cargue
    get awsBadge() { return document.getElementById('status-aws'); },
    get wsBadge() { return document.getElementById('status-wss'); },
    get feedback() { return document.getElementById('action-feedback'); },
    get btnStop() { return document.getElementById('btn-stop'); },
    get cmdsContainer() { return document.getElementById('extra-commands-container'); },
    get demoSelect() { return document.getElementById('demo-select'); },
    get btnDemoStart() { return document.getElementById('btn-demo-start'); },
    get btnDemoCancel() { return document.getElementById('btn-demo-cancel'); },
    get joystickZone() { return document.getElementById('joystick-zone'); },
    get joystickKnob() { return document.getElementById('joystick-knob'); },

    showFeedback(msg, type = 'info', autoHide = true) {
        const fb = this.feedback;
        fb.className = `alert alert-${type} max-w-sm w-100 text-center mx-auto mb-3 shadow-sm fw-medium`;
        fb.innerHTML = msg;
        fb.classList.remove('d-none');
        
        if (autoHide && type !== 'danger') {
            setTimeout(() => { fb.classList.add('d-none'); }, 2500);
        }
    },

    updateAws(isAvailable) {
        const badge = this.awsBadge;
        if (isAvailable) {
            badge.className = 'badge bg-success border border-light status-badge';
            badge.innerHTML = '<i class="bi bi-cloud-check"></i> AWS: Disponible';
        } else {
            badge.className = 'badge bg-danger border border-light status-badge';
            badge.innerHTML = '<i class="bi bi-cloud-slash"></i> AWS: No Disponible';
        }
    },

    updateWss(state, type) {
        const badge = this.wsBadge;
        badge.className = `badge bg-${type} border border-light status-badge`;
        badge.innerHTML = `<i class="bi bi-broadcast"></i> WSS: ${state}`;
    }
};
