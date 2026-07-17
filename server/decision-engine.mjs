export function buildEvidenceGatedDecision({ place, reservationOptions = [], reservationPolicy = null, queuePolicy = null, conflicts = [], facts = [], planIntent = {} }) {
  const planAdvisory = buildPlanAdvisory(planIntent);
  const closed = ["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(place?.businessStatus);
  if (closed) {
    const permanent = place.businessStatus === "CLOSED_PERMANENTLY";
    const statusSource = place.businessStatusSource === "official_website" ? "店舗の公式サイト" : "Google Maps";
    const statusCertainty = permanent || place.businessStatusSource === "official_website" ? "high" : "medium";
    return {
      recommendation: "temporarily_unavailable",
      queue: "そのまま向かわないでください",
      confidence: statusCertainty,
      summary: permanent
        ? `${statusSource}では閉業と表示されています。元の住所へ向かうことはおすすめしません。`
        : `${statusSource}では一時休業と表示されています。営業再開日は改めて確認が必要です。`,
      nextAction: "店舗の公式サイトまたは Google Maps で最新の営業状況を確認してください。",
      planAdvisory,
      reasons: [permanent ? `${statusSource}で閉業と表示` : `${statusSource}で一時休業と表示`, "第三者サービスに店舗ページが残っていても、現在営業中とは限りません"],
      evidence: [{ claim: "現在の営業状況", factIds: factIdsFor(facts, "business_status"), certainty: statusCertainty, limitation: "情報源の更新後に営業状況が変わる場合があります" }]
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
      queue: "公式サイト内の情報が矛盾",
      confidence: "low",
      summary: "公式サイト本文には予約不可とありますが、同じサイトからオンライン予約にも進めます。どちらがこの店舗や希望日に適用されるか、現時点では安全に判断できません。",
      nextAction: "公式サイトで対象店舗と適用日を確認し、不明な場合は電話で問い合わせてください。",
      planAdvisory,
      reasons: ["公式サイトに予約不可の明記があります", "同じ公式サイトにオンライン予約入口があります", "矛盾が解消するまでは予約可・来店のみのどちらとも断定しません"],
      evidence: [{ claim: "公式サイトの予約ルールが矛盾", factIds: factIdsFor(facts, "reservation_policy"), optionId: reservationFlow.id, certainty: "low", limitation: "特定店舗、日付、時間帯、席種だけに適用される可能性があります" }]
    };
  }
  if (officialDoesNotAcceptReservations) {
    const queueKnown = Boolean(queuePolicy?.mode);
    return {
      recommendation: "walk_in_ok",
      queue: queueKnown ? queuePolicy.label : "来店受付のみ・待ち時間不明",
      confidence: reservationPolicy.certainty || "high",
      summary: queueKnown
        ? `公式サイトには予約不可と明記され、「${queuePolicy.label}」で案内されています。ただし、来店時の空席や待ち時間までは分かりません。`
        : "公式サイトには予約不可と明記されています。来店する場合は店頭受付を想定してください。ただし、空席や待ち時間までは確認できません。",
      nextAction: queueKnown ? queueNextAction(queuePolicy.mode) : "出発前に当日の営業時間を確認し、満席に備えて待ち時間や別の候補も見込んでください。",
      planAdvisory,
      reasons: ["公式サイトに予約不可と明記", queueKnown ? `公式サイトに「${queuePolicy.label}」と明記` : "店頭受付の方法は未確認", "現在の待ち時間を推定できる根拠はありません"],
      evidence: [
        { claim: "公式サイトに予約不可と明記", factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "公式サイト記載の予約方針だけを示し、希望時間の営業や空席は保証しません" },
        ...(queueKnown ? [{ claim: `公式サイトの案内：${queuePolicy.label}`, factIds: factIdsFor(facts, "queue_policy"), certainty: queuePolicy.certainty || "high", limitation: "受付方法は変更される場合があり、現在の待ち時間は推定できません" }] : [])
      ]
    };
  }
  if (officialReservationIsLimited && !reservationFlow) {
    return {
      recommendation: "unknown",
      queue: "予約条件あり",
      confidence: reservationPolicy.certainty || "high",
      summary: `公式サイトに予約条件「${reservationPolicy.label}」が明記されています。確認済みの直接予約入口がないため、希望日・時間・人数が条件に合うかは判断できません。`,
      nextAction: "公式サイトで対象日、時間帯、人数を確認し、不明な場合は公式電話番号へ問い合わせてください。",
      planAdvisory,
      reasons: [`公式サイトに「${reservationPolicy.label}」と明記`, "確認済みの直接予約入口は見つかっていません", "入力された予定だけで条件を満たすとは判断しません"],
      evidence: [{ claim: `公式サイトの予約条件：${reservationPolicy.label}`, factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "ルールは変更される場合があり、希望日の空席は示しません" }]
    };
  }
  if (reservationFlow && unresolvedIdentityConflict) {
    return {
      recommendation: "unknown",
      queue: "まず店舗を再確認",
      confidence: "low",
      summary: "予約入口は見つかりましたが、入力内容と現在の店舗の住所または支店情報が一致していません。誤予約を避けるため、直接予約はまだおすすめできません。",
      nextAction: "Google Maps または店舗公式サイトで現在の住所と支店を確認し、同じ店舗と確認できてから予約ページへ進んでください。",
      planAdvisory,
      reasons: [unresolvedIdentityConflict.message, "予約入口があっても、画像と同じ支店とは限りません", "店舗情報の矛盾が解消するまで予約送信はおすすめしません"],
      evidence: [{ claim: "予約入口と対象店舗の対応は未確認", factIds: factIdsFor(facts, "address"), optionId: reservationFlow.id, certainty: "low", limitation: "古い投稿、移転、同名支店により誤予約が起きる可能性があります" }]
    };
  }
  if (directOnline) {
    const restrictionPrefix = officialReservationIsLimited ? `公式サイトには「${reservationPolicy.label}」とあります。` : "";
    const isOfficialBooking = directOnline.provider === "official_booking";
    return {
      recommendation: "recommended",
      queue: "オンラインで空席を確認",
      confidence: hasUnresolvedHighConflict ? "low" : directOnline.capability.certainty,
      summary: `${resolvedRelocation ? "入力住所は旧住所の可能性がありますが、現在の Google Maps と確認済み公式サイトで現住所を確認しました。" : ""}${restrictionPrefix}${isOfficialBooking ? "店舗公式サイトの予約ページ" : `${directOnline.officiality === "linked_from_restaurant_website" ? "店舗公式サイトから直接リンクされた" : "明確な"}${directOnline.label} の予約ページ`}が見つかりました。希望条件と空席をオンラインで確認できます。`,
      nextAction: `${resolvedRelocation ? "公式サイトの現住所で対象店舗を確認してから、" : ""}${isOfficialBooking ? "店舗公式の予約ページ" : directOnline.label}を開き、日付・時間・人数・条件を確認してください。確認画面または確認通知を受け取って初めて予約成立です。`,
      planAdvisory,
      reasons: ["明確なオンライン予約経路を確認済み", officialReservationIsLimited ? `公式サイトに「${reservationPolicy.label}」と明記` : "入口の実在と実際の空席は分けて判断します", resolvedRelocation ? "現在の公式店舗ページで旧住所との矛盾を解消" : conflicts.length ? `確認が必要な情報源の差異が ${conflicts.length} 件あります` : "重大な情報源の矛盾は見つかりませんでした"],
      evidence: [
        { claim: "利用可能なオンライン予約経路があります", optionId: directOnline.id, certainty: directOnline.capability.certainty, limitation: "希望日の空席や予約成立を示すものではありません" },
        ...(officialReservationIsLimited ? [{ claim: `公式サイトの予約条件：${reservationPolicy.label}`, factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "送信前に希望日、時間帯、人数が対象か確認してください" }] : [])
      ]
    };
  }
  if (providerBooking) {
    const restrictionPrefix = officialReservationIsLimited ? `公式サイトには「${reservationPolicy.label}」とあります。` : "";
    return {
      recommendation: "recommended",
      queue: "送信後に確認待ち",
      confidence: hasUnresolvedHighConflict ? "low" : providerBooking.capability.certainty,
      summary: `${restrictionPrefix}${providerBooking.label} の予約入口が見つかりました。ただし、即時確定・リクエスト・店舗への代行連絡のいずれかはサービス側で決まるため、送信だけでは予約成立になりません。`,
      nextAction: `${providerBooking.label} を開き、条件・料金・確定方法を確認してください。明確な予約確認を受け取ってから予約済みとして予定を組んでください。`,
      planAdvisory,
      reasons: ["予約サービスの入口を確認済み", officialReservationIsLimited ? `公式サイトに「${reservationPolicy.label}」と明記` : "サービスへの送信と店舗の最終確定は分けて扱います", conflicts.length ? `確認が必要な情報源の差異が ${conflicts.length} 件あります` : "重大な情報源の矛盾は見つかりませんでした"],
      evidence: [
        { claim: "予約サービスが管理する予約経路があります", optionId: providerBooking.id, certainty: providerBooking.capability.certainty, limitation: "店舗への代行連絡、料金の支払い、確定待ちが必要な場合があります" },
        ...(officialReservationIsLimited ? [{ claim: `公式サイトの予約条件：${reservationPolicy.label}`, factIds: factIdsFor(facts, "reservation_policy"), certainty: reservationPolicy.certainty || "high", limitation: "送信前に希望日、時間帯、人数が対象か確認してください" }] : [])
      ]
    };
  }

  const official = reservationOptions.find((item) => item.capability?.kind === "official_information");
  const phone = reservationOptions.find((item) => item.capability?.kind === "phone_confirmation");
  const listing = reservationOptions.find((item) => item.capability?.kind === "platform_listing");
  const next = waitlist || official || phone || listing;
  return {
    recommendation: "unknown",
    queue: queuePolicy?.label || "要確認",
    confidence: hasUnresolvedHighConflict ? "low" : listing || queuePolicy ? "medium" : "low",
    summary: queuePolicy
      ? `公式サイトには「${queuePolicy.label}」とありますが、予約受付の有無は確認できません。順番待ちの案内だけでは来店時の空席も判断できません。`
      : waitlist ? "順番待ちの受付ページは見つかりましたが、座席予約ではなく、来店時の入店を保証するものでもありません。" : "店舗の同一性と基本情報は確認できましたが、予約受付や店頭での順番待ちについて明確な根拠がありません。",
    nextAction: queuePolicy ? queueNextAction(queuePolicy.mode) : next?.capability?.primaryLabel || "まず公式ページを確認し、記載がなければ電話で問い合わせてください。",
    planAdvisory,
    reasons: ["Google Maps で店名と住所を確認済み", queuePolicy ? `公式サイトに「${queuePolicy.label}」と明記` : waitlist ? "順番待ち受付は座席予約ではありません" : listing ? `${listing.label} の店舗ページはありますが、ページの存在だけでは予約可能と判断できません` : "確認済みの予約サービス店舗ページは見つかりませんでした", phone ? "確認済みの電話番号で予約受付を直接問い合わせられます" : "利用できる電話番号を確認できませんでした"],
    evidence: queuePolicy
      ? [{ claim: `公式サイトの案内：${queuePolicy.label}`, factIds: factIdsFor(facts, "queue_policy"), certainty: queuePolicy.certainty || "high", limitation: "予約受付、現在の空席、待ち時間までは判断できません" }]
      : [{ claim: "予約・順番待ちルールは未確認", factIds: [], certainty: "low", limitation: "評価点、クチコミ数、店舗ページの存在から予約ルールを推測しません" }]
  };
}

function queueNextAction(mode) {
  return {
    numbered_ticket: "出発前に公式サイトで当日の整理券配布時間と場所を確認してください。整理券を受け取っても、すぐ入店できるとは限りません。",
    app_waitlist: "公式サイト指定のアプリまたはWebページで順番待ち受付を行い、呼び出しとキャンセル扱いの条件を確認してください。",
    name_list: "来店後、公式案内に従って名前を記入し、呼び出し方法を店舗スタッフへ確認してください。",
    onsite_queue: "公式案内に従って店頭に並んでください。現在の待ち時間は不明なため、出発前に営業状況も確認してください。"
  }[mode] || "公式サイトで当日の受付方法を確認してください。現在の待ち時間は不明です。";
}

export function buildPlanAdvisory(plan = {}) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(plan.planDate || "")) ? plan.planDate : "";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(plan.planTime || "")) ? plan.planTime : "";
  const party = Number.isInteger(Number(plan.partySize)) && Number(plan.partySize) >= 1 && Number(plan.partySize) <= 20 ? Number(plan.partySize) : null;
  const notes = [];
  if (date) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    notes.push(day === 0 || day === 6
      ? `${date} は週末です。混雑の根拠にはなりませんが、予約条件・コース・選べる時間が異なる場合があるため、事前に確認してください。`
      : `予定日は ${date} です。この日付で営業状況と選べる時間を確認してください。`);
  }
  if (time && Number(time.slice(0, 2)) >= 18) notes.push(`予定時刻は ${time} です。ディナー時間という理由だけで混雑や空席を推測せず、予約ページまたは店舗の回答を確認してください。`);
  if (party && party >= 6) notes.push(`予定人数は ${party} 名です。席種、コース、デポジットの条件がある場合があるため、送信前に確認してください。`);
  return notes.length ? notes.join(" ") : null;
}

function factIdsFor(facts, field) {
  return facts.filter((fact) => fact.field === field).map((fact) => fact.id).filter(Boolean);
}
