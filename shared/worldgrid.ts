/** shared/worldgrid.ts (new). Pure world helpers: the same cells and island sizes for the server's desks and the client's map. */
export const PIER_CELL = { col: 0, row: 1 } as const;

export const ISLAND_TIERS = [
  { size: 9, seats: 6 }, { size: 10, seats: 12 }, { size: 12, seats: 21 }, { size: 14, seats: 31 },
] as const;

export function tierFor(seatsNeeded: number): (typeof ISLAND_TIERS)[number] {
  return ISLAND_TIERS.find((t) => t.seats >= seatsNeeded) ?? ISLAND_TIERS[ISLAND_TIERS.length - 1]!;
}
