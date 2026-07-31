// Packaged (repackaged) volumes for ships, in m³.
//
// The SDE's per-type `volume` is the *assembled* hull volume (a Rifter is 27,289 m³
// assembled). Ships are bought and hauled **packaged**, where the volume is a fixed
// constant per ship group (every Frigate repackages to 2,500 m³, every Battleship to
// 50,000 m³, …). That per-group table used to live in the SDE's `invVolumes`; it was
// dropped from the JSONL SDE, and ESI exposes the same numbers as `packaged_volume`.
//
// This map was derived programmatically from ESI `packaged_volume` over **all** published
// category-6 (Ship) types — one dominant value per group, plus the handful of intra-group
// exceptions listed below. Keying by group (not type) means new ships added to an existing
// group inherit the right volume automatically. Verify/regenerate against ESI if CCP ever
// introduces a new ship group.

/** groupID → packaged volume (m³) for every ship group. */
export const SHIP_GROUP_PACKAGED_VOLUME: Record<number, number> = {
  25: 2500, // Frigate
  26: 10000, // Cruiser
  27: 50000, // Battleship
  28: 20000, // Hauler
  29: 500, // Capsule
  30: 10000000, // Titan
  31: 500, // Shuttle
  237: 2500, // Corvette
  324: 2500, // Assault Frigate
  358: 10000, // Heavy Assault Cruiser
  380: 20000, // Deep Space Transport
  419: 15000, // Combat Battlecruiser
  420: 5000, // Destroyer
  463: 3750, // Mining Barge
  485: 1300000, // Dreadnought
  513: 1300000, // Freighter
  540: 15000, // Command Ship
  541: 5000, // Interdictor
  543: 3750, // Exhumer
  547: 1300000, // Carrier
  659: 1300000, // Supercarrier
  830: 2500, // Covert Ops
  831: 2500, // Interceptor
  832: 10000, // Logistics
  833: 10000, // Force Recon Ship
  834: 2500, // Stealth Bomber
  883: 1300000, // Capital Industrial Ship
  893: 2500, // Electronic Attack Ship
  894: 10000, // Heavy Interdiction Cruiser
  898: 50000, // Black Ops
  900: 50000, // Marauder
  902: 1300000, // Jump Freighter
  906: 10000, // Combat Recon Ship
  941: 500000, // Industrial Command Ship (Orca; Porpoise overridden below)
  963: 5000, // Strategic Cruiser
  1022: 500, // Prototype Exploration Ship
  1201: 15000, // Attack Battlecruiser
  1202: 20000, // Blockade Runner
  1283: 2500, // Expedition Frigate
  1305: 5000, // Tactical Destroyer
  1527: 2500, // Logistics Frigate
  1534: 5000, // Command Destroyer
  1538: 1300000, // Force Auxiliary
  1972: 10000, // Flag Cruiser
  4594: 1300000, // Lancer Dreadnought
  4902: 50000, // Expedition Command Ship
  5087: 10000, // Special Edition Yachts
  5120: 1300000, // Command Carrier
};

/** typeID → packaged volume (m³) for the rare ship that differs from its group's value. */
export const SHIP_TYPE_PACKAGED_VOLUME: Record<number, number> = {
  42244: 50000, // Porpoise — a smaller Industrial Command Ship (group repackages to 500,000)
};

/**
 * The volume (m³) a single unit occupies as bought/hauled: a ship's packaged volume when
 * we know it (per-type override first, then per-group), otherwise `null` so the caller
 * falls back to the SDE assembled `volume`. Non-ship types always return `null`.
 */
export function packagedVolumeFor(typeId: number, groupId: number): number | null {
  const byType = SHIP_TYPE_PACKAGED_VOLUME[typeId];
  if (byType !== undefined) return byType;
  const byGroup = SHIP_GROUP_PACKAGED_VOLUME[groupId];
  if (byGroup !== undefined) return byGroup;
  return null;
}
