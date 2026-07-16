# 日本餐厅预约平台覆盖

TabiTabi 不把“存在店铺页面”当作“可以预约”，也不把“已提交”当作“预约成功”。所有第三方入口先映射到统一能力，再由证据门控决策选择行动。

## 统一能力

| `capability.kind` | 用户含义 | 成功边界 |
| --- | --- | --- |
| `online_reservation_flow` | 明确的线上预约路径 | 完成确认页或收到确认通知 |
| `provider_booking_flow` | 平台决定即时确认、请求确认或代为联系 | 收到平台或餐厅明确确认 |
| `waitlist_flow` | 排队取号 | 不是订座，也不保证到店即入座 |
| `phone_confirmation` | 直接电话询问 | 餐厅口头明确接受后成立 |
| `platform_listing` | 已核对的平台店铺页 | 仍需确认是否有预约按钮 |
| `official_information` | 餐厅官网 | 只说明官网可信，未证明有空位 |
| `external_information` | Google Maps 所列但未独立核验的网站 | 不能称为餐厅官网，也不能证明支持预约 |
| `discovery` | 平台搜索入口 | 尚未核对是否为同一家店 |

## 当前 provider registry

平台按产品用途分层，而不是按知名度堆按钮：

- P0 核心覆盖：餐厅官网/电话、Hot Pepper、Tabelog、TableCheck、Rakuten Gurunavi、Reserve with Google。
- P1 重要场景：一休、OMAKASE、Pocket Concierge、TABLEALL、OpenTable，以及餐厅官网常见的 Toreta、ebica 预约表单。
- P2 补充覆盖：EPARK、PayPay Gourmet、OZmall、ヒトサラ、SAVOR JAPAN、Retty、byFood，以及访日游客使用的 Foodies Reserve、JPNEAZY、My Concierge Japan、JapanFoodTravel。
- 谨慎入口：AutoReserve 只有在已核验餐厅官网明确链接时才可成为建议动作；Google Maps 所列或用户粘贴的链接只展示为未独立核验入口。

| 平台 | 当前识别 | 保守处理 |
| --- | --- | --- |
| Hot Pepper | 店铺页及明确 `/yoyaku` 路径 | 店铺页仍为 listing；预约路径标为平台决定确认方式 |
| Tabelog | 店铺页、当前 `/booking/form/new`、旧 `yoyaku/net_booking_form` 与 `ai_request_booking` 请求路径 | 普通页保持 listing；网络表单与请求预约分开标记，请求预约需等待成立通知 |
| TableCheck | `/shops/{shop}/reserve` | 明确线上预约，提示信用卡、预付与取消条款 |
| Rakuten Gurunavi | `gnavi.co.jp`、`gurunavi.com`、`gorp.jp` | 默认 listing；`gorp.jp` 不冒充餐厅官网 |
| 一休餐厅 | 数字餐厅页的 plan 路径 | 套餐预约；提示预付、服务费与取消条件 |
| OMAKASE | `/r/{restaurant}` 等预约路径 | 高端餐厅预约；提示登录、候补、信用卡与预付 |
| Pocket Concierge | 普通 restaurant 页；明确 reserve/reservation/booking 子路径 | 普通页保持 listing；明确操作路径才升级预约流程 |
| TABLEALL | 普通首页与 `/restaurant/{id}` 餐厅预约页 | 餐厅页标为平台决定的预购席位或请求预约，并提示预约费和最终确认边界 |
| OpenTable | `/r/{restaurant}` | 线上预约；确认页或通知才算成功 |
| Reserve with Google | 仅识别 `google.com/maps/reserve/...` 明确预约路径 | 普通 Google 搜索和 Maps 店铺页不升级；预约可能即时、请求或跳转合作平台，确认邮件才成立 |
| EPARK | waitlist/faspa/junban/queue 路径 | 只标记排队取号，不声称保留座位 |
| AutoReserve | 普通 restaurant 页；明确 reserve/reservation/booking 子路径 | 普通页保持 listing；明确入口才标平台预约/代订，并等待最终确认 |
| ヒトサラ | `hitosara.com` / `reserve.hitosara.com` | 普通页保持 listing；不从店铺页推断即时或请求预约 |
| SAVOR JAPAN | 普通店页与 reserve/reservation/booking 路径 | 明确路径标为平台决定的即时或请求预约，最终通知才成立 |
| Toreta | `yoyaku.toreta.in` 餐厅表单 | 明确线上预约表单，完成确认才成立 |
| ebica | `booking.ebica.jp` 的 webrsv/reserve 路径 | 明确线上预约表单，需核对分店和取消条款 |
| PayPay Gourmet | 普通店铺页及 `/{restaurant}/plan{plan}` 套餐路径 | 普通店铺页保持 listing；明确套餐页升级为线上预约流程，仍需核对即时/请求预约、在线支付与取消条件 |
| OZmall | 普通餐厅页及 `/restaurant/{id}/plan/{plan}` 套餐路径 | 普通餐厅页保持 listing；明确套餐页升级为线上预约流程，并提示套餐、支付和取消条件 |
| Retty | `retty.me` | 当前保守识别为平台店铺页；不混淆即时预约和请求预约 |
| byFood | `byfood.com` | 当前保守识别为平台店铺页；不推断预付套餐或代联络已可用 |
| Foodies Reserve | 多语言餐厅页 `/restaurants/{id}` | 标为平台决定的预约与结算流程；确认邮件才成立，提示手续费、信用卡和预付边界 |
| JPNEAZY | 多语言餐厅页 `/restaurants/{id}` | 标为付费请求预约；平台安排并按要求付款后才成立，提示餐费与手续费分离 |
| My Concierge Japan | `myconciergejapan.com/restaurants/{slug}` 介绍页与 `mycon-jp.net/reservation/...` 预约页 | 介绍页保持 listing；明确预约域名标为代订/预付流程并提示 concierge 服务费 |
| JapanFoodTravel | 人工代订服务入口 | 只标为付费代订服务页；提交咨询不等于餐厅接受预约 |

## 数据获取边界

- Hot Pepper 使用官方 Web Service 做餐厅信息补充，但 API 命中本身不证明该店开放网络预约。
- Google Places 用于店铺身份、地址、营业状态和官方/平台网站入口；Google Maps 中出现预约按钮仍要识别实际服务商。当前不为判断“可预约”额外请求高计费层级的 `reservable` 字段，只在已有明确 Google 预约 URL 时识别该流程。
- Google Maps 返回的未知域名网站默认只标为“Google Maps 所列网站”、中置信度；只有店名与地址进入核验 registry 后才升级为餐厅官网。
- Google Maps 返回的已知第三方预约平台也不自动获得推荐资格。它可以展示并按 host/path 说明可能的流程，但只有餐厅官网明确链接、Hot Pepper 店名/地址匹配或其他独立证据确认分店关联后，才能成为主行动。
- 其他平台当前采用餐厅官网外链和已核对 URL 规则，不抓取登录态、库存或结算页面。
- 用户直接粘贴已知预约平台 URL 时，只做 host/path 能力分类，不把它送入普通网页 HTML 提取器。单独链接不能证明对应分店或预约成立；必须补充餐厅线索并经 Places 候选确认。确认后该链接仍标为 `user_provided_external`、低可信且不可推荐；服务端按实际 URL 重新识别 provider，不信任客户端标签，已核验官网链接始终优先。
- 同一平台存在多个外链时，保留能力最强的明确预约路径；Hot Pepper API 或 Google 先提供普通店铺页时，也不会覆盖餐厅官网随后提供的直达预约链接。
- 没有平台官方库存合作权限时，产品只负责把用户送到可信入口，不代表用户执行预约，也不保存第三方账号或支付信息。

## 下一阶段

先完成 P0 平台的真实移动端审计，不按平台知名度跳过失败案例：

| 顺序 | 场景 | 必须证明的边界 |
| --- | --- | --- |
| 1 | Hot Pepper 普通店铺页 | 只显示 listing，不声称可以预约 |
| 2 | Hot Pepper 明确预约路径 | 显示平台决定的预约流程，并等待最终通知 |
| 3 | Tabelog 普通店铺页 | 只显示 listing 和费用提示 |
| 4 | Tabelog 当前 `/booking/form/new` 与旧 `net_booking_form` | 识别网络预约表单，但不声称有位或已成立 |
| 5 | Tabelog `ai_request_booking` | 明确是请求预约，需等待平台联系餐厅后的结果 |
| 6 | TableCheck 官网直链 | 识别线上预约，并提示担保、预付及取消条款 |
| 7 | Gurunavi / `gorp.jp` | 平台托管页不能冒充餐厅官网；普通页不升级为直订 |
| 8 | Reserve with Google | 普通 Maps 页面不升级，明确 reserve 路径才进入预约流程 |

每项审计必须保存：正确分店证据、390×844 或相近移动视口截图、原始 URL、TabiTabi 输出的 provider 与 capability、主行动、费用/确认提示，以及返回应用后的状态。只浏览到最终提交前一步，不登录用户账号、不提交真实预约、不输入信用卡、不占用席位。

P0 完成后依次审计一休、OMAKASE、Pocket Concierge、TABLEALL、OpenTable、Toreta、ebica、EPARK、PayPay Gourmet 和 OZmall。AutoReserve 单独放在谨慎轨道，只验证“未经官网核验不得推荐”的规则。

截至 2026-07-16，已在退出登录状态完成 9 个公开页面的桌面提交前导航检查：Hot Pepper 普通店铺页、Hot Pepper 明确预约路径、Tabelog 迁址旧店页、Tabelog 当前 `/booking/form/new` 登录边界、Tabelog 请求预约官方说明、Tabelog 请求预约适用门店 listing、Gurunavi 明确预约路径、Gurunavi `gorp.jp` 普通托管页、Reserve with Google 当前不可订边界。检查发现并修复了 Tabelog 当前 URL 形态，但新开的第三方标签页实际恢复为 1280×720，因此这些记录明确不计作 P0 手机审计。结构化记录保存在 `eval/platform-navigation-audits.json`，本地截图保存在被 Git 忽略的 `output/platform-audit/`；运行 `npm run eval:platform-navigation` 会复核 provider/capability、禁止登录/最终提交的边界和本地证据存在性。P0 各平台仍需在 390×844 或真实 Safari 重新完成移动证据；Tabelog 请求预约实际申请仅限 App 并要求电话认证，不应为完成审计而登录或发起请求。

Hot Pepper 后续如要从页面判断即时预约或请求预约，只接受平台允许使用的结构化证据或正式合作接口；不把 API 店铺命中、按钮文案猜测或抓取库存当成预约能力。若获得平台正式合作权限，再接入库存和确认状态；在此之前不模拟下单或保存支付资料。
