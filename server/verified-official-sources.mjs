const VERIFIED_OFFICIAL_SOURCES = [
  {
    nameIncludes: ["肉ときどきレモンサワー", "肉ときどきレモンサワー。"],
    addressIncludes: ["東京都台東区上野6-13-2", "台東区上野6丁目13-2", "上野6132渡辺上野ビル4F"],
    url: "https://store.gosso.co.jp/detail/nikulemon_ueno/",
    label: "肉ときどきレモンサワー。上野駅前店官方门店页",
    verifiedAt: "2026-07-14"
  },
  {
    nameIncludes: ["串かつだるま", "串カツだるま"],
    addressIncludes: ["恵美須東2丁目3-9", "恵美須東23-9"],
    url: "https://www.kushikatu-daruma.com/location/shinsekai",
    label: "串かつだるま官方门店页",
    verifiedAt: "2026-07-13"
  },
  {
    nameIncludes: ["ＭＫレストラン 佐世保大塔店", "MKレストラン 佐世保大塔店"],
    addressIncludes: ["長崎県佐世保市大塔町18-16", "佐世保市大塔町1816"],
    url: "https://store.mkrestaurants.co.jp/b/mkrestaurants/info/70007/",
    label: "MKレストラン官方门店页",
    verifiedAt: "2026-07-13"
  },
  {
    nameIncludes: ["つるとんたん", "TsuruTonTan"],
    addressIncludes: ["東京都港区六本木7-8-6", "六本木7丁目8-6", "六本木786"],
    url: "https://www.tsurutontan.co.jp/shop/roppongi/",
    label: "つるとんたん六本木店官方门店页",
    verifiedAt: "2026-07-13"
  }
];

export function findVerifiedOfficialSource(place) {
  const name = normalize(place?.name);
  const address = normalize(place?.address);
  return VERIFIED_OFFICIAL_SOURCES.find((source) =>
    source.nameIncludes.some((value) => name.includes(normalize(value)))
      && source.addressIncludes.some((value) => address.includes(normalize(value)))
  ) || null;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s〒‐‑‒–—―−ー丁目番地号]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}
