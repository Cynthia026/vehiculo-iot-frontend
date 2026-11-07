// js/joystick.js
import { UI } from './ui.js';

export const JoystickControl = {
    activeDirection: null,
    isActive: false,
    maxRadius: 70, 
    deadZone: 25,  
    onMoveCallback: null,
    onStopCallback: null,

    init(onMove, onStop) {
        this.onMoveCallback = onMove;
        this.onStopCallback = onStop;
        UI.joystickKnob.addEventListener('pointerdown', this.onDown.bind(this));
        document.addEventListener('pointermove', this.onMove.bind(this));
        document.addEventListener('pointerup', this.onUp.bind(this));
        document.addEventListener('pointercancel', this.onUp.bind(this));
    },

    onDown(e) {
        this.isActive = true;
        UI.joystickKnob.classList.remove('returning');
        UI.joystickKnob.setPointerCapture(e.pointerId);
    },

    onMove(e) {
        if (!this.isActive) return;
        
        const rect = UI.joystickZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        let dx = e.clientX - centerX;
        let dy = e.clientY - centerY;
        
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > this.maxRadius) {
            dx = dx * (this.maxRadius / distance);
            dy = dy * (this.maxRadius / distance);
        }
        
        UI.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.calculateDirection(dx, dy, distance);
    },

    onUp() {
        if (!this.isActive) return;
        this.isActive = false;
        
        UI.joystickKnob.classList.add('returning');
        UI.joystickKnob.style.transform = `translate(0px, 0px)`;
        
        if (this.activeDirection !== null) {
            this.activeDirection = null;
            if (this.onStopCallback) this.onStopCallback();
        }
    },

    calculateDirection(dx, dy, distance) {
        if (distance < this.deadZone) {
            if (this.activeDirection !== null) {
                this.activeDirection = null;
                if (this.onStopCallback) this.onStopCallback();
            }
            return;
        }

        let newDirection = null;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        if (angle >= -45 && angle <= 45) newDirection = 'DERECHA';
        else if (angle > 45 && angle < 135) newDirection = 'ATRAS';
        else if (angle >= 135 || angle <= -135) newDirection = 'IZQUIERDA';
        else if (angle > -135 && angle < -45) newDirection = 'ADELANTE';

        if (newDirection && newDirection !== this.activeDirection) {
            this.activeDirection = newDirection;
            if (this.onMoveCallback) this.onMoveCallback(newDirection);
        }
    }
};
