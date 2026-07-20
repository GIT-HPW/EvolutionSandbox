// SPDX-License-Identifier: GPL-3.0-or-later

const VERTEX_SOURCE = [
  "attribute vec2 a_position;",
  "void main() {",
  "  gl_Position = vec4(a_position, 0.0, 1.0);",
  "}",
].join("\n")

const FRAGMENT_SOURCE = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "",
  "uniform vec2 u_resolution;",
  "uniform vec2 u_pointer;",
  "uniform float u_time;",
  "uniform float u_phase;",
  "uniform float u_energy;",
  "uniform float u_information;",
  "uniform float u_entropy;",
  "uniform float u_stability;",
  "uniform float u_fragments;",
  "uniform float u_burst;",
  "uniform float u_impact;",
  "",
  "float hash21(vec2 p) {",
  "  p = fract(p * vec2(123.34, 456.21));",
  "  p += dot(p, p + 45.32);",
  "  return fract(p.x * p.y);",
  "}",
  "",
  "mat2 rotate2d(float angle) {",
  "  float c = cos(angle);",
  "  float s = sin(angle);",
  "  return mat2(c, -s, s, c);",
  "}",
  "",
  "float sdTorus(vec3 p, vec2 radius) {",
  "  vec2 q = vec2(length(p.xz) - radius.x, p.y);",
  "  return length(q) - radius.y;",
  "}",
  "",
  "float sdCrystal(vec3 p, float size) {",
  "  p = abs(p);",
  "  return (p.x + p.y + p.z - size) * 0.57735027;",
  "}",
  "",
  "vec2 mapScene(vec3 p) {",
  "  float spin = u_time * (0.14 + u_entropy * 0.08);",
  "  p.xz *= rotate2d(spin + u_pointer.x * 0.25);",
  "  p.yz *= rotate2d(-spin * 0.55 + u_pointer.y * 0.18);",
  "",
  "  float pulse = sin(p.x * 5.0 + u_time * 2.1) * sin(p.y * 4.0 - u_time * 1.7) * sin(p.z * 6.0);",
  "  float core = length(p) - (0.72 + pulse * (0.018 + u_entropy * 0.026));",
  "  vec2 result = vec2(core, 1.0);",
  "",
  "  vec3 ringA = p;",
  "  ringA.yz *= rotate2d(0.88);",
  "  float ringWidth = 0.024 + u_information * 0.018;",
  "  float ring = sdTorus(ringA, vec2(1.08 + u_phase * 0.18, ringWidth));",
  "  if (ring < result.x) result = vec2(ring, 2.0);",
  "",
  "  vec3 ringB = p;",
  "  ringB.xy *= rotate2d(-0.72);",
  "  ringB.xz *= rotate2d(u_time * 0.12);",
  "  ring = sdTorus(ringB, vec2(1.31 + u_energy * 0.08, 0.018 + u_phase * 0.012));",
  "  if (ring < result.x) result = vec2(ring, 3.0);",
  "",
  "  if (u_fragments > 0.02) {",
  "    for (int i = 0; i < 3; i++) {",
  "      float index = float(i);",
  "      float angle = index * 1.2566 + u_time * (0.22 + index * 0.015);",
  "      float orbit = 1.48 + 0.14 * sin(index * 3.1 + u_time);",
  "      vec3 shardPosition = vec3(cos(angle) * orbit, sin(angle * 1.7) * 0.62, sin(angle) * orbit);",
  "      vec3 shard = p - shardPosition;",
  "      shard.xy *= rotate2d(angle + u_time);",
  "      float crystal = sdCrystal(shard, 0.11 + u_fragments * 0.075);",
  "      if (crystal < result.x) result = vec2(crystal, 4.0);",
  "    }",
  "  }",
  "",
  "  if (u_phase > 0.5) {",
  "    float plane = p.y + 1.45;",
  "    if (plane < result.x) result = vec2(plane, 5.0);",
  "  }",
  "  return result;",
  "}",
  "",
  "vec3 sceneNormal(vec3 p) {",
  "  vec2 e = vec2(0.0012, 0.0);",
  "  return normalize(vec3(",
  "    mapScene(p + e.xyy).x - mapScene(p - e.xyy).x,",
  "    mapScene(p + e.yxy).x - mapScene(p - e.yxy).x,",
  "    mapScene(p + e.yyx).x - mapScene(p - e.yyx).x",
  "  ));",
  "}",
  "",
  "vec3 palette(float material) {",
  "  vec3 violet = vec3(0.43, 0.18, 1.0);",
  "  vec3 cyan = vec3(0.08, 0.82, 1.0);",
  "  vec3 rose = vec3(1.0, 0.18, 0.62);",
  "  if (material < 1.5) return mix(violet, cyan, u_information * 0.62 + u_phase * 0.28);",
  "  if (material < 2.5) return mix(cyan, vec3(0.84, 0.95, 1.0), u_stability);",
  "  if (material < 3.5) return mix(rose, violet, u_energy);",
  "  return mix(rose, cyan, u_phase);",
  "}",
  "",
  "void main() {",
  "  vec2 centered = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);",
  "  vec2 starCell = floor(gl_FragCoord.xy * 0.46);",
  "  float starSeed = hash21(starCell);",
  "  float star = step(0.988 - u_information * 0.004, starSeed) * pow(starSeed, 18.0);",
  "  float nebula = 0.5 + 0.5 * sin(centered.x * 2.4 - centered.y * 1.7 + u_time * 0.08);",
  "  vec3 background = mix(vec3(0.008, 0.012, 0.045), vec3(0.035, 0.018, 0.10), nebula * 0.55);",
  "  background += star * mix(vec3(0.42, 0.62, 1.0), vec3(1.0, 0.46, 0.82), starSeed) * 0.9;",
  "",
  "  vec3 rayOrigin = vec3(0.0, 0.12 + u_pointer.y * 0.12, 4.35 - u_phase * 0.38);",
  "  vec3 target = vec3(u_pointer.x * 0.22, u_pointer.y * 0.13, 0.0);",
  "  vec3 forward = normalize(target - rayOrigin);",
  "  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));",
  "  vec3 up = cross(forward, right);",
  "  vec3 rayDirection = normalize(forward + centered.x * right + centered.y * up);",
  "",
  "  float distanceTravelled = 0.0;",
  "  float material = 0.0;",
  "  float glow = 0.0;",
  "  bool hit = false;",
  "  for (int stepIndex = 0; stepIndex < 52; stepIndex++) {",
  "    vec3 samplePoint = rayOrigin + rayDirection * distanceTravelled;",
  "    vec2 sampleResult = mapScene(samplePoint);",
  "    float distanceToScene = sampleResult.x;",
  "    glow += 0.0018 / (0.018 + abs(distanceToScene));",
  "    if (distanceToScene < 0.0015) {",
  "      hit = true;",
  "      material = sampleResult.y;",
  "      break;",
  "    }",
  "    distanceTravelled += max(distanceToScene * 0.72, 0.008);",
  "    if (distanceTravelled > 10.0) break;",
  "  }",
  "",
  "  vec3 color = background;",
  "  vec3 accent = mix(vec3(0.48, 0.25, 1.0), vec3(0.04, 0.88, 1.0), u_phase);",
  "  color += accent * min(glow, 1.35) * (0.075 + u_energy * 0.045);",
  "",
  "  if (hit) {",
  "    vec3 hitPoint = rayOrigin + rayDirection * distanceTravelled;",
  "    vec3 normal = sceneNormal(hitPoint);",
  "    vec3 lightDirection = normalize(vec3(-0.45, 0.75, 0.55));",
  "    float diffuse = max(dot(normal, lightDirection), 0.0);",
  "    float toon = floor(diffuse * 4.0) / 3.0;",
  "    float rim = pow(1.0 - max(dot(normal, -rayDirection), 0.0), 2.4);",
  "    float facing = abs(dot(normal, -rayDirection));",
  "    vec3 base = palette(material);",
  "    color = base * (0.16 + toon * 0.82);",
  "    color += rim * mix(vec3(0.40, 0.72, 1.0), vec3(1.0, 0.38, 0.78), u_entropy) * 1.25;",
  "    color *= smoothstep(0.035, 0.16, facing);",
  "    if (material > 4.5) {",
  "      vec2 gridPoint = hitPoint.xz * (1.1 + u_information * 0.7);",
  "      vec2 gridDistance = abs(fract(gridPoint) - 0.5);",
  "      float grid = smoothstep(0.46, 0.5, max(gridDistance.x, gridDistance.y));",
  "      float horizon = exp(-abs(hitPoint.z) * 0.10);",
  "      color = mix(vec3(0.008, 0.025, 0.07), accent * (0.55 + horizon), grid);",
  "    }",
  "  }",
  "",
  "  if (u_burst >= 0.0) {",
  "    float ringRadius = u_burst * 1.38;",
  "    float shockwave = exp(-abs(length(centered) - ringRadius) * 54.0) * (1.0 - smoothstep(0.0, 1.45, u_burst));",
  "    color += shockwave * mix(vec3(0.45, 0.78, 1.0), vec3(1.0, 0.42, 0.78), u_entropy) * u_impact;",
  "  }",
  "",
  "  float vignette = 1.0 - smoothstep(0.55, 1.55, length(centered));",
  "  color *= 0.64 + vignette * 0.45;",
  "  color = pow(max(color, vec3(0.0)), vec3(0.82));",
  "  gl_FragColor = vec4(color, 1.0);",
  "}",
].join("\n")

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "unknown shader compilation error"
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(gl) {
  const program = gl.createProgram()
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "unknown shader link error"
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function normalizedState(state) {
  return {
    phase: state?.phase === "first_3d" ? 1 : 0,
    energy: clamp01((state?.energy ?? 24) / 36),
    information: clamp01((state?.information ?? 0) / 18),
    entropy: clamp01((state?.entropy ?? 0) / 20),
    stability: clamp01((state?.stability ?? 12) / 24),
    fragments: clamp01((state?.fragments ?? 0) / 8),
  }
}

function setFallback(shell, statusElement, captionElement, message) {
  shell?.classList.add("scene-fallback")
  if (statusElement) statusElement.textContent = "STATIC / SAFE MODE"
  if (captionElement) captionElement.textContent = message
}

export function createEvolutionScene(canvas, { statusElement, captionElement } = {}) {
  const shell = canvas?.closest(".scene-shell")
  if (!canvas) return { supported: false, setState() {}, pulse() {}, destroy() {} }

  const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  })

  if (!gl) {
    setFallback(shell, statusElement, captionElement, "当前浏览器未启用 WebGL，已显示静态宇宙景观。")
    return { supported: false, setState() {}, pulse() {}, destroy() {} }
  }

  let program
  try {
    program = createProgram(gl)
  } catch (error) {
    console.warn("Evolution scene unavailable:", error.message)
    setFallback(shell, statusElement, captionElement, "3D shader 初始化失败，已切换静态宇宙景观。")
    return { supported: false, setState() {}, pulse() {}, destroy() {} }
  }

  const position = gl.getAttribLocation(program, "a_position")
  const uniforms = Object.fromEntries([
    "u_resolution", "u_pointer", "u_time", "u_phase", "u_energy", "u_information",
    "u_entropy", "u_stability", "u_fragments", "u_burst", "u_impact",
  ].map((name) => [name, gl.getUniformLocation(program, name)]))
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.useProgram(program)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  let current = normalizedState()
  let target = { ...current }
  let pointer = { x: 0, y: 0 }
  let pointerTarget = { x: 0, y: 0 }
  let burst = -1
  let impact = 0
  let frame
  let previousTime = performance.now()
  let lastRenderedTime = 0
  let disposed = false

  if (statusElement) statusElement.textContent = reducedMotion ? "WEBGL / STILL" : "WEBGL / LIVE"

  function resize() {
    const bounds = canvas.getBoundingClientRect()
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, bounds.width < 560 ? 1 : 1.35)
    const width = Math.max(1, Math.round(bounds.width * pixelRatio))
    const height = Math.max(1, Math.round(bounds.height * pixelRatio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
  }

  function draw(now = performance.now()) {
    if (disposed) return
    resize()
    const delta = Math.min(0.05, Math.max(0, (now - previousTime) / 1000))
    previousTime = now
    const ease = reducedMotion ? 1 : 1 - Math.pow(0.001, delta)
    for (const key of Object.keys(current)) current[key] += (target[key] - current[key]) * ease
    pointer.x += (pointerTarget.x - pointer.x) * ease
    pointer.y += (pointerTarget.y - pointer.y) * ease
    if (burst >= 0) {
      burst += delta * (0.72 + impact * 0.18)
      if (burst > 1.5) burst = -1
    }

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(program)
    gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height)
    gl.uniform2f(uniforms.u_pointer, pointer.x, pointer.y)
    gl.uniform1f(uniforms.u_time, now / 1000)
    gl.uniform1f(uniforms.u_phase, current.phase)
    gl.uniform1f(uniforms.u_energy, current.energy)
    gl.uniform1f(uniforms.u_information, current.information)
    gl.uniform1f(uniforms.u_entropy, current.entropy)
    gl.uniform1f(uniforms.u_stability, current.stability)
    gl.uniform1f(uniforms.u_fragments, current.fragments)
    gl.uniform1f(uniforms.u_burst, burst)
    gl.uniform1f(uniforms.u_impact, impact)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function loop(now) {
    if (now - lastRenderedTime >= 30) {
      draw(now)
      lastRenderedTime = now
    }
    if (!reducedMotion && !document.hidden && !disposed) frame = requestAnimationFrame(loop)
  }

  function restart() {
    cancelAnimationFrame(frame)
    previousTime = performance.now()
    if (reducedMotion) draw()
    else if (!document.hidden) frame = requestAnimationFrame(loop)
  }

  function setState(state, phase) {
    target = normalizedState(state)
    if (shell) shell.dataset.phase = state?.phase ?? "loading"
    if (captionElement && state && phase) {
      captionElement.textContent = state.phase === "first_3d"
        ? phase.title + " · 时间线 " + state.timeline
        : phase.title + " · 信息 " + state.information + " / 熵 " + state.entropy
    }
    if (reducedMotion) draw()
  }

  function pulse(kind) {
    const impacts = {
      observe: 0.65,
      split: 1.0,
      fuse: 0.8,
      big_bang: 2.2,
      create: 0.9,
      destroy: 1.25,
      stabilize: 0.7,
      timeline_create: 1.35,
      timeline_join: 1.0,
      reset: 1.4,
    }
    impact = impacts[kind] ?? 0.8
    burst = 0
    if (reducedMotion) draw()
  }

  function updatePointer(event) {
    const bounds = canvas.getBoundingClientRect()
    pointerTarget.x = clamp01((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointerTarget.y = (clamp01((event.clientY - bounds.top) / bounds.height) * 2 - 1) * -1
    if (reducedMotion) draw()
  }

  const resizeObserver = globalThis.ResizeObserver
    ? new ResizeObserver(() => reducedMotion && draw())
    : { observe() {}, disconnect() {} }
  const resetPointer = () => {
    pointerTarget = { x: 0, y: 0 }
    if (reducedMotion) draw()
  }
  const handleContextLost = (event) => {
    event.preventDefault()
    disposed = true
    cancelAnimationFrame(frame)
    setFallback(shell, statusElement, captionElement, "3D 图形上下文已中断，规则演示仍可继续。")
  }
  resizeObserver.observe(canvas)
  canvas.addEventListener("pointermove", updatePointer)
  canvas.addEventListener("pointerleave", resetPointer)
  canvas.addEventListener("webglcontextlost", handleContextLost)
  document.addEventListener("visibilitychange", restart)
  restart()

  return {
    supported: true,
    setState,
    pulse,
    destroy() {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      canvas.removeEventListener("pointermove", updatePointer)
      canvas.removeEventListener("pointerleave", resetPointer)
      canvas.removeEventListener("webglcontextlost", handleContextLost)
      document.removeEventListener("visibilitychange", restart)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    },
  }
}
