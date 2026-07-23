// SPDX-License-Identifier: GPL-3.0-or-later

import { clearSceneFlow, SceneFlowController, SCENE_FLOW_STORAGE_KEY } from "./scene-flow.mjs"

const stageGrid = document.querySelector("#stage-grid")
const status = document.querySelector("#lobby-status")
const resetButton = document.querySelector("#reset-navigation")

function stageCard(scene, flow, allowedSceneIds) {
  const article = document.createElement("article")
  article.className = "stage-card"
  article.dataset.visibility = scene.visibility

  const order = document.createElement("span")
  order.className = "stage-order"
  order.textContent = String(scene.order).padStart(2, "0")
  const chapter = document.createElement("p")
  chapter.className = "stage-chapter"
  chapter.textContent = scene.chapter
  const title = document.createElement("h2")
  title.textContent = scene.title
  const summary = document.createElement("p")
  summary.className = "stage-summary"
  summary.textContent = scene.summary
  const badge = document.createElement("span")
  badge.className = "stage-badge"
  badge.textContent = scene.visibility === "experimental" ? "本地实验" : "已开放"
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = flow.snapshot().lastSceneId === scene.id ? "继续本阶段" : "进入本阶段"
  button.addEventListener("click", () => {
    button.disabled = true
    status.textContent = `正在建立 ${scene.title} 的受控加载记录……`
    try {
      flow.selectScene(scene.id, allowedSceneIds)
      window.location.assign(scene.page)
    } catch (error) {
      button.disabled = false
      status.textContent = `${error.code ?? "navigation_error"}：${error.message}`
    }
  })

  article.append(order, chapter, title, summary, badge, button)
  return article
}

async function start() {
  const response = await fetch("./scenes.json")
  if (!response.ok) throw new Error(`场景目录加载失败：HTTP ${response.status}`)
  const manifest = await response.json()
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    throw new Error("场景目录格式无效")
  }
  const flow = new SceneFlowController()
  flow.showStageSelect()
  const allowedSceneIds = manifest.scenes.map((scene) => scene.id)
  stageGrid.replaceChildren(...manifest.scenes.map((scene) => stageCard(scene, flow, allowedSceneIds)))
  status.textContent = manifest.profile === "experimental"
    ? "本地实验构建：实验场景不会进入默认 GitHub Pages 产物。"
    : `公开构建：当前开放 ${manifest.scenes.length} 个演化阶段。`
}

resetButton.addEventListener("click", () => {
  clearSceneFlow(localStorage, SCENE_FLOW_STORAGE_KEY)
  window.location.reload()
})

start().catch((error) => {
  status.textContent = `阶段选择无法启动：${error.message}`
  resetButton.hidden = false
})
