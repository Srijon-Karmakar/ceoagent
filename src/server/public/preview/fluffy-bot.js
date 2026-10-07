// Fluffy Bot — Master 3D Asset + Interactive Fluff Physics & Visor Engine
// Physical fur brushing dynamics, squishy elastic jiggle, autonomous glancing/blinking,
// and real-time cursor eye tracking on the digital visor.

(function () {
  let activeInstance = null;

  class FluffyBot {
    constructor(container) {
      this.container = container;
      this.rafId = 0;
      this.destroyed = false;

      // Mouse & Pointer tracking
      this.mouse = { x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0 };
      this.isHovered = false;
      this.isMouseDown = false;

      // Body spring-mass damper physics
      this.body = {
        x: 0, y: 0, vx: 0, vy: 0,
        scaleX: 1, scaleY: 1, vScaleX: 0, vScaleY: 0,
        rot: 0, vRot: 0,
        tiltX: 0, tiltY: 0,
      };

      // Eyes state & autonomous timing
      this.eyes = {
        x: 0, y: 0, targetX: 0, targetY: 0,
        scaleY: 1, isBlinking: false,
        nextBlinkTime: performance.now() + 2400,
        nextGlanceTime: performance.now() + 1600,
      };

      // Fur strands simulation
      this.strands = [];
      this.canvas = null;
      this.ctx = null;
      this.width = 220;
      this.height = 220;

      this.initDOM();
      this.updateCanvasSize();
      this.initFurStrands();
      this.bindEvents();
      this.loop = this.loop.bind(this);
      this.rafId = requestAnimationFrame(this.loop);
    }

    initDOM() {
      this.container.innerHTML = `
        <div class="fluffy-bot-root" id="fluffy-bot-root" role="button" aria-label="Fluffy Bot">
          <div class="fluffy-aura"></div>
          <div class="fluffy-body-wrap">
            <img class="fluffy-bot-base" src="fluffy-bot-body.png" alt="Fluffy Bot" draggable="false" />
            <canvas class="fluffy-fur-canvas"></canvas>
            <div class="fluffy-visor-overlay">
              <div class="fluffy-eyes-wrap">
                <div class="fluffy-eye fluffy-eye-l">
                  <div class="fluffy-eye-core"></div>
                  <div class="fluffy-eye-glint"></div>
                </div>
                <div class="fluffy-eye fluffy-eye-r">
                  <div class="fluffy-eye-core"></div>
                  <div class="fluffy-eye-glint"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      this.root = this.container.querySelector(".fluffy-bot-root");
      this.bodyWrap = this.container.querySelector(".fluffy-body-wrap");
      this.eyesWrap = this.container.querySelector(".fluffy-eyes-wrap");
      this.eyeL = this.container.querySelector(".fluffy-eye-l");
      this.eyeR = this.container.querySelector(".fluffy-eye-r");
      this.canvas = this.container.querySelector(".fluffy-fur-canvas");
      this.ctx = this.canvas.getContext("2d");
    }

    updateCanvasSize() {
      if (!this.canvas) return;
      const rect = this.bodyWrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = rect.width || 220;
      this.height = rect.height || 220;

      // Make canvas slightly larger than the body to give fur room to fluff outward
      const pad = 36;
      this.canvasPad = pad;
      this.canvasW = this.width + pad * 2;
      this.canvasH = this.height + pad * 2;

      this.canvas.width = Math.round(this.canvasW * dpr);
      this.canvas.height = Math.round(this.canvasH * dpr);
      if (this.ctx.resetTransform) this.ctx.resetTransform();
      else this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
    }

    initFurStrands() {
      this.strands = [];
      const count = 240;
      const baseRadius = Math.min(this.width, this.height) * 0.44;

      // Color palette matching the fluffy bot's pastel violet/lavender/blue/pink fur
      const colors = {
        top: ["#c084fc", "#d8b4fe", "#e9d5ff", "#a855f7", "#c4b5fd"], // Lavender & Lilac crest
        left: ["#93c5fd", "#818cf8", "#a5b4fc", "#60a5fa", "#bfdbfe"], // Soft celestial blue
        right: ["#f472b6", "#fb7185", "#fda4af", "#fbcfe8", "#f43f5e"], // Rose & candy pink
        bottom: ["#f472b6", "#e879f9", "#c084fc", "#fda4af"], // Radiant magenta/pink
        wisps: ["#ffffff", "#f5f3ff", "#ede9fe"], // Specular hair glints
      };

      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;

        // Top crest has iconic slightly longer feather tufts
        const isTopCrest = angle > -Math.PI * 0.82 && angle < -Math.PI * 0.18;
        const baseLen = isTopCrest
          ? 14 + Math.random() * 12
          : 8 + Math.random() * 10;

        // Base anchor along outer contour of fur ball with subtle radial depth variation
        const depth = Math.random();
        const rVar = baseRadius * (0.76 + depth * 0.18);
        const bx = Math.cos(angle) * rVar;
        const by = Math.sin(angle) * rVar;

        // Hair flows radially outward with organic curve tilt
        const curl = (Math.random() - 0.5) * 0.45;
        const dirAngle = angle + curl;
        const dx = Math.cos(dirAngle) * baseLen;
        const dy = Math.sin(dirAngle) * baseLen;

        // Pick color palette segment based on angle
        let pal = colors.top;
        if (angle < -Math.PI * 0.25) pal = colors.top;
        else if (angle < Math.PI * 0.3) pal = colors.right;
        else if (angle < Math.PI * 0.78) pal = colors.bottom;
        else pal = colors.left;

        let strandColor = pal[Math.floor(Math.random() * pal.length)];
        // 12% chance of bright silky specular highlight wisp
        if (Math.random() < 0.12) {
          strandColor = colors.wisps[Math.floor(Math.random() * colors.wisps.length)];
        }

        this.strands.push({
          baseX: bx,
          baseY: by,
          dx, dy,       // resting tip offset
          tipX: dx,     // current tip offset
          tipY: dy,
          vx: 0, vy: 0,
          color: strandColor,
          width: 0.9 + Math.random() * 0.9,
          alpha: 0.28 + Math.random() * 0.32,
          stiffness: 0.16 + Math.random() * 0.08,
          damping: 0.82 + Math.random() * 0.05,
          freq: 2.0 + Math.random() * 2.8,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    bindEvents() {
      this.onPointerMove = (e) => {
        const rect = this.bodyWrap.getBoundingClientRect();
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;

        const curX = e.clientX - cx;
        const curY = e.clientY - cy;

        this.mouse.vx = (curX - this.mouse.x) * 0.75;
        this.mouse.vy = (curY - this.mouse.y) * 0.75;
        this.mouse.prevX = this.mouse.x;
        this.mouse.prevY = this.mouse.y;
        this.mouse.x = curX;
        this.mouse.y = curY;

        const dist = Math.hypot(curX, curY);
        const radius = rect.width * 0.5;
        this.isHovered = dist < (radius + 50);

        // Physical brushing of fluff strands
        if (this.isHovered || dist < (radius + 90)) {
          const speed = Math.hypot(this.mouse.vx, this.mouse.vy);
          if (speed > 0.8) {
            this.brushFur(curX, curY, this.mouse.vx, this.mouse.vy);
          }
        }

        // Active awakened mood when hovered or near
        if (this.isHovered) {
          this.root.setAttribute("data-mood", "active");

          // Visor cursor tracking
          const angle = Math.atan2(curY, curX);
          const distFactor = Math.min(1.0, Math.max(0.18, dist / 180));
          this.eyes.targetX = Math.cos(angle) * 13 * distFactor;
          this.eyes.targetY = Math.sin(angle) * 10 * distFactor;

          // 3D head tilt towards cursor
          this.body.tiltX = Math.max(-15, Math.min(15, -curY * 0.09));
          this.body.tiltY = Math.max(-17, Math.min(17, curX * 0.09));
        } else {
          this.root.setAttribute("data-mood", "idle");
          this.body.tiltX *= 0.90;
          this.body.tiltY *= 0.90;
        }

        // Drag physics when holding pointer
        if (this.isMouseDown) {
          this.body.x = curX * 0.22;
          this.body.y = curY * 0.22;
          this.body.scaleX = 1 + (curX * 0.0008);
          this.body.scaleY = 1 - (curY * 0.0008);
        }
      };

      this.onPointerDown = (e) => {
        this.isMouseDown = true;
        // Squishy spring bounce jiggle!
        this.body.vScaleX += 0.32;
        this.body.vScaleY -= 0.32;
        this.body.vRot += (Math.random() - 0.5) * 10;

        // Big joyful eye blink / squish
        this.eyes.scaleY = 1.35;

        // Brush fluff outward from click point
        const rect = this.bodyWrap.getBoundingClientRect();
        const curX = e.clientX - (rect.left + rect.width * 0.5);
        const curY = e.clientY - (rect.top + rect.height * 0.5);
        this.brushFur(curX, curY, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 95);
      };

      this.onPointerUp = () => {
        this.isMouseDown = false;
        // Snap-back elastic spring release
        this.body.vScaleX -= 0.38;
        this.body.vScaleY += 0.38;
        this.eyes.scaleY = 1.0;
      };

      this.onResize = () => {
        this.updateCanvasSize();
        this.initFurStrands();
      };

      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerup", this.onPointerUp, { passive: true });
      window.addEventListener("resize", this.onResize);
      this.bodyWrap.addEventListener("pointerdown", this.onPointerDown);
    }

    brushFur(mx, my, vx, vy, customRadius = 65) {
      const brushRadius = customRadius;
      const forceMag = Math.min(22, Math.hypot(vx, vy) * 0.65);

      for (let i = 0; i < this.strands.length; i++) {
        const s = this.strands[i];
        const tipGlobalX = s.baseX + s.tipX;
        const tipGlobalY = s.baseY + s.tipY;

        const dx = tipGlobalX - mx;
        const dy = tipGlobalY - my;
        const dist = Math.hypot(dx, dy);

        if (dist < brushRadius) {
          const proximity = 1.0 - (dist / brushRadius);
          // Hair deflection in the stroke direction
          s.vx += vx * proximity * 0.55;
          s.vy += vy * proximity * 0.55;
          // Outward puff from pressure point
          const pushAngle = Math.atan2(dy, dx);
          s.vx += Math.cos(pushAngle) * forceMag * proximity * 0.3;
          s.vy += Math.sin(pushAngle) * forceMag * proximity * 0.3;
        }
      }
    }

    updatePhysics(dt, time) {
      // 1. Body Spring-Mass Damper
      const k = 0.16;   // Spring stiffness
      const d = 0.82;   // Damping

      // Scale spring (recovers to 1, 1)
      const axScaleX = -k * (this.body.scaleX - 1) - d * this.body.vScaleX;
      const axScaleY = -k * (this.body.scaleY - 1) - d * this.body.vScaleY;
      this.body.vScaleX += axScaleX;
      this.body.vScaleY += axScaleY;
      this.body.scaleX += this.body.vScaleX * 0.6;
      this.body.scaleY += this.body.vScaleY * 0.6;

      // Position spring (recovers to 0, 0)
      if (!this.isMouseDown) {
        const axPos = -k * this.body.x - d * this.body.vx;
        const ayPos = -k * this.body.y - d * this.body.vy;
        this.body.vx += axPos;
        this.body.vy += ayPos;
        this.body.x += this.body.vx * 0.6;
        this.body.y += this.body.vy * 0.6;
      }

      // Rotation spring (recovers to 0)
      const aRot = -k * this.body.rot - d * this.body.vRot;
      this.body.vRot += aRot;
      this.body.rot += this.body.vRot * 0.5;

      // 2. Eyes Animation & Autonomous Look
      const now = performance.now();

      if (!this.isHovered) {
        // Autonomous look around: Center, Left, Right, Up, Down, Diagonals
        if (now > this.eyes.nextGlanceTime) {
          const targets = [
            { x: 0, y: 0 },         // center straight
            { x: -9, y: 0 },        // look left
            { x: 9, y: 0 },         // look right
            { x: 0, y: -7 },        // look up
            { x: 0, y: 7 },         // look down
            { x: -7, y: -5 },       // top-left
            { x: 7, y: -5 },        // top-right
            { x: -6, y: 5 },        // bottom-left
            { x: 6, y: 5 },         // bottom-right
          ];
          const choice = targets[Math.floor(Math.random() * targets.length)];
          this.eyes.targetX = choice.x;
          this.eyes.targetY = choice.y;
          this.eyes.nextGlanceTime = now + 1700 + Math.random() * 2400;
        }
      }

      // Smooth eyes position lerp
      this.eyes.x += (this.eyes.targetX - this.eyes.x) * 0.15;
      this.eyes.y += (this.eyes.targetY - this.eyes.y) * 0.15;

      // Natural Autonomous Blinking
      if (now > this.eyes.nextBlinkTime && !this.eyes.isBlinking) {
        this.eyes.isBlinking = true;
        this.eyes.scaleY = 0.05;
        setTimeout(() => {
          this.eyes.scaleY = 1.0;
          // 32% chance of an affectionate double-blink!
          if (Math.random() < 0.32) {
            setTimeout(() => {
              this.eyes.scaleY = 0.05;
              setTimeout(() => { this.eyes.scaleY = 1.0; this.eyes.isBlinking = false; }, 90);
            }, 130);
          } else {
            this.eyes.isBlinking = false;
          }
        }, 95);
        this.eyes.nextBlinkTime = now + 3400 + Math.random() * 3200;
      }

      // Apply transform to DOM elements
      const floatY = Math.sin(time * 2.2) * 4.5;
      this.bodyWrap.style.transform = `
        translate3d(${this.body.x.toFixed(1)}px, ${(this.body.y + floatY).toFixed(1)}px, 0)
        rotateZ(${this.body.rot.toFixed(1)}deg)
        rotateX(${this.body.tiltX.toFixed(1)}deg)
        rotateY(${this.body.tiltY.toFixed(1)}deg)
        scale(${this.body.scaleX.toFixed(3)}, ${this.body.scaleY.toFixed(3)})
      `;

      this.eyesWrap.style.transform = `
        translate(${this.eyes.x.toFixed(1)}px, ${this.eyes.y.toFixed(1)}px)
        scaleY(${this.eyes.scaleY.toFixed(2)})
      `;

      // 3. Fur Strands Simulation & Render
      this.renderFur(time);
    }

    renderFur(time) {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this.canvasW, this.canvasH);

      const cx = this.canvasW * 0.5;
      const cy = this.canvasH * 0.5;
      const windX = Math.sin(time * 2.6) * 0.6;
      const windY = Math.cos(time * 2.1) * 0.4;

      this.ctx.lineCap = "round";

      for (let i = 0; i < this.strands.length; i++) {
        const s = this.strands[i];

        // Soft ambient breeze oscillation
        const ambient = Math.sin(time * s.freq + s.phase) * 1.8;
        const targetTipX = s.dx + windX + ambient;
        const targetTipY = s.dy + windY + ambient;

        // Spring acceleration
        const ax = -s.stiffness * (s.tipX - targetTipX) - s.damping * s.vx;
        const ay = -s.stiffness * (s.tipY - targetTipY) - s.damping * s.vy;
        s.vx += ax;
        s.vy += ay;
        s.tipX += s.vx * 0.65;
        s.tipY += s.vy * 0.65;

        // Draw curved silky hair fiber
        const startX = cx + s.baseX;
        const startY = cy + s.baseY;
        const endX = startX + s.tipX;
        const endY = startY + s.tipY;
        const ctrlX = startX + s.tipX * 0.52 - s.tipY * 0.22;
        const ctrlY = startY + s.tipY * 0.52 + s.tipX * 0.22;

        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
        this.ctx.strokeStyle = s.color;
        this.ctx.lineWidth = s.width;
        this.ctx.globalAlpha = s.alpha;
        this.ctx.stroke();
      }
    }

    loop() {
      if (this.destroyed) return;
      const time = performance.now() * 0.001;
      this.updatePhysics(0.016, time);
      this.rafId = requestAnimationFrame(this.loop);
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      cancelAnimationFrame(this.rafId);
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
      window.removeEventListener("resize", this.onResize);
    }
  }

  window.FluffyBot = {
    mount(container) {
      if (activeInstance) activeInstance.destroy();
      activeInstance = new FluffyBot(container);
      return activeInstance;
    },
    getInstance() {
      return activeInstance;
    },
  };
})();
