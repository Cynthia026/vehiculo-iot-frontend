// js/ui.js
class UIController {
    constructor() {
        this.feedback = document.getElementById('action-feedback');
        this.statusWss = document.getElementById('status-wss');
        this.statusAws = document.getElementById('status-aws');
    }

    updateWssStatus(text, type) {
        this.statusWss.className = `badge bg-${type} border border-light`;
        this.statusWss.innerHTML = `<i class="bi bi-broadcast"></i> WSS: ${text}`;
    }

    updateAwsStatus(text) {
        const type = text === 'Disponible' ? 'success' : 'danger';
        this.statusAws.className = `badge bg-${type} border border-light`;
        this.statusAws.innerHTML = `<i class="bi bi-cloud-check"></i> AWS: ${text}`;
    }

    showFeedback(message, type = 'info') {
        this.feedback.textContent = message;
        this.feedback.className = `alert alert-${type} w-100 max-w-sm text-center`;
        this.feedback.classList.remove('d-none');
        
        // Ocultar después de 2 segundos si no es un error
        if(type !== 'danger'){
            setTimeout(() => {
                this.feedback.classList.add('d-none');
            }, 2000);
        }
    }

    renderComandos(comandos, onCommandClick) {
        const container = document.getElementById('extra-commands-container');
        container.innerHTML = ''; // Limpiar
        
        // Excluimos los comandos que ya controla el joystick y el botón rojo
        const excluidos = ['AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'Detener'];
        
        comandos.forEach(cmd => {
            if (!excluidos.includes(cmd.nombre)) {
                const div = document.createElement('div');
                div.className = 'col-6 mb-2';
                const btn = document.createElement('button');
                btn.className = 'btn btn-outline-primary w-100 h-100';
                btn.textContent = cmd.nombre; // Ahora lee 'nombre' en lugar de 'comando'
                btn.onclick = () => onCommandClick(cmd.id_comando, cmd.nombre);
                div.appendChild(btn);
                container.appendChild(div);
            }
        });
    }

    renderDemos(demos) {
        const select = document.getElementById('demo-select');
        select.innerHTML = '<option value="">Selecciona una DEMO</option>';
        demos.forEach(demo => {
            const option = document.createElement('option');
            option.value = demo.id_demo;
            option.textContent = demo.nombre;
            select.appendChild(option);
        });
        
        document.getElementById('btn-demo-start').disabled = false;
        document.getElementById('btn-demo-cancel').disabled = false;
    }
}

export const ui = new UIController();
