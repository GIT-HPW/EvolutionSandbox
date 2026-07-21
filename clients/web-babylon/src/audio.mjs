// SPDX-License-Identifier: GPL-3.0-or-later

let context

function audioContext() {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContext) return null
  context ??= new AudioContext()
  if (context.state === "suspended") context.resume().catch(() => {})
  return context
}

function tone({ frequency, endFrequency, duration, gain = 0.05, type = "sine", delay = 0 }) {
  const audio = audioContext()
  if (!audio) return
  const start = audio.currentTime + delay
  const oscillator = audio.createOscillator()
  const envelope = audio.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency ?? frequency), start + duration)
  envelope.gain.setValueAtTime(0.0001, start)
  envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.04, duration / 3))
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(envelope).connect(audio.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

export function playActionSound(actionId) {
  if (actionId === "observe") {
    tone({ frequency: 360, endFrequency: 720, duration: 0.22, type: "sine" })
    tone({ frequency: 540, endFrequency: 960, duration: 0.18, gain: 0.025, delay: 0.08 })
    return
  }
  if (actionId === "split") {
    tone({ frequency: 220, endFrequency: 70, duration: 0.38, type: "sawtooth", gain: 0.04 })
    return
  }
  if (actionId === "fuse" || actionId === "stabilize") {
    tone({ frequency: 280, endFrequency: 580, duration: 0.42, type: "triangle" })
    return
  }
  if (actionId === "big_bang") {
    tone({ frequency: 70, endFrequency: 28, duration: 1.2, type: "sawtooth", gain: 0.08 })
    tone({ frequency: 520, endFrequency: 1400, duration: 0.8, type: "sine", gain: 0.035, delay: 0.06 })
    return
  }
  if (actionId === "create") {
    tone({ frequency: 180, endFrequency: 520, duration: 0.44, type: "triangle", gain: 0.045 })
    tone({ frequency: 360, endFrequency: 760, duration: 0.34, type: "sine", gain: 0.028, delay: 0.09 })
    return
  }
  if (actionId === "destroy") {
    tone({ frequency: 420, endFrequency: 65, duration: 0.5, type: "sawtooth", gain: 0.042 })
    return
  }
  if (actionId === "realm_complete") {
    tone({ frequency: 262, endFrequency: 524, duration: 0.65, type: "sine", gain: 0.038 })
    tone({ frequency: 392, endFrequency: 784, duration: 0.72, type: "triangle", gain: 0.032, delay: 0.11 })
    tone({ frequency: 523, endFrequency: 1046, duration: 0.78, type: "sine", gain: 0.024, delay: 0.2 })
    return
  }
  tone({ frequency: 240, endFrequency: 420, duration: 0.25, type: "triangle", gain: 0.035 })
}
