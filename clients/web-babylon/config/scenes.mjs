// SPDX-License-Identifier: GPL-3.0-or-later

const scenes = [
  {
    id: "origin",
    order: 1,
    chapter: "第一纪元",
    title: "次世代原点演化",
    summary: "从零维原点建立首个三维领域，并闭合第一次物质循环。",
    visibility: "public",
    page: "origin.html",
    sourceEntry: "app.mjs",
    bundle: "app.js",
    styles: ["styles.css"],
    content: [{ source: "content/chapters/origin.json", output: "origin.json" }],
  },
  {
    id: "stellar",
    order: 2,
    chapter: "实验纪元",
    title: "星辰：物质的熔炉",
    summary: "让原始物质云自主经历恒星生命周期，并把复杂物质交给行星盘。",
    visibility: "experimental",
    page: "stellar.html",
    sourceEntry: "stellar-app.mjs",
    bundle: "stellar-app.js",
    styles: ["styles.css", "stellar.css"],
    content: [{ source: "content/stellar/presets/first-light.json", output: "stellar.json" }],
  },
]

export const SCENE_REGISTRY = Object.freeze(scenes.map((scene) => Object.freeze({
  ...scene,
  styles: Object.freeze([...scene.styles]),
  content: Object.freeze(scene.content.map((entry) => Object.freeze({ ...entry }))),
})))

export function scenesForProfile(profile = "public") {
  if (!["public", "experimental"].includes(profile)) throw new TypeError(`Unknown scene profile: ${profile}`)
  return SCENE_REGISTRY.filter((scene) => scene.visibility === "public" || profile === "experimental")
}

export function publicSceneDescriptor(scene) {
  return {
    id: scene.id,
    order: scene.order,
    chapter: scene.chapter,
    title: scene.title,
    summary: scene.summary,
    visibility: scene.visibility,
    page: scene.page,
  }
}
