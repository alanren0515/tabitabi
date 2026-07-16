export function matchesExpected(candidate, expected = {}) {
  if (expected.placeId && candidate.placeId === expected.placeId) return true;
  const expectedNames = expected.nameAnyOf?.length ? expected.nameAnyOf : expected.nameIncludes ? [expected.nameIncludes] : [];
  const nameMatches = !expectedNames.length || expectedNames.some((name) => normalize(candidate.name).includes(normalize(name)));
  const addressMatches = !expected.addressIncludes || normalize(candidate.address).includes(normalize(expected.addressIncludes));
  return nameMatches && addressMatches;
}

export function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ヶヵ]/g, "ケ")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/(\d+)丁目/g, "$1-")
    .replace(/(\d+)番地?/g, "$1-")
    .replace(/(\d+)号/g, "$1")
    .replace(/-+/g, "-")
    .replace(/\s+/g, "");
}

export function classifyCandidateFailure(candidates, expected = {}) {
  if (!candidates.length) return "no_candidates";
  if (expected.placeId && !candidates.some((candidate) => candidate.placeId === expected.placeId)) return "expected_place_id_missing";
  const expectedNames = expected.nameAnyOf?.length ? expected.nameAnyOf : expected.nameIncludes ? [expected.nameIncludes] : [];
  const nameCandidate = candidates.find((candidate) => !expectedNames.length || expectedNames.some((name) => normalize(candidate.name).includes(normalize(name))));
  if (!nameCandidate) return "name_mismatch";
  if (expected.addressIncludes && !normalize(nameCandidate.address).includes(normalize(expected.addressIncludes))) return "branch_or_address_mismatch";
  return "unclassified_mismatch";
}
