// Closed roster of travellers eligible for Travel Request (102 people as of writing), sourced
// from HR. To add, remove, or update a traveller, edit travellers.json directly -- there is no
// manual-entry path in the UI, by design (see Fix 2 of the Name-of-traveller combobox).
import travellersData from "./travellers.json";

export interface Traveller {
  id: string;
  name: string;
  team: string;
  position: string;
  dutyStation: string;
}

export const TRAVELLERS: Traveller[] = travellersData;

const TRAVELLER_BY_NAME = new Map(TRAVELLERS.map((t) => [t.name, t]));

export function findTraveller(name: string): Traveller | undefined {
  return TRAVELLER_BY_NAME.get(name);
}
