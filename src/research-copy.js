const copy = {
  ja: {
    title: "任意の利用調査", intro: "参加しなくても、すべての機能を同じように使えます。",
    body: "参加すると、このブラウザにランダムな端末番号を保存し、確認や再確認などの操作を最長30日間つなげて、継続利用を調べます。調査記録に画像、入力文、連絡先は含めません。端末の集計であり、人数の集計ではありません。",
    withdrawal: "いつでも参加を取り消せます。取り消すと新しい関連付けを停止し、サーバーの調査用の関連付けも削除します。関連付けのない運用記録は通常の保管期限まで残ります。",
    join: "内容を確認して参加する", decline: "参加しない", revoke: "参加を取り消す", retry: "送信を再試行", busy: "送信中…", until: "参加期限：",
    states: { not_asked: "未参加です。", declined: "未参加です。機能は引き続き利用できます。", accepted: "参加中です。", pending_accept: "参加の確認ができていません。調査への関連付けは停止しています。再試行するか、参加を取り消せます。", pending_revocation: "関連付けは停止しました。サーバーへの取り消し送信は未完了です。再送用の情報だけをこの端末に残しています。接続または招待アクセスを確認して再試行してください。", revoked: "参加を取り消しました。調査用の関連付けを削除しました。", expired: "参加期限が終了しました。関連付けは停止しています。", unavailable: "このブラウザでは調査への参加を保存できません。機能は引き続き利用できます。" }
  },
  en: {
    title: "Optional usage research", intro: "All features work the same whether you participate or not.",
    body: "If you join, a random device ID is stored in this browser. It links actions such as checks and rechecks for up to 30 days to study return use. Research records do not include images, input text or contact details. Counts represent devices, not people.",
    withdrawal: "You can withdraw at any time. Withdrawal stops new links and deletes the research links on the server. Unlinked operational records remain until their normal retention deadline.",
    join: "I understand and want to join", decline: "Do not participate", revoke: "Withdraw participation", retry: "Retry sending", busy: "Sending…", until: "Participation ends: ",
    states: { not_asked: "Not participating.", declined: "Not participating. All features remain available.", accepted: "Participating.", pending_accept: "Participation has not been confirmed. Research linking is off. Retry or withdraw your request.", pending_revocation: "Research linking is off. Server withdrawal is still pending. Only the information needed to resend it is retained on this device. Check your connection or invitation access, then retry.", revoked: "Participation withdrawn. Research links have been deleted.", expired: "Participation has expired. Research linking is off.", unavailable: "This browser cannot save research participation. All features remain available." }
  },
  "zh-CN": {
    title: "可选使用研究", intro: "不参加也能正常使用所有功能。",
    body: "参加后，会在此浏览器保存随机设备编号，将确认、重新确认等操作关联最多30天，用于了解持续使用情况。研究记录不包含图片、输入原文或联系方式。统计的是设备，而非人数。",
    withdrawal: "可以随时退出。退出会立即停止新的关联，并删除服务器上的研究关联；未关联的运营记录按原保留期限清理。",
    join: "了解并参加", decline: "不参加", revoke: "退出研究", retry: "重新发送", busy: "发送中…", until: "参加截止时间：",
    states: { not_asked: "尚未参加。", declined: "未参加，所有功能仍可使用。", accepted: "已参加。", pending_accept: "尚未确认参加成功，研究关联已停止。可以重试或撤回申请。", pending_revocation: "关联已停止，但退出请求尚未送达服务器。此设备仅保留重新发送所需的信息。请检查网络或邀请访问权限后重试。", revoked: "已退出，研究关联已删除。", expired: "参加已到期，研究关联已停止。", unavailable: "此浏览器无法保存研究状态，所有功能仍可使用。" }
  }
};

export function researchCopy(locale) { return copy[locale] || copy.ja; }
