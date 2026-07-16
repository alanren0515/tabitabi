import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceGatedDecision, buildPlanAdvisory } from "../server/decision-engine.mjs";

test("recommends opening a verified direct reservation flow without claiming availability", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", officiality: "linked_from_restaurant_website", capability: { kind: "online_reservation_flow", certainty: "high" } }]
  });
  assert.equal(decision.recommendation, "recommended");
  assert.match(decision.summary, /预约流程/);
  assert.match(decision.evidence[0].limitation, /不代表目标日期有空位/);
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
  assert.match(result.summary, /餐厅官网中的预约流程/);
  assert.doesNotMatch(result.summary, /预约预约流程/);
  assert.match(result.nextAction, /餐厅官网预约页/);
});

test("blocks a booking flow when a high-risk store identity conflict is unresolved", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", officiality: "reservation_platform", capability: { kind: "online_reservation_flow", certainty: "medium" } }],
    conflicts: [{ field: "address", severity: "high", resolvedByOfficial: false, message: "输入地址与当前地址不一致。" }],
    facts: [{ id: "google:address:1", field: "address" }, { id: "user:address:2", field: "address" }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.match(decision.nextAction, /确认是同一家店/);
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
  assert.match(decision.summary, /旧址/);
  assert.match(decision.nextAction, /官网现址/);
});

test("does not infer reservation rules from ratings or a platform listing", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL", rating: 4.9, userRatingCount: 10000 },
    reservationOptions: [{ id: "hotpepper", label: "Hot Pepper", capability: { kind: "platform_listing", primaryLabel: "核对" } }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.match(decision.evidence[0].limitation, /不会根据评分/);
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
  assert.match(decision.summary, /恢复时间仍需再次核对/);
  assert.match(decision.nextAction, /最新营业状态/);
});

test("uses an explicit official no-reservations rule for a conservative walk-in decision", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "not_accepted", certainty: "high" },
    facts: [{ id: "official:policy:1", field: "reservation_policy" }]
  });
  assert.equal(decision.recommendation, "walk_in_ok");
  assert.match(decision.queue, /排队时间未知/);
  assert.deepEqual(decision.evidence[0].factIds, ["official:policy:1"]);
  assert.match(decision.evidence[0].limitation, /不代表目标时间一定营业/);
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
  assert.match(decision.summary, /不代表到店时一定有位/);
  assert.match(decision.nextAction, /整理券.*领取时间和地点/);
  assert.deepEqual(decision.evidence[1].factIds, ["official:queue:1"]);
  assert.match(decision.evidence[1].limitation, /不能据此估算实时等待时间/);
});

test("shows a verified queue rule without inferring whether reservations are open", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    queuePolicy: { mode: "name_list", label: "到店登记姓名", certainty: "high" },
    facts: [{ id: "official:queue:2", field: "queue_policy" }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.equal(decision.queue, "到店登记姓名");
  assert.match(decision.summary, /尚无明确证据证明预约是否开放/);
  assert.match(decision.nextAction, /登记姓名/);
  assert.deepEqual(decision.evidence[0].factIds, ["official:queue:2"]);
});

test("returns unknown when an official no-reservations rule conflicts with a direct booking flow", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "not_accepted", certainty: "high" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", capability: { kind: "online_reservation_flow", certainty: "high" } }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.match(decision.summary, /无法安全判断/);
  assert.match(decision.evidence[0].limitation, /特定分店/);
});

test("keeps a limited official reservation rule unknown when no direct flow is verified", () => {
  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationPolicy: { status: "limited", label: "仅平日接受预约", certainty: "high" },
    facts: [{ id: "official:policy:limited", field: "reservation_policy" }]
  });
  assert.equal(decision.recommendation, "unknown");
  assert.equal(decision.queue, "预约有条件");
  assert.match(decision.summary, /仅平日接受预约/);
  assert.match(decision.nextAction, /适用日期、时段和人数/);
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
  assert.match(decision.nextAction, /官网限制/);
  assert.deepEqual(decision.evidence[1].factIds, ["official:policy:lunch"]);
});

test("distinguishes a provider-managed request from an already confirmed reservation", () => {
  const result = buildEvidenceGatedDecision({
    place: { name: "Demo", businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "autoreserve", label: "AutoReserve", capability: { kind: "provider_booking_flow", certainty: "medium" } }]
  });
  assert.equal(result.recommendation, "recommended");
  assert.match(result.summary, /提交本身不代表预约成立/);
  assert.match(result.nextAction, /明确的预约确认/);
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
  assert.match(result.summary, /不是订座/);
  assert.match(result.nextAction, /排队取号/);
});

test("uses date, dinner time, and party size only for conservative plan reminders", () => {
  const advisory = buildPlanAdvisory({ planDate: "2026-07-18", planTime: "19:30", partySize: 6 });
  assert.match(advisory, /周末/);
  assert.match(advisory, /不能证明餐厅拥挤/);
  assert.match(advisory, /不会仅因晚餐时段推断热门或有位/);
  assert.match(advisory, /6 人.*桌型.*套餐.*押金/);

  const decision = buildEvidenceGatedDecision({
    place: { businessStatus: "OPERATIONAL" },
    reservationOptions: [{ id: "tablecheck", label: "TableCheck", capability: { kind: "online_reservation_flow", certainty: "high" } }],
    planIntent: { planDate: "2026-07-18", planTime: "19:30", partySize: 6 }
  });
  assert.equal(decision.recommendation, "recommended");
  assert.match(decision.planAdvisory, /不能证明餐厅拥挤/);
});
