// Draws the bendable puppet with WebGL (fast on phones). The result is copied onto the 2D
// stage canvas each frame, between the background and the camera inset.

const VS = `
attribute vec2 aPos; attribute vec2 aUV;
uniform vec2 uRes; uniform vec2 uOff; uniform float uScale;
varying vec2 vUV;
void main() {
  vec2 p = aPos * uScale + uOff;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  vUV = aUV;
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex; varying vec2 vUV;
void main() { gl_FragColor = texture2D(uTex, vUV); }`;

export class PuppetRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: true });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.uint32 = !!gl.getExtension('OES_element_index_uint');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {
      aPos: gl.getAttribLocation(p, 'aPos'), aUV: gl.getAttribLocation(p, 'aUV'),
      uRes: gl.getUniformLocation(p, 'uRes'), uOff: gl.getUniformLocation(p, 'uOff'), uScale: gl.getUniformLocation(p, 'uScale'),
    };
    this.posBuf = gl.createBuffer();
    this.uvBuf = gl.createBuffer();
    this.idxBuf = gl.createBuffer();
    this.tex = gl.createTexture();
  }

  /** @param image canvas/image of the cut-out character; rig from buildRig */
  setCharacter(image, rig) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rig.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rig.rest.byteLength, gl.DYNAMIC_DRAW);
    const big = rig.rest.length / 2 > 65535;
    this.idxType = big && this.uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const idx = this.idxType === gl.UNSIGNED_INT ? rig.indices : Uint16Array.from(rig.indices);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = rig.indices.length;
  }

  /** Draws the posed mesh. positions are drawing pixels; scale/offset place it on the stage. */
  draw(positions, scale, offX, offY) {
    const gl = this.gl, c = this.canvas, L = this.loc;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;
    gl.useProgram(this.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.enableVertexAttribArray(L.aPos);
    gl.vertexAttribPointer(L.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.enableVertexAttribArray(L.aUV);
    gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform2f(L.uRes, c.width, c.height);
    gl.uniform2f(L.uOff, offX, offY);
    gl.uniform1f(L.uScale, scale);
    gl.drawElements(gl.TRIANGLES, this.count, this.idxType, 0);
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
}
