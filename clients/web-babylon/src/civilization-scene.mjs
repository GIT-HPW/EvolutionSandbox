// SPDX-License-Identifier: GPL-3.0-or-later

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js"
import { Engine } from "@babylonjs/core/Engines/engine.js"
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js"
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js"
import { PointLight } from "@babylonjs/core/Lights/pointLight.js"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js"
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js"
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js"
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.pure.js"
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.pure.js"
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.pure.js"
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js"
import { Scene } from "@babylonjs/core/scene.js"

const COLORS = {
  knowledge: Color3.FromHexString("#58e8ff"),
  ecology: Color3.FromHexString("#72ffbd"),
  cohesion: Color3.FromHexString("#b082ff"),
  resources: Color3.FromHexString("#ffd36a"),
  alert: Color3.FromHexString("#ff5fa6"),
}
const ERA_INDEX = { origin: 0, settlement: 1, civic: 2, planetary: 3 }

function material(scene, name, color, alpha = 1) {
  const result = new StandardMaterial(name, scene)
  result.diffuseColor = color.scale(0.08)
  result.emissiveColor = color.scale(0.72)
  result.specularColor = Color3.Black()
  result.alpha = alpha
  if (alpha < 1) result.backFaceCulling = false
  return result
}

function metricsFrom(observation) {
  return Object.fromEntries(observation.summary.metrics.map((entry) => [entry.id, entry.value]))
}

export function createCivilizationScene(canvas, { reducedMotion = false } = {}) {
  if (!canvas || !Engine.isSupported()) return { supported: false, setObservation() {}, pulse() {}, dispose() {} }
  const engine = new Engine(canvas, true, {
    antialias: true,
    preserveDrawingBuffer: false,
    stencil: true,
    powerPreference: "high-performance",
  }, true)
  engine.setHardwareScalingLevel(Math.min(1.5, Math.max(1, globalThis.devicePixelRatio / 1.5 || 1)))
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.003, 0.009, 0.018, 1)
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.018
  scene.fogColor = new Color3(0.008, 0.025, 0.035)
  scene.skipPointerMovePicking = true

  const camera = new ArcRotateCamera("civilization-camera", -Math.PI / 2, 1.08, 24, new Vector3(0, 1.2, 0), scene)
  camera.lowerRadiusLimit = 12
  camera.upperRadiusLimit = 36
  camera.lowerBetaLimit = 0.42
  camera.upperBetaLimit = 1.46
  camera.wheelPrecision = 45
  camera.panningSensibility = 0
  camera.attachControl(canvas, true)

  const hemisphere = new HemisphericLight("civilization-hemisphere", new Vector3(0.2, 1, -0.1), scene)
  hemisphere.intensity = 0.42
  hemisphere.diffuse = COLORS.knowledge
  hemisphere.groundColor = COLORS.ecology.scale(0.1)
  const centerLight = new PointLight("civilization-center-light", new Vector3(0, 5, 0), scene)
  centerLight.diffuse = COLORS.knowledge
  centerLight.intensity = 7
  centerLight.range = 38
  const glow = new GlowLayer("civilization-glow", scene, { blurKernelSize: 48 })
  glow.intensity = 0.42

  const root = new TransformNode("civilization-observatory", scene)
  const platform = CreateCylinder("civilization-platform", { diameter: 18, height: 0.35, tessellation: 96 }, scene)
  platform.parent = root
  platform.position.y = -0.3
  platform.material = material(scene, "civilization-platform-material", COLORS.ecology, 0.3)

  const rings = [6, 11.5, 17].map((diameter, index) => {
    const ring = CreateTorus(`civilization-ring-${index}`, { diameter, thickness: 0.045 + index * 0.018, tessellation: 160 }, scene)
    ring.parent = root
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.05 + index * 0.08
    ring.material = material(scene, `civilization-ring-material-${index}`, index === 0 ? COLORS.knowledge : COLORS.cohesion, 0.28)
    return ring
  })

  const core = CreateCylinder("civilization-core", { diameter: 2.5, height: 3.2, tessellation: 8 }, scene)
  core.parent = root
  core.position.y = 1.3
  core.material = material(scene, "civilization-core-material", COLORS.knowledge)

  const districts = Array.from({ length: 64 }, (_, index) => {
    const mesh = CreateBox(`civilization-district-${index}`, { size: 1 }, scene)
    const ringIndex = index % 3
    const slot = Math.floor(index / 3)
    const slots = 22
    const theta = slot / slots * Math.PI * 2 + ringIndex * 0.23
    const radius = 3.5 + ringIndex * 2.35 + (slot % 3) * 0.15
    mesh.parent = root
    mesh.position.set(Math.cos(theta) * radius, 0.2, Math.sin(theta) * radius)
    mesh.rotation.y = -theta
    mesh.material = material(scene, `civilization-district-material-${index}`, index % 4 === 0 ? COLORS.resources : COLORS.knowledge)
    mesh.metadata = { ringIndex, theta, radius, seed: (index * 37) % 101 }
    return mesh
  })

  let elapsed = 0
  let branchAge = 99
  let target = {
    phase: "origin",
    status: "paused",
    population: 120,
    resources: 220,
    knowledge: 12,
    ecology: 88,
    cohesion: 74,
  }

  function setObservation(observation) {
    const metrics = metricsFrom(observation)
    target = {
      phase: observation.phase,
      status: observation.summary.status,
      population: Number(metrics.population ?? target.population),
      resources: Number(metrics.resources ?? target.resources),
      knowledge: Number(metrics.knowledge ?? target.knowledge),
      ecology: Number(metrics.ecology ?? target.ecology),
      cohesion: Number(metrics.cohesion ?? target.cohesion),
    }
  }

  function pulse(kind) {
    if (kind === "timeline_branch") branchAge = 0
    if (kind === "reset") branchAge = 99
  }

  scene.onBeforeRenderObservable.add(() => {
    const delta = Math.min(0.05, engine.getDeltaTime() / 1000)
    elapsed += delta
    const motion = reducedMotion ? 0.14 : 1
    const era = ERA_INDEX[target.phase] ?? 0
    const activeDistricts = Math.min(districts.length, 10 + era * 12 + Math.floor(Math.log10(Math.max(10, target.population)) * 7))
    const knowledgeScale = Math.min(1, target.knowledge / 700)
    const resourceScale = Math.min(1, target.resources / 700)
    const ecologyScale = Math.min(1, target.ecology / 100)
    const cohesionScale = Math.min(1, target.cohesion / 100)

    root.rotation.y += delta * (0.025 + knowledgeScale * 0.04) * motion
    core.rotation.y -= delta * (0.2 + knowledgeScale * 0.6) * motion
    core.scaling.y += ((0.7 + knowledgeScale * 1.45) - core.scaling.y) * Math.min(1, delta * 3)
    core.material.emissiveColor = Color3.Lerp(COLORS.alert, COLORS.knowledge, cohesionScale).scale(0.78)
    platform.material.emissiveColor = Color3.Lerp(COLORS.alert, COLORS.ecology, ecologyScale).scale(0.42)
    platform.material.alpha = 0.16 + ecologyScale * 0.28
    glow.intensity += ((0.28 + knowledgeScale * 0.45 + cohesionScale * 0.18) - glow.intensity) * Math.min(1, delta * 2.5)
    centerLight.intensity = 3 + knowledgeScale * 11

    rings.forEach((ring, index) => {
      ring.rotation.z += delta * (0.03 + index * 0.02 + cohesionScale * 0.04) * motion
      ring.material.alpha = 0.12 + cohesionScale * 0.32 + (era >= index + 1 ? 0.16 : 0)
      ring.material.emissiveColor = Color3.Lerp(COLORS.cohesion, COLORS.ecology, ecologyScale).scale(0.72)
    })

    districts.forEach((mesh, index) => {
      const visible = index < activeDistricts
      mesh.visibility += ((visible ? 1 : 0) - mesh.visibility) * Math.min(1, delta * 4)
      const height = 0.28 + (mesh.metadata.seed / 100) * (1.2 + knowledgeScale * 4.5)
      mesh.scaling.set(0.3 + resourceScale * 0.5, height, 0.3 + resourceScale * 0.5)
      mesh.position.y = height / 2
      const base = index % 4 === 0 ? COLORS.resources : COLORS.knowledge
      mesh.material.emissiveColor = Color3.Lerp(base, COLORS.ecology, ecologyScale * 0.45).scale(0.58 + knowledgeScale * 0.32)
    })

    if (branchAge < 2.4) {
      branchAge += delta
      const wave = Math.sin(Math.min(1, branchAge / 2.4) * Math.PI)
      rings.forEach((ring, index) => {
        ring.scaling.setAll(1 + wave * (0.12 + index * 0.05))
        ring.material.alpha += wave * 0.32
      })
      centerLight.intensity += wave * 14
    } else rings.forEach((ring) => ring.scaling.setAll(1))

    camera.radius += ((era >= 2 ? 26 : 22) - camera.radius) * Math.min(1, delta * 0.35)
  })

  engine.runRenderLoop(() => scene.render())
  const resize = () => engine.resize()
  globalThis.addEventListener("resize", resize)
  return {
    supported: true,
    setObservation,
    pulse,
    dispose() {
      globalThis.removeEventListener("resize", resize)
      scene.dispose()
      engine.dispose()
    },
  }
}
