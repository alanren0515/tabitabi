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
      step: "Invitation-only pilot", title: "A friend sent you a restaurant clue? Try TabiTabi.", intro: "Spend about 15 minutes checking one real restaurant you found on public SNS.",
      taskTitle: "Just three things", tasks: ["Add the restaurant name or a public SNS screenshot.", "Confirm the correct restaurant.", "Tell us what you thought on the result page."],
      safetyBody: "No booking, payment, or phone call. Use public content only. Images are not saved to TabiTabi’s server disk.",
      email: "Email to get your code", haveCode: "I already have a code"
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
      step: "邀请测试", title: "朋友发来一家店？用 TabiTabi 确认一下。", intro: "用大约15分钟，确认一家你在公开 SNS 上发现的真实餐厅。",
      taskTitle: "只做三件事", tasks: ["添加餐厅名称或公开 SNS 截图。", "确认正确的餐厅。", "在结果页告诉我们你的感受。"],
      safetyBody: "不需要预约、付款或打电话；只使用公开内容；图片不会保存到 TabiTabi 服务器磁盘。",
      email: "邮件获取访问码", haveCode: "我已有访问码"
    }
  }
};

const PUBLIC_CONTENT = {
  en: {
    terms: {
      intro: "Effective {date} · Applies to the publicly available TabiTabi service.",
      sections: [
        ["Service scope", "TabiTabi organizes screenshots and text you submit and summarizes public restaurant information. It is not a restaurant, travel agency, or booking agent, and using it alone never creates a reservation."],
        ["Booking and final verification", "Opening a booking page, calling, or saving a plan does not confirm a reservation. Before submitting, verify the restaurant, branch, address, date, time, party size, price, fees, cancellation terms, allergies, dietary needs, and accessibility requirements with the restaurant or booking service."],
        ["External services and charges", "Google Maps, Hot Pepper Gourmet, Tabelog, TableCheck, Gurunavi, and other external services operate under their own terms and privacy policies. Cover charges, service fees, prepayment, or cancellation fees may apply."],
        ["Your submissions", "Submit only content you are entitled to use. Do not upload private messages, confidential material, personal data about others, or content that infringes rights. You retain rights in your content and grant TabiTabi only the limited permission needed to process it for the requested check."],
        ["Prohibited conduct", "Do not harass restaurants, automate excessive requests, bypass access or provider restrictions, probe security, disrupt the service, impersonate others, or use the service unlawfully."],
        ["Changes and suspension", "We may change, restrict, or suspend features to protect users, providers, budgets, or service integrity. Important changes will be reflected on this page with an updated effective date."],
        ["Availability and liability", "We take reasonable care but do not guarantee uninterrupted access or that every external fact is complete or current. To the extent permitted by law, TabiTabi is not responsible for losses caused by decisions made without completing the final checks described above."],
        ["Governing law and contact", "Japanese law governs these terms. Please contact the operator first about questions or disputes. Mandatory consumer protections and the jurisdiction required by applicable law remain unaffected."]
      ]
    },
    privacy: {
      intro: "Updated {date} · This notice explains how the public TabiTabi service handles information and how to contact us about it.",
      providersBody: "When you add an image, it is sent through TabiTabi to Alibaba Cloud Model Studio/Qwen in the Singapore international region; OpenAI may receive it only as a configured fallback. Google Places receives restaurant search terms and Place IDs. Recruit/Hot Pepper receives a confirmed name, address, or phone for matching. Fly.io hosts the service in Tokyo. After confirmation, the server may read bounded public HTML from a verified official restaurant site. Each provider processes data under its own terms and safeguards.",
      metricsBody: "We record privacy-limited events such as input type, candidate confirmation, action clicks, success state, latency, token usage, and feedback you choose to submit. We do not store source images on TabiTabi's server disk, and do not log the original search text, exact visit date, or API keys. Operational logs are normally retained for up to 30 days and are also capped by file size and record count.",
      rightsTitle: "Requests, questions, and complaints", rightsBody: "Contact the operator by email to ask about access, correction, deletion, suspension of use, or other handling of personal information. We may need enough information to verify the request and locate relevant records. Because there is no account and operational events are deliberately de-identified, some records cannot be linked back to a particular person.",
      retentionTitle: "Retention and overseas processing", retentionBody: "Local plans and settings remain in your browser until you delete them. TabiTabi operational logs are normally retained for up to 30 days. Image analysis may involve processing in Singapore and, only if fallback is enabled and used, by OpenAI. Provider-side retention and international transfer safeguards follow each provider's applicable terms and settings. Do not put personal information in optional feedback unless it is necessary."
    },
    pilot: {
      step: "Public beta", title: "Turn an SNS find into a usable next step.", intro: "TabiTabi is available as a public beta for people who discover restaurants on Instagram, TikTok, and other SNS.",
      joinTitle: "Try TabiTabi now", joinBody: "No invitation code is required. Start with a restaurant name, link, or public SNS screenshot, and verify every booking on the final restaurant or booking-service screen.", email: "Contact the operator", haveCode: "Start checking a restaurant"
    }
  },
  "zh-CN": {
    terms: {
      intro: "生效日期：{date} · 适用于公开提供的 TabiTabi 服务。",
      sections: [
        ["服务范围", "TabiTabi 会整理你提交的截图和文字，并汇总公开餐厅信息。TabiTabi 不是餐厅、旅行社或代订平台，仅使用本服务不会形成预约。"],
        ["预约与最终核对", "打开预约页、拨打电话或保存计划都不代表预约成功。提交前请向餐厅或预约平台核对餐厅、分店、地址、日期、时间、人数、价格、手续费、取消条件、过敏、饮食限制和无障碍需求。"],
        ["外部服务与费用", "Google Maps、Hot Pepper、食べログ、TableCheck、ぐるなび等外部服务适用各自的条款和隐私政策，可能产生座位费、系统费、预付款或取消费。"],
        ["你提交的内容", "请只提交你有权使用的内容。请勿上传私信、机密信息、他人的个人信息或侵权内容。内容权利仍归你所有；你仅授予 TabiTabi 为完成本次查询所必需的有限处理权限。"],
        ["禁止行为", "请勿骚扰餐厅、大量自动访问、绕过访问或供应商限制、探测安全漏洞、干扰服务、冒充他人或从事违法活动。"],
        ["变更与暂停", "为保护用户、供应商、预算或服务安全，我们可能变更、限制或暂停功能。重要变更会在本页更新生效日期。"],
        ["可用性与责任", "我们会采取合理措施，但不保证服务不中断，也不保证所有外部信息始终完整或最新。在法律允许的范围内，因未完成上述最终核对而作出的决定所产生的损失，不由 TabiTabi 承担。"],
        ["适用法律与联系", "本条款适用日本法律。如有问题或争议，请先联系运营者；适用法律规定的消费者保护和管辖规则不受影响。"]
      ]
    },
    privacy: {
      intro: "更新日期：{date} · 本页说明公开版 TabiTabi 如何处理信息，以及如何联系我们。",
      providersBody: "添加图片时，图片会经由 TabiTabi 发送到阿里云 Model Studio/Qwen 的新加坡国际区域；只有在已配置且需要兜底时才可能发送给 OpenAI。Google Places 会收到餐厅搜索词和 Place ID；Recruit/Hot Pepper 会收到已确认的店名、地址或电话用于匹配；Fly.io 在东京托管本服务。确认餐厅后，服务器还可能读取经过限制的餐厅官方公开网页。各供应商依据其条款和安全措施处理数据。",
      metricsBody: "我们记录经过隐私限制的事件，例如输入类型、候选确认、行动点击、成功状态、耗时、token 用量，以及你主动提交的反馈。TabiTabi 不把原始图片保存到服务器磁盘，也不记录原始搜索文字、具体到店日期或 API Key。运行日志通常最多保留30天，同时受文件大小和记录数量上限约束。",
      rightsTitle: "查询、更正、删除与投诉", rightsBody: "你可以通过邮件联系运营者，提出查询、更正、删除、停止使用或其他个人信息处理请求。我们可能需要足够的信息确认请求人并定位相关记录。由于当前没有账号，且运行事件经过刻意去标识化，部分记录无法关联到某位用户。",
      retentionTitle: "保留期限与境外处理", retentionBody: "本机计划和设置会保留在浏览器中，直到你主动删除。TabiTabi 运行日志通常最多保留30天。图片识别可能在新加坡处理；仅在启用且触发兜底时，OpenAI 也可能处理图片。供应商侧的保留期限和跨境保护措施适用其各自条款与设置。除非确有必要，请勿在可选反馈中填写个人信息。"
    },
    pilot: {
      step: "公开测试版", title: "把 SNS 里发现的店，变成可以行动的信息。", intro: "TabiTabi 公开测试版面向会从 Instagram、TikTok 等 SNS 发现餐厅的用户开放。",
      joinTitle: "现在开始使用", joinBody: "无需邀请码。输入餐厅名称、链接或公开 SNS 截图，并在餐厅或预约平台最终页面自行确认预约是否成立。", email: "联系运营者", haveCode: "开始确认餐厅"
    }
  }
};

export function localizedLegalContent(locale, { publicRelease = false } = {}) {
  const base = CONTENT[locale];
  if (!base) return null;
  if (!publicRelease) return base;
  const overrides = PUBLIC_CONTENT[locale];
  return {
    ...base,
    terms: { ...base.terms, ...overrides.terms },
    privacy: { ...base.privacy, ...overrides.privacy },
    pilot: { ...base.pilot, ...overrides.pilot }
  };
}
