import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ROUTES, BRIEF, banner } from '../content/routes.js'

// The concert (v3.5 stadium, pass 2). One camera, standing in a stadium crowd looking at the stage. The painted layers
// (art/concert/stadium) stack like a theatre set: the stands, the stage and its LED screens, haze, the barrier, three
// rows of crowd. Over the stage something that does not belong to a normal concert: the brief's six routes hang in the
// air as glowing ads, on a slow halo around the stage, and the big screen behind them shows the brief they came from.
// Each route is a song. When it changes, the halo drifts round to bring that ad to the front, the lights drop, the
// route's colour floods the room, the beams find that route's people in the crowd and their phones light up.
// Hovering the crowd shows who a person is: a face (DiceBear "Notionists", CC0), name, age, city, one line about them
// and the audience they belong to. All the art is lit neutral white; the route colours are added here.

const F = { w: 1536, h: 1040 } // the frame, in art px
const SRC = '/sprites/concert/stadium/'
const TAU = Math.PI * 2
// where each layer sits in the frame (art px): x, y, width, height, and how much it pushes in on scroll
const LAYERS = [
  ['backdrop', 'sd-backdrop', 0, -40, 1536, 1024, 0],
  ['stage', 'sd-stage', 0, -70, 1536, 1024, 0.02],
  ['haze', 'sd-haze', 0, 10, 1536, 1024, 0.04],
  ['halo', null, 0, 0, 0, 0, 0.05],
  ['far', 'sd-crowd-far', 0, 200, 1536, 1024, 0.06],
  ['mid', 'sd-crowd-mid', 0, 250, 1536, 1024, 0.1],
  ['near', 'sd-crowd-near', 0, 360, 1536, 1024, 0.16],
]
// the LED screens in the stage art (frame px): the big one shows the brief, the side ones the route at the front
const SCREENS = { mid: [472, 268, 591, 308], left: [270, 268, 163, 305, '916'], right: [1102, 268, 163, 307, '45'] }
const LAMPS = [197, 307, 459, 587, 705, 830, 948, 1076, 1226, 1338].map((x) => [x, 118])
const VP = [768, 360] // the vanishing point: the camera pushes in toward it
// the halo the ads hang on (frame px)
const HALO = { x: 768, y: 586, rx: 610, ry: 92, cw: 132 } // rx narrows on phones, where the sides of the frame are cut
const STEP = TAU / ROUTES.length

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

// a steady random, so the crowd is the same on every visit
const rnd = (() => {
  let a = 11
  return () => {
    a = (a * 16807) % 2147483647
    return a / 2147483647
  }
})()
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
// people: made up, the same on every visit. Lines describe the person, not the ad; no he or she
const NAMES = [
  'Maya',
  'Tom',
  'Priya',
  'Josh',
  'Aisha',
  'Ben',
  'Chloe',
  'Sam',
  'Nadia',
  'Leo',
  'Grace',
  'Ollie',
  'Zara',
  'Dan',
  'Mei',
  'Luke',
  'Hannah',
  'Ravi',
  'Ella',
  'Marcus',
  'Sophie',
  'Kofi',
  'Isla',
  'Jack',
  'Amara',
  'Finn',
  'Lucy',
  'Omar',
  'Ruby',
  'Theo',
  'Jade',
  'Arjun',
  'Carmen',
  'Yusuf',
  'Freya',
  'Diego',
  'Noor',
  'Callum',
  'Hana',
  'Mateo',
]
const PLACES = [
  'Leeds',
  'Austin',
  'Brisbane',
  'Bristol',
  'Denver',
  'Perth',
  'Manchester',
  'Portland',
  'Melbourne',
  'Glasgow',
  'Chicago',
  'Adelaide',
  'Brighton',
  'Seattle',
  'Sydney',
  'Cardiff',
  'Boston',
  'Auckland',
  'Toronto',
  'Dublin',
]
const LINES = [
  [
    'Has tried three cleansers this year and kept none.',
    'Reads every before-and-after photo twice.',
    'Wants to see results first, then the price.',
  ],
  [
    'Gets two kids out of the door by eight.',
    'Has five minutes for skincare on a good day.',
    'Keeps the routine short so it actually happens.',
  ],
  [
    'Tries to eat healthy and looks at ingredients.',
    'Avoids anything with added fragrance.',
    'Looks up any ingredient that sounds made up.',
  ],
  [
    'Reads the reviews before the product page.',
    'Trusts someone with the same skin over any brand.',
    'Asks friends before trying anything new.',
  ],
  [
    'Has used the same foam cleanser for years.',
    'Notices skin feels tight after washing.',
    'Compares pack sizes and prices before buying.',
  ],
  [
    'Turns the evening wash into a quiet ritual.',
    'Likes a bathroom that feels calm.',
    'Picks the bottle that looks and feels soft.',
  ],
]
const AGES = [
  [24, 52],
  [30, 45],
  [22, 48],
  [19, 34],
  [27, 58],
  [22, 35],
]

// the crowd as people: rows of heads over the painted crowd (frame px), nearer rows lower, bigger and further apart
const ROWS = [
  [780, 0.32, 'far'],
  [802, 0.38, 'far'],
  [828, 0.46, 'far'],
  [858, 0.56, 'mid'],
  [892, 0.68, 'mid'],
  [932, 0.82, 'near'],
  [978, 0.96, 'near'],
  [1028, 1.1, 'near'],
]
const PEOPLE = []
for (const [y, s, layer] of ROWS) {
  const gap = 46 * s
  for (let x = 20 + rnd() * gap; x < F.w - 10; x += gap * (0.8 + rnd() * 0.5)) {
    const r = Math.floor(rnd() * ROUTES.length),
      [a0, a1] = AGES[r]
    PEOPLE.push({
      x,
      y: y + (rnd() - 0.5) * 10 * s,
      s,
      layer,
      route: r,
      arm: rnd() < 0.5 ? -1 : 1,
      ph: rnd() * TAU,
      on: rnd() < 0.8,
      name: pick(NAMES),
      age: a0 + Math.floor(rnd() * (a1 - a0 + 1)),
      place: pick(PLACES),
      line: pick(LINES[r]),
    })
  }
}

export function stadium(root, { still = false } = {}) {
  if (!root) return null
  const sec = root.closest('[data-orbit-sec]') || root.parentElement
  const nameEl = sec.querySelector('[data-picked-name]')
  const whoEl = sec.querySelector('[data-picked-who]')
  const whyEl = sec.querySelector('[data-picked-why]')
  const list = sec.querySelector('[data-setlist]')

  // ---- build the frame
  const frame = document.createElement('div')
  frame.className = 'sd__frame'
  const layer = {}
  const img = (cls, name, x, y, w, h) => {
    const i = document.createElement('img')
    i.className = `sd__l sd__l--${cls}`
    i.src = `${SRC}${name}.webp`
    i.alt = ''
    i.decoding = 'async'
    i.draggable = false
    Object.assign(i.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
    return i
  }
  const canvas = (cls) => {
    const c = document.createElement('canvas')
    c.className = `sd__cv sd__${cls}`
    c.width = F.w
    c.height = F.h
    return c
  }
  let cards = []
  for (const [key, name, x, y, w, h] of LAYERS) {
    const g = document.createElement('div')
    g.className = `sd__g sd__g--${key}`
    frame.appendChild(g)
    layer[key] = g
    if (name) g.appendChild(img(key, name, x, y, w, h))
    if (key === 'backdrop') {
      const wash = document.createElement('div')
      wash.className = 'sd__wash'
      g.appendChild(wash)
      layer.behind = document.createElement('div')
      layer.behind.className = 'sd__ring sd__ring--behind'
      g.appendChild(layer.behind)
    }
    if (key === 'stage') {
      for (const [kk, [x0, y0, w0, h0, size]] of Object.entries(SCREENS)) {
        const s = document.createElement('div')
        s.className = `sd__screen sd__screen--${kk}`
        Object.assign(s.style, { left: `${x0}px`, top: `${y0}px`, width: `${w0}px`, height: `${h0}px` })
        s.innerHTML = size
          ? '<div class="sd__ad"></div><i class="sd__led"></i>'
          : `<div class="sd__brief-scr"><span class="px">Tonight's brief</span><b>${BRIEF.title}</b><span>${BRIEF.line}</span><span class="mono">${BRIEF.brand} · from 18 March</span></div><i class="sd__led"></i>`
        g.appendChild(s)
      }
    }
    if (key === 'haze') {
      g.appendChild(Object.assign(document.createElement('div'), { className: 'sd__barrier' }))
      layer.beams = canvas('beams')
      g.appendChild(layer.beams)
    }
    if (key === 'halo') {
      layer.aura = canvas('aura')
      g.appendChild(layer.aura)
      const ring = document.createElement('div')
      ring.className = 'sd__ring'
      ring.innerHTML = ROUTES.map(
        (r, i) =>
          `<button type="button" class="sd__card" data-i="${i}" tabindex="-1" style="--acc:${r.acc};width:${HALO.cw}px">${banner(r, '45')}<span class="sd__card-name">${r.name}</span></button>`,
      ).join('')
      g.appendChild(ring)
      layer.ring = ring
      cards = [...ring.children]
    }
    if (key === 'mid' || key === 'near') {
      const up = img(`${key}-up`, `sd-crowd-${key}-up`, x, y, w, h)
      up.classList.add('sd__up')
      g.appendChild(up)
    }
  }
  const rim = document.createElement('div')
  rim.className = 'sd__rim'
  frame.appendChild(rim)
  const front = canvas('front')
  frame.appendChild(front) // light pools on the crowd, phones, the follow spot, confetti
  const flash = document.createElement('div')
  flash.className = 'sd__flash'
  frame.appendChild(flash)
  root.appendChild(frame)
  const tip = document.createElement('div')
  tip.className = 'orbit__tip'
  tip.setAttribute('aria-hidden', 'true')
  root.appendChild(tip)

  // ---- the frame is drawn at art size and scaled to the column; on short screens the top and bottom are trimmed
  // on a phone the frame is too small at full width, so it is drawn bigger, cut at the sides, and the halo narrows to fit
  let k = 1,
    cropX = 0,
    cropY = 0
  const fit = () => {
    const w = root.clientWidth
    k = w / F.w
    let h = Math.min(F.h * k, Math.max(420, window.innerHeight * 0.9))
    cropX = 0
    if (w < 760) {
      h = Math.min(window.innerHeight * 0.78, 600)
      k = h / 900 // show 900 art px of height: truss to crowd
      cropX = (F.w - w / k) / 2
    }
    cropY = (F.h - h / k) * 0.3
    HALO.rx = Math.min(610, (F.w - 2 * cropX) / 2 - HALO.cw * 0.5)
    frame.style.transform = `scale(${k}) translate(${-cropX}px, ${-cropY}px)`
    root.style.height = `${h}px`
  }
  const ro = new ResizeObserver(fit)
  ro.observe(root)
  fit()

  // ---- the setlist: one button per route
  list.innerHTML = ROUTES.map(
    (r, i) =>
      `<li><button type="button" data-i="${i}" style="--acc:${r.acc}"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${r.name}</button></li>`,
  ).join('')
  const btns = [...list.querySelectorAll('button')]

  // ---- the halo: six ads hanging in the air around the stage, the one at the front lit and sharp
  const st = { a: Math.PI / 2 }
  const placeCards = (now) => {
    cards.forEach((c, i) => {
      const t = st.a + i * STEP
      const depth = (Math.sin(t) + 1) / 2
      const bob = still ? 0 : Math.sin(now / 2100 + i * 1.9) * 9 + Math.sin(now / 1300 + i) * 3
      const x = HALO.x + Math.cos(t) * HALO.rx,
        y = HALO.y + Math.sin(t) * HALO.ry + bob - (1 - depth) * 40
      const s = 0.52 + depth * 0.62
      const tilt = still ? 0 : Math.sin(now / 2700 + i * 2.3) * 2.2
      c.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(3)}) rotate(${(tilt - Math.cos(t) * 4).toFixed(2)}deg)`
      c.style.zIndex = String(Math.round(depth * 100))
      const home = depth < 0.3 ? layer.behind : layer.ring // the far side of the halo passes behind the stage
      if (c.parentNode !== home) home.appendChild(c)
      c.style.opacity = (0.38 + 0.62 * depth ** 1.5).toFixed(3)
      c.style.filter = `blur(${(Math.max(0, 0.55 - depth) * 3).toFixed(2)}px) brightness(${(0.55 + 0.45 * depth ** 2).toFixed(2)})`
    })
  }

  // ---- light: beams from the truss onto that route's people, pools where they land, phones lighting up
  const bx = layer.beams.getContext('2d'),
    ax = layer.aura.getContext('2d'),
    fx = front.getContext('2d')
  let colour = rgb(ROUTES[0].acc),
    burst = 0,
    cur = -1
  const glowV = ROUTES.map(() => ({ v: 0 }))
  const bobOf = { far: 0, mid: 0, near: 0 }
  const scaleOf = (key) => gsap.getProperty(layer[key], 'scale') || 1
  const shown = (p) => {
    // where a person is drawn now, after the push-in and the beat
    const sc = scaleOf(p.layer)
    return [VP[0] + (p.x - VP[0]) * sc, VP[1] + (p.y + bobOf[p.layer] - VP[1]) * sc, p.s * sc]
  }
  // each lamp follows one of the lit people, chosen again on every song
  let aims = []
  const aim = () => {
    const mine = PEOPLE.filter((p) => p.route === cur && p.layer !== 'far')
    aims = LAMPS.map(([lx]) => {
      const near = mine.filter((p) => Math.abs(p.x - lx) < 420)
      const from = near.length ? near : mine
      return from[Math.floor(rnd() * from.length)]
    })
  }
  const sway = (now, i) => (still ? 0 : Math.sin(now / (2300 + i * 90) + i * 1.7) * 26)
  const drawBeams = (now) => {
    bx.clearRect(0, 0, F.w, F.h)
    bx.globalCompositeOperation = 'lighter'
    const c = colour,
      hot = mix(c, [255, 255, 255], 0.45)
    LAMPS.forEach(([lx, ly], i) => {
      const p = aims[i]
      if (!p) return
      const [px, py] = shown(p)
      const tx = px + sway(now, i),
        ty = py - 10
      const len = Math.hypot(tx - lx, ty - ly),
        ang = Math.atan2(ty - ly, tx - lx)
      const spread = 26 + burst * 24
      const a = (0.03 + 0.02 * Math.max(0, Math.sin(now / 520 + i * 2.1))) * (1 + burst * 1.8)
      const g = bx.createLinearGradient(lx, ly, tx, ty)
      g.addColorStop(0, rgba(hot, Math.min(0.5, a * 2.4)))
      g.addColorStop(0.7, rgba(c, a * 0.7))
      g.addColorStop(1, rgba(c, a * 0.9))
      bx.fillStyle = g
      bx.save()
      bx.translate(lx, ly)
      bx.rotate(ang)
      bx.beginPath()
      bx.moveTo(0, -4)
      bx.lineTo(len, -spread)
      bx.lineTo(len, spread)
      bx.lineTo(0, 4)
      bx.closePath()
      bx.fill()
      bx.restore()
      const glow = bx.createRadialGradient(lx, ly, 0, lx, ly, 24)
      glow.addColorStop(0, rgba([255, 255, 255], 0.9))
      glow.addColorStop(0.4, rgba(hot, 0.45))
      glow.addColorStop(1, rgba(c, 0))
      bx.fillStyle = glow
      bx.beginPath()
      bx.arc(lx, ly, 24, 0, TAU)
      bx.fill()
    })
    bx.globalCompositeOperation = 'source-over'
  }

  // the aura behind the ads: a faint ring of light they hang on, a soft column rising from the stage, motes drifting up
  const MOTES = Array.from({ length: 70 }, () => ({
    x: HALO.x + (rnd() - 0.5) * HALO.rx * 2.3,
    y: 200 + rnd() * 560,
    v: 6 + rnd() * 14,
    r: 0.8 + rnd() * 2.2,
    ph: rnd() * TAU,
  }))
  const drawAura = (now, dt) => {
    ax.clearRect(0, 0, F.w, F.h)
    const c = colour,
      hot = mix(c, [255, 255, 255], 0.55)
    ax.globalCompositeOperation = 'lighter'
    const col = ax.createLinearGradient(0, 760, 0, 160)
    col.addColorStop(0, rgba(c, 0.16 + burst * 0.12))
    col.addColorStop(1, rgba(c, 0))
    ax.fillStyle = col
    ax.beginPath()
    ax.ellipse(HALO.x, 760, 300, 600, 0, Math.PI, 0)
    ax.fill()
    // the ring itself: a band of light, brighter at the front
    for (let j = 0; j < 2; j++) {
      ax.save()
      ax.shadowColor = rgba(c, 0.9)
      ax.shadowBlur = j ? 0 : 24
      ax.strokeStyle = rgba(j ? hot : c, j ? 0.5 : 0.22)
      ax.lineWidth = j ? 1.4 : 6
      ax.beginPath()
      ax.ellipse(HALO.x, HALO.y + 30, HALO.rx, HALO.ry, 0, 0.15, Math.PI - 0.15)
      ax.stroke()
      ax.globalAlpha = 0.35
      ax.beginPath()
      ax.ellipse(HALO.x, HALO.y + 30, HALO.rx, HALO.ry, 0, Math.PI + 0.1, TAU - 0.1)
      ax.stroke()
      ax.restore()
    }
    // sparks running round the ring
    if (!still)
      for (let j = 0; j < 3; j++) {
        const t = now / 2600 + (j * TAU) / 3,
          sx = HALO.x + Math.cos(t) * HALO.rx,
          sy = HALO.y + 30 + Math.sin(t) * HALO.ry
        const g = ax.createRadialGradient(sx, sy, 0, sx, sy, 22)
        g.addColorStop(0, rgba([255, 255, 255], 0.7 * (0.5 + 0.5 * Math.sin(t))))
        g.addColorStop(1, rgba(hot, 0))
        ax.fillStyle = g
        ax.beginPath()
        ax.arc(sx, sy, 22, 0, TAU)
        ax.fill()
      }
    for (const m of MOTES) {
      if (!still) {
        m.y -= m.v * dt
        if (m.y < 160) {
          m.y = 780
          m.x = HALO.x + (rnd() - 0.5) * HALO.rx * 2.3
        }
      }
      const a = (0.25 + 0.35 * Math.sin(now / 700 + m.ph)) * Math.min(1, (m.y - 160) / 120)
      ax.fillStyle = rgba(hot, Math.max(0, a))
      ax.beginPath()
      ax.arc(m.x + Math.sin(now / 1500 + m.ph) * 8, m.y, m.r, 0, TAU)
      ax.fill()
    }
    ax.globalCompositeOperation = 'source-over'
  }

  let hover = null,
    bits = []
  const throwConfetti = (c) => {
    for (let n = 0; n < 120; n++) {
      bits.push({
        x: 200 + Math.random() * 1136,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 60,
        vy: 70 + Math.random() * 90,
        r: Math.random() * 6.3,
        vr: (Math.random() - 0.5) * 8,
        w: 6 + Math.random() * 7,
        h: 3 + Math.random() * 5,
        c: Math.random() < 0.55 ? c : Math.random() < 0.5 ? [255, 255, 255] : mix(c, [255, 255, 255], 0.5),
      })
    }
  }
  const drawFront = (now, dt) => {
    fx.clearRect(0, 0, F.w, F.h)
    fx.globalCompositeOperation = 'lighter'
    const c = colour,
      hot = mix(c, [255, 255, 255], 0.5)
    // where the beams land: soft pools on heads and shoulders
    LAMPS.forEach((_, i) => {
      const p = aims[i]
      if (!p) return
      const [px0, py, s] = shown(p),
        px = px0 + sway(now, i)
      const rx = 120 * s + burst * 40,
        g = fx.createRadialGradient(px, py, 0, px, py, rx)
      g.addColorStop(0, rgba(hot, 0.3 + burst * 0.15))
      g.addColorStop(0.5, rgba(c, 0.12 + burst * 0.06))
      g.addColorStop(1, rgba(c, 0))
      fx.fillStyle = g
      fx.save()
      fx.translate(px, py)
      fx.scale(1, 0.45)
      fx.beginPath()
      fx.arc(0, 0, rx, 0, TAU)
      fx.fill()
      fx.restore()
    })
    // the ad at the front throws its light down onto the crowd, like a projection
    const cy0 = HALO.y + HALO.ry + 60,
      sh = fx.createLinearGradient(0, cy0, 0, F.h)
    sh.addColorStop(0, rgba(hot, 0.1 + burst * 0.08))
    sh.addColorStop(1, rgba(c, 0))
    fx.fillStyle = sh
    fx.beginPath()
    fx.moveTo(HALO.x - 70, cy0)
    fx.lineTo(HALO.x + 70, cy0)
    fx.lineTo(HALO.x + 340, F.h)
    fx.lineTo(HALO.x - 340, F.h)
    fx.fill()
    // the route's people hold their phones up: a small screen and a little light around it
    for (const p of PEOPLE) {
      const L = glowV[p.route].v
      if (L < 0.02 || !p.on) continue
      const [x, y, s] = shown(p)
      const px = x + p.arm * 11 * s,
        py = y - 30 * s - L * 4 * s
      const fl = still ? 1 : 0.8 + 0.2 * Math.sin(now / 300 + p.ph)
      const g = fx.createRadialGradient(px, py, 0, px, py, 15 * s)
      g.addColorStop(0, rgba([255, 255, 255], 0.5 * L * fl))
      g.addColorStop(0.35, rgba(hot, 0.22 * L * fl))
      g.addColorStop(1, rgba(c, 0))
      fx.fillStyle = g
      fx.beginPath()
      fx.arc(px, py, 15 * s, 0, TAU)
      fx.fill()
      fx.fillStyle = rgba(mix(hot, [255, 255, 255], 0.4), 0.5 * L * fl)
      fx.fillRect(px - 2.4 * s, py - 4 * s, 4.8 * s, 8 * s)
    }
    // the follow spot on the person under the pointer
    if (hover) {
      const [x, y, s] = shown(hover)
      const g = fx.createLinearGradient(x, 0, x, y)
      g.addColorStop(0, 'rgba(255,250,235,0)')
      g.addColorStop(1, 'rgba(255,250,235,.2)')
      fx.fillStyle = g
      fx.beginPath()
      fx.moveTo(x - 6, 0)
      fx.lineTo(x + 6, 0)
      fx.lineTo(x + 30 * s, y)
      fx.lineTo(x - 30 * s, y)
      fx.fill()
      const p = fx.createRadialGradient(x, y - 10 * s, 0, x, y - 10 * s, 34 * s)
      p.addColorStop(0, 'rgba(255,250,235,.4)')
      p.addColorStop(1, 'rgba(255,250,235,0)')
      fx.fillStyle = p
      fx.beginPath()
      fx.arc(x, y - 10 * s, 34 * s, 0, TAU)
      fx.fill()
    }
    fx.globalCompositeOperation = 'source-over'
    if (hover) {
      const [x, y, s] = shown(hover)
      fx.strokeStyle = 'rgba(255,255,255,.9)'
      fx.lineWidth = 2.5
      fx.beginPath()
      fx.arc(x, y - 12 * s, 24 * s, 0, TAU)
      fx.stroke()
    }
    if (bits.length) {
      bits = bits.filter((b) => b.y < F.h + 20)
      for (const b of bits) {
        b.vy += 26 * dt
        b.x += (b.vx + Math.sin(b.y / 40 + b.r) * 30) * dt
        b.y += b.vy * dt
        b.r += b.vr * dt
        fx.save()
        fx.translate(b.x, b.y)
        fx.rotate(b.r)
        fx.scale(1, Math.cos(b.r * 1.7))
        fx.fillStyle = rgba(b.c, 0.95)
        fx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h)
        fx.restore()
      }
    }
  }

  // ---- a route takes the stage
  let timer = 0,
    spin = null,
    running = false
  const show = (i, { quiet = false } = {}) => {
    if (i === cur) return
    cur = i
    const r = ROUTES[i]
    btns.forEach((b, n) => {
      b.classList.toggle('is-on', n === i)
      b.setAttribute('aria-pressed', String(n === i))
    })
    cards.forEach((c, n) => c.classList.toggle('is-front', n === i))
    nameEl.textContent = r.name
    whoEl.textContent = r.who.charAt(0).toLowerCase() + r.who.slice(1)
    whyEl.textContent = r.why
    // the halo turns the short way round until this ad is at the front
    let d = (Math.PI / 2 - i * STEP - st.a) % TAU
    if (d > Math.PI) d -= TAU
    if (d < -Math.PI) d += TAU
    spin?.kill()
    if (quiet || still) st.a += d
    else spin = gsap.to(st, { a: st.a + d, duration: 2.2, ease: 'power2.inOut' })
    const swap = () => {
      for (const kk of ['left', 'right'])
        frame.querySelector(`.sd__screen--${kk} .sd__ad`).innerHTML = banner(r, SCREENS[kk][4])
      sec.style.setProperty('--front', r.acc)
      frame.style.setProperty('--front', r.acc)
      colour = rgb(r.acc)
      aim()
      glowV.forEach((g, n) =>
        gsap.to(g, { v: n === i ? 1 : 0, duration: quiet || still ? 0 : 0.9, ease: 'power2.out', overwrite: true }),
      )
    }
    if (quiet || still) {
      swap()
      return
    }
    // the song change: lights drop, the new colour floods in, beams flare, arms go up, confetti
    const tl = gsap.timeline()
    tl.to(flash, { opacity: 0.7, duration: 0.25, ease: 'power2.in' })
      .add(swap)
      .to(flash, { opacity: 0, duration: 1, ease: 'power2.out' })
      .fromTo(
        frame.querySelectorAll('.sd__screen'),
        { filter: 'brightness(2) saturate(.6)' },
        { filter: 'brightness(1) saturate(1)', duration: 0.9, stagger: 0.06 },
        '<',
      )
      .to(
        { v: 0 },
        {
          v: 1,
          duration: 0.35,
          ease: 'power2.out',
          onUpdate() {
            burst = this.targets()[0].v
          },
        },
        '<',
      )
      .to(
        { v: 1 },
        {
          v: 0,
          duration: 2.6,
          ease: 'sine.inOut',
          onUpdate() {
            burst = this.targets()[0].v
          },
        },
        '>.4',
      )
      .to(frame.querySelectorAll('.sd__up'), { opacity: 1, duration: 0.3 }, 0.25)
      .to(frame.querySelectorAll('.sd__up'), { opacity: 0, duration: 0.8 }, 3.2)
      .add(() => throwConfetti(rgb(r.acc)), 0.3)
  }
  const next = () => show((cur + 1) % ROUTES.length)
  const loop = () => {
    clearTimeout(timer)
    if (!still && running)
      timer = setTimeout(() => {
        if (!hover) next()
        loop()
      }, 7000)
  }
  btns.forEach((b, n) =>
    b.addEventListener('click', () => {
      show(n)
      loop()
    }),
  )
  cards.forEach((c, n) =>
    c.addEventListener('click', () => {
      show(n)
      loop()
    }),
  )

  // ---- hover: the person under the pointer shows who they are
  const faces = new Map()
  let maker = null,
    loading = null
  const loadFaces = () =>
    loading ||
    (loading = Promise.all([import('@dicebear/core'), import('@dicebear/notionists')])
      .then(([core, style]) => {
        maker = (seed) =>
          core
            .createAvatar(style, {
              seed,
              size: 96,
              backgroundColor: ['dcebf5', 'efe2cf', 'e5ead6', 'f6dfdc', 'f3e7c6'],
              backgroundType: ['solid'],
            })
            .toDataUri()
        if (hover) showTip(hover)
      })
      .catch(() => {}))
  root.addEventListener('pointerenter', loadFaces, { once: true })
  const face = (p) => {
    const key = `${p.name}-${p.age}-${p.place}`
    if (!maker) {
      loadFaces()
      return ''
    }
    if (!faces.has(key)) faces.set(key, maker(key))
    return faces.get(key)
  }
  const showTip = (p) => {
    const r = ROUTES[p.route],
      f = face(p)
    tip.style.setProperty('--acc', r.acc)
    tip.innerHTML = `<div class="tip__top">${f ? `<img src="${f}" alt="" width="56" height="56">` : '<span class="tip__face"></span>'}<div><b>${p.name}, ${p.age}</b><span>${p.place}</span></div></div>
      <p>${p.line}</p>
      <div class="tip__foot"><span>Audience</span><b>${r.who}</b></div>`
  }
  const toFrame = (e) => {
    const b = root.getBoundingClientRect()
    return [(e.clientX - b.left) / k + cropX, (e.clientY - b.top) / k + cropY]
  }
  const placeTip = () => {
    if (!hover) return
    const [x, y, s] = shown(hover)
    const half = tip.offsetWidth / 2 + 8,
      tx = Math.min(root.clientWidth - half, Math.max(half, (x - cropX) * k))
    tip.style.transform = `translate(${tx}px, ${(y - 40 * s - cropY) * k}px) translate(-50%, -100%)`
  }
  const pickAt = (mx, my) => {
    let best = null,
      bd = Infinity
    if (my > 750)
      for (const p of PEOPLE) {
        const [x, y, s] = shown(p)
        const d = Math.hypot(mx - x, (my - (y - 12 * s)) * 1.3)
        if (d < 26 * s && d < bd) {
          bd = d
          best = p
        }
      }
    return best
  }
  const setHover = (p) => {
    if (p === hover) return
    hover = p
    if (hover) showTip(hover)
    tip.classList.toggle('is-on', !!hover)
    root.classList.toggle('is-over-crowd', !!hover)
    if (still) paint(0, 0)
  }
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      const [mx, my] = toFrame(e)
      setHover(pickAt(mx, my))
      placeTip()
    }
  })
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') setHover(null)
  })
  // on touch, a tap on the crowd shows a person, a tap anywhere else hides them
  root.addEventListener('click', (e) => {
    if (e.target.closest('.sd__card')) return
    const [mx, my] = toFrame(e)
    setHover(pickAt(mx, my))
    placeTip()
  })

  const paint = (now, dt) => {
    placeCards(now)
    drawAura(now, dt)
    drawBeams(now)
    drawFront(now, dt)
    placeTip()
  }
  show(0, { quiet: true })

  if (still) {
    paint(0, 0)
    return {
      kill() {
        ro.disconnect()
      },
    }
  }

  // ---- motion: the crowd bobbing to a beat, haze drifting, the halo breathing, light and confetti
  const BEAT = 60000 / 118
  let last = 0
  const beat = (now, off) => Math.pow(Math.sin((((now + BEAT * off) % BEAT) / BEAT) * Math.PI), 2)
  const tick = () => {
    const now = performance.now(),
      dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    bobOf.near = -beat(now, 0) * 7 * (1 + burst)
    bobOf.mid = -beat(now, 0.3) * 4 * (1 + burst)
    bobOf.far = -beat(now, 0.6) * 2
    for (const kk of ['near', 'mid', 'far']) layer[kk].style.translate = `0 ${bobOf[kk].toFixed(2)}px`
    layer.haze.querySelector('.sd__l--haze').style.translate = `${(Math.sin(now / 5200) * 40).toFixed(1)}px 0`
    paint(now, dt)
  }
  const watch = ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      running = self.isActive
      if (running) {
        last = 0
        gsap.ticker.add(tick)
        loop()
      } else {
        gsap.ticker.remove(tick)
        clearTimeout(timer)
      }
    },
  })
  // scrolling pushes the camera in: near layers grow more than far ones, all toward the vanishing point
  const push = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: 0.6 } })
  for (const [key, , , , , , depth] of LAYERS) {
    layer[key].style.transformOrigin = `${VP[0]}px ${VP[1]}px`
    push.fromTo(layer[key], { scale: 1 }, { scale: 1 + depth * 1.4, ease: 'none' }, 0)
  }
  return {
    kill() {
      ro.disconnect()
      watch.kill()
      push.scrollTrigger?.kill()
      push.kill()
      gsap.ticker.remove(tick)
      clearTimeout(timer)
      spin?.kill()
    },
  }
}
