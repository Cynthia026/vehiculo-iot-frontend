// js/joystick.js

// EXPORTACIÓN EXACTA: app.js espera importar la clase 'Joystick'
export class Joystick {
    constructor(zoneId, knobId, onMove, onStop) {
        this.zone = document.getElementById(zoneId);
        this.knob = document.getElementById(knobId);
        this.onMove = onMove; 
        this.onStop = onStop; 
        
        this.active = false;
        this.currentDirection = null;
        this.center = { x: 0, y: 0 };
        this.maxRadius = this.zone.offsetWidth / 2 - this.knob.offsetWidth / 2;

        this.initEvents();
    }

    initEvents() {
        this.zone.addEventListener('pointerdown', this.handleDown.bind(this));
        document.addEventListener('pointermove', this.handleMove.bind(this));
        document.addEventListener('pointerup', this.handleUp.bind(this));
        document.addEventListener('pointercancel', this.handleUp.bind(this));
    }

    handleDown(e) {
        this.active = true;
        this.knob.classList.remove('returning');
        const rect = this.zone.getBoundingClientRect();
        this.center = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        this.updatePosition(e.clientX, e.clientY);
    }

    handleMove(e) {
        if (!this.active) return;
        e.preventDefault(); // Previene scroll en móviles
        this.updatePosition(e.clientX, e.clientY);
    }

    handleUp() {
        if (!this.active) return;
        this.active = false;
        
        // Regresar al centro visualmente
        this.knob.style.transform = `translate(0px, 0px)`;
        this.knob.classList.add('returning');
        this.currentDirection = null;
        
        // Ejecutar DETENER
        this.onStop();
    }

    updatePosition(clientX, clientY) {
        let dx = clientX - this.center.x;
        let dy = clientY - this.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Limitar el joystick al borde del círculo
        if (distance > this.maxRadius) {
            dx = dx * (this.maxRadius / distance);
            dy = dy * (this.maxRadius / distance);
        }

        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

        this.calculateDirection(dx, dy, distance);
    }

    calculateDirection(dx, dy, distance) {
        // Zona neutral muerta (si mueve menos de 20px, no hace nada)
        if (distance < 20) return;

        let newDirection = null;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        // Mapeo de ángulos a direcciones
        if (angle >= -45 && angle <= 45) newDirection = 'DERECHA';
        else if (angle > 45 && angle < 135) newDirection = 'ATRAS';
        else if (angle >= 135 || angle <= -135) newDirection = 'IZQUIERDA';
        else if (angle > -135 && angle < -45) newDirection = 'ADELANTE';

        // Solo envia si la dirección cambió (evita spam de POSTs)
        if (newDirection && newDirection !== this.currentDirection) {
            this.currentDirection = newDirection;
            this.onMove(newDirection);
        }
    }
}
