import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SPRITES } from './town-sprites.js'

// The town (a tile map): a 2D isometric city on a fixed grid, like a city-builder game. No 3D: the ground is one
// flat plane sheared into the 2:1 iso view, and every building is a painted sprite (public/sprites/city, warped onto the
// grid, see town-sprites.js) standing on a lot of exactly its footprint. Things are stacked back to front by their nearest
// corner, so nothing overlaps wrongly. One route's banner is painted onto four of the sprites in the four Meta sizes
// around the central crossroads. The camera starts close on the first, visits each size, then pulls back.
//
// Grid: one cell is 64 world px. Screen: x' = x - y, y' = (x + y) / 2 - z, so a cell is a 128 x 64 diamond.
// The map repeats every 10 cells: road (0), pavement (1), seven cells of lots (2 to 8), pavement (9).

const P = 10,
  M = 80,
  CELL = 64,
  CC = M / 2 // period, map size in cells, cell size, centre cell
const scr = (x, y, z = 0) => [x - y, (x + y) / 2 - z] // world px -> screen px
const depth = (x, y) => Math.round((x + y) * 4) // stacking order: further down the screen is nearer

const COPY = {
  proof: { b: 'Day 1.<br>Day 14.', short: 'Day 1.<br>Day 14.' },
  routine: { b: 'Two steps.<br>Morning and night.', short: 'Two steps.' },
}
const ad = (route, size) => {
  const wide = size === 's-191'
  return `<div class="ad ad--${route} ${size}"><span class="ad__brand">Sorrel &amp; Oat</span><b>${wide ? COPY[route].short : COPY[route].b}</b><span class="ad__pack"></span><span class="ad__cta">${wide ? 'Shop' : 'Shop the cleanser'}</span></div>`
}

// blank ad faces on the art, in sprite px: left and right x, top y at the left x, height, and which way the wall runs
// (+1: the wall faces down-left, its top edge falls to the right; -1: faces down-right, the top edge rises)
const PANELS = {
  'b-office-tower': { x1: 120, x2: 344, y1: 137, h: 587, s: 1 },
  'b-shop-row': { x1: 300, x2: 444, y1: 96, h: 76, s: -1 },
  's-billboard-wide': { x1: 80, x2: 592, y1: 284, h: 185, s: -1 },
  's-bus-shelter': { x1: 60, x2: 112, y1: 141, h: 106, s: 1 },
}

const seeded = (seed) => {
  const r = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 6; i++) r()
  return r
}

const TONES = {
  leaf: ['#8fc25e', '#6fa046', '#5a8a3a'],
  leaf2: ['#b4d877', '#8fb85a', '#77a048'],
  trunk: ['#a07a52', '#8a6a48', '#735638'],
  skin: ['#efc9a2', '#e2b48a', '#cf9f76'],
  glass: ['#f3f0ea', '#c9d5e6', '#aebdd3'],
  lamp: ['#fff4cf', '#f2d27a', '#d9b65c'],
  slab: ['#efe8da', '#d9cfbb', '#c7bca6'],
}
const tone = (c) => (Array.isArray(c) ? c : TONES[c] || [c, c, `color-mix(in srgb, ${c} 78%, black)`])

function build(world) {
  const frag = document.createDocumentFragment()
  const el = (cls, css = {}) => {
    const n = document.createElement('div')
    n.className = cls
    Object.assign(n.style, css)
    return n
  }
  const px = (v) => `${v}px`

  // the ground: one plane, sheared into the iso view; everything on it is laid out in cells
  const ground = el('t-ground', { width: px(M * CELL), height: px(M * CELL) })
  const flat = (cls, i, j, w, h) => {
    const n = el(`t-flat ${cls}`, { left: px(i * CELL), top: px(j * CELL), width: px(w * CELL), height: px(h * CELL) })
    ground.appendChild(n)
    return n
  }
  flat('t-grass', 0, 0, M, M)
  for (let k = 0; k < M; k += P) {
    flat('t-pave', 0, k - 1, M, 3)
    flat('t-pave', k - 1, 0, 3, M)
  }
  for (let k = 0; k < M; k += P) {
    flat('t-road', 0, k, M, 1)
    flat('t-road--v', k, 0, 1, M)
  }
  for (let i = 0; i < M; i += P) for (let j = 0; j < M; j += P) flat('t-cross', i, j, 1, 1)
  for (const ci of [CC - P, CC, CC + P])
    for (const cj of [CC - P, CC, CC + P]) {
      flat('t-zebra', ci - 1, cj, 1, 1)
      flat('t-zebra', ci + 1, cj, 1, 1)
      flat('t-zebra--v', ci, cj - 1, 1, 1)
      flat('t-zebra--v', ci, cj + 1, 1, 1)
    }
  world.appendChild(ground)

  // anything standing up is placed in screen px in one layer and stacked by depth
  const things = el('t-things')
  const put = (n, x, y) => {
    n.style.zIndex = depth(x, y)
    things.appendChild(n)
    return n
  }

  // a painted sprite on the lot i..i+W, j..j+D (cells); returns the element and its screen box
  // flip = true mirrors it: the same building seen from the other side, so its footprint turns (W and D swap)
  const sprite = (name, i, j, flip = false) => {
    const m = SPRITES[name]
    const W = flip ? m.D : m.W,
      D = flip ? m.W : m.D
    const fx = (i + W) * CELL,
      fy = (j + D) * CELL // the footprint's nearest corner
    const [X, Y] = scr(fx, fy)
    const ox = flip ? m.w - m.ox : m.ox
    const n = el(`t-sprite${flip ? ' is-flip' : ''}`, {
      left: px(X - ox / 2),
      top: px(Y - m.oy / 2),
      width: px(m.w / 2),
      height: px(m.h / 2),
    })
    const img = document.createElement('img')
    img.src = m.src
    img.alt = ''
    img.decoding = 'async'
    img.draggable = false
    img.loading = 'lazy'
    n.appendChild(img)
    put(n, fx, fy)
    return n
  }
  // paint an ad onto a sprite's blank panel, fitted at its own aspect ratio
  const paint = (host, name, route, size, target) => {
    const p = PANELS[name]
    const k = 0.5 // sprite px -> css px
    const dx = (p.x2 - p.x1) * k,
      H = p.h * k,
      L = dx * 1.118 // run across, height, true length along the wall
    const ar = { 's-11': 1, 's-45': 0.8, 's-916': 0.5625, 's-191': 1.91 }[size]
    let w = L * 0.9,
      h = w / ar
    if (h > H * 0.9) {
      h = H * 0.9
      w = h * ar
    }
    const u0 = (L - w) / 2 / 1.118,
      v0 = (H - h) / 2 // margins, in screen run and height
    const n = el('t-panel')
    n.innerHTML = ad(route, size)
    n.style.width = px(w)
    n.dataset.target = target
    const sx = 1 / 1.118,
      sy = (p.s * 0.5) / 1.118 // one px along the wall -> screen run and drop
    n.style.transform = `matrix(${sx}, ${sy}, 0, 1, ${p.x1 * k + u0}, ${p.y1 * k + p.s * 0.5 * u0 + v0})`
    host.appendChild(n)
    return n
  }

  // a small iso block (people, cars, trees until their art exists): top, south and east faces in screen space
  const box = ({ x, y, z = 0, w, d, h, c, parent }) => {
    const [t, s, e] = tone(c)
    const n = el('t-box')
    const face = (cls, bg, W, Hh, m) => {
      const f = el(cls, { width: px(W), height: px(Hh), background: bg, transform: `matrix(${m.join(',')})` })
      n.appendChild(f)
      return f
    }
    const [ax, ay] = scr(x, y, z + h)
    face('t-f', t, w, d, [1, 0.5, -1, 0.5, ax, ay])
    const [bx, by] = scr(x, y + d, z + h)
    face('t-f', s, w, h, [1, 0.5, 0, 1, bx, by])
    const [cx, cy] = scr(x + w, y, z + h)
    face('t-f', e, d, h, [-1, 0.5, 0, 1, cx, cy])
    if (parent) parent.appendChild(n)
    else put(n, x + w, y + d)
    return n
  }
  const tree = (x, y, k = 1) => {
    const g = el('t-group')
    box({ x: x - 4, y: y - 4, w: 8, d: 8, h: 14 * k, c: 'trunk', parent: g })
    box({
      x: x - 17 * k,
      y: y - 17 * k,
      w: 34 * k,
      d: 34 * k,
      h: 30 * k,
      z: 14 * k,
      c: k > 0.9 ? 'leaf' : 'leaf2',
      parent: g,
    })
    return put(g, x + 17 * k, y + 17 * k)
  }
  const cellTree = (i, j, k) => tree((i + 0.5) * CELL, (j + 0.5) * CELL, k)

  // which blocks the widest shot can see (the rest is never built)
  const seen = (bi, bj) => {
    const [X, Y] = scr((bi * P + 5 - CC) * CELL, (bj * P + 5 - CC) * CELL)
    return Math.abs(X) < 2300 && Y < 1400 && Y > -1650
  }

  // block plans, in lot cells 0..6 from the block's far corner. Every building sits on a lot of exactly its size.
  // the office tower and the shop row carry blank ad boards, so in the made-up blocks they are rare (most real
  // buildings have none); everything else is mirrored at random so neighbours don't repeat
  const BIG = ['b-market'] // the office tower's blank wall is only for the banner; a plain glass tower comes with its art
  const MIDS = ['b-gym', 'b-apartments', 'b-gym', 'b-apartments', 'b-gym', 'b-apartments', 'b-shop-row']
  const pick = (r, list) => list[Math.floor(r() * list.length)]
  const any = (r, name, i, j) => sprite(name, i, j, r() < 0.5)
  const PLANS = {
    houses: (r, i, j) => {
      flat('t-pave', i - 0.2, j + 2, 7.4, 1)
      flat('t-pave', i + 6, j - 0.2, 1, 7.4) // a walk between the rows, out to both pavements
      for (const a of [0, 2, 4])
        for (const b of [0, 3]) {
          if (r() < 0.12) {
            cellTree(i + a + 0.5, j + b + 0.5, 0.9)
            cellTree(i + a + 1.5, j + b + 1.4, 0.75)
            continue
          }
          any(r, r() < 0.5 ? 'b-house-a' : 'b-house-b', i + a, j + b)
        }
      for (const a of [1, 3, 5]) cellTree(i + a, j + 5.6, 0.8)
    },
    shops: (r, i, j) => {
      flat('t-plaza', i, j, 7, 7)
      any(r, pick(r, BIG), i, j)
      cellTree(i + 3.5, j + 1, 0.8)
      if (r() < 0.5) any(r, pick(r, BIG), i + 4, j)
      else {
        cellTree(i + 4.6, j + 0.8, 0.9)
        cellTree(i + 5.8, j + 2, 0.8)
      }
      // three mid-size lots along the near side, each 2 x 3 (or 3 x 2 when mirrored, so they are placed by footprint)
      for (const a of [0, 2.5, 5]) {
        const nm = pick(r, MIDS)
        sprite(nm, i + a, j + 4, false)
      }
    },
    flats: (r, i, j) => {
      flat('t-plaza', i, j, 7, 7)
      sprite(pick(r, MIDS), i, j)
      sprite(pick(r, MIDS), i + 2, j)
      any(r, pick(r, BIG), i + 4, j)
      any(r, pick(r, BIG), i, j + 4)
      sprite(pick(r, MIDS), i + 4, j + 4)
      cellTree(i + 3.4, j + 5, 0.9)
      cellTree(i + 6.4, j + 5.5, 0.8)
    },
    park: (r, i, j) => {
      flat('t-park', i, j, 7, 7)
      flat('t-pave', i - 0.2, j + 3, 7.4, 1)
      flat('t-pave', i + 3, j - 0.2, 1, 7.4) // paths across, to the fountain
      flat('t-pave', i + 2, j + 2, 3, 3)
      flat('t-pool', i + 2.5, j + 2.5, 2, 2)
      sprite('s-kiosk', i + 4.2, j + 4.2)
      ;[
        [0.6, 0.6],
        [1.8, 1.6],
        [5.6, 0.8],
        [4.8, 1.8],
        [0.8, 5.6],
        [5.8, 5.6],
        [1.6, 4.9],
      ].forEach(([a, b], t) => cellTree(i + a, j + b, 0.8 + (t % 3) * 0.15))
    },
  }
  const centre = new Set(['3,3', '4,3', '3,4', '4,4'])
  for (let bi = 0; bi < M / P; bi++)
    for (let bj = 0; bj < M / P; bj++) {
      if (centre.has(`${bi},${bj}`) || !seen(bi, bj)) continue
      const r = seeded(bi * 97 + bj * 31 + 11),
        v = r()
      const plan = v < 0.14 ? 'park' : v < 0.52 ? 'houses' : v < 0.78 ? 'shops' : 'flats'
      PLANS[plan](r, bi * P + 2, bj * P + 2)
    }

  // the four centre blocks carry the banners, each right by the middle crossroads (cells 38 to 42)
  // NW: the shop row's roof board, square (1:1)
  sprite('b-house-a', 32, 32)
  sprite('b-house-b', 34, 32)
  sprite('b-market', 32, 35)
  sprite('b-apartments', 36, 32)
  const shops = sprite('b-shop-row', 36, 35)
  paint(shops, 'b-shop-row', 'proof', 's-11', 0)
  cellTree(35.5, 37.5, 0.8)
  // SW: the bus shelter's poster, portrait (4:5), houses behind
  const stop = sprite('s-bus-shelter', 37, 42)
  paint(stop, 's-bus-shelter', 'proof', 's-45', 1)
  sprite('b-house-a', 32, 42)
  sprite('b-house-b', 34, 42)
  sprite('b-house-a', 32, 45)
  sprite('b-house-b', 34, 45)
  flat('t-pave', 31.8, 44, 6.4, 1)
  flat('t-pave', 36, 41.8, 1, 7.4)
  cellTree(37.5, 46.5, 0.9)
  cellTree(38.2, 48.2, 0.8)
  // NE: the office tower's wrap, story size (9:16)
  sprite('b-gym', 42, 32)
  sprite('b-shop-row', 45, 32)
  const tower = sprite('b-office-tower', 42, 35)
  paint(tower, 'b-office-tower', 'proof', 's-916', 2)
  sprite('b-apartments', 46, 35)
  // SE: the roadside board, landscape (1.91:1), on the edge of a little park with a café
  flat('t-park', 42, 42, 7, 7)
  const board = sprite('s-billboard-wide', 42, 42)
  paint(board, 's-billboard-wide', 'proof', 's-191', 3)
  flat('t-pave', 41.8, 45.5, 7.4, 1)
  flat('t-pave', 45.5, 41.8, 1, 7.4)
  flat('t-pave', 44.5, 44.5, 3, 3)
  flat('t-pool', 45, 45, 2, 2)
  sprite('s-kiosk', 47, 47)
  ;[
    [44.2, 42.5],
    [46.4, 42.6],
    [48.4, 43.5],
    [43, 47.2],
    [48.2, 45.6],
  ].forEach(([a, b], t) => cellTree(a, b, 0.8 + (t % 2) * 0.2))

  // movers: cars both ways on the roads near the middle, people on the pavements
  const movers = []
  const COLORS = ['#d2402b', '#1f5f9e', '#f7f5ef', '#2b2f2d', '#f2c650', '#5e7f3e', '#e98aa2', '#7d93a8']
  const vehicle = (along, c) => {
    const g = el('t-mover')
    const L = 58,
      Wd = 26
    const [w, d] = along === 'x' ? [L, Wd] : [Wd, L]
    box({ x: -w / 2, y: -d / 2, z: 3, w, d, h: 14, c, parent: g })
    box({
      x: -w / 2 + (along === 'x' ? 14 : 4),
      y: -d / 2 + (along === 'x' ? 4 : 14),
      z: 17,
      w: along === 'x' ? 26 : 18,
      d: along === 'x' ? 18 : 26,
      h: 11,
      c: 'glass',
      parent: g,
    })
    things.appendChild(g)
    return g
  }
  const rc = seeded(4242)
  for (let k = 0; k < M; k += P) {
    if (Math.abs(k - CC) > 2 * P) continue
    for (let n = 0; n < 4; n++) {
      const dir = n % 2 ? -1 : 1,
        start = ((n >> 1) * 0.5 + rc() * 0.4) % 1
      const lane = (k + (dir > 0 ? 0.72 : 0.28)) * CELL
      movers.push({ m: vehicle('x', COLORS[Math.floor(rc() * COLORS.length)]), axis: 'x', at: lane, dir, start })
      const laneV = (k + (dir > 0 ? 0.28 : 0.72)) * CELL
      movers.push({
        m: vehicle('y', COLORS[Math.floor(rc() * COLORS.length)]),
        axis: 'y',
        at: laneV,
        dir,
        start: (start + 0.37) % 1,
      })
    }
  }

  const people = []
  const body = (coat, hair, parent) => {
    box({ x: -4, y: -4, w: 8, d: 8, h: 18, c: coat, parent })
    return box({ x: -3.5, y: -3.5, z: 18, w: 7, d: 7, h: 8, c: [hair, TONES.skin[1], TONES.skin[2]], parent })
  }
  const COATS = ['#1f5f9e', '#d2402b', '#5e7f3e', '#2b2f2d', '#c4693f', '#e98aa2', '#f2c650', '#7d93a8']
  const rp = seeded(777)
  for (let n = 0; n < 30; n++) {
    const bi = 2 + Math.floor(rp() * 4),
      bj = 2 + Math.floor(rp() * 4)
    const horiz = rp() < 0.5,
      side = rp() < 0.5 ? -0.5 : 1.5 // the pavement either side of the road
    const at = ((horiz ? bj : bi) * P + side) * CELL
    const from = ((horiz ? bi : bj) * P + 2 + rp() * 3) * CELL
    const g = el('t-mover')
    body(COATS[n % COATS.length], '#3b2c22', g)
    things.appendChild(g)
    people.push({ m: g, axis: horiz ? 'x' : 'y', at, from, to: from + (2 + rp() * 2) * CELL })
  }

  // the speakers: someone by each banner who says that size's line in a speech bubble on the close shots
  const speakers = []
  const figure = (x, y, coat, hair, walk) => {
    const g = el('t-mover t-speaker')
    const head = body(coat, hair, g)
    things.appendChild(g)
    speakers.push({ m: g, head, x, y, walk })
  }
  figure(37.2 * CELL, 38.6 * CELL, '#d2402b', '#3b2c22', ['x', -1.2 * CELL]) // on the pavement in front of the shops
  figure(38.5 * CELL, 44.6 * CELL, '#1f5f9e', '#1d1d1f', ['y', -0.8 * CELL]) // at the bus stop, by the poster
  figure(43.5 * CELL, 38.6 * CELL, '#5e7f3e', '#8a6a48', ['x', 1.2 * CELL]) // under the tower
  figure(41.5 * CELL, 44.5 * CELL, '#c4693f', '#2b2f2d', ['y', 1.4 * CELL]) // by the roadside board

  world.appendChild(things)
  world.appendChild(frag)
  return { movers, people, speakers }
}

// place a mover at world (x, y): screen position and stacking
const place = (m, x, y) => {
  const [X, Y] = scr(x, y)
  m.style.transform = `translate(${X}px, ${Y}px)`
  m.style.zIndex = depth(x, y)
}

function life({ movers, people, speakers }) {
  const tl = gsap.timeline({ paused: true })
  const span = M * CELL
  speakers.forEach((s, k) => {
    const [ax, d] = s.walk
    const o = { t: 0 }
    place(s.m, s.x, s.y)
    tl.add(
      gsap.to(o, {
        t: 1,
        duration: 4 + k * 0.5,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        onUpdate: () => place(s.m, s.x + (ax === 'x' ? d * o.t : 0), s.y + (ax === 'y' ? d * o.t : 0)),
      }),
      0,
    )
  })
  movers.forEach(({ m, axis, at, dir, start }) => {
    const o = { t: 0 },
      dur = 30 + ((at * 7) % 13)
    const one = gsap.to(o, {
      t: 1,
      duration: dur,
      ease: 'none',
      repeat: -1,
      onUpdate: () => {
        const s = dir > 0 ? o.t * span : span - o.t * span
        if (axis === 'x') place(m, s, at)
        else place(m, at, s)
      },
    })
    one.progress(start)
    tl.add(one, 0)
  })
  people.forEach(({ m, axis, at, from, to }, k) => {
    const o = { t: 0 },
      dur = 9 + (k % 7) * 1.6
    const one = gsap.to(o, {
      t: 1,
      duration: dur,
      ease: 'none',
      repeat: -1,
      yoyo: true,
      onUpdate: () => {
        const s = from + (to - from) * o.t
        if (axis === 'x') place(m, s, at)
        else place(m, at, s)
      },
    })
    one.totalTime((k * 3.7) % (dur * 2))
    tl.add(one, 0)
  })
  return tl
}

export function town(section, { still = false } = {}) {
  if (!section) return null
  const pin = section.querySelector('.town__pin')
  const stage = section.querySelector('.town__stage')
  const camera = section.querySelector('[data-camera]')
  const world = section.querySelector('[data-world]')
  const items = [...section.querySelectorAll('[data-size]')]
  const parts = build(world)
  const faces = [0, 1, 2, 3].map((i) => world.querySelector(`[data-target="${i}"]`))

  // camera maths: with no camera transform the world sits 1:1 in the stage centre; translate then scale about it
  // shot 0 is the whole town across the full width; shots 1 to 4 are close on each banner
  let shots = []
  const measure = () => {
    const prev = camera.style.transform
    camera.style.transform = 'none'
    const sr = stage.getBoundingClientRect()
    const cx = sr.left + sr.width / 2,
      cy = sr.top + sr.height / 2
    const W = sr.width,
      H = sr.height,
      wide = W >= 1024
    const ox = wide ? W * 0.05 : 0,
      oy = wide ? H * 0.04 : -H * 0.1
    const s0 = Math.max(W / 2 / 1950, H / 2 / 1200) // the smallest scale at which the built part of the city covers the stage
    shots = [{ x: 0, y: H * 0.03, scale: s0 }]
    faces.forEach((f) => {
      const r = f.getBoundingClientRect()
      const dx = r.left + r.width / 2 - cx,
        dy = r.top + r.height / 2 - cy
      const S = Math.min(1.7, (H * (wide ? 0.48 : 0.34)) / r.height, (W * (wide ? 0.42 : 0.74)) / r.width)
      shots.push({ x: ox - S * dx, y: oy - S * dy, scale: S })
    })
    camera.style.transform = prev
  }
  measure()
  const shot = (i, k) => () => {
    if (!shots.length) measure()
    return shots[i][k]
  }
  const at = (i) => ({ x: shot(i, 'x'), y: shot(i, 'y'), scale: shot(i, 'scale') })

  const tl = life(parts)

  // speech bubbles, in screen space, following the speaker's head
  const LINES = [
    ['Every route,', '1080 × 1080 · Feed, square'],
    ['in every size.', '1080 × 1350 · Feed, portrait'],
    ['One route, refitted for each placement.', '1080 × 1920 · Stories and Reels'],
    ['Change it once. Every size follows.', '1200 × 628 · Landscape'],
  ]
  const talk = document.createElement('div')
  talk.className = 'town__talk'
  talk.setAttribute('aria-hidden', 'true')
  talk.innerHTML = LINES.map(
    ([a, b]) => `<div class="bubble"><div class="bubble__in"><b>${a}</b><span class="mono">${b}</span></div></div>`,
  ).join('')
  pin.appendChild(talk)
  const bubbles = [...talk.children]
  let speaking = 0
  const follow = () => {
    const pr = pin.getBoundingClientRect()
    bubbles.forEach((bb, i) => {
      bb.classList.toggle('is-on', i === speaking)
      if (i !== speaking) return
      const h = parts.speakers[i].head.getBoundingClientRect(),
        f = faces[i].getBoundingClientRect()
      let x = h.left + h.width / 2 - pr.left
      const y = h.top - pr.top
      const left = h.left + h.width / 2 < f.left + f.width / 2 // the speaker stands left of the banner: talk to the left, away from it
      bb.classList.toggle('is-left', left)

      bb.style.transform = `translate(${x}px, ${y}px)`
    })
  }
  const talking = parts.speakers.map(({ head }) =>
    gsap.to(head, { y: -4, duration: 0.2, repeat: -1, yoyo: true, ease: 'sine.inOut', paused: true }),
  )
  const speak = (i) => {
    if (i === speaking) return
    speaking = i
    follow()
    talking.forEach((t, k) => {
      if (k === i) t.play()
      else {
        t.pause()
        gsap.to(parts.speakers[k].head, { y: 0, duration: 0.2 })
      }
    })
    parts.speakers.forEach(({ m }, k) => m.classList.toggle('is-talking', k === i))
  }

  if (still) {
    gsap.set(camera, at(0))
    items.forEach((li) => li.classList.add('is-on'))
    section.classList.add('is-wide')
    speaking = -1
    follow()
    const onResize = () => {
      measure()
      gsap.set(camera, at(0))
    }
    window.addEventListener('resize', onResize)
    return {
      kill() {
        window.removeEventListener('resize', onResize)
      },
    }
  }

  const onRefreshInit = () => {
    measure()
  }
  ScrollTrigger.addEventListener('refreshInit', onRefreshInit)

  const mark = (i) => items.forEach((li, k) => li.classList.toggle('is-on', k === i))
  const marks = []
  mark(0)
  const cam = gsap.timeline({
    defaults: { ease: 'power2.inOut', duration: 1 },
    scrollTrigger: {
      trigger: pin,
      start: 'top top',
      end: '+=160%',
      pin: true,
      scrub: 1,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const t = self.progress * cam.duration()
        let on = -1
        marks.forEach(([a, b, i]) => {
          if (t >= a && t < b) on = i
        })
        const wideNow = t > marks[marks.length - 1][1]
        section.classList.toggle('is-wide', wideNow)
        if (wideNow) {
          items.forEach((li) => li.classList.add('is-on'))
          speak(-1)
        } else {
          mark(on)
          if (on >= 0) speak(on)
          else speak(-1)
        }
      },
    },
  })
  // start close on the first size, visit the others, then pull back over the whole town
  cam.set(camera, at(1), 0).to({}, { duration: 0.6 })
  marks.push([0, 0.9, 0])
  for (let i = 2; i <= 4; i++) {
    const a = cam.duration()
    cam.to(camera, at(i))
    cam.to({}, { duration: 0.6 })
    marks.push([a + 0.5, cam.duration() + 0.4, i - 1])
  }
  cam.to(camera, { ...at(0), duration: 1.4, ease: 'power3.inOut' }).to({}, { duration: 0.5 })

  // keep the city moving the whole time it is on screen. Made after the pin, so its end counts the pinned scroll
  // shown a screen early, so its first paint happens off screen
  const watch = ScrollTrigger.create({
    trigger: section,
    start: 'top bottom+=100%',
    end: 'bottom top-=50%',
    refreshPriority: -1,
    onToggle: (self) => {
      tl.paused(!self.isActive)
      world.style.visibility = self.isActive ? '' : 'hidden'
      if (self.isActive) gsap.ticker.add(follow)
      else gsap.ticker.remove(follow)
    },
  })
  if (watch.isActive) gsap.ticker.add(follow)
  if (!watch.isActive) world.style.visibility = 'hidden' // off screen, the browser skips the whole city

  return {
    kill() {
      tl.kill()
      watch.kill()
      gsap.ticker.remove(follow)
      cam.scrollTrigger?.kill()
      cam.kill()
      ScrollTrigger.removeEventListener('refreshInit', onRefreshInit)
    },
  }
}
