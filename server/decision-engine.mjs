export function buildEvidenceGatedDecision({ place, reservationOptions = [], reservationPolicy = null, queuePolicy = null, conflicts = [], facts = [], planIntent = {} }) {
  const planAdvisory = buildPlanAdvisory(planIntent);
  const closed = ["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(place?.businessStatus);
  if (closed) {
    const permanent = place.businessStatus === "CLOSED_PERMANENTLY";
    const statusSource = place.businessStatusSource === "official_website" ? "餐厅官网" : "Google Maps";
    const statusCertainty = permanent || place.businessStatusSource === "official_website" ? "high" : "medium";
    return {
      recommendation: "temporarily_unavailable",
      queue: "不要直接前往",
      confidence: statusCertainty,
      summary: permanent
        ? `${statusSource}显示该店已永久停业，不建议按原地址前往。`
        : `${statusSource}显示该店目前暂停营业，恢复时间仍需再次核对。`,
      nextAction: "先在餐厅官网或 Google Maps 核对最新营业状态。",
      planAdvisory,
      reasons: [permanent ? `${statusSource}标记为永久停业` : `${statusSource}标记为暂停营业`, "第三方仍有店铺页面不代表当前正常营业"],
      evidence: [{ claim: "当前营业状态", factIds: factIdsFor(facts, "business_status"), certainty: statusCertainty, limitation: "营业状态可能在来源更新后发生变化" }]
    };
  }

  const directOnline = reservationOptions.find((item) => item.capability?.kind === "online_reservation_flow" && item.capability.recommended !== false);
  const providerBooking = reservationOptions.find((item) => item.capability?.kind === "provider_booking_flow" && item.capability.recommended !== false);
  const reservationFlow = directOnline || providerBooking;
  const waitlist = reservationOptions.find((item) => item.capability?.kind === "waitlist_flow");
  const officialDoesNotAcceptReservations = reservationPolicy?.status === "not_accepted";
  const officialReservationIsLimited = reservationPolicy?.status === "limited";
  const unresolvedIdentityConflict = conflicts.find((item) => item.severity === "high" && !item.resolvedByOfficial && ["address", "name", "branch"].includes(item.field));
  const resolvedRelocation = conflicts.find((item) => item.field === "address" && item.resolvedByOfficial);
  const hasUnresolvedHighConflict = conflicts.some((item) => item.severity === "high" && !item.resolvedByOfficial);
  if (reservationFlow && officialDoesNotAcceptReservations) {
    return {
      recommendation: "unknown",
      queue: "官网信息冲突",
      confidence: "low",
      summary: "餐厅官网正文写明不接受预约，但同一官网又链接了线上预约入口；当前无法安全判断哪条规则适用于这家店或目标日期。",
      nextAction: "先打开官网核对适用分店和日期；仍不明确时电话确认。",
      planAdvisory,
      reasons: ["官网出现明确的不可预约说明", "官网同时存在明确线上预约入口", "冲突解决前不建议直接假定可预约或仅限现场"],
      evidence: [{ claim: "官网预约规则存在冲突", factIds: factIdsFor(facts, "reservation_policy"), optionId: reservationFlow.id, certainty: "low", limitation: "规则可能只适用于特定分店、日期、时段或席位" }]
    };
  }
  if (officialDoesNotAcceptReservations) {
    const queueKnown = Boolean(queuePolicy?.mode);
    return {
      recommendation: "walk_in_ok",
      queue: queueKnown ? queuePolicy.label : "仅建议现场尝试，排队时间未知",
      confidence: reservationPolicy.certainty || "high",
      summary: queueKnown
        ? `餐厅官网明确写明不接受预约，并说明采用“${queuePolicy.label}”；该规则仍不代表到店时一定有位或能估算实时等待时间。`
        : "餐厅官网明确写明不接受预约；如要到店，应按现场接待方式准备，但官网证据并未说明是否一定有位或需要排多久。",
      nextAction: queueKnown ? queueNextAction(queuePolicy.mode) : "出发前核对当天营业时间；现场可能满位，建议预留候位或备选餐厅。",
      planAdvisory,
      reasons: ["官网明确写明不接受预约", queueKnown ? `官网明确说明${queuePolicy.label}` : "未发现明确的现场接待方式", "没有可靠证据可估算实时排队时间"],
      evidence: [
        { claim: "餐厅官网明确不接受预约", factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "只证明官网所述预约政策，不代表目标时间一定营业或有位" },
        ...(queueKnown ? [{ claim: `官网说明${queuePolicy.label}`, factIds: factIdsFor(facts, "queue_policy"), certainty: queuePolicy.certainty || "high", limitation: "排队方式可能临时变化，且不能据此估算实时等待时间" }] : [])
      ]
    };
  }
  if (officialReservationIsLimited && !reservationFlow) {
    return {
      recommendation: "unknown",
      queue: "预约有条件",
      confidence: reservationPolicy.certainty || "high",
      summary: `餐厅官网明确写有预约限制：${reservationPolicy.label}。当前没有已核验的直接预约流程，不能确认你的目标日期、时段或人数是否符合条件。`,
      nextAction: "打开官网核对限制的适用日期、时段和人数；仍不明确时使用官方电话确认。",
      planAdvisory,
      reasons: [`官网明确说明${reservationPolicy.label}`, "尚未发现已核验的直接预约流程", "不会根据计划信息自行假设限制条件已满足"],
      evidence: [{ claim: `官网预约限制：${reservationPolicy.label}`, factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "规则可能变更，且不证明目标日期有位" }]
    };
  }
  if (reservationFlow && unresolvedIdentityConflict) {
    return {
      recommendation: "unknown",
      queue: "先确认门店身份",
      confidence: "low",
      summary: "虽然找到了预约入口，但输入内容与当前门店的地址或分店信息存在未解决冲突，暂不能安全推荐直接预约。",
      nextAction: "先在 Google Maps 或餐厅官网核对当前地址和分店；确认是同一家店后再进入预约页。",
      planAdvisory,
      reasons: [unresolvedIdentityConflict.message, "预约入口存在不代表它对应截图中的同一家分店", "门店身份冲突解决前不推荐提交预约"],
      evidence: [{ claim: "预约入口与目标门店的对应关系尚未确认", factIds: factIdsFor(facts, "address"), optionId: reservationFlow.id, certainty: "low", limitation: "旧帖、迁址和同名分店都可能导致错误预约" }]
    };
  }
  if (directOnline) {
    const restrictionPrefix = officialReservationIsLimited ? `餐厅官网写明“${reservationPolicy.label}”。` : "";
    const isOfficialBooking = directOnline.provider === "official_booking";
    return {
      recommendation: "recommended",
      queue: "先在线核对空位",
      confidence: hasUnresolvedHighConflict ? "low" : directOnline.capability.certainty,
      summary: `${resolvedRelocation ? "输入地址疑似为旧址；已用当前 Google Maps 与核验官网确认现址。" : ""}${restrictionPrefix}已发现${isOfficialBooking ? "餐厅官网中的预约流程" : `${directOnline.officiality === "linked_from_restaurant_website" ? "餐厅官网直接链接的" : "明确的"}${directOnline.label}预约流程`}，可以先在线查看目标条件是否适用以及是否有空位。`,
      nextAction: `${resolvedRelocation ? "先按官网现址核对目标分店，再" : ""}打开${isOfficialBooking ? "餐厅官网预约页" : ` ${directOnline.label}`}核对日期、时间、人数及官网限制；看到确认页面或邮件后才算预约成功。`,
      planAdvisory,
      reasons: ["已核对到明确的线上预约路径", officialReservationIsLimited ? `官网同时说明${reservationPolicy.label}` : "入口真实性与实际空位分开判断", resolvedRelocation ? "旧地址冲突已由当前官方门店页消解" : conflicts.length ? `仍有 ${conflicts.length} 项来源信息需要核对` : "未发现高风险来源冲突"],
      evidence: [
        { claim: "存在可进入的线上预约流程", optionId: directOnline.id, certainty: directOnline.capability.certainty, limitation: "不代表目标日期有空位，也不代表预约已经成立" },
        ...(officialReservationIsLimited ? [{ claim: `官网预约限制：${reservationPolicy.label}`, factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "必须在提交前核对目标日期、时段和人数是否适用" }] : [])
      ]
    };
  }
  if (providerBooking) {
    const restrictionPrefix = officialReservationIsLimited ? `餐厅官网写明“${reservationPolicy.label}”。` : "";
    return {
      recommendation: "recommended",
      queue: "提交后等待确认",
      confidence: hasUnresolvedHighConflict ? "low" : providerBooking.capability.certainty,
      summary: `${restrictionPrefix}已发现 ${providerBooking.label} 的预约入口，但平台可能采用即时确认、请求确认或代为联系餐厅，提交本身不代表预约成立。`,
      nextAction: `打开 ${providerBooking.label} 核对官网限制、费用和确认方式；只有收到明确的预约确认后才按已预约安排行程。`,
      planAdvisory,
      reasons: ["已核对到平台预约入口", officialReservationIsLimited ? `官网同时说明${reservationPolicy.label}` : "平台提交与餐厅最终确认分开处理", conflicts.length ? `仍有 ${conflicts.length} 项来源信息需要核对` : "未发现高风险来源冲突"],
      evidence: [
        { claim: "存在平台管理的预约流程", optionId: providerBooking.id, certainty: providerBooking.capability.certainty, limitation: "可能需要平台代联络餐厅、支付费用或等待确认" },
        ...(officialReservationIsLimited ? [{ claim: `官网预约限制：${reservationPolicy.label}`, factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "必须在提交前核对目标日期、时段和人数是否适用" }] : [])
      ]
    };
  }

  const official = reservationOptions.find((item) => item.capability?.kind === "official_information");
  const phone = reservationOptions.find((item) => item.capability?.kind === "phone_confirmation");
  const listing = reservationOptions.find((item) => item.capability?.kind === "platform_listing");
  const next = waitlist || official || phone || listing;
  return {
    recommendation: "unknown",
    queue: queuePolicy?.label || "信息不足",
    confidence: hasUnresolvedHighConflict ? "low" : listing || queuePolicy ? "medium" : "low",
    summary: queuePolicy
      ? `餐厅官网明确说明采用“${queuePolicy.label}”，但尚无明确证据证明预约是否开放；排队规则也不能证明到店时一定有位。`
      : waitlist ? "已找到排队取号入口，但排队取号不是订座，也不能证明到店时一定有位。" : "已确认店铺身份和基础信息，但尚无明确证据证明是否接受预约或需要现场排队。",
    nextAction: queuePolicy ? queueNextAction(queuePolicy.mode) : next?.capability?.primaryLabel || "先核对官方页面；没有明确说明时再电话确认。",
    planAdvisory,
    reasons: ["已通过 Google Maps 确认店名与地址", queuePolicy ? `官网明确说明${queuePolicy.label}` : waitlist ? "排队取号不等于保留座位" : listing ? `找到了对应的 ${listing.label} 店铺页面，但页面存在不等于可预约` : "尚未找到已核对的预约平台店铺页", phone ? "可通过已核对的电话号码直接询问预约是否开放" : "尚未取得可用电话号码"],
    evidence: queuePolicy
      ? [{ claim: `官网说明${queuePolicy.label}`, factIds: factIdsFor(facts, "queue_policy"), certainty: queuePolicy.certainty || "high", limitation: "仍不能据此判断预约状态、实时有位或等待时长" }]
      : [{ claim: "预约与排队规则仍未知", factIds: [], certainty: "low", limitation: "不会根据评分、评价数或平台店铺页推断预约规则" }]
  };
}

function queueNextAction(mode) {
  return {
    numbered_ticket: "出发前打开官网核对当天整理券的领取时间和地点；领券不代表立即入店。",
    app_waitlist: "按官网指定的 App 或网页完成排队取号，并持续核对叫号与过号规则。",
    name_list: "到店后先按官网说明登记姓名，并向店员确认预计叫号方式。",
    onsite_queue: "按官网说明到店排队；实时等待时间未知，出发前仍需核对营业状态。"
  }[mode] || "打开官网核对当天排队方式；实时等待时间未知。";
}

export function buildPlanAdvisory(plan = {}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(plan.planDate || "")) ? plan.planDate : "";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(plan.planTime || "")) ? plan.planTime : "";
  const party = Number.isInteger(Number(plan.partySize)) && Number(plan.partySize) >= 1 && Number(plan.partySize) <= 20 ? Number(plan.partySize) : null;
  const notes = [];
  if (date) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    notes.push(day === 0 || day === 6
      ? `${date} 是周末；这本身不能证明餐厅拥挤，但预约规则、套餐和可选时段可能不同，请提前核对。`
      : `计划日期为 ${date}；请按这个具体日期核对营业状态和可选时段。`);
  }
  if (time && Number(time.slice(0, 2)) >= 18) notes.push(`计划时间为 ${time}；系统不会仅因晚餐时段推断热门或有位，请以预约页或餐厅答复为准。`);
  if (party && party >= 6) notes.push(`计划人数为 ${party} 人；多人可能受桌型、套餐或押金限制，提交前应确认全部条件。`);
  return notes.length ? notes.join(" ") : null;
}

function factIdsFor(facts, field) {
  return facts.filter((fact) => fact.field === field).map((fact) => fact.id).filter(Boolean);
}
