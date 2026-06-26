// 产品视角文档生成器（PM 用，无技术细节）：一份内容 → 两个 HTML
// 三级颗粒度：底部 Tab → 功能模块 → 功能点。零遗漏（对照 49 代理通读全代码的完整清单核对补齐）。
//   01_功能清单.html  —— Tab/模块/功能点 + 大白话描述（理解用）
//   02_验收清单.html  —— 同结构 + 怎么验 + 完成/未完成 + 备注（逐条验收用）
import fs from "fs";
import path from "path";
const DATE = "2026-06-26";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 功能点简写：n=名称 d=描述 h=怎么验 e=看到啥(预期)
const f = (n, d, h, e) => ({ n, d, h, e });

const TABS = [
  {
    key: "chat", tab: "智学", glyph: "智", accent: "#4a7359", soft: "#e7f0e8",
    sub: "AI 读书伙伴「小涤」", desc: "像聊微信一样和 AI 对话，帮你荐书、答疑、解读原文。不登录也能用，登录后更懂你。",
    modules: [
      { name: "对话与回答", features: [
        f("逐字流式回答", "提问后回答一个字一个字连续蹦出来，像真人打字。", "智学输入一个问题（如“推荐一本关于成长的书”）发送。", "回答连续逐字出现、不卡顿；长回答也能完整读完，不会中途空白。"),
        f("智能等待提示", "它在查书/思考时给“在翻书/在帮你查”的人话提示。", "问一个需要查书的问题。", "等待期间出现“翻开《某书》/在网上帮你查”之类提示，不是干转圈。"),
        f("回答排版与外链", "回答有标题、列表、加粗等排版；链接点开新网页。", "问一个回答较长、可能带链接的问题。", "排版清晰好读；链接在新页打开，不会把对话页顶掉。"),
      ]},
      { name: "智能卡片", features: [
        f("推荐书卡片", "荐书时给可点的书封卡片，读过的书标“已读完/在读”。", "问“给我推荐一本书”。", "出现横排书封卡片，点一下进书页；读过的书卡上有“已读完/在读N%”小标。"),
        f("原文出处卡片", "答疑时给依据的章节卡片，点一下跳到原文。", "问某本书某章讲了什么。", "回答下方出现“依据原文N处”卡片，点击跳到对应章。"),
        f("联网来源卡片", "时效问题联网查并附来源链接。", "问“最近/最新/近况”类问题。", "出现“来源N处”外链卡；非时效问题不会乱联网。"),
        f("卡片出现在正确位置", "卡片插在“理由之后、后话之前”的合适位置。", "问会同时出文字和卡片的问题。", "卡片出现在它该出现的话语位置，阅读顺序自然不突兀。"),
      ]},
      { name: "输入", features: [
        f("文字输入与发送", "输入框可多行、有字数上限、回车发送。", "在输入框打字、超长试试、回车发送。", "可多行输入；超 500 字有提示；回车发送（输入法选词时不会误发）。"),
        f("语音输入", "长按输入框说话转文字。", "长按输入框说一句话，松手；试试上滑取消。", "识别成文字填进输入框可改可删再发；上滑能取消。"),
      ]},
      { name: "个性化与记忆", features: [
        f("认得你的近况", "登录后欢迎语喊昵称、点出你在读的书。", "登录后进智学空白对话。", "问候喊你昵称，说出你在读的书/已读时长。"),
        f("专属示例问题", "按你的数据给可点的示例问题（游客用真实馆藏）。", "看欢迎区的示例问题。", "示例问题贴合你的阅读；点一下就能开聊。"),
        f("越聊越懂你", "记住你的阅读偏好、近况，跨对话也记得。", "告诉它你的偏好，过几轮再问相关。", "它延续你说过的偏好，不重复问。"),
        f("长对话不忘事", "对话很长也不丢前面聊过的内容。", "连聊很多轮后问“我们前面聊过的那本书”。", "仍记得早先讨论过的书/结论/偏好。"),
      ]},
      { name: "回答操作", features: [
        f("点赞 / 点踩 + 原因", "对回答点赞或点踩并选原因。", "对一条回答点踩→选原因。", "能选标签（推荐偏差/答疑有误等）并留备注。"),
        f("重新生成", "对回答不满意换个角度再答（带上踩的原因）。", "点踩选原因后点“重新生成”。", "换个角度重答，能体现你刚才的反馈。"),
        f("复制回答", "一键复制回答文本。", "点回答下方复制。", "提示“已复制”。"),
        f("停止生成", "回答太长随时停。", "回答进行中点“停止生成”。", "立刻停下，已出内容保留。"),
      ]},
      { name: "会话同步", features: [
        f("对话保存与跨设备同步", "对话自动存云端，换设备也接得上。", "聊几句→换个设备/浏览器登录同账号进智学。", "之前的对话还在、能接着聊。"),
        f("切 Tab / 重登仍在", "切去别的 Tab 再回来、或重新登录，对话不丢。", "聊几句→切到泡馆再回智学；或退出重登。", "对话内容仍在，不会清空。"),
        f("回看与回到最新", "向上翻看历史时停止自动滚动，并给“回到最新”。", "回答输出中向上滑看前面。", "不被强行拽回底部；出现“回到最新”按钮，点了回底部。"),
        f("体验账号不串档", "体验账号是大家共用，但各人的对话不会互相看到。", "用体验账号聊几句→换个浏览器/无痕再用体验账号进智学。", "看不到上一个人的对话内容（隐私不泄露）。"),
      ]},
    ],
  },
  {
    key: "library", tab: "泡馆", glyph: "泡", accent: "#b08d57", soft: "#f4ecdb",
    sub: "分类书库 + 文字/音频/视频阅读", desc: "逛书库、读书、听书、看视频解读，划线写笔记、写书评，都在这里。",
    modules: [
      { name: "泡馆首页", features: [
        f("分类网格", "首页按分类入口进入。", "打开泡馆。", "看到各分类入口，点击进入对应分类。"),
        f("每类最新 Banner", "每个分类最新入库的一本作 Banner。", "看首页 Banner。", "展示每类最新的书，可点进。"),
        f("继续阅读", "首页给你在读的书续读入口。", "登录且有在读的书时看首页。", "出现“继续阅读”，点击直接续读。"),
        f("热门好书", "首页推荐热门好书列表。", "看首页热门好书。", "列出热门好书（已读完的不再出现）。"),
      ]},
      { name: "分类书库页", features: [
        f("进入分类看全部", "某分类下全部书。", "点一个分类。", "列出该分类的书。"),
        f("类型筛选", "音视频 / 文字稿 切换。", "在分类页切“音视频/文字稿”。", "列表按类型过滤。"),
        f("已读 / 未读状态", "书上标已读/未读。", "看列表里书的状态标。", "读过的标“已读”，未读的标“未读”，与实际一致。"),
        f("无限滚动加载", "往下滚自动加载更多。", "往下滑到底。", "自动续上更多、不重复、不漏。"),
      ]},
      { name: "搜索", features: [
        f("搜书名/作者/标签", "关键词搜书。", "点搜索输入关键词。", "出相关结果。"),
        f("最近搜过", "记住最近搜索词。", "搜几个词后回到搜索落地页。", "“最近搜过”里有刚搜的词，可点可删。"),
        f("热门搜索", "展示热门搜索词。", "看搜索落地页“热门搜索”。", "有热门词，点了必有结果。"),
        f("返回保留搜索词与结果", "搜了点进书再返回，词和结果还在。", "搜词→点进一本书→返回。", "搜索词和结果列表都还在，不用重打。"),
      ]},
      { name: "书籍详情页", features: [
        f("简介/标签/字数", "封面氛围图、简介、标签、字数。", "点开一本书。", "信息完整，简介可“展开全文”。"),
        f("章节目录", "文字书展示章节清单。", "看详情页“文字全文”区。", "列出章节，点章进入阅读。"),
        f("收藏 / 取消", "收藏这本书。", "点“收藏”。", "变“已收藏”，去我的能看到；刚进页面不先闪错状态。"),
        f("阅读入口", "开始/继续阅读、播放音视频。", "看详情页底部按钮。", "文字书显“开始/继续阅读”；音视频书显“播放”。"),
      ]},
      { name: "文字阅读器", features: [
        f("正文阅读", "正文排版清晰。", "进入阅读器。", "正文字体/行距/排版舒适。"),
        f("目录与翻章", "目录抽屉 + 上一章/下一章。", "点目录、点上/下一章。", "能切章，目录定位当前章。"),
        f("进度显示", "本章进度 + 全书进度。", "读时看底部进度。", "显示本章 X% / 全书 Y%，随滚动前进。"),
        f("续读回原位", "回到上次读到的精确位置。", "读到某章中间退出→再“继续阅读”。", "回到你离开时的滚动位置（不是甩回章首）。"),
        f("沉浸模式", "点正文中部隐藏顶/底栏。", "点正文纵向中间区域。", "顶栏底栏隐藏，再点恢复。"),
        f("阅读设置", "字号/背景/亮度可调。", "点设置调整。", "字号/背景/亮度实时生效。"),
        f("读毕仪式", "整本读完盖“读毕”印 + 写书评入口。", "把一本书全部章读完。", "出现“读毕”印章和写书评入口。"),
      ]},
      { name: "划线与笔记", features: [
        f("划线高亮", "选中正文打高亮，多色。", "长按选一段文字选颜色。", "选中文字被完整标色；刷新后仍在。"),
        f("写笔记", "对划线写想法。", "选中文字→“笔记”→写一句保存。", "保存成功；我的笔记里能看到。"),
        f("换色 / 删除划线", "点已有划线换色或删除。", "点正文里的高亮。", "可换颜色、写/改想法、删除（删了能撤销）。"),
      ]},
      { name: "音频播放器", features: [
        f("播放 / 暂停", "口播音频播放控制。", "详情页切音频播放。", "能播能停。"),
        f("±15 秒与倍速", "后退/快进 15 秒、调倍速。", "点 ±15、切倍速。", "前后跳 15 秒；倍速生效。"),
        f("锁屏控制", "锁屏/控制中心可控。", "播放中锁屏。", "锁屏显示书名封面，可暂停/播放/±15。"),
        f("续播位置", "下次从上次位置接着听。", "听到中段退出再进。", "从上次位置接着播。"),
      ]},
      { name: "视频播放器", features: [
        f("播放 / 暂停", "竖屏视频播放控制。", "详情页播放视频。", "能播能停。"),
        f("竖屏全屏", "进入/退出全屏。", "点全屏按钮。", "竖屏全屏，返回手势退全屏不退页面。"),
        f("倍速", "调播放倍速。", "切倍速。", "倍速生效。"),
        f("拖动进度", "拖进度条定位。", "拖进度条。", "能定位，松手到位。"),
        f("续播位置", "下次从上次位置接着看（与音频/乱翻共享）。", "看到中段退出再进。", "从上次位置接着播。"),
      ]},
      { name: "书评", features: [
        f("写书评", "评分 + 写内容。", "详情页点“写书评”填写提交。", "提交后详情页“我的评价”显示你的书评。"),
        f("更新书评", "改自己的书评。", "再次点“更新书评”。", "内容更新成功。"),
        f("我的评价展示", "详情页只显你自己那条。", "看详情页“我的评价”。", "展示本人书评（头像昵称为当前账号）。"),
      ]},
    ],
  },
  {
    key: "flip", tab: "乱翻", glyph: "乱", accent: "#b04a3c", soft: "#f6e6e2",
    sub: "竖滑视频流（像刷抖音）", desc: "上下滑发现好书的视频解读，双击收藏、随手写书评。",
    modules: [
      { name: "视频流", features: [
        f("竖滑切条", "上下滑一屏一本书。", "打开乱翻上下滑。", "一屏一条，滑动跟手不卡。"),
        f("自动播放", "滑到哪播哪，划走自动停。", "停在某条。", "当前自动播放，划走自动暂停。"),
        f("无限续拉", "一直滑自动续更多。", "持续往下滑。", "自动续上、不突然没了、不紧挨重复同一本。"),
        f("离开返回保持位置", "去别处再回乱翻，停在原位。", "滑几条→去写书评/详情→返回乱翻。", "回到刚才那条、那个画面。"),
      ]},
      { name: "播放控制", features: [
        f("声音开关", "静音/外放，含被拦兜底提示。", "点右上喇叭。", "切静音/外放；被浏览器拦时提示“轻点开启声音”。"),
        f("进度条拖动", "拖底部进度条定位。", "拖底部细进度条。", "能定位、显示当前/总时长。"),
        f("续播与详情页共享(不被污染)", "乱翻↔详情页进度互通；但拖进度/视频循环不会弄乱。", "详情看到中段→乱翻滑到这本(或反过来)；再让视频循环回开头或拖一下进度条退回详情。", "从同一进度接着播；循环回开头/拖进度后续播点不被打回开头。"),
        f("坏视频转图文", "视频放不出给图文出路。", "遇到无法播放的视频。", "出现“重试”和“看图文详情”，不一直转圈。"),
      ]},
      { name: "互动", features: [
        f("双击收藏", "双击屏幕收藏，有心形动画。", "双击视频。", "心形动画爆开，加入收藏。"),
        f("右侧心形收藏", "点右侧心收藏。", "点右侧心形。", "收藏并提示。"),
        f("写书评入口", "随手写书评。", "点右侧评论图标。", "进入写书评。"),
      ]},
      { name: "个性化", features: [
        f("每日个性化书单", "结合你偏好每天更新推送。", "登录用户每天来逛。", "推的书贴合你偏好，已读完的不再推。"),
      ]},
    ],
  },
  {
    key: "me", tab: "我的", glyph: "我", accent: "#4f7a8c", soft: "#e4eef2",
    sub: "个人中心", desc: "登录注册、个人资料、收藏/笔记/书评/历史、设置与主题，都在这里。",
    modules: [
      { name: "个人中心首页", features: [
        f("资料展示", "头像、昵称、简介。", "打开我的。", "展示当前账号头像昵称简介。"),
        f("数据统计卡", "阅读时长/已读/进行中/收藏。", "看顶部四个数据卡。", "刚登录/冷启动不先闪“0”再跳；数字真实。"),
        f("菜单入口", "我的书评/笔记/设置/关于。", "看菜单。", "各入口可进。"),
        f("拉绳台灯主题", "拉绳切日/夜主题（彩蛋）。", "拉一下右上角台灯绳。", "日间/夜间切换，全站生效。"),
      ]},
      { name: "编辑资料", features: [
        f("改昵称/简介", "修改昵称和简介。", "点“编辑资料”改昵称简介保存。", "保存成功并生效。"),
        f("换 / 上传头像", "换预设或上传头像。", "在编辑资料里换/传头像。", "头像更新成功。"),
      ]},
      { name: "我的收藏", features: [
        f("收藏列表", "看收藏的书。", "点“收藏”卡。", "列出收藏的书，可进入。"),
      ]},
      { name: "我的笔记", features: [
        f("笔记列表", "看所有笔记。", "点“我的笔记”。", "列出笔记。"),
        f("跳回原文", "点笔记跳回书里位置。", "点一条笔记。", "跳回书里对应位置（即使被其它划线覆盖也能定位）。"),
      ]},
      { name: "我的书评", features: [
        f("书评列表", "看写过的书评。", "点“我的书评”。", "列出你的书评。"),
      ]},
      { name: "阅读历史", features: [
        f("已读 / 进行中视图", "按已读/进行中看。", "点“已读”或“进行中”卡。", "进入对应列表。"),
        f("数字与列表一致", "卡上数字和列表条数对得上。", "对比卡片数字与点进去的条数。", "数字 = 列表条数（同书音视频+文字不重复算）。"),
        f("删除 + 撤销", "删历史可撤销。", "删一条→点撤销。", "删除有“撤销”，撤回后顺序正常。"),
      ]},
      { name: "设置", features: [
        f("修改密码", "改登录密码（体验账号不可）。", "设置里改密码。", "本人账号可改；体验账号被拦。"),
        f("阅读偏好", "默认阅读方式等偏好。", "设置里调阅读偏好。", "设置生效。"),
        f("主题深浅色", "浅色/深色切换。", "设置里切主题。", "全站浅/深色切换。"),
        f("意见反馈", "提交意见反馈。", "设置里找反馈入口。", "能提交反馈。"),
        f("退出登录", "退出回游客态。", "点退出。", "回游客态，看不到上一账号数据。"),
        f("注销账号", "本人可注销清数据（体验账号不可）。", "设置里尝试注销。", "本人账号可注销；体验账号提示不可注销。"),
      ]},
      { name: "关于 / 法律", features: [
        f("关于", "关于本应用。", "点“关于”。", "正常打开。"),
        f("用户协议", "用户协议页。", "打开用户协议。", "正常展示。"),
        f("隐私政策", "隐私政策页。", "打开隐私政策。", "正常展示。"),
      ]},
    ],
  },
  {
    key: "global", tab: "全站通用", glyph: "通", accent: "#6b6459", soft: "#ece7db",
    sub: "贯穿所有页面的体验", desc: "不属于某一个 Tab、但每个页面都该正常的通用体验。",
    modules: [
      { name: "启动与导航", features: [
        f("开屏启动画面", "进入有开屏画面，可跳过。", "冷启动打开 App。", "显示开屏（约 3 秒）后进泡馆；可点“跳过”。"),
        f("底部 4 Tab 切换", "智学/泡馆/乱翻/我的 四个 Tab。", "依次点底部四个 Tab。", "都能切换，当前 Tab 高亮。"),
        f("二级返回不跳出", "返回箭头回馆内。", "从外部链接/分享打开一本书点左上返回。", "回到馆内，不弹出 App 到外部网站。"),
        f("页面转场", "页面切换有平滑动画。", "在各页之间跳转。", "切换有淡入/过渡，不生硬。"),
      ]},
      { name: "登录与守卫", features: [
        f("登录 / 注册弹层", "邮箱密码登录注册。", "点登录，试注册和登录。", "能注册/登录，错误有中文提示。"),
        f("体验账号一键登录", "无需注册一键体验。", "点“体验账号一键登录”。", "直接进入登录态。"),
        f("未登录拦截自动继续", "点需登录功能弹登录，登录后自动继续。", "游客点收藏/写笔记/进我的二级页。", "弹登录；登录后自动完成你刚才的操作。"),
        f("游客可逛", "不登录也能用核心功能。", "不登录浏览书库/刷乱翻/问智学。", "都能用；仅个性化和我的需登录。"),
      ]},
      { name: "健壮性兜底", features: [
        f("出错不白屏", "任何页面出错有中文兜底+重试。", "正常使用（异常时观察）。", "出错显中文“出了点小状况/重试”，不白屏，手机上字/钮大小正常可点。"),
        f("404 页", "访问不存在的页面有提示。", "打开一个不存在的地址。", "显示 404 中文提示+回首页出路。"),
        f("空状态友好", "没数据时有引导。", "新账号看收藏/笔记/历史。", "空列表有友好文案+去逛逛入口。"),
        f("不卡死在加载", "首屏/登录态恢复不会一直转圈。", "刷新各页、弱网进入。", "页面正常出来，不会永久卡在“正在打开”。"),
      ]},
      { name: "适配与基础", features: [
        f("手机安全区适配", "全面屏不被遮挡。", "用手机逛各页面。", "底部不被导航条压住，顶部不被刘海挡。"),
        f("深浅主题全站生效", "切主题所有页面跟着变。", "切深色后逛各页面。", "全站深/浅一致，无残留亮块。"),
        f("操作 Toast 提示", "收藏/保存/出错有轻提示。", "做收藏/保存/触发错误。", "出现简短中文提示（成功/失败）。"),
        f("添加到主屏(PWA)", "可添加到手机主屏。", "手机浏览器“添加到主屏幕”。", "能添加（图标在部分系统可能不显示，属已知小问题）。"),
        f("防刷限流", "短时间狂问会被温和拦一下。", "极短时间内连续大量提问。", "提示“歇口气，一分钟后接着聊”；正常节奏不被打断。"),
      ]},
    ],
  },
];

const totalFeatures = TABS.reduce((s, t) => s + t.modules.reduce((a, m) => a + m.features.length, 0), 0);

const CSS = `
:root{--paper:#f4efe4;--paper2:#fbf8f1;--card:#fffdf8;--ink:#33302a;--ink2:#6b6459;--ink3:#928a7b;--celadon:#4a7359;--gold:#b08d57;--cinnabar:#b04a3c;--line:#e2d9c6;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Serif SC","Songti SC","Source Han Serif SC",ui-serif,Georgia,serif;line-height:1.72;font-size:15px}
.wrap{max-width:1080px;margin:0 auto;padding:0 18px}
.hero{background:linear-gradient(135deg,#3f6452,#4a7359 60%,#5a8068);color:#f6f2e8;border-bottom:3px solid var(--gold)}
.hero .wrap{padding:36px 18px 28px}
.hero .kicker{letter-spacing:.34em;font-size:12px;opacity:.85;margin:0 0 8px}
.hero h1{margin:0;font-size:28px;font-weight:700;letter-spacing:.03em}
.hero .pos{margin:12px 0 0;max-width:790px;opacity:.95;font-size:14.5px}
.hero .stat{display:flex;gap:24px;margin-top:20px;flex-wrap:wrap}
.hero .stat b{font-size:24px;display:block;font-weight:700}
.hero .stat span{font-size:12px;opacity:.85}
.tabs{position:sticky;top:0;z-index:30;background:rgba(244,239,228,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.tabs .wrap{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 18px}
.tabchip{border:1px solid var(--line);background:var(--paper2);color:var(--ink2);border-radius:20px;padding:6px 13px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.tabchip.active{background:var(--celadon);color:#fff;border-color:var(--celadon)}
.seal{width:19px;height:19px;border-radius:5px;color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.module{margin:28px 0;scroll-margin-top:64px}
.mod-head{display:flex;gap:13px;align-items:flex-start;padding:14px 16px;border-radius:14px 14px 0 0;background:linear-gradient(180deg,var(--soft),transparent);border:1px solid var(--line);border-bottom:none}
.seal.big{width:42px;height:42px;border-radius:10px;font-size:22px;box-shadow:0 4px 12px -4px rgba(0,0,0,.3)}
.mod-head h2{margin:0;font-size:21px}
.mod-head .cnt{font-size:12px;color:var(--ink3);font-weight:400;margin-left:6px}
.mod-head .sub{font-size:12.5px;color:var(--celadon);margin:2px 0 0}
.mod-head .md{font-size:13px;color:var(--ink2);margin:5px 0 0}
.mbody{border:1px solid var(--line);border-top:none;border-radius:0 0 14px 14px;background:rgba(255,255,255,.35);padding:8px 14px 14px}
.submod{margin-top:14px}
.submod>.sh{display:flex;align-items:center;gap:8px;font-size:14.5px;font-weight:700;color:var(--celadon);margin:6px 0 8px}
.submod>.sh::before{content:"";width:13px;height:13px;background:var(--gold);transform:rotate(45deg);display:inline-block;flex:none}
.submod>.sh .scnt{font-size:11px;color:var(--ink3);font-weight:400}
.foot{margin:44px 0 28px;text-align:center;color:var(--ink3);font-size:12px}
.foot .gold{color:var(--gold)}
@media print{.tabs{display:none}.module,.feat,.item,.submod{break-inside:avoid}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

function buildFeatureList() {
  const tabBtns = TABS.map((t) => `<button class="tabchip" onclick="document.getElementById('m-${t.key}').scrollIntoView({behavior:'smooth',block:'start'})"><i class="seal" style="background:${t.accent}">${t.glyph}</i>${esc(t.tab)} <b>${t.modules.reduce((a, m) => a + m.features.length, 0)}</b></button>`).join("");
  const secs = TABS.map((t) => {
    const subs = t.modules.map((m) => {
      const cards = m.features.map((x) => `<div class="feat"><div class="fn">${esc(x.n)}</div><div class="fd">${esc(x.d)}</div></div>`).join("");
      return `<div class="submod"><div class="sh">${esc(m.name)} <span class="scnt">${m.features.length}</span></div><div class="grid">${cards}</div></div>`;
    }).join("");
    return `<section class="module" id="m-${t.key}" style="--soft:${t.soft}">
      <div class="mod-head"><i class="seal big" style="background:${t.accent}">${t.glyph}</i><div>
        <h2>${esc(t.tab)} <span class="cnt">${t.modules.length} 模块 · ${t.modules.reduce((a, m) => a + m.features.length, 0)} 功能点</span></h2>
        <p class="sub">${esc(t.sub)}</p><p class="md">${esc(t.desc)}</p></div></div>
      <div class="mbody">${subs}</div></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI 图书馆 · 功能清单</title><style>${CSS}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
.feat{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:9px;padding:10px 13px}
.fn{font-weight:700;font-size:14.5px}
.fd{margin-top:4px;font-size:13px;color:var(--ink2);line-height:1.65}
</style></head><body>
<div class="hero"><div class="wrap">
  <p class="kicker">AI 图书馆 · 功能清单（产品视角）</p>
  <h1>这个 App 有哪些功能</h1>
  <p class="pos">三级结构：底部 Tab → 功能模块 → 功能点。纯产品视角、大白话，不含技术细节。共 ${TABS.length} 个 Tab、${totalFeatures} 个功能点，已对照全代码核对、无遗漏。</p>
  <div class="stat"><div><b>${TABS.length}</b><span>功能模块(Tab)</span></div><div><b>${totalFeatures}</b><span>功能点</span></div><div><b>已上线</b><span>goodcontent.cn</span></div></div>
</div></div>
<div class="tabs"><div class="wrap">${tabBtns}</div></div>
<div class="wrap">${secs}<div class="foot">AI 图书馆 H5 · 功能清单 · ${DATE}<br/><span class="gold">东方典雅 · 古书新韵</span></div></div>
</body></html>`;
}

function buildAcceptance() {
  const tabBtns = `<button class="tabchip active" data-tab="all">全部</button>` +
    TABS.map((t) => `<button class="tabchip" data-tab="${t.key}"><i class="seal" style="background:${t.accent}">${t.glyph}</i>${esc(t.tab)}</button>`).join("");
  const secs = TABS.map((t) => {
    let mi = 0;
    const subs = t.modules.map((m) => {
      mi++;
      let fi = 0;
      const its = m.features.map((x) => {
        fi++;
        const id = `${t.key}-${mi}-${fi}`;
        return `<div class="item" data-id="${id}">
          <div class="ih"><span class="fn">${esc(x.n)}</span><span class="vmark" data-for="${id}"></span></div>
          <div class="fd">${esc(x.d)}</div>
          <div class="row"><span class="k">怎么验</span><span class="v">${esc(x.h)}</span></div>
          <div class="row"><span class="k">看到啥</span><span class="v">${esc(x.e)}</span></div>
          <div class="verdict">
            <label class="vb done"><input type="radio" name="v-${id}" value="done"><span>✓ 完成</span></label>
            <label class="vb todo"><input type="radio" name="v-${id}" value="todo"><span>✗ 未完成</span></label>
            <input class="note" data-id="${id}" placeholder="备注（未完成时写：哪里不对、怎么不对）"/>
          </div></div>`;
      }).join("");
      return `<div class="submod"><div class="sh">${esc(m.name)} <span class="scnt">${m.features.length}</span></div>${its}</div>`;
    }).join("");
    return `<section class="module" id="m-${t.key}" data-mod="${t.key}" style="--soft:${t.soft}">
      <div class="mod-head"><i class="seal big" style="background:${t.accent}">${t.glyph}</i><div>
        <h2>${esc(t.tab)} <span class="cnt">${t.modules.length} 模块 · ${t.modules.reduce((a, m) => a + m.features.length, 0)} 项</span></h2>
        <p class="sub">${esc(t.sub)}</p></div></div>
      <div class="mbody">${subs}</div></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI 图书馆 · 验收清单</title><style>${CSS}
.bar{height:9px;border-radius:5px;background:#e3dac7;overflow:hidden;display:flex}
.bar i{display:block;height:100%}.bar .d{background:#6f9b80}.bar .t{background:#cf6a5c}
.prog{flex:1;min-width:170px}.stat2{font-size:12px;color:var(--ink2);margin-top:4px}.stat2 b{color:var(--ink)}
.btn{border:1px solid var(--gold);background:#fff;color:#8a6d3b;border-radius:18px;padding:5px 13px;font:inherit;font-size:12.5px;cursor:pointer}
.btn:hover{background:#fbf3e3}
.note-box{background:#fdf6e3;border:1px solid #e7d9b0;border-radius:12px;padding:12px 16px;font-size:13px;color:#7a6326;margin:18px 0}
.item{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:10px;padding:11px 13px;margin:8px 0}
.item.s-done{border-left-color:#6f9b80;background:#f6faf4}
.item.s-todo{border-left-color:#cf6a5c;background:#fcf3f1}
.ih{display:flex;align-items:center;gap:8px}
.fn{font-weight:700;font-size:15px}
.vmark{margin-left:auto;font-size:14px;font-weight:700}
.fd{margin-top:4px;font-size:13px;color:var(--ink2)}
.row{display:flex;gap:9px;margin-top:5px;font-size:13px}
.row .k{flex:none;width:46px;color:#fff;background:var(--ink3);border-radius:5px;font-size:11px;font-family:system-ui;text-align:center;height:20px;line-height:20px}
.row .v{color:var(--ink2);flex:1}
.verdict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px;border-top:1px dashed var(--line);padding-top:9px}
.vb{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-family:system-ui;cursor:pointer;border:1px solid var(--line);border-radius:16px;padding:4px 13px;user-select:none}
.vb input{display:none}
.vb.done.on{background:#6f9b80;color:#fff;border-color:#6f9b80}
.vb.todo.on{background:#cf6a5c;color:#fff;border-color:#cf6a5c}
.note{flex:1;min-width:180px;border:1px solid var(--line);border-radius:8px;padding:6px 11px;font:inherit;font-size:12.5px;background:#fff}
.note:focus{outline:none;border-color:var(--celadon)}
.hide{display:none !important}
</style></head><body>
<div class="hero"><div class="wrap">
  <p class="kicker">AI 图书馆 · 验收清单（产品视角）</p>
  <h1>逐条验收 · 勾选即记</h1>
  <p class="pos">三级结构：底部 Tab → 功能模块 → 功能点。照“怎么验”操作、对照“看到啥”，选“完成/未完成”，不对就在备注写一句。共 ${totalFeatures} 项（已对照全代码核对、无遗漏），进度自动存本浏览器、刷新不丢。验完点“导出未完成”把问题清单复制发我——前端还是后端、怎么改我来处理，你不用碰技术。</p>
  <div class="stat"><div><b>${totalFeatures}</b><span>待验功能点</span></div><div><b>${TABS.length}</b><span>Tab</span></div><div><b>线上</b><span>goodcontent.cn</span></div></div>
</div></div>
<div class="tabs"><div class="wrap">
  <div class="prog"><div class="bar"><i class="d" id="bd"></i><i class="t" id="bt"></i></div>
    <div class="stat2"><b id="sd">0</b> 完成 · <b id="st">0</b> 未完成 · 共 <b>${totalFeatures}</b></div></div>
  ${tabBtns}
  <button class="btn" id="export">导出未完成</button>
  <button class="btn" id="reset">清空</button>
</div></div>
<div class="wrap">
  <div class="note-box">建议顺序：智学 → 泡馆 → 乱翻 → 我的 → 全站通用，一个 Tab、一个模块地过。不确定先空着；确认有问题选“未完成”并写清现象。</div>
  ${secs}
  <div class="foot">AI 图书馆 H5 · 验收清单 · ${DATE}<br/>东方典雅 · 古书新韵</div>
</div>
<div id="modal" class="hide" style="position:fixed;inset:0;z-index:80;background:rgba(40,38,32,.5);display:flex;align-items:center;justify-content:center;padding:20px">
  <div style="background:#fffdf8;border-radius:14px;max-width:720px;width:100%;max-height:80vh;overflow:auto;padding:20px;border:1px solid var(--line)">
    <h3 style="margin:0 0 8px">未完成清单（复制发我）</h3>
    <textarea id="etext" style="width:100%;height:300px;border:1px solid var(--line);border-radius:8px;padding:10px;font-family:Consolas,monospace;font-size:12px"></textarea>
    <div style="margin-top:10px;text-align:right"><button class="btn" id="copy">复制</button> <button class="btn" id="close">关闭</button></div>
  </div>
</div>
<script>
const KEY="ail-accept-pm-v2";const state=JSON.parse(localStorage.getItem(KEY)||"{}");
const items=[...document.querySelectorAll(".item")];const TOTAL=${totalFeatures};
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
function paint(el){const id=el.dataset.id,s=state[id]||{};el.classList.remove("s-done","s-todo");
  el.querySelectorAll(".vb").forEach(b=>b.classList.remove("on"));const m=el.querySelector(".vmark");m.textContent="";
  if(s.v){el.classList.add("s-"+s.v);const l=el.querySelector(".vb."+s.v);if(l)l.classList.add("on");
    m.textContent=s.v==="done"?"✓":"✗";m.style.color=s.v==="done"?"#4a7359":"#b04a3c";
    const r=el.querySelector('input[value="'+s.v+'"]');if(r)r.checked=true;}
  const n=el.querySelector(".note");if(n&&s.note!==undefined)n.value=s.note;}
function stats(){let d=0,t=0;for(const k in state){if(state[k].v==="done")d++;else if(state[k].v==="todo")t++;}
  sd.textContent=d;st.textContent=t;bd.style.width=(d/TOTAL*100)+"%";bt.style.width=(t/TOTAL*100)+"%";}
items.forEach(el=>{const id=el.dataset.id;
  el.querySelectorAll('input[type=radio]').forEach(r=>r.addEventListener("change",()=>{state[id]=Object.assign({},state[id],{v:r.value});save();paint(el);stats();}));
  const n=el.querySelector(".note");n.addEventListener("input",()=>{state[id]=Object.assign({},state[id],{note:n.value});save();});
  paint(el);});
stats();
let tab="all";document.querySelectorAll(".tabchip[data-tab]").forEach(c=>c.addEventListener("click",()=>{
  document.querySelectorAll(".tabchip[data-tab]").forEach(x=>x.classList.remove("active"));c.classList.add("active");tab=c.dataset.tab;
  document.querySelectorAll(".module").forEach(s=>s.classList.toggle("hide",tab!=="all"&&s.dataset.mod!==tab));}));
function $(i){return document.getElementById(i)}
$("export").onclick=()=>{let out="AI 图书馆 验收·未完成清单 "+new Date().toLocaleString()+"\\n\\n";let arr=[];
  items.forEach(el=>{const s=state[el.dataset.id]||{};if(s.v==="todo"){const mod=el.closest(".module").querySelector("h2").textContent.trim().split(" ")[0];
    const sm=el.closest(".submod").querySelector(".sh").textContent.trim().split(" ")[0];
    arr.push("[未完成] "+mod+" / "+sm+" / "+el.querySelector(".fn").textContent+(s.note?" — "+s.note:""));}});
  out+=arr.length?arr.join("\\n"):"（暂无未完成项 🎉）";etext.value=out;modal.classList.remove("hide");};
$("close").onclick=()=>modal.classList.add("hide");
$("copy").onclick=()=>{etext.select();try{navigator.clipboard.writeText(etext.value)}catch(e){document.execCommand("copy")}};
$("reset").onclick=()=>{if(confirm("确定清空全部勾选？")){for(const k in state)delete state[k];save();items.forEach(paint);stats();}};
</script></body></html>`;
}

const outDir = "docs/交付物";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "01_功能清单.html"), buildFeatureList(), "utf8");
fs.writeFileSync(path.join(outDir, "02_验收清单.html"), buildAcceptance(), "utf8");
console.log("已生成 | Tab", TABS.length, "| 功能点", totalFeatures);
TABS.forEach((t) => console.log("  " + t.tab + ": " + t.modules.length + " 模块 / " + t.modules.reduce((a, m) => a + m.features.length, 0) + " 功能点"));
