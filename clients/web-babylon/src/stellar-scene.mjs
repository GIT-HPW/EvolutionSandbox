// SPDX-License-Identifier: GPL-3.0-or-later

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js"
import { Engine } from "@babylonjs/core/Engines/engine.js"
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js"
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js"
import { PointLight } from "@babylonjs/core/Lights/pointLight.js"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js"
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js"
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js"
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder.pure.js"
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.pure.js"
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js"
import { Scene } from "@babylonjs/core/scene.js"

const COLORS = {
  nebula: Color3.FromHexString("#8a5cff"),
  cold: Color3.FromHexString("#ff6c96"),
  hot: Color3.FromHexString("#ffd36a"),
  white: Color3.FromHexString("#f5fbff"),
  blue: Color3.FromHexString("#63c9ff"),
  disk: Color3.FromHexString("#ff9f5a"),
}
const PHASE_INDEX = { nebula: 0, protostar: 1, main_sequence: 2, red_giant: 3, supernova: 4, planetary_disk: 5 }

function material(scene, name, { emissive = Color3.Black(), diffuse = Color3.Black(), alpha = 1, wireframe = false } = {}) {
  const result = new StandardMaterial(name, scene)
  result.emissiveColor = emissive
  result.diffuseColor = diffuse
  result.specularColor = Color3.Black()
  result.alpha = alpha
  result.wireframe = wireframe
  if (alpha < 1) result.backFaceCulling = false
  return result
}

export function createStellarScene(canvas, { reducedMotion = false } = {}) {
  if (!canvas || !Engine.isSupported()) return { supported: false, setState() {}, pulse() {}, dispose() {} }
  const engine = new Engine(canvas, true, {
    antialias: true,
    preserveDrawingBuffer: false,
    stencil: true,
    powerPreference: "high-performance",
  }, true)
  engine.setHardwareScalingLevel(Math.min(1.5, Math.max(1, globalThis.devicePixelRatio / 1.5 || 1)))
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.003, 0.004, 0.016, 1)
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.012
  scene.fogColor = new Color3(0.014, 0.006, 0.035)
  scene.skipPointerMovePicking = true

  const camera = new ArcRotateCamera("stellar-camera", -Math.PI / 2, Math.PI / 2.45, 20, Vector3.Zero(), scene)
  camera.lowerRadiusLimit = 9
  camera.upperRadiusLimit = 34
  camera.lowerBetaLimit = 0.45
  camera.upperBetaLimit = 2.35
  camera.wheelPrecision = 48
  camera.panningSensibility = 0
  camera.attachControl(canvas, true)

  const hemisphere = new HemisphericLight("stellar-hemisphere", new Vector3(0.2, 1, -0.1), scene)
  hemisphere.intensity = 0.2
  hemisphere.diffuse = COLORS.blue
  hemisphere.groundColor = COLORS.nebula.scale(0.08)
  const stellarLight = new PointLight("stellar-light", Vector3.Zero(), scene)
  stellarLight.diffuse = COLORS.hot
  stellarLight.intensity = 0
  stellarLight.range = 70
  const glow = new GlowLayer("stellar-glow", scene, { blurKernelSize: 64 })
  glow.intensity = 0.35

  const stellarRoot = new TransformNode("stellar-system", scene)
  const core = CreateIcoSphere("stellar-core", { radius: 1.35, subdivisions: 5 }, scene)
  core.parent = stellarRoot
  core.material = material(scene, "stellar-core-material", { emissive: COLORS.cold.scale(0.25), diffuse: COLORS.cold.scale(0.08) })
  core.renderOutline = true
  core.outlineColor = COLORS.white
  core.outlineWidth = 0.025
  const photosphere = CreateIcoSphere("stellar-photosphere", { radius: 1.8, subdivisions: 4 }, scene)
  photosphere.parent = stellarRoot
  photosphere.material = material(scene, "photosphere-material", { emissive: COLORS.hot.scale(0.35), alpha: 0.58 })
  const corona = CreateIcoSphere("stellar-corona", { radius: 2.25, subdivisions: 3 }, scene)
  corona.parent = stellarRoot
  corona.material = material(scene, "corona-material", { emissive: COLORS.blue.scale(0.72), alpha: 0.08, wireframe: true })

  const diskRings = [6.2, 8.8, 11.5, 14.2].map((diameter, index) => {
    const ring = CreateTorus(`stellar-disk-ring-${index}`, { diameter, thickness: 0.025 + index * 0.008, tessellation: 192 }, scene)
    ring.parent = stellarRoot
    ring.rotation.x = Math.PI / 2 + (index - 1.5) * 0.025
    ring.rotation.z = (index - 1.5) * 0.04
    ring.material = material(scene, `stellar-disk-material-${index}`, {
      emissive: Color3.Lerp(COLORS.nebula, COLORS.disk, index / 4).scale(0.75), alpha: 0.08,
    })
    return ring
  })

  const dustMaterial = material(scene, "stellar-dust-material", { emissive: COLORS.nebula.scale(0.52) })
  const dust = Array.from({ length: 120 }, (_, index) => {
    const mesh = CreateIcoSphere(`stellar-dust-${index}`, { radius: 0.035 + (index % 7) * 0.009, subdivisions: 1 }, scene)
    const theta = index * 2.399963
    const baseRadius = 4 + ((index * 47) % 110) / 10
    const height = -5 + ((index * 61) % 100) / 10
    mesh.material = dustMaterial
    mesh.metadata = { theta, baseRadius, height, speed: 0.08 + (index % 13) * 0.006 }
    return mesh
  })

  const shockwaves = [0, 1, 2].map((index) => {
    const wave = CreateTorus(`stellar-shockwave-${index}`, { diameter: 4 + index * 0.4, thickness: 0.055, tessellation: 192 }, scene)
    wave.rotation.x = Math.PI / 2 + index * 0.45
    wave.rotation.z = index * 0.7
    wave.material = material(scene, `stellar-shock-material-${index}`, { emissive: index === 1 ? COLORS.blue : COLORS.white, alpha: 0 })
    return wave
  })

  let elapsed = 0
  let explosionAge = 99
  let target = {
    phase: "nebula", nebulaMass: 1200, stellarMass: 20, temperature: 4, corePressure: 12, angularMomentum: 75,
    luminosity: 0, stability: 20, elementDiversity: 1, diskMass: 0, diskStability: 0,
  }

  function setState(state) {
    target = { ...target, ...state }
  }

  function pulse(kind) {
    if (kind === "stellar_explosion") explosionAge = 0
    if (kind === "reset") explosionAge = 99
  }

  scene.onBeforeRenderObservable.add(() => {
    const delta = Math.min(0.05, engine.getDeltaTime() / 1000)
    elapsed += delta
    const motion = reducedMotion ? 0.16 : 1
    const phase = PHASE_INDEX[target.phase] ?? 0
    const ignition = Math.min(1, Math.max(0, (phase - 0.35) / 1.65))
    const diskBlend = phase === 5 ? 1 : 0
    const redBlend = phase === 3 ? 1 : 0
    const massScale = 0.34 + Math.min(1.15, target.stellarMass / 180)
    const breathing = 1 + Math.sin(elapsed * (1.8 + target.stability / 80)) * (0.035 + redBlend * 0.09) * motion
    const desiredScale = diskBlend ? 0.55 : massScale * breathing
    core.scaling.setAll(desiredScale)
    photosphere.scaling.setAll(desiredScale * (1.12 + target.luminosity / 650))
    corona.scaling.setAll(desiredScale * (1.45 + target.luminosity / 380))
    core.rotation.y += delta * (0.1 + target.corePressure / 1800) * motion
    core.rotation.x -= delta * 0.05 * motion
    photosphere.rotation.y -= delta * (0.08 + target.temperature / 5000) * motion
    corona.rotation.y += delta * 0.17 * motion
    const hotColor = Color3.Lerp(COLORS.cold, COLORS.hot, Math.min(1, target.temperature / 170))
    const stellarColor = Color3.Lerp(hotColor, COLORS.white, Math.min(0.7, target.luminosity / 130))
    core.material.emissiveColor = Color3.Lerp(COLORS.nebula.scale(0.18), stellarColor.scale(0.72), ignition)
    photosphere.material.emissiveColor = Color3.Lerp(COLORS.cold.scale(0.12), stellarColor.scale(0.82), ignition)
    corona.material.emissiveColor = Color3.Lerp(COLORS.nebula.scale(0.4), COLORS.blue.scale(0.85), ignition)
    stellarLight.diffuse = stellarColor
    stellarLight.intensity = ignition * (2 + target.luminosity / 5)
    glow.intensity += ((0.28 + ignition * 0.55 + redBlend * 0.25) - glow.intensity) * Math.min(1, delta * 3)

    diskRings.forEach((ring, index) => {
      ring.rotation.y += delta * (0.05 + target.angularMomentum / 500 + index * 0.018) * motion
      const desiredAlpha = diskBlend
        ? 0.22 + target.diskStability / 260 + index * 0.025
        : Math.max(0.025, (1 - ignition) * 0.15)
      ring.material.alpha += (desiredAlpha - ring.material.alpha) * Math.min(1, delta * 3)
      ring.scaling.setAll((diskBlend ? 0.8 + target.diskMass / 360 : 0.82 + target.nebulaMass / 5000) * (1 + index * 0.02))
    })

    dustMaterial.emissiveColor = Color3.Lerp(COLORS.nebula.scale(0.48), COLORS.disk.scale(0.72), diskBlend)
    dust.forEach((mesh, index) => {
      const data = mesh.metadata
      const angle = data.theta + elapsed * data.speed * (1 + target.angularMomentum / 100) * motion
      const accretion = Math.min(0.72, target.stellarMass / 300)
      const sphericalRadius = data.baseRadius * (1 - accretion * 0.55)
      const diskRadius = 3.2 + (data.baseRadius - 4) * 0.82
      const radius = sphericalRadius + (diskRadius - sphericalRadius) * diskBlend
      const y = data.height * (1 - diskBlend * 0.94)
      mesh.position.set(Math.cos(angle) * radius, y + Math.sin(angle * 1.7) * (1 - diskBlend) * 0.6, Math.sin(angle) * radius)
      const visibility = diskBlend ? 0.32 + target.diskStability / 150 : 0.18 + target.nebulaMass / 1700
      mesh.visibility = Math.min(1, visibility)
      mesh.scaling.setAll(0.65 + (index % 5) * 0.1 + diskBlend * target.elementDiversity / 80)
    })

    if (explosionAge < 3) {
      explosionAge += delta
      const progress = Math.min(1, explosionAge / 2.4)
      shockwaves.forEach((wave, index) => {
        const local = Math.max(0, Math.min(1, progress * 1.35 - index * 0.12))
        wave.scaling.setAll(1 + local * (9 + index * 2))
        wave.material.alpha = Math.sin(local * Math.PI) * (0.92 - index * 0.16)
      })
      const flash = Math.sin(progress * Math.PI)
      stellarLight.intensity += flash * 42
      glow.intensity += flash * 1.8
    } else shockwaves.forEach((wave) => { wave.material.alpha = 0 })

    camera.radius += ((diskBlend ? 23 : redBlend ? 24 : 19) - camera.radius) * Math.min(1, delta * 0.4)
  })

  engine.runRenderLoop(() => scene.render())
  const resize = () => engine.resize()
  globalThis.addEventListener("resize", resize)
  return {
    supported: true,
    setState,
    pulse,
    dispose() {
      globalThis.removeEventListener("resize", resize)
      scene.dispose()
      engine.dispose()
    },
  }
}
