// Single source of truth for feature visibility. Unhiding a feature is a one-line change here
// -- keep this file's diffs to that one line so merges from feature branches stay conflict-free.
export const FEATURES = {
  travelClaim: true// set true on the travel-claim branch
} as const;
