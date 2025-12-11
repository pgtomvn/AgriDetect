// src/templates/aurora.js
(function () {
  const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ), 
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \
  int index = 0;                                            \
  for (int i = 0; i < 2; i++) {                               \
     ColorStop currentColor = colors[i];                    \
     bool isInBetween = currentColor.position <= factor;    \
     index = int(mix(float(index), float(i), float(isInBetween))); \
  }                                                         \
  ColorStop currentColor = colors[index];                   \
  ColorStop nextColor = colors[index + 1];                  \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  
  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);
  
  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);
  
  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  // Dải sáng chính
  float midPoint = 0.18;
  float auroraMask = smoothstep(
    midPoint - uBlend * 0.5,
    midPoint + uBlend * 0.5,
    intensity
  );

  // Đảm bảo aurora không bị quá tối
  float light = 0.45 + 0.55 * clamp(intensity, 0.0, 1.0);
  vec3 auroraColor = rampColor * light;

  // Màu nền mint #c3f0c3
  vec3 baseColor = vec3(195.0/255.0, 240.0/255.0, 195.0/255.0);

  // Trộn aurora với nền, ngoài rìa chỉ hơi đổi màu
  float mixAmount = auroraMask * 0.85;
  vec3 finalColor = mix(baseColor, auroraColor, mixAmount);

  fragColor = vec4(finalColor, 1.0);
}
`;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Aurora shader error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vertSrc, fragSrc) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Aurora program error:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  function hexToRgbNorm(hex) {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r / 255, g / 255, b / 255];
  }

  function initAurora() {
    const container = document.getElementById("aurora-bg");
    if (!container) {
      console.warn("Aurora: không tìm thấy #aurora-bg");
      return;
    }

    const canvas = document.createElement("canvas");
    container.appendChild(canvas);

    const gl = canvas.getContext("webgl2", { alpha: true });
    if (!gl) {
      console.warn("Aurora: Trình duyệt không hỗ trợ WebGL2");
      return;
    }

    const program = createProgram(gl, VERT, FRAG);
    if (!program) return;
    gl.useProgram(program);

    const positionLoc = gl.getAttribLocation(program, "position");
    const uTimeLoc = gl.getUniformLocation(program, "uTime");
    const uAmpLoc = gl.getUniformLocation(program, "uAmplitude");
    const uResLoc = gl.getUniformLocation(program, "uResolution");
    const uBlendLoc = gl.getUniformLocation(program, "uBlend");
    const uColorLoc = gl.getUniformLocation(program, "uColorStops[0]");

    // Fullscreen triangle
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([
      -1, -1,
      3, -1,
      -1, 3,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    // Tham số Aurora
    const amplitude = 1.1;
    const blend = 0.5;
    const speed = 1;
    const colorStops = ["#55D883", "#66C772", "#81DF93"];

    const colorArray = new Float32Array(9);
    colorStops.map(hexToRgbNorm).forEach((c, i) => {
      colorArray[i * 3 + 0] = c[0];
      colorArray[i * 3 + 1] = c[1];
      colorArray[i * 3 + 2] = c[2];
    });

    gl.uniform1f(uAmpLoc, amplitude);
    gl.uniform1f(uBlendLoc, blend);
    gl.uniform3fv(uColorLoc, colorArray);

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uResLoc, canvas.width, canvas.height);
    }

    window.addEventListener("resize", resize);
    resize();

    const start = performance.now();
    function render(now) {
      const t = (now - start) / 1000;
      gl.uniform1f(uTimeLoc, t * speed);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAurora);
  } else {
    initAurora();
  }
})();
