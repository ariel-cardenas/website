/**
 * Dependency-free WebGL renderer for the mountain scene.
 *
 * It draws the current and incoming weather textures on one full-screen quad.
 * When a hotspot is hovered, a fragment shader creates an organic displacement
 * bounded by that landmark's rectangle. The DOM images remain as a fallback.
 */
(function exposeMountainRenderer() {
  "use strict";

  const VERTEX_SHADER = `
    attribute vec2 aPosition;
    varying vec2 vUv;

    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uTextureA;
    uniform sampler2D uTextureB;
    uniform float uTextureMix;
    uniform float uTime;
    uniform float uAspect;
    uniform float uHoverAmount;
    uniform vec2 uHoverPosition;
    uniform vec4 uHoverRect;

    float random(vec2 point) {
      return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float valueNoise(vec2 point) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      local = local * local * (3.0 - 2.0 * local);

      float a = random(cell);
      float b = random(cell + vec2(1.0, 0.0));
      float c = random(cell + vec2(0.0, 1.0));
      float d = random(cell + vec2(1.0, 1.0));

      return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
    }

    float rectangleMask(vec2 uv, vec4 rect) {
      vec2 feather = vec2(0.018);
      float leftEdge = smoothstep(rect.x, rect.x + feather.x, uv.x);
      float bottomEdge = smoothstep(rect.y, rect.y + feather.y, uv.y);
      float rightEdge = 1.0 - smoothstep(rect.z - feather.x, rect.z, uv.x);
      float topEdge = 1.0 - smoothstep(rect.w - feather.y, rect.w, uv.y);
      return leftEdge * bottomEdge * rightEdge * topEdge;
    }

    void main() {
      vec2 uv = vUv;

      // Work in aspect-corrected space so the ripple stays circular on screen.
      vec2 delta = (uv - uHoverPosition) * vec2(uAspect, 1.0);
      float distanceFromPointer = length(delta);
      vec2 rectSize = vec2(
        (uHoverRect.z - uHoverRect.x) * uAspect,
        uHoverRect.w - uHoverRect.y
      );
      float radius = max(0.055, length(rectSize) * 0.58);
      float falloff = 1.0 - smoothstep(radius * 0.08, radius, distanceFromPointer);
      float bounded = rectangleMask(uv, uHoverRect);

      // Two slow noise fields keep the wave from looking like a perfect ring.
      float noiseA = valueNoise(uv * vec2(11.0 * uAspect, 11.0) + uTime * 0.38);
      float noiseB = valueNoise(uv * vec2(18.0 * uAspect, 18.0) - uTime * 0.21);
      float wave = sin(distanceFromPointer * 72.0 - uTime * 3.0 + noiseA * 5.0);
      float amount = uHoverAmount * bounded * falloff;

      vec2 direction = delta / max(distanceFromPointer, 0.001);
      vec2 radial = vec2(direction.x / uAspect, direction.y);
      vec2 tangent = vec2(-direction.y / uAspect, direction.x);

      // Radial wobble, faint swirl, and a small lens-like pull toward the cursor.
      uv += radial * wave * 0.0045 * amount;
      uv += tangent * (noiseB - 0.5) * 0.004 * amount;
      uv += (uHoverPosition - uv) * 0.007 * amount;
      uv = clamp(uv, 0.001, 0.999);

      vec4 colorA = texture2D(uTextureA, uv);
      vec4 colorB = texture2D(uTextureB, uv);
      gl_FragColor = mix(colorA, colorB, uTextureMix);
    }
  `;

  class MountainRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = null;
      this.program = null;
      this.ready = false;
      this.currentTexture = null;
      this.nextTexture = null;
      this.currentSource = "";
      this.nextSource = "";
      this.textureCache = new Map();
      this.textureLoads = new Map();
      this.destroyed = false;
      this.textureMix = 0;
      this.transitionStartedAt = 0;
      this.transitionDuration = 1100;
      this.loadToken = 0;
      this.hoverAmount = 0;
      this.hoverTarget = 0;
      this.hoverPosition = [0.5, 0.5];
      this.hoverPositionTarget = [0.5, 0.5];
      this.hoverRect = [0.45, 0.45, 0.55, 0.55];
      this.frameRequest = 0;
      this.startedAt = performance.now();
      this.resizeObserver = null;

      this.drawFrame = this.drawFrame.bind(this);
      this.resize = this.resize.bind(this);
    }

    async initialize(source) {
      try {
        this.gl = this.canvas.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
        });

        if (!this.gl) return false;

        this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
        this.cacheLocations();
        this.createGeometry();
        this.currentTexture = await this.loadTexture(source);
        this.currentSource = source;
        this.ready = true;

        if ("ResizeObserver" in window) {
          this.resizeObserver = new ResizeObserver(this.resize);
          this.resizeObserver.observe(this.canvas);
        } else {
          window.addEventListener("resize", this.resize);
        }
        this.resize();
        this.render(performance.now());

        this.canvas.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          this.ready = false;
          this.stop();
          this.canvas.dispatchEvent(new CustomEvent("mountaincontextlost"));
        });

        return true;
      } catch (error) {
        console.warn("WebGL mountain effect unavailable; using image fallback.", error);
        this.destroy();
        return false;
      }
    }

    createShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation failed: ${message}`);
      }

      return shader;
    }

    createProgram(vertexSource, fragmentSource) {
      const gl = this.gl;
      const vertex = this.createShader(gl.VERTEX_SHADER, vertexSource);
      const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram();

      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Shader link failed: ${message}`);
      }

      return program;
    }

    cacheLocations() {
      const gl = this.gl;
      const names = [
        "uTextureA",
        "uTextureB",
        "uTextureMix",
        "uTime",
        "uAspect",
        "uHoverAmount",
        "uHoverPosition",
        "uHoverRect",
      ];

      this.uniforms = Object.fromEntries(
        names.map((name) => [name, gl.getUniformLocation(this.program, name)]),
      );
      this.positionLocation = gl.getAttribLocation(this.program, "aPosition");
    }

    createGeometry() {
      const gl = this.gl;
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.useProgram(this.program);
      gl.enableVertexAttribArray(this.positionLocation);
      gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
      this.geometryBuffer = buffer;
    }

    loadImage(source) {
      if (window.MountainSceneCache) return window.MountainSceneCache.get(source);
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Unable to load texture: ${source}`));
        image.src = source;
      });
    }

    async loadTexture(source) {
      if (this.textureCache.has(source)) return this.textureCache.get(source);
      if (this.textureLoads.has(source)) return this.textureLoads.get(source);
      const loading = this.uploadTexture(source).finally(() => this.textureLoads.delete(source));
      this.textureLoads.set(source, loading);
      return loading;
    }

    async preload(source) {
      if (this.ready) await this.loadTexture(source);
    }

    emitSceneReady() {
      this.canvas.dispatchEvent(new CustomEvent("mountainsceneready", { detail: { source: this.currentSource } }));
    }

    // A breakpoint is a different composition, not a weather crossfade. Keep
    // the matching preview visible until the corresponding texture is ready.
    async setSource(source) {
      if (!this.ready) return false;
      const token = ++this.loadToken;
      try {
        const texture = await this.loadTexture(source);
        if (!this.ready || token !== this.loadToken) return false;
        this.currentTexture = texture;
        this.currentSource = source;
        this.nextTexture = null;
        this.nextSource = "";
        this.textureMix = 0;
        this.render(performance.now());
        this.emitSceneReady();
        return true;
      } catch (_) {
        return false;
      }
    }

    async uploadTexture(source) {
      const surface = await this.loadImage(source);
      const image = surface.image ?? surface;
      const gl = this.gl;
      if (this.destroyed || !gl || gl.isContextLost()) throw new Error("Scene context unavailable");
      const texture = gl.createTexture();

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.textureCache.set(source, texture);
      return texture;
    }

    async transitionTo(source, duration = 1100) {
      if (!this.ready) return;
      // Rapidly switching back must cancel the incoming weather, not keep
      // fading toward it while the DOM has already returned to the old state.
      if (source === this.currentSource) {
        ++this.loadToken;
        this.nextTexture = null;
        this.nextSource = "";
        this.textureMix = 0;
        this.render(performance.now());
        this.emitSceneReady();
        return;
      }
      if (source === this.nextSource) return;

      const token = ++this.loadToken;

      try {
        const texture = await this.loadTexture(source);
        if (token !== this.loadToken || !this.ready) {
          return;
        }

        this.nextTexture = texture;
        this.nextSource = source;
        this.textureMix = 0;
        this.transitionDuration = duration;
        this.transitionStartedAt = performance.now();
        this.start();
      } catch (error) {
        console.warn("Could not transition WebGL weather texture.", error);
      }
    }

    setHoverFromElement(event, element, region) {
      if (!this.ready) return;

      const worldRect = this.canvas.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const pointerX = event?.clientX ?? elementRect.left + elementRect.width / 2;
      const pointerY = event?.clientY ?? elementRect.top + elementRect.height / 2;
      const centerX = elementRect.left + elementRect.width / 2;
      const centerY = elementRect.top + elementRect.height / 2;

      const pointerU = this.clamp((pointerX - worldRect.left) / worldRect.width, 0, 1);
      const pointerV = this.clamp(1 - (pointerY - worldRect.top) / worldRect.height, 0, 1);
      const centerU = this.clamp((centerX - worldRect.left) / worldRect.width, 0, 1);
      const centerV = this.clamp(1 - (centerY - worldRect.top) / worldRect.height, 0, 1);
      // By default, the shader boundary is the exact responsive CSS hit region.
      const regionWidth = region?.[0] ?? elementRect.width / worldRect.width;
      const regionHeight = region?.[1] ?? elementRect.height / worldRect.height;
      const halfWidth = regionWidth / 2;
      const halfHeight = regionHeight / 2;

      this.hoverPositionTarget[0] = pointerU;
      this.hoverPositionTarget[1] = pointerV;
      this.hoverRect = [
        this.clamp(centerU - halfWidth, 0, 1),
        this.clamp(centerV - halfHeight, 0, 1),
        this.clamp(centerU + halfWidth, 0, 1),
        this.clamp(centerV + halfHeight, 0, 1),
      ];

      if (this.hoverAmount < 0.015) {
        this.hoverPosition[0] = pointerU;
        this.hoverPosition[1] = pointerV;
      }

      this.hoverTarget = 1;
      this.start();
    }

    clearHover() {
      this.hoverTarget = 0;
      this.start();
    }

    clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }

    resize() {
      if (!this.gl) return;
      // The source artwork is ~1.7k wide, so an enormous 4K/Retina buffer would
      // spend GPU memory without adding useful detail. Cap both DPR and size.
      const maximumDimension = 2400;
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        1.5,
        maximumDimension / Math.max(this.canvas.clientWidth, this.canvas.clientHeight),
      );
      const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));

      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
      }

      if (this.ready) this.render(performance.now());
    }

    start() {
      if (!this.ready || this.frameRequest) return;
      this.frameRequest = window.requestAnimationFrame(this.drawFrame);
    }

    stop() {
      window.cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
    }

    drawFrame(now) {
      this.frameRequest = 0;
      this.hoverAmount += (this.hoverTarget - this.hoverAmount) * 0.12;
      this.hoverPosition[0] += (this.hoverPositionTarget[0] - this.hoverPosition[0]) * 0.18;
      this.hoverPosition[1] += (this.hoverPositionTarget[1] - this.hoverPosition[1]) * 0.18;

      if (this.nextTexture) {
        const progress = this.clamp(
          (now - this.transitionStartedAt) / this.transitionDuration,
          0,
          1,
        );
        this.textureMix = progress * progress * (3 - 2 * progress);

        if (progress >= 1) {
          this.currentTexture = this.nextTexture;
          this.currentSource = this.nextSource;
          this.nextTexture = null;
          this.nextSource = "";
          this.textureMix = 0;
          this.emitSceneReady();
        }
      }

      this.render(now);

      const hoverIsMoving = Math.abs(this.hoverTarget - this.hoverAmount) > 0.002;
      if (this.nextTexture || this.hoverTarget > 0 || hoverIsMoving) this.start();
    }

    render(now) {
      if (!this.ready || !this.currentTexture) return;
      const gl = this.gl;
      const secondTexture = this.nextTexture || this.currentTexture;

      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);
      gl.enableVertexAttribArray(this.positionLocation);
      gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
      gl.uniform1i(this.uniforms.uTextureA, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, secondTexture);
      gl.uniform1i(this.uniforms.uTextureB, 1);

      gl.uniform1f(this.uniforms.uTextureMix, this.textureMix);
      gl.uniform1f(this.uniforms.uTime, (now - this.startedAt) / 1000);
      gl.uniform1f(this.uniforms.uAspect, this.canvas.clientWidth / this.canvas.clientHeight);
      gl.uniform1f(this.uniforms.uHoverAmount, this.hoverAmount);
      gl.uniform2fv(this.uniforms.uHoverPosition, this.hoverPosition);
      gl.uniform4fv(this.uniforms.uHoverRect, this.hoverRect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    destroy() {
      this.destroyed = true;
      this.loadToken++;
      this.stop();
      this.resizeObserver?.disconnect();
      window.removeEventListener("resize", this.resize);
      this.ready = false;
      if (!this.gl) return;
      for (const texture of this.textureCache.values()) this.gl.deleteTexture(texture);
      this.textureCache.clear();
      if (this.geometryBuffer) this.gl.deleteBuffer(this.geometryBuffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
  }

  window.MountainRenderer = MountainRenderer;
})();
