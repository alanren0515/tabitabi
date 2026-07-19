const CONTENT = {
  en: {
    terms: {
      step: "Terms of use", title: "Scope and responsibility", intro: "Effective {date} · Applies to the current invitation-only TabiTabi pilot.",
      highlightTitle: "Most important", highlightBody: "TabiTabi suggests a next step; it does not confirm a reservation. Check the restaurant or booking service's final screen, phone response, and confirmation email.",
      sections: [
        ["A service for organizing information and next steps", "TabiTabi organizes screenshots and text you provide and summarizes public restaurant information. It is not a restaurant, travel agent, or booking agent, and using this service alone never creates a reservation."],
        ["Confirm bookings with the restaurant or booking service", "Opening a booking page, calling, or saving a plan does not confirm a reservation. Treat it as confirmed only after the restaurant or booking service gives clear confirmation. Availability, hours, prices, fees, and cancellation terms may change."],
        ["You are responsible for the final check", "Before submitting, check the restaurant, branch, address, date, time, party size, price, and cancellation terms. For allergies, religious dietary needs, accessibility, or urgent health needs, contact the restaurant directly."],
        ["External services and fees", "Google Maps, Hot Pepper Gourmet, Tabelog, TableCheck, Gurunavi, and other external pages are operated by their providers under their own terms and privacy policies. Cover charges, service fees, prepayment, or cancellation fees may apply."],
        ["Fair use and pilot limitations", "Do not use the service for harassment, excessive automation, bypassing external restrictions, or illegal activity. The pilot may change, stop, or show errors. We show evidence and uncertainty but do not guarantee that all information is complete or current."]
      ],
      operator: "Operator", contact: "Contact", continue: "By continuing, you acknowledge this scope. See Privacy and data for how information is handled."
    },
    privacy: {
      step: "Privacy and data", title: "Control data on this device", intro: "Updated {date} · This page explains what the invitation-only pilot handles and what you can delete.",
      cards: [["saved plans", "Stored only in this browser."], ["restaurants to check", "Only restaurant clues are saved; not the source image."], ["recent checks", "A minimal history of up to 10 items."], ["server-stored images", "Images are processed in the request and are not written to TabiTabi's server disk."]],
      localTitle: "Stored on this device", localBody: "Plans, pending clues, recent checks, language and settings are stored locally. The static app shell may be cached for offline opening, but API responses, restaurant results, source images, post text, and engagement are not cached. Shared text and links are removed from the address bar and are not sent until you start checking.",
      providersTitle: "Sent when you request a check", providersBody: "Qwen receives an image only when you add one. Google Places receives restaurant search terms and Place IDs. Hot Pepper receives the confirmed name, address, or phone for matching. After confirmation, the server may read bounded public HTML from a verified official restaurant site to find booking links and explicit rules. Provider processing and retention follow each provider's terms.",
      metricsTitle: "Operational records", metricsBody: "We record privacy-limited events such as input type, candidate confirmation, action clicks, success state, latency, and token usage. Feedback records only the answers and optional comment you submit. We do not record the image, original search text, exact visit date, or API keys. There is no account, so aggregate operational records cannot be linked back and deleted through this device.",
      deleteTitle: "Delete data on this device", deleteBody: "Deletes local plans, pending clues, history, and settings. It does not delete data held by Google, Hot Pepper, Qwen, OpenAI, restaurants, or booking services.", deleteButton: "Delete data on this device", confirm: "Permanently delete all data on this device?", cancel: "Cancel", deleteAll: "Delete all"
    },
    pilot: {
      step: "Invitation-only pilot", title: "Turn an SNS find into a usable next step.", intro: "We invite people living in Japan who discover restaurants on Instagram, TikTok, and other SNS to try a 15–20 minute prototype.",
      criteria: [["18+ and living in Japan", "Use your usual iPhone or Android device."], ["Try a real restaurant search", "Use a public SNS screenshot or a restaurant name you genuinely want to check."], ["No purchase or booking required", "Confirm the restaurant and next step, then send feedback from the result page."]],
      taskTitle: "Check 2–4 restaurants", tasks: ["Add a public SNS screenshot or restaurant name.", "Confirm the extracted name and branch, then select the correct restaurant.", "Review official-site, phone, and booking-service guidance.", "Answer whether the result was helpful and accurate."],
      safetyTitle: "Safety and privacy", safetyBody: "Do not confirm a booking, pay, or call for this test. Do not use images containing DMs, notifications, private posts, or another person's personal information. Images are processed in the request and are not stored on TabiTabi's server disk.",
      joinTitle: "Contact us to receive an invitation code", joinBody: "After confirming the eligibility and safety notes, we will provide a pilot access code. Do not post the code publicly.", email: "Ask to join by email", haveCode: "I already have a code"
    }
  },
  "zh-CN": {
    terms: {
      step: "使用条款", title: "服务范围与责任", intro: "生效日期：{date} · 适用于当前 TabiTabi 邀请测试。",
      highlightTitle: "最重要的说明", highlightBody: "TabiTabi 只提供下一步建议，不代表预约已经成立。请以餐厅或预约平台的最终页面、电话答复和确认邮件为准。",
      sections: [
        ["本服务用于整理信息和下一步", "TabiTabi 会整理你提供的截图和文字，并汇总公开的餐厅信息。TabiTabi 不是餐厅、旅行社或代订平台，仅操作本服务不会形成预约。"],
        ["预约是否成立请向餐厅或预约平台确认", "打开预约页、拨打电话或保存计划都不代表预约成功。只有收到餐厅或预约平台的明确确认后，才应视为预约成立。空位、营业时间、价格、手续费和取消条件可能变化。"],
        ["最终核对由用户自行完成", "提交前请核对餐厅、分店、地址、日期、时间、人数、价格和取消条件。过敏、宗教饮食、无障碍或紧急健康需求必须直接向餐厅确认。"],
        ["外部服务与费用", "Google Maps、Hot Pepper、食べログ、TableCheck、ぐるなび等外部页面由各自运营方提供，并适用各自条款和隐私政策。可能产生座位费、系统费、预付款或取消费。"],
        ["合理使用与测试限制", "请勿用于骚扰餐厅、大量自动访问、绕过外部限制或违法活动。邀请测试期间可能变更、暂停或出现误差。我们会展示证据和不确定性，但不保证所有信息始终完整或最新。"]
      ],
      operator: "运营者", contact: "联系方式", continue: "继续使用即表示你理解上述范围。数据处理方式请查看“隐私与数据”。"
    },
    privacy: {
      step: "隐私与数据", title: "管理当前设备的数据", intro: "更新日期：{date} · 本页说明邀请测试会处理哪些数据，以及你能够删除的范围。",
      cards: [["条已保存计划", "只保存在当前浏览器。"], ["家待确认餐厅", "只保存餐厅线索，不保存原始图片。"], ["条最近确认", "最多保存10条必要历史。"], ["张服务器存图", "图片只在请求中处理，不写入 TabiTabi 服务器磁盘。"]],
      localTitle: "保存在当前设备", localBody: "计划、待确认线索、最近确认、语言和设置保存在本机。为离线打开页面，浏览器可能缓存静态应用文件，但不会缓存 API 响应、餐厅结果、原始图片、帖子正文或互动数据。分享进来的文字和链接会从地址栏删除，并且只有在你开始确认后才发送。",
      providersTitle: "发起确认时发送给外部服务", providersBody: "只有添加图片时，Qwen 才会收到图片。Google Places 会收到餐厅搜索词和 Place ID。Hot Pepper 会收到已确认的店名、地址或电话用于匹配。确认餐厅后，服务器可能读取经过限制的餐厅官方公开网页，用于查找预约入口和明确规则。各供应商的处理与保留期限适用其自身条款。",
      metricsTitle: "服务运行记录", metricsBody: "我们会记录经过隐私限制的事件，例如输入类型、候选确认、行动点击、成功状态、耗时和 token 用量。反馈只记录你提交的选项和可选评论。不会记录图片、原始搜索文字、具体到店日期或 API Key。当前没有账号，因此无法通过当前设备把汇总运行记录定位并删除。",
      deleteTitle: "删除当前设备的数据", deleteBody: "删除本机计划、待确认线索、历史和设置；不会删除 Google、Hot Pepper、Qwen、OpenAI、餐厅或预约平台持有的数据。", deleteButton: "删除当前设备的数据", confirm: "确定永久删除当前设备的全部数据吗？", cancel: "取消", deleteAll: "全部删除"
    },
    pilot: {
      step: "邀请测试招募", title: "把 SNS 里发现的店，变成可以行动的信息。", intro: "我们邀请居住在日本、会从 Instagram、TikTok 等 SNS 发现餐厅的用户，参加约15–20分钟的原型测试。",
      criteria: [["年满18岁并居住在日本", "使用你平时的 iPhone 或 Android。"], ["用真实需求测试", "使用公开 SNS 截图，或输入你真正想去的餐厅名称。"], ["无需购买或完成预约", "确认餐厅和下一步后，在结果页提交反馈即可。"]],
      taskTitle: "确认2–4家餐厅", tasks: ["添加公开 SNS 截图或餐厅名称。", "确认识别出的店名和分店，并选择正确餐厅。", "查看官网、电话和预约平台说明。", "回答结果是否有帮助、信息是否准确。"],
      safetyTitle: "安全与隐私", safetyBody: "测试不需要完成预约、付款或打电话。请勿使用包含私信、通知、非公开帖子或他人个人信息的图片。图片只在识别请求中处理，不保存到 TabiTabi 服务器磁盘。",
      joinTitle: "联系后获取邀请访问码", joinBody: "确认参与条件和注意事项后，我们会提供测试访问码。请勿公开发布访问码。", email: "通过邮件咨询参与", haveCode: "我已有访问码"
    }
  }
};

export function localizedLegalContent(locale) {
  return CONTENT[locale] || null;
}
