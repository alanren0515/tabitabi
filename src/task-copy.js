const COPY = {
  ja: {
    recoveryTitle: "記録を読み取れません", recoveryBody: "現在読み取れないため、記録がないとは限りません。元データを保持しています。上の再試行、または一覧のエクスポートで確認してください。",
    navLabel: "この端末の店舗記録", navQueue: "確認待ち", navSaved: "行きたい", navHistory: "最近の確認", manageList: "一覧を管理", savedEmptyBody: "店舗を確認したら、結果の「予定を保存」で行きたいリストに追加できます。", noSearchResults: "一致する記録がありません", noSearchResultsBody: "店名やメモの言葉を変えるか、すべての記録を表示してください。", resetSearch: "すべての記録を表示", queueEmptyTitle: "確認待ちの店舗はありません", queueEmptyBody: "まずは1店舗を確認しましょう。複数の店名がある場合は、下の「複数の店舗を一度に追加」で準備できます。",
    actionBoundary: "店舗の候補はあなたが選択しました。営業・空席・予約条件は、店舗や予約先で最終確認してください。リンクを開くだけでは予約は成立しません。", uncertainBoundary: "情報が不足しているため、来店方法を確定できません。店舗への確認が必要です。", exampleActionBody: "これは操作サンプルです。ボタンを押しても外部ページを開いたり、電話をかけたりしません。", exampleActionDone: "サンプル操作を確認しました。外部ページ・電話・予約への接続は行っていません。", backToList: "一覧に戻る",
    open: "端末の記録を見る", recheck: "最新情報を確認", localOnly: "この端末に保存した記録です。開いただけでは店舗情報を取得しません。",
    note: "自分用メモ", search: "店名・メモで検索", save: "記録を保存", newPlan: "別の日の予定として保存", progress: "自分の進捗", want_to_go: "行きたい", reserved_by_user: "本人の記録：予約済み", visited: "行った", skipped: "今回は見送る",
    unknownTime: "取得時刻不明", reviewTime: "前回の確認", noReview: "確認記録なし", resultTime: "今回の確認", branchConfirmTime: "あなたが店舗を選んだ時刻", times: "情報源と取得時刻", timeBoundary: "取得時刻は営業・空席や予約成立の保証ではありません。キャッシュは元の取得時刻を表示します。",
    export: "この一覧をエクスポート", download: "ファイルを保存", exportPreview: "内容を見る・手動で保存", exportBody: "端末の記録を書き出します。取得した店舗情報や画像は含みません。ダウンロードが始まらない場合は、内容を表示してコピーできます。", exportIncomplete: "読み込み・保存が未完了です。書き出すのは現在の画面で扱える記録だけで、未読の元データは含みません。元データは保持しています。", exportContent: "書き出す内容", close: "閉じる", clear: "この一覧を空にする", confirm: "この一覧だけを空にしますか？招待コードと他の一覧は残ります。", undo: "削除を元に戻す", undoBlocked: "件数上限または同じ手掛かりとの重複により、全件を戻せません。現在の一覧は変更していません。",
    omitted: "元の一覧に、この画面では扱えない {count} 件があります。元データは保持しています。",
    storageError: "端末への保存が完了していません。元のデータは残し、編集中の内容はこの画面で保持しています。", retryStorage: "保存を再試行",
    pause: "保存して中断", resume: "続きから確認", skip: "この項目を見送る", pending: "未確認", reviewing: "確認中", completed: "確認完了", failed: "再確認が必要", paused: "中断・保存済み", clearFinished: "完了・見送りを一覧から除く",
    capacity: "追加 {added} 件、重複 {duplicate} 件、上限のため未追加 {rejected} 件", batch: "{done} / {total} 件を確認・見送り {skipped} 件・再確認 {failed} 件", imageBoundary: "画像は保存していません。必要な場合はもう一度選んでください。",
    issue: "この情報に問題がある", issueSent: "問題の種類を記録しました。事実は自動変更しません。", wrong_branch: "店舗・支店が違う", wrong_link: "リンクが違う", outdated_info: "情報が古い", unclear_condition: "条件がわかりにくい", other: "その他",
    budget: "今日の確認回数の上限に達しました。東京時間の翌日0時以降にお試しください。保存したリストと入力は引き続き使えます。"
  },
  en: {
    recoveryTitle: "Records could not be read", recoveryBody: "Unreadable does not mean empty. Original data remains intact. Retry above or export the available records before deciding what to clear.",
    navLabel: "Restaurant records on this device", navQueue: "To check", navSaved: "Want to go", navHistory: "Recent", manageList: "Manage list", savedEmptyBody: "After checking a restaurant, use Save plan on the result page to add it here.", noSearchResults: "No matching records", noSearchResultsBody: "Try another name or note, or show all records.", resetSearch: "Show all records", queueEmptyTitle: "No restaurants waiting to be checked", queueEmptyBody: "Start with one restaurant. To prepare several names, expand Add several restaurants below.",
    actionBoundary: "You selected this restaurant candidate. Confirm opening, availability and booking conditions with the restaurant or booking service. Opening a link does not make a booking.", uncertainBoundary: "There is not enough information to decide how to visit. Check with the restaurant.", exampleActionBody: "This is a sample. These buttons do not open external pages or make phone calls.", exampleActionDone: "Sample action completed. No external page, phone call or booking was opened.", backToList: "Back to list",
    open: "View device record", recheck: "Check current information", localOnly: "This is your device record. Opening it does not fetch restaurant information.",
    note: "Personal note", search: "Search names and notes", save: "Save record", newPlan: "Save as another plan", progress: "My progress", want_to_go: "Want to go", reserved_by_user: "Booked (your record)", visited: "Visited", skipped: "Skip for now",
    unknownTime: "Retrieval time unknown", reviewTime: "Last review", noReview: "No review recorded", resultTime: "This check", branchConfirmTime: "Time you selected this restaurant", times: "Sources and retrieval times", timeBoundary: "Retrieval time does not guarantee opening, availability or a confirmed booking. Cached information retains its original time.",
    export: "Export this list", download: "Save file", exportPreview: "View content or save manually", exportBody: "Export your device records. Retrieved restaurant information and images are excluded. If the download does not start, display and copy the content.", exportIncomplete: "Loading or saving is incomplete. This export includes only records available in this page; unread original data is excluded and remains intact.", exportContent: "Export content", close: "Close", clear: "Clear this list", confirm: "Clear only this list? Your access code and other lists remain.", undo: "Undo deletion", undoBlocked: "The list limit or duplicate clues prevent restoring every item. Your current list has not changed.",
    omitted: "The original list contains {count} entries this page cannot handle. Original data remains intact.",
    storageError: "Device saving is incomplete. The original data remains and your edits are kept in this page.", retryStorage: "Retry saving",
    pause: "Save and pause", resume: "Continue this check", skip: "Skip this item", pending: "Unchecked", reviewing: "Checking", completed: "Check completed", failed: "Needs another check", paused: "Paused and saved", clearFinished: "Remove completed and skipped items",
    capacity: "Added {added}; duplicates {duplicate}; not added due to capacity {rejected}", batch: "{done} / {total} checked · {skipped} skipped · {failed} to retry", imageBoundary: "Images are not saved. Select the image again if it is needed.",
    issue: "Report a problem", issueSent: "Issue category recorded. Facts are not automatically changed.", wrong_branch: "Wrong restaurant or branch", wrong_link: "Wrong link", outdated_info: "Outdated information", unclear_condition: "Unclear condition", other: "Other",
    budget: "Today's check limit has been reached. Try after midnight Tokyo time. Your lists and input remain available."
  },
  "zh-CN": {
    recoveryTitle: "暂时无法读取记录", recoveryBody: "无法读取不代表没有记录，原数据仍保留。请先使用上方重试或导出可读记录，再决定是否清空。",
    navLabel: "本机餐厅记录", navQueue: "待核对", navSaved: "想去", navHistory: "最近确认", manageList: "管理列表", savedEmptyBody: "确认餐厅后，在结果页点击“保存计划”即可加入想去列表。", noSearchResults: "没有匹配的记录", noSearchResultsBody: "换一个店名或备注关键词，或显示全部记录。", resetSearch: "显示全部记录", queueEmptyTitle: "没有待核对的餐厅", queueEmptyBody: "先确认一家餐厅；如果有多个店名，可以展开下方“批量添加餐厅”来准备线索。",
    actionBoundary: "你已选择此餐厅候选。营业、空席和预约条件仍需向餐厅或预约平台最终确认。仅打开链接不会完成预约。", uncertainBoundary: "信息不足，尚不能确定到店方式，需要向餐厅核对。", exampleActionBody: "这是操作示例，点击按钮不会打开外部页面或拨打电话。", exampleActionDone: "已体验示例操作，没有打开外部页面、拨打电话或发起预约。", backToList: "返回列表",
    open: "查看本机记录", recheck: "核对最新信息", localOnly: "这是本机保存的记录，仅打开不会获取餐厅信息。",
    note: "个人备注", search: "搜索店名或备注", save: "保存记录", newPlan: "另存为不同计划", progress: "我的进度", want_to_go: "想去", reserved_by_user: "本人记录：已预约", visited: "已去", skipped: "暂时跳过",
    unknownTime: "获取时间未知", reviewTime: "上次核对", noReview: "暂无核对记录", resultTime: "本次核对", branchConfirmTime: "本人选择门店的时间", times: "信息源与获取时间", timeBoundary: "获取时间不保证营业、空席或预约成立。缓存沿用原获取时间。",
    export: "导出此列表", download: "保存文件", exportPreview: "查看内容或手动保存", exportBody: "导出本机记录，不包含获取的餐厅详情或图片。若下载未开始，可以展开内容并复制保存。", exportIncomplete: "读取或保存尚未完成。此导出仅含当前页面能够处理的记录，不含尚未读到的原始记录；原数据仍保留。", exportContent: "导出内容", close: "关闭", clear: "清空此列表", confirm: "仅清空此列表？邀请码和其他列表会保留。", undo: "撤销删除", undoBlocked: "列表容量或重复线索使部分记录无法恢复，当前列表未被更改。",
    omitted: "原始列表有 {count} 项无法在当前页面处理，原数据仍保留。",
    storageError: "本机保存尚未完成。原始数据仍保留，当前编辑内容保存在此页面内存中。", retryStorage: "重试保存",
    pause: "保存并暂停", resume: "继续核对", skip: "跳过此项", pending: "待核对", reviewing: "核对中", completed: "核对完成", failed: "需要重试", paused: "已暂停并保存", clearFinished: "移除已完成或跳过的条目",
    capacity: "新增 {added} 项，重复 {duplicate} 项，达到上限未导入 {rejected} 项", batch: "已核对 {done} / {total} 项 · 跳过 {skipped} 项 · 待重试 {failed} 项", imageBoundary: "未保存原图，需要时请重新选择图片。",
    issue: "报告信息问题", issueSent: "已记录问题分类，不会自动修改事实。", wrong_branch: "餐厅或分店错误", wrong_link: "链接错误", outdated_info: "信息过期", unclear_condition: "条件不清楚", other: "其他",
    budget: "今日核对次数已达上限，请在东京时间次日零点后重试。已存列表和输入仍可使用。"
  }
};
export function taskCopy(locale, key, variables = {}) {
  return String((COPY[locale] || COPY.ja)[key] || key).replace(/\{(\w+)\}/g, (_, name) => variables[name] ?? "");
}
