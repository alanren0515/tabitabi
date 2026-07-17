import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceGatedDecision, buildPlanAdvisory } from "../server/decision-engine.mjs";

test("recommends opening a verified direct reservation flow without claiming availability", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", officiality: "linked_from_restaurant_website", capability: { kind: "online_reservation_flow", certainty: "high" } }]
  });
  assert.equal(decision.recommendation, "recommended");
  assert.match(decision.summary, /予約ページ/);
  assert.match(decision.evidence[0].limitation, /希望日の空席/);
});

test("describes a verified same-origin official booking flow without duplicated wording", () => {
  const result = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{
      id: "official_booking",
      provider: "official_booking",
      label: "官网预约",
      officiality: "linked_from_restaurant_website",
      capability: { kind: "online_reservation_flow", certainty: "high" }
    }]
  });
  assert.equal(result.recommendation, "recommended");
  assert.match(result.summary, /店舗公式サイトの予約ページ/);
  assert.doesNotMatch(result.summary, /予約予約/);
  assert.match(result.nextAction, /店舗公式の予約ページ/);
});

test("blocks a booking flow when a high-risk store identity conflict is unresolved", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", officiality: "reservation_platform", capability: { kind: "online_reservation_flow", certainty: "medium" } }],
    conflicts: [{ field: "address", severity: "high", resolvedByOfficial: false, message: "输入地址与当前地址不一致。" }],
    facts: [{ id: "google:address:1", field: "address" }, { id: "user:address:2", field: "address" }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.match(decision.nextAction, /同じ店舗と確認/);
  assert.deepEqual(decision.evidence[0].factIds, ["google:address:1", "user:address:2"]);
});

test("allows a verified current booking flow while warning that the input address is old", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", officiality: "linked_from_restaurant_website", capability: { kind: "online_reservation_flow", certainty: "high" } }],
    conflicts: [{ field: "address", severity: "high", resolvedByOfficial: true, message: "原内容可能发布于迁址前。" }]
  });
  assert.equal(decision.recommendation, "recommended");
  assert.equal(decision.confidence, "high");
  assert.match(decision.summary, /旧住所/);
  assert.match(decision.nextAction, /公式サイトの現住所/);
});

test("does not infer reservation rules from ratings or a platform listing", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL", rating: 4.9, userRatingCount: 10000 },
    reservationOptions: [{ id: "hotpepper", label: "Hot Pepper", capability: { kind: "platform_listing", primaryLabel: "核对" } }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.match(decision.evidence[0].limitation, /評価点.*予約ルールを推測しません/);
});

test("closed status overrides remaining third-party links", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "CLOSED_PERMANENTLY" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", capability: { kind: "online_reservation_flow", certainty: "high" } }],
    facts: [{ id: "google_places:business_status:1", field: "business_status" }]
  });
  assert.equal(decision.recommendation, "temporarily_unavailable");
  assert.deepEqual(decision.evidence[0].factIds, ["google_places:business_status:1"]);
});

test("temporary closure also blocks booking actions without claiming a reopen date", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "CLOSED_TEMPORARILY" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", capability: { kind: "online_reservation_flow", certainty: "high" } }],
    facts: [{ id: "google_places:business_status:temporary", field: "business_status" }]
  });
  assert.equal(decision.recommendation, "temporarily_unavailable");
  assert.match(decision.summary, /営業再開日は改めて確認/);
  assert.match(decision.nextAction, /最新の営業状況/);
});

test("uses an explicit official no-reservations rule for a conservative walk-in decision", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "not_accepted", certainty: "high" },
    facts: [{ id: "official:policy:1", field: "reservation_policy" }]
  });
  assert.equal(decision.recommendation, "walk_in_ok");
  assert.match(decision.queue, /待ち時間不明/);
  assert.deepEqual(decision.evidence[0].factIds, ["official:policy:1"]);
  assert.match(decision.evidence[0].limitation, /希望時間の営業や空席は保証しません/);
});

test("uses an explicit official queue mode while keeping availability and wait time unknown", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "not_accepted", certainty: "high" },
    queuePolicy: { mode: "numbered_ticket", label: "整理券取号", certainty: "high" },
    facts: [{ id: "official:policy:1", field: "reservation_policy" }, { id: "official:queue:1", field: "queue_policy" }]
  });
  assert.equal(decision.recommendation, "walk_in_ok");
  assert.equal(decision.queue, "整理券取号");
  assert.match(decision.summary, /来店時の空席/);
  assert.match(decision.nextAction, /整理券配布時間と場所/);
  assert.deepEqual(decision.evidence[1].factIds, ["official:queue:1"]);
  assert.match(decision.evidence[1].limitation, /現在の待ち時間は推定できません/);
});

test("shows a verified queue rule without inferring whether reservations are open", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    queuePolicy: { mode: "name_list", label: "到店登记姓名", certainty: "high" },
    facts: [{ id: "official:queue:2", field: "queue_policy" }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.equal(decision.queue, "到店登记姓名");
  assert.match(decision.summary, /予約受付の有無は確認できません/);
  assert.match(decision.nextAction, /名前を記入/);
  assert.deepEqual(decision.evidence[0].factIds, ["official:queue:2"]);
});

test("returns unknown when an official no-reservations rule conflicts with a direct booking flow", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "not_accepted", certainty: "high" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", capability: { kind: "online_reservation_flow", certainty: "high" } }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.match(decision.summary, /安全に判断できません/);
  assert.match(decision.evidence[0].limitation, /特定店舗/);
});

test("keeps a limited official reservation rule unknown when no direct flow is verified", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "limited", label: "仅平日接受预约", certainty: "high" },
    facts: [{ id: "official:policy:limited", field: "reservation_policy" }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.equal(decision.queue, "予約条件あり");
  assert.match(decision.summary, /仅平日接受预约/);
  assert.match(decision.nextAction, /対象日、時間帯、人数/);
  assert.deepEqual(decision.evidence[0].factIds, ["official:policy:limited"]);
});

test("preserves an official reservation restriction beside a verified booking flow", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "limited", label: "午餐时段不接受预约", certainty: "high" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", officiality: "linked_from_restaurant_website", capability: { kind: "online_reservation_flow", certainty: "high" } }],
    facts: [{ id: "official:policy:lunch", field: "reservation_policy" }]
  });
  assert.equal(decision.recommendation, "recommended");
  assert.match(decision.summary, /午餐时段不接受预约/);
  assert.match(decision.nextAction, /条件を確認/);
  assert.deepEqual(decision.evidence[1].factIds, ["official:policy:lunch"]);
});

test("distinguishes a provider-managed request from an already confirmed reservation", () => {
  const result = buildEvidenceGatedDecision({
    place: { name: "Demo", businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "autoreserve", label: "AutoReserve", capability: { kind: "provider_booking_flow", certainty: "medium" } }]
  });
  assert.equal(result.recommendation, "recommended");
  assert.match(result.summary, /送信だけでは予約成立になりません/);
  assert.match(result.nextAction, /明確な予約確認/);
});

test("does not recommend an unverified provider flow that the option layer marked unsafe", () => {
  const result = buildEvidenceGatedDecision({
    place: { name: "Demo", businessStatus: "OPERATIONAL" },
    reservationOptions: [
      { id: "tabelog", label: "Tabelog", capability: { kind: "provider_booking_flow", certainty: "low", recommended: false } },
      { id: "phone", label: "电话确认", capability: { kind: "phone_confirmation", certainty: "medium", recommended: true, primaryLabel: "拨打电话确认预约" } }
    ]
  });
  assert.equal(result.recommendation, "unknown");
  assert.equal(result.nextAction, "拨打电话确认预约");
  assert.doesNotMatch(result.summary, /已发现.*预约入口/);
});

test("does not turn an EPARK waitlist into a seat reservation claim", () => {
  const result = buildEvidenceGatedDecision({
    place: { name: "Demo", businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "epark", label: "EPARK", capability: { kind: "waitlist_flow", certainty: "medium", primaryLabel: "打开 EPARK 查看排队取号" } }]
  });
  assert.equal(result.recommendation, "unknown");
  assert.match(result.summary, /座席予約ではなく/);
  assert.match(result.nextAction, /排队取号/);
});

test("uses date, dinner time, and party size only for conservative plan reminders", () => {
  const advisory = buildPlanAdvisory({ planDate: "2026-07-18", planTime: "19:30", partySize: 6 });
  assert.match(advisory, /週末/);
  assert.match(advisory, /混雑の根拠にはなりません/);
  assert.match(advisory, /ディナー時間.*混雑や空席を推測せず/);
  assert.match(advisory, /6 名.*席種.*コース.*デポジット/);

  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", capability: { kind: "online_reservation_flow", certainty: "high" } }],
    planIntent: { planDate: "2026-07-18", planTime: "19:30", partySize: 6 }
  });
  assert.equal(decision.recommendation, "recommended");
  assert.match(decision.planAdvisory, /混雑の根拠にはなりません/);
});
