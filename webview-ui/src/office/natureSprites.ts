/**
 * Nature sprite instance factory — converts tree T/R tile pairs and Lena's
 * hand-placed design elements into FurnitureInstances for z-sorted rendering.
 *
 * Trees are sprite instances (not floor tiles) so they z-sort correctly with
 * characters — a player walking behind a tree is occluded by the canopy.
 *
 * Pattern mirrors buildingSprites.ts: module-level state, set* initializer,
 * accessor functions.
 */

import type { FurnitureInstance, SpriteData, TileType as TileTypeVal } from './types.js'
import { TileType, TILE_SIZE } from './types.js'
import type { LoadedTileset } from './tilesetLoader.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NaturePlacement {
  type: 'rock' | 'flower' | 'tree'
  spriteId: string
  col: number
  row: number
  /** For multi-tile rocks: width in tiles */
  w?: number
  /** For multi-tile rocks: height in tiles */
  h?: number
}

// ---------------------------------------------------------------------------
// Lena's binding directives — hand-placed nature elements
// ---------------------------------------------------------------------------

const LENA_PLACEMENTS: NaturePlacement[] = [
  // Directive #1: Sentinel rocks near Keeper's Archive (33,16) — 1×1
  { type: 'rock', spriteId: 'rock1', col: 33, row: 16 },
  // Directive #2: Weathered rocks near pond (37,25) — 1×1
  { type: 'rock', spriteId: 'rock2', col: 37, row: 25 },
  // Directive #3: Rock cluster southeast meadow (33,6)-(34,7) — 2×2
  { type: 'rock', spriteId: 'rock3', col: 33, row: 6 },
  { type: 'rock', spriteId: 'rock1', col: 34, row: 7 },
  // Directive #5: Wildflower patch at (30,9) — 1×1
  { type: 'flower', spriteId: 'flower_pot', col: 30, row: 9 },
  // Directive #6: Focal tree at Lena's Cathedral (27,3) — placed as sprite instance
  { type: 'tree', spriteId: 'tree1', col: 27, row: 3 },
]

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Tree instances ready for z-sorted rendering */
let treeInstances: FurnitureInstance[] = []

/** Shadow instances (rendered behind trees) */
let shadowInstances: FurnitureInstance[] = []

/** Rock/flower instances from Lena's placements */
let rockInstances: FurnitureInstance[] = []

/** Set of encoded tile positions covered by nature sprites (row * 256 + col) */
let coveredNatureTiles: Set<number> | null = null

/** Encoding factor — must exceed max possible column count */
const ENCODE_FACTOR = 256

/** Water dot animation frames */
let waterDotFrames: SpriteData[] = []
let waterAnimTimer = 0
let waterFrameIndex = 0
const WATER_FRAME_DURATION = 0.2 // 200ms per frame

/** Positions blocked by placed nature elements (for collision) */
let natureBlockedPositions: Set<string> | null = null

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Initialize nature sprites from a loaded tileset and the tile map.
 * Scans for T/R tile pairs to create tree instances, loads Lena's placements,
 * and prepares water animation frames.
 */
export function setNatureTileset(tileset: LoadedTileset, tileMap: TileTypeVal[][]): void {
  treeInstances = []
  shadowInstances = []
  rockInstances = []
  coveredNatureTiles = new Set<number>()
  natureBlockedPositions = new Set<string>()
  waterDotFrames = []
  waterAnimTimer = 0
  waterFrameIndex = 0

  const treeSprite = tileset.natureSprites.get('tree1')
  const shadowSprite = tileset.natureSprites.get('tree_shadow')

  // --- Scan grid for T/R tree pairs ---
  if (treeSprite) {
    const rows = tileMap.length
    const cols = rows > 0 ? tileMap[0].length : 0
    // Track which T tiles have already been consumed by a 2-wide tree
    const consumed = new Set<number>()

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (tileMap[r][c] !== TileType.FLOOR_5) continue // Not a T tile
        if (consumed.has(r * ENCODE_FACTOR + c)) continue
        if (tileMap[r + 1][c] !== TileType.FLOOR_6) continue // No R below

        // Check for 2-wide tree: T at (c,r) and T at (c+1,r) with R below both
        const is2Wide = c + 1 < cols &&
          tileMap[r][c + 1] === TileType.FLOOR_5 &&
          tileMap[r + 1][c + 1] === TileType.FLOOR_6 &&
          !consumed.has(r * ENCODE_FACTOR + c + 1)

        const spriteH = treeSprite.length
        const spriteW = treeSprite[0]?.length ?? TILE_SIZE

        if (is2Wide) {
          // Center tree sprite over 2×2 block
          const blockCenterX = (c + 1) * TILE_SIZE // center of 2-col block
          const trunkBottom = (r + 2) * TILE_SIZE  // bottom of R row

          const x = blockCenterX - spriteW / 2
          const y = trunkBottom - spriteH
          const zY = trunkBottom

          treeInstances.push({ sprite: treeSprite, x, y, zY })

          if (shadowSprite) {
            shadowInstances.push({
              sprite: shadowSprite,
              x: blockCenterX - (shadowSprite[0]?.length ?? TILE_SIZE) / 2,
              y: trunkBottom - shadowSprite.length,
              zY: trunkBottom - 1, // shadow renders just behind trunk
            })
          }

          // Mark all 4 tiles as covered
          for (const dr of [0, 1]) {
            for (const dc of [0, 1]) {
              coveredNatureTiles.add((r + dr) * ENCODE_FACTOR + (c + dc))
              natureBlockedPositions.add(`${c + dc},${r + dr}`)
            }
          }
          consumed.add(r * ENCODE_FACTOR + c)
          consumed.add(r * ENCODE_FACTOR + c + 1)
        } else {
          // Single 1×2 tree (T on top, R on bottom)
          const trunkBottom = (r + 2) * TILE_SIZE
          const tileCenterX = c * TILE_SIZE + TILE_SIZE / 2

          const x = tileCenterX - spriteW / 2
          const y = trunkBottom - spriteH
          const zY = trunkBottom

          treeInstances.push({ sprite: treeSprite, x, y, zY })

          if (shadowSprite) {
            shadowInstances.push({
              sprite: shadowSprite,
              x: tileCenterX - (shadowSprite[0]?.length ?? TILE_SIZE) / 2,
              y: trunkBottom - shadowSprite.length,
              zY: trunkBottom - 1,
            })
          }

          // Mark T and R tiles as covered
          coveredNatureTiles.add(r * ENCODE_FACTOR + c)
          coveredNatureTiles.add((r + 1) * ENCODE_FACTOR + c)
          natureBlockedPositions.add(`${c},${r}`)
          natureBlockedPositions.add(`${c},${r + 1}`)
          consumed.add(r * ENCODE_FACTOR + c)
        }
      }
    }
  }

  // --- Lena's placements ---
  for (const placement of LENA_PLACEMENTS) {
    const sprite = tileset.natureSprites.get(placement.spriteId)
    if (!sprite) continue

    if (placement.type === 'tree' && treeSprite) {
      // Focal tree: bottom-align at placement row + 2 (tree needs 2 tile heights)
      const spriteH = treeSprite.length
      const spriteW = treeSprite[0]?.length ?? TILE_SIZE
      const trunkBottom = (placement.row + 2) * TILE_SIZE
      const tileCenterX = placement.col * TILE_SIZE + TILE_SIZE / 2

      const x = tileCenterX - spriteW / 2
      const y = trunkBottom - spriteH
      const zY = trunkBottom

      treeInstances.push({ sprite: treeSprite, x, y, zY })

      if (shadowSprite) {
        shadowInstances.push({
          sprite: shadowSprite,
          x: tileCenterX - (shadowSprite[0]?.length ?? TILE_SIZE) / 2,
          y: trunkBottom - shadowSprite.length,
          zY: trunkBottom - 1,
        })
      }

      // Block the 2 tiles under the tree
      natureBlockedPositions.add(`${placement.col},${placement.row}`)
      natureBlockedPositions.add(`${placement.col},${placement.row + 1}`)
    } else {
      // Rock or flower: bottom-align sprite at tile bottom
      const spriteH = sprite.length
      const spriteW = sprite[0]?.length ?? TILE_SIZE
      const tileBottom = (placement.row + 1) * TILE_SIZE
      const tileCenterX = placement.col * TILE_SIZE + TILE_SIZE / 2

      const x = tileCenterX - spriteW / 2
      const y = tileBottom - spriteH
      const zY = tileBottom

      rockInstances.push({ sprite, x, y, zY })

      // Rocks block walking
      if (placement.type === 'rock') {
        natureBlockedPositions.add(`${placement.col},${placement.row}`)
      }
    }
  }

  // --- Water dot animation frames ---
  for (let i = 1; i <= 5; i++) {
    const dotSprite = tileset.natureSprites.get(`water_dot_${i}`)
    if (dotSprite) waterDotFrames.push(dotSprite)
  }

  const treeCount = treeInstances.length
  const rockCount = rockInstances.length
  const waterCount = waterDotFrames.length
  if (treeCount > 0 || rockCount > 0 || waterCount > 0) {
    console.log(`[NatureSprites] ${treeCount} trees, ${rockCount} rocks/flowers, ${waterCount} water frames`)
  }
}

// ---------------------------------------------------------------------------
// Water animation
// ---------------------------------------------------------------------------

/** Tick the water dot animation timer. Call from game update loop. */
export function tickWaterAnimation(dt: number): void {
  if (waterDotFrames.length === 0) return
  waterAnimTimer += dt
  if (waterAnimTimer >= WATER_FRAME_DURATION) {
    waterAnimTimer -= WATER_FRAME_DURATION
    waterFrameIndex = (waterFrameIndex + 1) % waterDotFrames.length
  }
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Check if any nature sprites have been loaded */
export function hasNatureSprites(): boolean {
  return treeInstances.length > 0 || rockInstances.length > 0 || waterDotFrames.length > 0
}

/** Get all tree FurnitureInstances for z-sorted rendering */
export function getTreeInstances(): FurnitureInstance[] {
  return treeInstances
}

/** Get shadow FurnitureInstances (render behind trees) */
export function getShadowInstances(): FurnitureInstance[] {
  return shadowInstances
}

/** Get all rock/flower FurnitureInstances for z-sorted rendering */
export function getRockInstances(): FurnitureInstance[] {
  return rockInstances
}

/** Check if a tile at (col, row) is covered by a nature sprite */
export function isCoveredNatureTile(col: number, row: number): boolean {
  if (!coveredNatureTiles) return false
  return coveredNatureTiles.has(row * ENCODE_FACTOR + col)
}

/** Get the current water dot sprite frame (or null if no animation loaded) */
export function getWaterDotSprite(): SpriteData | null {
  if (waterDotFrames.length === 0) return null
  return waterDotFrames[waterFrameIndex]
}

/** Get positions blocked by placed nature elements (for collision merging) */
export function getNatureBlockedPositions(): Set<string> {
  return natureBlockedPositions ?? new Set()
}
