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
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder.pure.js"
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder.pure.js"
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.pure.js"
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js"
import { Scene } from "@babylonjs/core/scene.js"

const COLORS = {
  cyan: Color3.FromHexString("#53ecff"),
  violet: Color3.FromHexString("#9a72ff"),
  rose: Color3.FromHexString("#ff4fa3"),
  gold: Color3.FromHexString("#ffd36a"),
  blue: Color3.FromHexString("#365eff"),
}

function material(scene, name, { diffuse = Color3.Black(), emissive = Color3.Black(), alpha = 1, wireframe = false } = {}) {
  const result = new StandardMaterial(name, scene)
  result.diffuseColor = diffuse
  result.emissiveColor = emissive
  result.specularColor = Color3.Black()
  result.alpha = alpha
  result.wireframe = wireframe
  if (alpha < 1) result.backFaceCulling = false
  return result
}

function createGrid(scene) {
  const lines = []
  const color = new Color3(0.18, 0.56, 0.95)
  for (let index = -10; index <= 10; index += 1) {
    const x = CreateLines(`grid-x-${index}`, {
      points: [new Vector3(-12, -3.2, index), new Vector3(12, -3.2, index)],
    }, scene)
    const z = CreateLines(`grid-z-${index}`, {
      points: [new Vector3(index, -3.2, -12), new Vector3(index, -3.2, 12)],
    }, scene)
    x.color = color
    z.color = color
    x.visibility = 0
    z.visibility = 0
    lines.push(x, z)
  }
  return lines
}

export function createAnimeUniverse(canvas, { reducedMotion = false } = {}) {
  if (!canvas || !Engine.isSupported()) return { supported: false, dispose() {} }

  const engine = new Engine(canvas, true, {
    antialias: true,
    preserveDrawingBuffer: false,
    stencil: true,
    powerPreference: "high-performance",
  }, true)
  engine.setHardwareScalingLevel(Math.min(1.5, Math.max(1, globalThis.devicePixelRatio / 1.5 || 1)))
  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.008, 0.012, 0.055, 1)
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.018
  scene.fogColor = new Color3(0.015, 0.025, 0.1)
  scene.skipPointerMovePicking = true

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.3, 17, Vector3.Zero(), scene)
  camera.lowerRadiusLimit = 8
  camera.upperRadiusLimit = 28
  camera.lowerBetaLimit = 0.55
  camera.upperBetaLimit = 2.25
  camera.wheelPrecision = 50
  camera.panningSensibility = 0
  camera.attachControl(canvas, true)

  const hemisphere = new HemisphericLight("hemisphere", new Vector3(0.2, 1, 0.1), scene)
  hemisphere.intensity = 0.5
  hemisphere.diffuse = COLORS.cyan
  hemisphere.groundColor = new Color3(0.04, 0.01, 0.12)
  const coreLight = new PointLight("core-light", Vector3.Zero(), scene)
  coreLight.diffuse = COLORS.violet
  coreLight.intensity = 8
  coreLight.range = 36

  const glow = new GlowLayer("anime-glow", scene, { blurKernelSize: 48 })
  glow.intensity = 0.52

  const universe = new TransformNode("universe", scene)
  const core = CreateIcoSphere("energy-core", { radius: 2.05, subdivisions: 5 }, scene)
  core.parent = universe
  core.material = material(scene, "core-material", {
    diffuse: new Color3(0.08, 0.015, 0.2), emissive: COLORS.violet.scale(0.42), alpha: 0.76,
  })
  core.renderOutline = true
  core.outlineColor = COLORS.cyan
  core.outlineWidth = 0.035

  const innerCore = CreateIcoSphere("inner-energy-core", { radius: 1.08, subdivisions: 4 }, scene)
  innerCore.parent = universe
  innerCore.material = material(scene, "inner-core-material", {
    diffuse: new Color3(0.01, 0.07, 0.13), emissive: COLORS.cyan.scale(0.34),
  })

  const shell = CreateIcoSphere("information-shell", { radius: 2.55, subdivisions: 3 }, scene)
  shell.parent = universe
  shell.material = material(scene, "shell-material", {
    emissive: COLORS.cyan.scale(0.75), alpha: 0.12, wireframe: true,
  })

  const rings = [
    { diameter: 7.4, color: COLORS.cyan, x: 0.2, z: 0.2 },
    { diameter: 9.1, color: COLORS.violet, x: 1.15, z: 0.45 },
    { diameter: 10.8, color: COLORS.rose, x: 0.6, z: 1.2 },
  ].map((definition, index) => {
    const ring = CreateTorus(`time-ring-${index}`, {
      diameter: definition.diameter,
      thickness: index === 0 ? 0.055 : 0.035,
      tessellation: 160,
    }, scene)
    ring.parent = universe
    ring.rotation.x = definition.x
    ring.rotation.z = definition.z
    ring.material = material(scene, `ring-material-${index}`, {
      emissive: definition.color, alpha: 0.8 - index * 0.12,
    })
    return ring
  })

  const fragmentMaterial = material(scene, "fragment-material", {
    diffuse: new Color3(0.25, 0.03, 0.13), emissive: COLORS.rose.scale(0.9),
  })
  const fragments = Array.from({ length: 16 }, (_, index) => {
    const fragment = CreatePolyhedron(`fragment-${index}`, { type: index % 5, size: 0.34 + (index % 3) * 0.08 }, scene)
    fragment.parent = universe
    fragment.material = fragmentMaterial
    fragment.renderOutline = true
    fragment.outlineColor = COLORS.gold
    fragment.outlineWidth = 0.018
    fragment.setEnabled(false)
    return fragment
  })

  const starMaterial = material(scene, "star-material", { emissive: COLORS.cyan.scale(0.75) })
  const stars = Array.from({ length: 72 }, (_, index) => {
    const star = CreateIcoSphere(`star-${index}`, { radius: 0.025 + (index % 5) * 0.008, subdivisions: 1 }, scene)
    const theta = index * 2.399963
    const radius = 8 + ((index * 37) % 120) / 10
    const height = -7 + ((index * 53) % 140) / 10
    star.position.set(Math.cos(theta) * radius, height, Math.sin(theta) * radius)
    star.material = starMaterial
    return star
  })

  const grid = createGrid(scene)
  const realmRoot = new TransformNode("first-3d-realm", scene)
  const realmColors = [COLORS.cyan, COLORS.violet, COLORS.gold]
  const realmAnchor = CreateTorus("realm-anchor", { diameter: 9.2, thickness: 0.045, tessellation: 192 }, scene)
  realmAnchor.parent = realmRoot
  realmAnchor.position.y = -3.05
  realmAnchor.material = material(scene, "realm-anchor-material", { emissive: COLORS.cyan.scale(0.42), alpha: 0.72 })
  realmAnchor.scaling.setAll(0)
  const realmOrbs = realmColors.map((color, index) => {
    const orb = CreateIcoSphere(`matter-orb-${index}`, { radius: 0.8 + index * 0.22, subdivisions: 3 }, scene)
    orb.parent = realmRoot
    orb.position.set(-5 + index * 5, -1 + index * 0.9, 2.5 - index * 2.2)
    orb.material = material(scene, `matter-material-${index}`, { diffuse: color.scale(0.15), emissive: color.scale(0.72) })
    orb.renderOutline = true
    orb.outlineColor = Color3.White()
    orb.outlineWidth = 0.02
    orb.scaling.setAll(0)
    orb.setEnabled(false)
    return orb
  })
  realmRoot.setEnabled(false)

  const shockwave = CreateTorus("shockwave", { diameter: 4.4, thickness: 0.08, tessellation: 192 }, scene)
  shockwave.rotation.x = Math.PI / 2
  shockwave.material = material(scene, "shockwave-material", { emissive: COLORS.gold, alpha: 0 })

  let elapsed = 0
  let phaseBlend = 0
  let shockAge = 99
  let splitImpulse = 0
  let matterImpulse = 0
  let stabilityImpulse = 0
  let target = {
    energy: 24, information: 0, entropy: 0, stability: 12, fragments: 0,
    matter: 0, matterCreated: 0, matterStabilized: 0, matterRecycled: 0, phase: "origin_0d",
  }

  function setState(state) {
    target = { ...target, ...state }
  }

  function pulse(actionId) {
    if (actionId === "big_bang") shockAge = 0
    if (actionId === "split") splitImpulse = 1
    if (actionId === "fuse" || actionId === "stabilize") splitImpulse = -0.5
    if (actionId === "create") matterImpulse = 1
    if (actionId === "destroy") matterImpulse = -1
    if (actionId === "stabilize") stabilityImpulse = 1
    if (actionId === "realm_complete") stabilityImpulse = 1.8
    if (actionId === "reset") {
      shockAge = 99
      phaseBlend = 0
      matterImpulse = 0
      stabilityImpulse = 0
      camera.radius = 17
    }
  }

  scene.onBeforeRenderObservable.add(() => {
    const delta = Math.min(0.05, engine.getDeltaTime() / 1000)
    elapsed += delta
    const motion = reducedMotion ? 0.18 : 1
    phaseBlend += ((target.phase === "first_3d" ? 1 : 0) - phaseBlend) * Math.min(1, delta * 2.4)
    splitImpulse *= Math.pow(0.05, delta)
    matterImpulse *= Math.pow(0.06, delta)
    stabilityImpulse *= Math.pow(0.12, delta)
    const energyScale = 0.72 + Math.min(0.82, target.energy / 54)
    const breathing = 1 + Math.sin(elapsed * 2.2) * 0.045 * motion
    core.scaling.setAll(energyScale * breathing + splitImpulse * 0.08)
    innerCore.scaling.setAll(energyScale * (1.02 - Math.sin(elapsed * 2.2) * 0.035 * motion))
    shell.scaling.setAll(0.9 + target.information / 80 + Math.sin(elapsed * 1.4) * 0.03 * motion)
    core.rotation.y += delta * 0.16 * motion
    innerCore.rotation.y -= delta * 0.22 * motion
    innerCore.rotation.x += delta * 0.08 * motion
    shell.rotation.y -= delta * 0.12 * motion
    shell.rotation.x += delta * 0.05 * motion
    core.material.emissiveColor = Color3.Lerp(COLORS.violet.scale(0.38), COLORS.cyan.scale(0.48), Math.min(1, target.information / 18))
    innerCore.material.emissiveColor = Color3.Lerp(COLORS.cyan.scale(0.34), COLORS.gold.scale(0.46), phaseBlend)
    coreLight.diffuse = core.material.emissiveColor
    coreLight.intensity = 4 + Math.min(9, target.energy * 0.18)

    rings.forEach((ring, index) => {
      const entropySpeed = 0.07 + Math.min(0.5, target.entropy / 45)
      ring.rotation.y += delta * entropySpeed * (index % 2 === 0 ? 1 : -1) * motion
      ring.rotation.z += delta * (0.018 + index * 0.011) * motion
      ring.scaling.setAll(0.82 + Math.min(0.4, target.stability / 90) + phaseBlend * index * 0.05)
    })

    const visibleFragments = Math.min(fragments.length, Math.ceil(target.fragments * 1.5))
    fragments.forEach((fragment, index) => {
      fragment.setEnabled(index < visibleFragments)
      const angle = elapsed * (0.22 + index * 0.007) * motion + index * 2.399
      const radius = 3.3 + (index % 4) * 0.55 + Math.max(0, splitImpulse) * 1.2
      fragment.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 1.8, Math.sin(angle) * radius)
      fragment.rotation.x += delta * (0.3 + index * 0.02) * motion
      fragment.rotation.y -= delta * (0.24 + index * 0.015) * motion
    })

    grid.forEach((line, index) => {
      line.visibility = phaseBlend * (index % 4 === 0 ? 0.55 : 0.2)
    })
    realmRoot.setEnabled(phaseBlend > 0.01)
    const missionComplete = target.matterCreated > 0 && target.matterStabilized > 0 && target.matterRecycled > 0
    realmAnchor.scaling.setAll(phaseBlend * (1 + Math.max(0, stabilityImpulse) * 0.08))
    realmAnchor.rotation.y += delta * (0.08 + Math.max(0, stabilityImpulse) * 0.18) * motion
    realmAnchor.material.emissiveColor = Color3.Lerp(
      COLORS.cyan.scale(0.42),
      COLORS.gold.scale(0.78),
      Math.min(1, (missionComplete ? 0.72 : 0) + Math.max(0, stabilityImpulse) * 0.35),
    )
    realmOrbs.forEach((orb, index) => {
      const visible = index < Math.min(realmOrbs.length, target.matter)
      if (visible) orb.setEnabled(true)
      const desiredScale = visible ? phaseBlend * (1 + Math.max(0, matterImpulse) * 0.24) : 0
      const nextScale = orb.scaling.x + (desiredScale - orb.scaling.x) * Math.min(1, delta * 7)
      orb.scaling.setAll(nextScale)
      if (!visible && nextScale < 0.015) orb.setEnabled(false)
      orb.material.emissiveColor = Color3.Lerp(
        realmColors[index].scale(0.72),
        COLORS.gold.scale(0.82),
        Math.min(1, (target.matterStabilized > 0 ? 0.58 : 0) + Math.max(0, stabilityImpulse) * 0.4),
      )
      orb.rotation.y += delta * (0.12 + index * 0.08) * motion
      orb.position.y += Math.sin(elapsed * 0.8 + index) * delta * 0.06 * motion
    })
    stars.forEach((star, index) => {
      const pulseScale = 0.75 + Math.sin(elapsed * (0.5 + (index % 7) * 0.08) + index) * 0.25
      star.scaling.setAll(pulseScale)
    })

    camera.radius += ((phaseBlend > 0.5 ? 21 : 17) - camera.radius) * Math.min(1, delta * 0.35)
    if (shockAge < 2.2) {
      shockAge += delta
      const progress = Math.min(1, shockAge / 1.8)
      shockwave.scaling.setAll(1 + progress * 8)
      shockwave.material.alpha = Math.sin(progress * Math.PI) * 0.92
      glow.intensity = 0.52 + Math.sin(progress * Math.PI) * 1.25
    } else {
      shockwave.material.alpha = 0
      glow.intensity += (0.52 - glow.intensity) * Math.min(1, delta * 3)
    }
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
